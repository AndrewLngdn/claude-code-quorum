# Quorum

A Claude Code plugin that lets Claude ask other LLMs through [OpenRouter](https://openrouter.ai) for a second opinion.

Useful for a sanity check before you trust Claude's answer.

```text
> /quorum:ask small B2B SaaS for ~50 customers, deployed on a single
  VPS, ~80% reads. SQLite or Postgres?

## ~openai/gpt-latest
**Default recommendation: Postgres.**

For a small B2B SaaS with ~50 customers on a single VPS and mostly
reads, **SQLite can absolutely work**, but **Postgres is the safer
default** for a SaaS product unless you have a strong reason to keep
things ultra-simple.

## ~google/gemini-pro-latest
For a single VPS setup with ~50 customers and an 80% read workload,
**SQLite** is the best choice.

## mistralai/mistral-large-2512
For a small B2B SaaS with ~50 customers, deployed on a single VPS,
and with ~80% reads, **SQLite is a strong contender** and could work
well for your use case.

**My take:** SQLite for now. At 50 customers and one VPS, the simpler
ops story wins. Migrate to Postgres if write contention or horizontal
scaling becomes a real signal, not before.
```

(Verbatim opening of each response, plus my own take. Real responses run longer.)

When you ask about something already in your conversation ("is this right?"), Claude grabs the relevant code, error, or plan and includes it so you don't have to repaste. If a model still needs more context, it asks back. Claude rolls overlapping questions into one before re-running.

## Install

```text
/plugin marketplace add AndrewLngdn/claude-code-quorum
/plugin install quorum@andrewlngdn
```

It'll prompt for an OpenRouter API key ([get one](https://openrouter.ai/keys)). Requires [Node 18+](https://nodejs.org).

## Commands

- `/quorum:ask <q>` sends to the configured panel.
- `/quorum:ask using gpt: <q>` asks just one model.
- `/quorum:ask with claude, gemini: <q>` overrides the panel for one call.
- `/quorum:status` shows what's configured.

Family shortcuts you can use anywhere a model is named: `gpt`, `gemini`, `claude`, `kimi`. Anything else has to be a full OpenRouter slug.

You can ask Claude "compare them" or "who's right?" after a panel call to get a synthesis.

## Configuration

`/plugin → Quorum`:

- `panel_models`: comma-separated list. Default: `gpt,gemini,mistralai/mistral-large-2512`.
- `require_no_logging`: on by default. Tells OpenRouter to only use providers that don't log or train on prompts. Turn off if you've added a model whose only providers train on data.

## How it works

One file at `plugins/quorum/mcp-server/server.mjs`, no deps. Exposes `ask` and `status` MCP tools. Each `ask` call fires N parallel POSTs to OpenRouter's `/api/v1/chat/completions`. No streaming, no conversation history.

## Privacy & cost

Per-token pricing is whatever the underlying provider charges. OpenRouter takes ~5% on credit deposits.

With `require_no_logging` on, OpenRouter only routes to providers that don't train on prompts. OpenAI, Anthropic, Google, and Mistral all qualify. For open-weight models, OpenRouter picks a no-train provider when one's available. Details in [OpenRouter's privacy docs](https://openrouter.ai/docs/privacy-and-logging).

## License

MIT.
