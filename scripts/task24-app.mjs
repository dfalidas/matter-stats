// Test-process entry point ONLY. No application import, endpoint, environment
// override or production auth change. Decisions travel over a private parent IPC
// channel; loss of that channel fails closed. Never write credentials or bodies.
import assert from "node:assert/strict";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { installTransport } from "./task24-transport.mjs";

assert.equal(process.env.DISPOSABLE_DB_ACK, "yes");
assert.ok(process.send, "Task 24 requires its private runner IPC channel");
const config = await new Promise((resolve) => process.once("message", resolve));
assert.equal(config.type, "configure");
const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
// Defense in depth for transports other than fetch: no external TCP connection,
// including an accidental real Matter request, may leave this app process.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  const host =
    typeof options === "object"
      ? (options.host ?? options.hostname ?? "localhost")
      : typeof normalized[1] === "string"
        ? normalized[1]
        : "localhost";
  if (!loopback.has(host)) {
    process.send?.({ type: "unexpected-network" });
    throw new Error("Task 24 refused non-loopback TCP");
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();
installTransport(config, process);
process.argv = [
  process.execPath,
  "next",
  "start",
  config.directory,
  "--hostname",
  "127.0.0.1",
  "--port",
  String(config.port),
];
await import("../node_modules/next/dist/bin/next");
