---
description: Show the configured panel and API key status
---

Call the `status` tool from the quorum MCP server and present like this:

**Panel:**
- `<panel[i].input>` → `<panel[i].resolved>`

If input and resolved are identical, show only one.

If `api_key_source` is `"none"`, say so above the panel. The plugin can't make calls without a key. If `require_no_logging` is `true`, mention it once: `_No-logging routing: on (only no-train providers)._`

End with: _Edit via `/plugin` → Quorum → settings._
