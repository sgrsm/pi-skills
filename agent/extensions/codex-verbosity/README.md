# Codex verbosity extension

Controls the `text.verbosity` value sent to the OpenAI Codex provider from Pi.

## What it does

- Applies only when the active model provider is `openai-codex`.
- Before each provider request, adds or replaces `payload.text.verbosity` with the configured value.
- Keeps any other `payload.text` fields unchanged.
- Does nothing for non-Codex providers.
- Persists the selected value in `agent/extensions/codex-verbosity/config.json`.

Valid verbosity values:

- `low`
- `medium`
- `high`

If the config file is missing, unreadable, or contains an invalid value, the extension falls back to `low`.

## When it is used

Use this when running Pi with an OpenAI Codex model and you want to control how verbose the model's text output should be. After setting a value, requests to the `openai-codex` provider use it automatically.

## Slash command

```text
/codex-verbosity low|medium|high
```

Behavior:

- `/codex-verbosity` shows the current value and usage.
- `/codex-verbosity low` sets and saves low verbosity.
- `/codex-verbosity medium` sets and saves medium verbosity.
- `/codex-verbosity high` sets and saves high verbosity.
- Invalid arguments show the usage warning.

Argument completion is available for `low`, `medium`, and `high`.

## Examples

```text
/codex-verbosity
/codex-verbosity low
/codex-verbosity medium
/codex-verbosity high
```

Example persisted config:

```json
{
  "verbosity": "medium"
}
```

## Tools, flags, and events

- Tools: none.
- CLI flags: none.
- Event hook: `before_provider_request`.
- Provider filter: `ctx.model.provider === "openai-codex"`.

## UI notifications and status

There is no persistent footer/status indicator.

The extension uses standard UI notifications:

- Info: current verbosity and usage when run without arguments.
- Info: confirmation after setting a new value.
- Warning: usage message for invalid arguments.
