# Web search extension

Adds a `web_search` tool to Pi for live web lookups through a SearXNG endpoint.

## What it does

- Searches the web for current information, external docs, or sources outside the local workspace.
- Returns direct answers, infoboxes, result snippets, source URLs, suggestions, and structured details.
- Tries the SearXNG JSON API first; if unavailable, falls back to parsing the HTML results page.
- Instructs the agent to cite returned URLs after using the tool.

## When it is used

Pi may use `web_search` when the user asks for current web information or when local files do not contain the answer. If web search is disabled, calls are blocked with a message telling the user to run `/web-search on`.

## Slash command

`/web-search` controls whether the `web_search` tool is active. The setting is global and persisted.

Examples:

```text
/web-search        # show current state
/web-search on     # enable and save globally
/web-search off    # disable and save globally
```

Autocomplete is provided for `on` and `off`.

State is saved to:

- `$PI_CODING_AGENT_DIR/web-search.json`, when `PI_CODING_AGENT_DIR` is set
- otherwise `~/.pi/agent/web-search.json`

Default state is enabled when no saved state exists.

## Tool

Tool name: `web_search`  
Label: `Web Search`

Parameters:

- `query` - required search query
- `limit` - optional maximum number of results, clamped to `1..10` and defaulting to `5`
- `categories` - optional comma-separated SearXNG categories, for example `general,news,it`
- `language` - optional language code, for example `en-US` or `all`
- `timeRange` - optional freshness filter: `day`, `month`, or `year`

Example tool call shape:

```json
{
  "query": "Node.js current LTS release",
  "limit": 5,
  "categories": "general,it",
  "language": "en-US",
  "timeRange": "month"
}
```

Search endpoint selection:

1. `PI_SEARXNG_URL`
2. `SEARXNG_URL`
3. `https://agentsearch.area55.me`

## Events and behavior

- `session_start` reloads the saved on/off state, adds or removes `web_search` from active tools, and refreshes the footer status.
- `tool_call` blocks `web_search` when the saved/current state is off.
- No custom flags or shortcuts are registered.

## Status indicator

When the terminal UI is available, the footer shows one dim status item:

- `web-search: on •`
- `web-search: off •`

The status is refreshed on session start and when `/web-search on|off` changes the state.
