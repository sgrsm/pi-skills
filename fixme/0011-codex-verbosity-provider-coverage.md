# 0011: Make Codex verbosity's actual provider coverage explicit

- **Status:** Resolved — conservative local coverage fix; host API follow-up Open in [TDR-0006](../tdr/0006-provider-request-physical-model-identity.md)
- **Priority:** Low; direct legacy provider works
- **Evidence:** Test-first local regressions; host API limitation source-verified; successor/virtual dispatch not live-tested
- **Area:** `agent/extensions/codex-verbosity`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

At the audit baseline, the request hook in `agent/extensions/codex-verbosity/index.ts` filtered only by `ctx.model.provider === "openai-codex"`. The audited default provider was exactly that, so the direct legacy path worked.

Pi also offers ChatGPT sign-in through `openai`/Responses. The extension did nothing on that path, yet `/codex-verbosity` confirmed the setting without explaining that it was inactive for the selected provider.

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

Run `node --test codex-verbosity/index.test.ts` and `npm run verify` from `agent/extensions/`, with approved canonical scratch for the full gate. No login, token access, or paid model request is necessary.

## Resolution and validation

The user approved the conservative local correction and a separately documented host enhancement. The follow-up is [TDR-0006](../tdr/0006-provider-request-physical-model-identity.md), not an extension README implementation report or authorization to patch Pi.

Implemented:

- The hook requires both selected provider `openai-codex` and API `openai-codex-responses`. Missing/unknown APIs, unrelated providers, `openai`/Responses and virtual selections are skipped. The current internal `pi-virtual` marker refines command wording only; support does not depend on that marker remaining unchanged.
- Save and query notifications distinguish the preference from selected-model coverage, including successor, virtual and missing-selection explanations. No per-request warnings or status item were added.
- Payload replacement preserves other text fields, including structured-output format settings. Non-record payloads and malformed existing text values are untouched.
- `registerCodexVerbosityExtension()` injects config reads/writes for tests and owns the mutable preference per instance. Importing the module no longer reads personal configuration. The default factory retains the existing config path, JSON shape, normalization and `low` fallback.
- A failed save reports an error and preserves the running preference; memory is updated only after a successful write. Existing non-atomic file writes were not redesigned, so this is not a promise to roll back a partial disk write.
- The user guide explains how to select the legacy provider, saved-versus-applied feedback, unsupported coverage, reload behavior and troubleshooting. Host source/design/acceptance details live in TDR-0006.

Test-first reproduction: after introducing only the injectable registration seam and instance-local state, the focused suite had **7 passing and 7 failing tests**. Failures reproduced provider/API and virtual filtering, malformed-payload handling, missing coverage feedback, and save-error behavior. After correction, all **14 focused tests passed**.

Validation on Pi **1.0.0**, Node **v22.19.0**: focused tests, TypeScript and all five host dependency links passed; `npm run verify` passed **594 tests**, with none failed/cancelled/skipped, using approved canonical session scratch for both scratch environment variables.

An independent read-only reviewer found no blocking code defects. Its tracking warning led to closing this record and linking TDR-0006 in the index. Its optional observations led to clearer internal-marker wording, the sibling-event API precedent, legacy-picker guidance and a current-command getter in the test harness. The reviewer executed no tests; validation was parent-run.

Limits: tests use in-memory config dependencies and synthetic selected models/payloads; they never invoke the real config writer. No live provider request, login, token access, end-to-end virtual routing, installed-host patch, dependency change or personal-configuration change was used. Physical request identity and successor/routed provider support remain outside this local correction.
