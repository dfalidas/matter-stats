import assert from "node:assert/strict";

export function assertLocalOrigin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:");
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname),
    "hosted database refused",
  );
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.equal(url.pathname, "/");
  return url.origin;
}

export function installTransport(config, ipc) {
  const database = assertLocalOrigin(config.database);
  const application = assertLocalOrigin(config.application);
  const originalFetch = globalThis.fetch;
  let sequence = 0;
  const pending = new Map();
  ipc.on("message", (message) => {
    if (message.type !== "decision") return;
    pending.get(message.id)?.(message.decision);
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const matter =
      url.origin === "https://api.getmatter.com" &&
      url.pathname.startsWith("/public/v1/");
    if (!matter && ![database, application].includes(url.origin)) {
      ipc.send?.({ type: "unexpected-network" });
      throw new Error("Task 24 refused unknown fetch destination");
    }
    const id = ++sequence;
    const decision = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Task 24 transport controller unavailable"));
      }, 5000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(value);
      });
      ipc.send({
        type: "request",
        id,
        matter,
        path: url.pathname,
        method:
          init?.method ?? (input instanceof Request ? input.method : "GET"),
        // Only synthetic upstream parameters; database predicates/cookies/headers
        // and all request bodies stay inside the app process.
        query: matter ? Object.fromEntries(url.searchParams) : undefined,
      });
    });
    if (decision.kind === "fault")
      return Response.json(
        { message: "Synthetic transport unavailable" },
        { status: 503 },
      );
    if (decision.kind === "drop")
      throw Object.assign(new TypeError("Synthetic interrupted request"), {
        cause: { code: "ECONNRESET" },
      });
    if (matter) {
      assert.equal(
        decision.kind,
        "synthetic",
        "Matter may never reach a real transport",
      );
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (decision.delay)
        await new Promise((resolve, reject) => {
          signal?.throwIfAborted();
          const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          }, decision.delay);
          signal?.addEventListener("abort", abort, { once: true });
        });
      return Response.json(decision.body, {
        status: decision.status ?? 200,
        headers: decision.headers,
      });
    }
    assert.ok(["real", "drop-after"].includes(decision.kind));
    const response = await originalFetch(input, init);
    if (decision.kind === "drop-after") {
      await response.arrayBuffer();
      throw new TypeError("Synthetic lost persisted response");
    }
    return response;
  };
}
