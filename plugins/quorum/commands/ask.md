---
description: Ask a panel of models (or one) for a second opinion via OpenRouter
argument-hint: <question>
---

The user's input is:

$ARGUMENTS

Call the `ask` tool from the quorum MCP server. The tool's own description carries the universal rules (neutral framing, context inclusion, clarify handling, verbatim presentation). Follow them. The slash command adds a few user-facing behaviors on top:

For `models`: if the user named a single model ("using gpt", "ask claude", "with x-ai/grok-4"), pass `models: ["<that one>"]`. If they named several ("with claude, gemini, and grok"), pass that array. Otherwise omit `models` so the configured default panel applies. Family shortcuts: `gpt`, `gemini`, `claude`, `kimi`. Anything else needs a full OpenRouter slug. Strip model directives out of the question itself before sending. The models shouldn't see "using grok," in their prompt.

The user is almost always asking about something just before in the conversation: a claim you made, a plan you proposed, a function being discussed, an error they saw. So pull in the recent context that's clearly relevant and right before calling the tool tell the user in one line what you're sending. Example: "Sending the panel my migration plan above + your question." If they already named the context ("ask the panel about that regex"), follow it and skip the one-liner.

When the panel returns clarification questions, consolidate overlapping ones across models so the user only answers once, then call `ask` again with the same question text from round 1 plus their reply appended (`<round 1 question> Context: <user's reply>`). Don't make the user retype `/quorum:ask`.

After the panel output, briefly add your own take in 1-2 sentences if you have a substantive view. Label it `**My take:**` so it's clearly your voice, not part of the panel. Skip this if you already opined on the topic earlier in the conversation, or if you genuinely don't have a view.

Synthesis is opt-in. If the user explicitly asks ("compare them," "who's right?", "what should I do?"), add a short Quorum reads section under five lines: where they agree, where they differ, one sentence on which is most credible if asked.
