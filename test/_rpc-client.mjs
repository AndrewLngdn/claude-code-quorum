// Minimal MCP-over-stdio client for the test suite. Spawns the server,
// resolves each `call()` when the matching response arrives — no polling.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "plugins/quorum/mcp-server/server.mjs",
);

export function startServer({ env = {} } = {}) {
  const proc = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ...env },
  });

  const pending = new Map();
  let nextId = 1;
  let buf = "";
  let exited = null; // { code, signal } once the server has exited

  function failPending(reason) {
    for (const slot of pending.values()) slot.reject(new Error(reason));
    pending.clear();
  }

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const slot = pending.get(msg.id);
      if (slot) {
        pending.delete(msg.id);
        slot.resolve(msg);
      }
    }
  });

  proc.on("exit", (code, signal) => {
    exited = { code, signal };
    failPending(`Server exited (code=${code}, signal=${signal}) before responding.`);
  });
  proc.on("error", (err) => failPending(`Server spawn failed: ${err.message}`));

  function call(method, params, timeoutMs = 30000) {
    if (exited) {
      return Promise.reject(
        new Error(`Server already exited (code=${exited.code}, signal=${exited.signal}).`),
      );
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method} (id ${id}) after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  return { call, close: () => proc.kill() };
}
