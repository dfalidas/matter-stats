import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
  assertLocalOrigin,
  installTransport,
} from "../scripts/task24-transport.mjs";
import { expectedRows } from "../scripts/task24-fixtures.mjs";
import { imageRegistryEnvironment } from "../scripts/stabilization-db-orchestrator.mjs";

test("only the reviewed official CLI image registry selection is forwarded", () => {
  assert.deepEqual(imageRegistryEnvironment({}), {});
  assert.deepEqual(
    imageRegistryEnvironment({
      STABILIZATION_TEST_IMAGE_REGISTRY: "docker.io",
    }),
    { SUPABASE_INTERNAL_IMAGE_REGISTRY: "docker.io" },
  );
  for (const value of [
    "https://docker.io",
    "unreviewed.example",
    "public.ecr.aws/other",
  ])
    assert.throws(
      () =>
        imageRegistryEnvironment({ STABILIZATION_TEST_IMAGE_REGISTRY: value }),
      /refused/,
    );
});

test("Task 24 refuses hosted, credential-bearing and non-HTTP database origins", () => {
  for (const url of [
    "https://production.supabase.co",
    "http://localhost.attacker.test",
    "https://localhost",
    "http://user:secret@localhost",
    "http://127.0.0.1/path",
    "http://localhost?target=hosted",
  ])
    assert.throws(() => assertLocalOrigin(url));
  assert.equal(
    assertLocalOrigin("http://127.0.0.1:58421"),
    "http://127.0.0.1:58421",
  );
});

test("Task 24 process transport never forwards Matter or unknown requests; real DB path retains original fetch", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const actual = [];
  globalThis.fetch = async (input, init) => {
    actual.push([String(input), init]);
    return Response.json({ persisted: true });
  };
  const ipc = new EventEmitter();
  let mode = "real",
    unexpected = 0;
  ipc.send = (message) => {
    if (message.type === "unexpected-network") {
      unexpected++;
      return;
    }
    queueMicrotask(() =>
      ipc.emit("message", {
        type: "decision",
        id: message.id,
        decision: message.matter
          ? {
              kind: mode === "real" ? "synthetic" : mode,
              body: { synthetic: true },
            }
          : { kind: mode },
      }),
    );
  };
  installTransport(
    {
      database: "http://127.0.0.1:58421",
      application: "http://localhost:3094",
    },
    ipc,
  );
  assert.deepEqual(
    await (await fetch("https://api.getmatter.com/public/v1/me")).json(),
    { synthetic: true },
  );
  assert.equal(actual.length, 0);
  await assert.rejects(fetch("https://api.getmatter.com/unknown"), /refused/);
  await assert.rejects(fetch("https://example.com"), /refused/);
  assert.equal(unexpected, 2);
  assert.equal(actual.length, 0);
  await fetch("http://127.0.0.1:58421/rest/v1/reading_sessions", {
    method: "POST",
    body: "real",
  });
  assert.equal(actual.length, 1);
  assert.equal(actual[0][1].body, "real");
  await fetch("http://127.0.0.1:3094/dashboard");
  assert.equal(
    actual.length,
    2,
    "Next internal redirect fetch uses the exact application port",
  );
  await assert.rejects(fetch("http://127.0.0.1:3095/dashboard"), /refused/);
  mode = "fault";
  assert.equal(
    (await fetch("http://127.0.0.1:58421/rest/v1/app_sessions")).status,
    503,
  );
  assert.equal(actual.length, 2);
  mode = "drop-after";
  await assert.rejects(
    fetch("http://127.0.0.1:58421/rest/v1/rpc/commit_matter_page"),
    /persisted response/,
  );
  assert.equal(actual.length, 3);
});

test("independent fixture states 180 seconds/675 words and excludes exclusive midnight; fractional estimates sum per session", () => {
  assert.deepEqual(expectedRows("2025-01-02", "2025-01-02"), [
    ["2025-01-02", 180, 675, 3],
  ]);
  assert.deepEqual(expectedRows("2025-03-30", "2025-03-30"), [
    ["2025-03-30", 2, 8, 2],
  ]);
});
