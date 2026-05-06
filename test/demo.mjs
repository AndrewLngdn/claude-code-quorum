// Demo / dev harness: spawn the MCP server and run `ask` (default panel) with
// a question from argv. Useful for testing architectural questions through the
// real plugin code path without installing into Claude Code.
//
// Usage:
//   OPENROUTER_API_KEY=... node test/demo.mjs "your question here"

import { startServer } from "./_rpc-client.mjs";

const question = process.argv.slice(2).join(" ");
if (!question) {
  console.error("Usage: node test/demo.mjs <question>");
  process.exit(1);
}

const { call, close } = startServer();

try {
  await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "demo", version: "0" },
  });

  const reply = await call("tools/call", { name: "ask", arguments: { question } }, 120000);
  if (reply.result?.isError) {
    console.error("✗", reply.result.content?.[0]?.text);
    close();
    process.exit(1);
  }
  console.log(reply.result.content[0].text);
  close();
  process.exit(0);
} catch (err) {
  console.error("✗", err.message);
  close();
  process.exit(1);
}
