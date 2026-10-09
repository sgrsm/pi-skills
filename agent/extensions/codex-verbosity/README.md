# Codex verbosity extension

Saves a `low`, `medium`, or `high` text-verbosity preference for Pi's legacy OpenAI Codex connection.

## Quick start

The extension loads automatically from `agent/extensions/codex-verbosity/index.ts`. After changing the extension, restart Pi or run `/reload`.

Select a model from **OpenAI Codex (legacy)** in `/model` (provider ID `openai-codex`), then run:

```text
/codex-verbosity medium
```

For supported selections, the extension sets the request's `text.verbosity` while preserving other text settings. This is a provider preference, not a strict answer-length or token limit.

## Supported selections and limits

| Selected model | Behavior |
|---|---|
| Direct legacy `openai-codex` model using `openai-codex-responses` | Applies the saved preference. |
| `openai` / Responses, including the newer ChatGPT sign-in path | Saves the preference but does not apply it. |
| Virtual/router model under any provider | Saves the preference but does not apply it, even if the router chooses Codex. |
| Another provider/API, or no selected model | Saves the preference but does not apply it. |

Pi's model selection can differ from the provider actually receiving a routed request. The extension cannot see that actual destination in the request hook, so it skips virtual selections rather than guessing. Custom provider implementations that redirect requests are also outside its verified coverage.

Malformed request payloads or malformed existing text settings are left untouched. There are no repeated per-request warnings and no persistent footer/status indicator.

The separate [technical follow-up](../../../tdr/20261009-1204-provider-request-physical-model-identity.md) tracks the proposed Pi API improvement; it does not enable additional provider support today.

## Slash command

```text
/codex-verbosity low|medium|high
```

- `/codex-verbosity` shows the current preference, whether it applies to the selection, and usage.
- `/codex-verbosity low`, `medium`, or `high` saves the preference and explains whether it applies to the selection.
- Values are case-insensitive; argument completion is available.
- Invalid arguments show a usage warning without changing the preference.
- If saving fails, an error is shown and the running preference stays unchanged.

Example confirmations:

```text
OpenAI Codex verbosity preference saved as medium. Applies to the selected legacy Codex model.
OpenAI Codex verbosity preference saved as high. Not applied to openai/Responses, including ChatGPT sign-in.
```

Saving while an unsupported model is selected is still useful: the preference will apply when you switch to a supported legacy Codex selection.

## Persistence and defaults

The preference is stored in `agent/extensions/codex-verbosity/config.json`:

```json
{
  "verbosity": "medium"
}
```

The default is `low`. A missing, unreadable, malformed, or invalid config falls back to `low` without rewriting the file. Surrounding whitespace and letter case in a stored value are normalized.

The file is shared across sessions, but an already-running extension keeps its own loaded preference. Run the command in that session or `/reload` to pick up an external change.

## Troubleshooting

- **The preference is saved but not applied:** read the command's coverage message. The newer `openai` connection and all virtual/router selections are intentionally unsupported.
- **Saving fails:** check that the extension directory and `config.json` are writable, then retry the command. If a disk write was interrupted, check the saved file before reloading; an invalid file falls back to `low`.
- **Answers do not have the expected length:** verbosity is a model preference, not a guarantee of a particular response size; prompts and model behavior still affect the result.

The extension adds no tools or CLI flags.
