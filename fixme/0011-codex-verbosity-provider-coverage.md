# 0011: Make Codex verbosity's actual provider coverage explicit

- **Status:** Open
- **Priority:** Low; current legacy provider works
- **Evidence:** Source-verified; successor/virtual dispatch not live-tested
- **Area:** `agent/extensions/codex-verbosity`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

`index.ts:61` applies verbosity only when `ctx.model.provider === "openai-codex"`. The audited default provider is exactly that, so the current path works.

Pi now offers ChatGPT sign-in through `openai`/Responses as well. The extension does nothing on that path, yet `/codex-verbosity` reports the setting as saved without explaining it is inactive for the selected provider.

Virtual models make provider-name inference unsafe: `HOST/docs/virtual-models.md` says `ctx.model` describes selection, not physical dispatch. A virtual selection under openai-codex can route elsewhere; a router under another provider can dispatch to Codex. `before_provider_request` in 1.0.0 exposes payload, not a verified physical-model identity.

## Reproduce / test first

Capture the request hook and test legacy Codex, physical openai/Responses, unrelated providers, missing model, malformed payload, and virtual selections. Test command notifications with stubbed persistence; do not modify `config.json` in the actual extension directory.

Read current `HOST/docs/providers.md`, `virtual-models.md`, extension declarations, and provider payload builders. Do not infer compatibility merely from a payload having a `text` field.

## Recommended fix and settled scope

The minimal safe fix is **coverage transparency**, not silent expansion:

1. Keep the working physical legacy-Codex path and its persistence format.
2. Distinguish "preference saved" from "applies to the selected model" in command feedback.
3. Explain successor-provider and virtual-model limitations in the README; avoid repeated per-request warning spam.
4. Guard unsupported/ambiguous request contexts rather than injecting Codex-specific fields into unrelated payloads.
5. Add a small injectable persistence/helper seam and the first focused tests for this extension.

Supporting the successor provider or routed physical requests is a follow-up only if a documented capability/dispatch contract can identify supported requests safely. If implementation requires broadening provider scope or guessing the physical model, ask before that expansion; do not redesign virtual routing or import private provider internals.

## Acceptance criteria

- Current physical openai-codex requests still receive configured text.verbosity and retain other text fields.
- Unsupported selections do not receive misleading "active" confirmation.
- Malformed payloads and unrelated providers are untouched.
- Virtual selections are not treated as physical identities.
- Defaults, low/medium/high validation, and persisted config remain backward compatible.
- README accurately distinguishes tested support from unsupported/unverified paths.

## Validation

Add `codex-verbosity/index.test.ts`; `node --test codex-verbosity/index.test.ts`; `npm run verify` with approved scratch. No login, token access, or paid model request is necessary.
