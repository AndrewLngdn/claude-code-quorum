// Smoke test: spawn the MCP server, send initialize / tools/list / tools/call,
// verify protocol replies. Doesn't make any real OpenRouter calls.

import { startServer } from "./_rpc-client.mjs";

const { call, close } = startServer({
  env: { OPENROUTER_API_KEY: "test" },
});

function fail(msg) {
  console.error("\n✗", msg);
  close();
  process.exit(1);
}

try {
  const init = await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  if (init.result?.serverInfo?.name !== "quorum") {
    fail(`initialize: expected serverInfo.name=quorum, got ${JSON.stringify(init)}`);
  }
  console.log("✓ initialize");

  const tools = await call("tools/list");
  const names = tools.result?.tools?.map((t) => t.name) ?? [];
  for (const expected of ["ask", "status"]) {
    if (!names.includes(expected)) {
      fail(`tools/list: missing ${expected}. Got: ${names.join(", ")}`);
    }
  }
  console.log("✓ tools/list:", names.join(", "));

  const list = await call("tools/call", { name: "status", arguments: {} });
  const text = list.result?.content?.[0]?.text;
  if (!text || !text.includes("panel") || !text.includes("api_key_source")) {
    fail(`status: bad reply: ${JSON.stringify(list)}`);
  }
  console.log("✓ tools/call status");

  const bad = await call("tools/call", { name: "nonexistent", arguments: {} });
  if (!bad.result?.isError) {
    fail(`unknown tool should return isError. Got: ${JSON.stringify(bad)}`);
  }
  console.log("✓ tools/call rejects unknown tool");

  console.log("\nAll smoke tests passed.");
  close();
  process.exit(0);
} catch (err) {
  fail(err.message);
}
