// Unit tests for pure helpers. Imports server.mjs (which only spawns the
// JSON-RPC loop when run as a script, so importing here is safe).

import { extractClarify } from "../plugins/quorum/mcp-server/server.mjs";

let failed = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    console.log("✓", name);
  } else {
    failed++;
    console.error("✗", name);
    console.error("  got: ", JSON.stringify(got));
    console.error("  want:", JSON.stringify(want));
  }
}

// Pure clarify at start of message.
check(
  "plain CLARIFY at start",
  extractClarify("CLARIFY: what stack are you on?"),
  { before: "", question: "what stack are you on?" },
);

// Markdown-decorated clarify (the pattern Mistral often produces).
check(
  "markdown-decorated CLARIFY header",
  extractClarify("### **CLARIFY:**\nWhat is your tech stack?"),
  { before: "", question: "What is your tech stack?" },
);

// Hybrid: answer first, then clarify at the end.
check(
  "answer + CLARIFY at end",
  extractClarify("Probably yes.\n\nCLARIFY: what's your scale?"),
  { before: "Probably yes.", question: "what's your scale?" },
);

// Lowercase clarify still matches.
check(
  "lowercase clarify:",
  extractClarify("clarify: what language?"),
  { before: "", question: "what language?" },
);

// No clarify in the message → null.
check(
  "no clarify marker",
  extractClarify("Just a normal answer with reasoning."),
  null,
);

// Clarify in the middle of a paragraph (should NOT match — we only want
// it at line starts).
check(
  "clarify mid-sentence is ignored",
  extractClarify("I'd clarify: this isn't a real question marker."),
  null,
);

if (failed > 0) {
  console.error(`\n${failed} unit test${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("\nAll unit tests passed.");
