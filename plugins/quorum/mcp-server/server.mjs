#!/usr/bin/env node
// Quorum MCP server. Speaks MCP stdio JSON-RPC, wraps a couple of OpenRouter tools.
// Zero deps. Requires Node 18+ for global fetch.

import readline from "node:readline";
import { homedir } from "node:os";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_INFO = { name: "quorum", version: "0.1.2" };
// Fallback if the client doesn't send a protocolVersion in `initialize`.
// In practice we echo the client's version back; see handle().
const FALLBACK_PROTOCOL_VERSION = "2025-11-25";

function readApiKey() {
  const env = process.env.OPENROUTER_API_KEY?.trim();
  if (env) return { key: env, source: "env" };
  const file = path.join(homedir(), ".config", "openrouter", "key");
  try {
    if (process.platform !== "win32") {
      const mode = statSync(file).mode & 0o777;
      if (mode & 0o077) {
        console.error(
          `quorum: ${file} is mode ${mode.toString(8)}, readable by group/other. Run \`chmod 600 ${file}\` to lock it down.`,
        );
      }
    }
    const v = readFileSync(file, "utf8").trim();
    if (v) return { key: v, source: "~/.config/openrouter/key" };
  } catch {}
  return { key: null, source: "none" };
}

const { key: OPENROUTER_API_KEY, source: API_KEY_SOURCE } = readApiKey();
const PANEL_MODELS = (process.env.QUORUM_PANEL_MODELS || "gpt,gemini,mistralai/mistral-large-2512")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Frontier models can take 30+s for complex prompts; 90s is a comfortable ceiling.
const TIMEOUT_MS = Number(process.env.QUORUM_TIMEOUT_MS) || 90_000;

// When on (default), attach `provider.data_collection: "deny"` to every
// chat-completions call so OpenRouter only routes to inference providers that
// don't log or train on prompts. May fail for some models if no qualifying
// provider exists; turn off via QUORUM_REQUIRE_NO_LOGGING=false.
const REQUIRE_NO_LOGGING = !["0", "false", "no", "off", "disabled"].includes(
  String(process.env.QUORUM_REQUIRE_NO_LOGGING ?? "").toLowerCase(),
);

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Lets a model ask for more context instead of guessing. Models opt in by
// prefixing their reply with "CLARIFY:". The server detects this and renders
// it as a "Needs more context" note so the user can see which models stalled
// and re-run the panel with the missing info.
const DEFAULT_SYSTEM_PROMPT =
  "Answer the user's question. If you'd need more context to give a useful answer, " +
  "you may ask one clarifying question instead. Start your reply with `CLARIFY:` and ask the question. " +
  "Otherwise, just answer.";

function explainOpenRouterError(status, body, model) {
  const trimmed = body.slice(0, 500);
  let hint = "";
  if (status === 401) {
    hint = " API key invalid or expired. Configure via /plugin → Quorum.";
  } else if (status === 402) {
    hint = " Insufficient OpenRouter credits. Top up at https://openrouter.ai/credits.";
  } else if (status === 429) {
    hint = " Rate limited. Retry shortly, or pick a different model.";
  } else if (/not a valid model/i.test(body)) {
    hint = ` Unknown model slug "${model}". Browse https://openrouter.ai/models.`;
  }
  return `OpenRouter ${status} for ${model}: ${trimmed}${hint}`;
}

// Family names map to OpenRouter's provider-maintained -latest aliases.
// Anything containing "/" is an exact slug and bypasses lookup.
const FAMILIES = {
  gpt:    "~openai/gpt-latest",
  claude: "~anthropic/claude-opus-latest",
  gemini: "~google/gemini-pro-latest",
  kimi:   "~moonshotai/kimi-latest",
};

const ALIASES = {
  openai: "gpt",
  google: "gemini",
  anthropic: "claude",
};

function resolveSlug(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.includes("/")) return trimmed;
  const family = ALIASES[trimmed.toLowerCase()] ?? trimmed.toLowerCase();
  return FAMILIES[family] ?? trimmed;
}

const TOOLS = [
  {
    name: "ask",
    description:
      `Ask one or more OpenRouter models a question for a parallel second opinion.

\`models\`: array of family names or OpenRouter slugs. Omit for the configured default panel (${PANEL_MODELS.join(", ")}). Family shortcuts: ${Object.keys(FAMILIES).join(", ")}; anything else must be an exact slug.

How to use this tool well:
- Frame the question neutrally. Don't load one alternative with positive words ("clean," "principled") and the other with negative ones ("paternalistic," "overengineered"). That biases the panel.
- Include the context the user is asking about (a claim, a plan, a snippet, an error). The bare question alone is usually insufficient; pull in what they're plausibly referring to.
- Responses render as \`## <model_slug>\` blocks. If a model returns \`_Needs more context:_ <question>\` instead of an answer, that's the model asking the user back, not an opinion to weigh. Surface those questions to the user (consolidating overlapping ones across models so they don't answer the same thing three times), then re-call this tool with their reply appended to the original question.
- Present each model's response verbatim under its heading. Don't paraphrase, rank, or synthesize unless the user explicitly asks ("compare them," "who's right?", "what should I do?").`,
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question or prompt to send." },
        models: {
          type: "array",
          items: { type: "string" },
          description: `Family names or OpenRouter slugs. Omitted = configured default panel: ${PANEL_MODELS.join(", ")}`,
        },
        system: { type: "string", description: "Optional system prompt sent to every model. Replaces the default system prompt (which permits models to ask `CLARIFY:` questions). Most callers should omit." },
      },
      required: ["question"],
    },
  },
  {
    name: "status",
    description:
      `Return the configured panel, family/alias mappings, API key source, no-logging policy, and request timeout. Diagnostic.

When surfacing this to a user: if \`api_key_source\` is "none", the user hasn't configured a key. Say so explicitly so they know to set one. If \`require_no_logging\` is true, mention it briefly so they know provider routing is constrained.`,
    inputSchema: { type: "object", properties: {} },
  },
];

async function callOpenRouter({ model, question, system }) {
  if (!OPENROUTER_API_KEY) {
    throw new Error(
      "No OpenRouter API key. Configure it via /plugin → Quorum. Get a key at https://openrouter.ai/keys.",
    );
  }
  const messages = [];
  messages.push({ role: "system", content: system ?? DEFAULT_SYSTEM_PROMPT });
  messages.push({ role: "user", content: question });

  let res;
  try {
    res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        // OpenRouter uses these for attribution in the dashboard's per-app
        // usage breakdown. Optional but recommended.
        "HTTP-Referer": "https://github.com/AndrewLngdn/claude-code-quorum",
        "X-Title": "Claude Code Quorum",
      },
      body: JSON.stringify({
        model,
        messages,
        ...(REQUIRE_NO_LOGGING && { provider: { data_collection: "deny" } }),
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        `Timed out after ${TIMEOUT_MS / 1000}s waiting for ${model}. Set QUORUM_TIMEOUT_MS to override.`,
      );
    }
    throw new Error(`Network error calling OpenRouter for ${model}: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(explainOpenRouterError(res.status, text, model));
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || "_(empty response)_";
  return { model, content, usage: json.usage };
}

// Find a CLARIFY marker the model emitted, tolerating markdown decoration
// (e.g. `### **CLARIFY:**`, `**Clarify:**`, plain `CLARIFY:`).
// Returns { before, question } or null.
export function extractClarify(text) {
  const re = /(^|\n)\s*[#*\s]*clarify\s*:?\s*[*\s]*(?:\n+|[ \t]+)([^\n].*?)(?:\n\n|$)/is;
  const m = text.match(re);
  if (!m) return null;
  const idx = m.index + m[1].length; // skip the leading anchor (^/\n)
  return {
    before: text.slice(0, idx).trim(),
    question: m[2].trim(),
  };
}

function fmtSingle({ model, content, usage }) {
  const tokens = usage
    ? ` _(${usage.prompt_tokens}+${usage.completion_tokens} tok)_`
    : "";
  const clarify = extractClarify(content.trim());
  let body;
  if (clarify && !clarify.before) {
    // No answer body, only a clarification request.
    body = `_Needs more context:_ ${clarify.question}`;
  } else if (clarify) {
    // Answer + clarification appended.
    body = `${clarify.before}\n\n_Also wants to know:_ ${clarify.question}`;
  } else {
    body = content;
  }
  return `## ${model}${tokens}\n\n${body}`;
}

function fmtPanel(slugs, results) {
  const parts = results.map((r, i) =>
    r.status === "fulfilled"
      ? fmtSingle(r.value)
      : `## ${slugs[i]}\n\n_Error: ${r.reason?.message ?? String(r.reason)}_`,
  );

  const usages = results
    .filter((r) => r.status === "fulfilled" && r.value.usage)
    .map((r) => r.value.usage);
  if (usages.length > 1) {
    const prompt = usages.reduce((s, u) => s + (u.prompt_tokens ?? 0), 0);
    const completion = usages.reduce((s, u) => s + (u.completion_tokens ?? 0), 0);
    parts.push(`_Total: ${prompt} prompt + ${completion} completion tokens across ${usages.length} models._`);
  }
  return parts.join("\n\n---\n\n");
}

async function callTool(name, args) {
  if (name === "ask") {
    const inputs =
      Array.isArray(args.models) && args.models.length > 0 ? args.models : PANEL_MODELS;
    if (!inputs.length) {
      throw new Error(
        "No models configured. Set `panel_models` in /plugin → Quorum, or pass `models` in the tool call.",
      );
    }
    const slugs = inputs.map(resolveSlug);
    const results = await Promise.allSettled(
      slugs.map((slug) =>
        callOpenRouter({ model: slug, question: args.question, system: args.system }),
      ),
    );
    return { content: [{ type: "text", text: fmtPanel(slugs, results) }] };
  }
  if (name === "status") {
    const payload = {
      panel: PANEL_MODELS.map((p) => ({ input: p, resolved: resolveSlug(p) })),
      families: FAMILIES,
      aliases: ALIASES,
      api_key_source: API_KEY_SOURCE,
      require_no_logging: REQUIRE_NO_LOGGING,
      request_timeout_ms: TIMEOUT_MS,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(req) {
  const { id, method, params } = req;
  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? FALLBACK_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }
    if (method === "tools/call") {
      const result = await callTool(params.name, params.arguments || {});
      return { jsonrpc: "2.0", id, result };
    }
    if (method?.startsWith("notifications/")) {
      return null;
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      },
    };
  }
}

// Only start the JSON-RPC loop when executed directly as a script.
// Imported (e.g. by unit tests) the module just exposes its helpers.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    const isNotification = req.id === undefined || req.id === null;
    const reply = await handle(req);
    if (reply && !isNotification) send(reply);
  });
}
