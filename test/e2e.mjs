// End-to-end test: hit real OpenRouter via the MCP server.
// Reads OPENROUTER_API_KEY from env. Runs ask (single + panel) calls.

import { startServer } from "./_rpc-client.mjs";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("OPENROUTER_API_KEY not set; skipping e2e test.");
  process.exit(0);
}

const { call, close } = startServer({
  env: {
    OPENROUTER_API_KEY: key,
    // Mix family resolution with explicit cheap slugs to keep the test fast/cheap.
    // - "openai/gpt-5.4-nano" exercises the literal-slug bypass.
    // - "~google/gemini-flash-latest" exercises a direct -latest alias.
    // - "gemini" exercises family-name resolution (maps to ~google/gemini-pro-latest).
    QUORUM_PANEL_MODELS: "openai/gpt-5.4-nano,~google/gemini-flash-latest,gemini",
  },
});

const fail = (m) => {
  console.error("\n✗", m);
  close();
  process.exit(1);
};

try {
  await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "e2e", version: "0" },
  });

  console.log("→ ask (single model): 'reply with the single word PONG'");
  const ask = await call("tools/call", {
    name: "ask",
    arguments: {
      question: "Reply with exactly the single word: PONG",
      models: ["openai/gpt-5.4-nano"],
    },
  });
  if (ask.result?.isError) fail(`ask errored: ${JSON.stringify(ask.result.content)}`);
  const askText = ask.result?.content?.[0]?.text || "";
  console.log("← " + askText.replace(/\n/g, "\n  "));
  if (!/PONG/i.test(askText)) fail("ask did not return PONG");
  console.log("✓ ask (single model)");

  console.log("\n→ ask (default panel, 3 models): 'reply with single word PANEL_OK'");
  const panel = await call(
    "tools/call",
    {
      name: "ask",
      arguments: { question: "Reply with exactly the single word: PANEL_OK" },
    },
    60000,
  );
  if (panel.result?.isError) fail(`ask (panel) errored: ${JSON.stringify(panel.result.content)}`);
  const panelText = panel.result?.content?.[0]?.text || "";
  console.log("← " + panelText.replace(/\n/g, "\n  "));
  const matches = (panelText.match(/PANEL_OK/gi) || []).length;
  if (matches < 2) fail(`ask (panel): expected at least 2 PANEL_OK, got ${matches}`);
  console.log(`✓ ask (panel, ${matches} models replied as expected)`);

  // Family resolution: "gemini" should resolve to ~google/gemini-pro-latest.
  console.log("\n→ status (verifies family resolution)");
  const list = await call("tools/call", { name: "status", arguments: {} });
  const listText = list.result?.content?.[0]?.text || "";
  console.log("← " + listText.replace(/\n/g, "\n  "));
  if (!/"input":\s*"gemini"/.test(listText)) fail("expected gemini in panel input");
  if (!/"resolved":\s*"~google\/gemini-pro-latest"/.test(listText)) {
    fail("expected gemini family to resolve to ~google/gemini-pro-latest");
  }
  console.log("✓ family resolution");

  console.log("\nAll e2e tests passed.");
  close();
  process.exit(0);
} catch (err) {
  fail(err.message);
}
