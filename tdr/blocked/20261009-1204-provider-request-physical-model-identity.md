# TDR-20261009-1204: Expose physical model identity to provider-request extensions

- **Status:** Blocked — source-verified API limitation; host enhancement deferred upstream
- **Priority:** Low; direct legacy Codex verbosity remains supported
- **Created:** 2026-10-03
- **Area:** Pi host request-hook contract (`sdk` / `ExtensionRunner` / extension declarations)
- **Origin:** Codex verbosity provider-coverage investigation on Pi 1.0.0

## Summary and decision

Pi's public `before_provider_request` extension event exposes a request payload but not the physical model receiving it. `ctx.model` describes the user's selection, which may be a virtual/router model. Using that selection to decide whether a provider-specific request field is safe is therefore unreliable for routed requests.

The local Codex verbosity extension now preserves direct legacy support, skips virtual and unsupported selections, and distinguishes a saved preference from supported coverage. It does not support the newer `openai` / Responses connection or routed requests. That conservative behavior is intentional; it does not resolve the host API limitation.

The deferred improvement is to carry the physical model identity already available at the provider callback into the public request event. This is an additive API enhancement, not evidence that Pi's routing itself is broken. It must be implemented in a separately authorized Pi source checkout/upstream change, not by patching the installed package or adding a local routing workaround.

## Contract and source evidence

Here, **HOST** is the installed `@earendil-works/pi-coding-agent` package, and **AI** is its installed `@earendil-works/pi-ai` dependency. Locate them through public module resolution or the host links in `agent/extensions/node_modules/`; do not hard-code a global installation path. The following line numbers refer to version **1.0.0**; search by symbol after upgrades.

1. `HOST/docs/virtual-models.md`, Selection and dispatch, distinguishes selected virtual models from physical dispatch. `ctx.model` describes selection; providers receive physical models; assistant messages record the model that answered.
2. `HOST/dist/core/virtual-models.js:3, 8-9, 65-74` marks virtual catalog entries with API `pi-virtual`, independently of their provider label. That marker/helper is an unexported host internal, not a public import contract. A virtual model can be listed under `openai-codex` or another provider; the local extension excludes it using a positive legacy-API allowlist.
3. `AI/dist/types.d.ts:57-78`, `ProviderRequestOptions`, declares `onPayload(payload, model)`: the provider callback already receives model identity.
4. `AI/dist/api/openai-codex-responses.js:173-177` and `AI/dist/api/openai-responses.js:123-127` pass their request model to that callback and honor a replacement payload.
5. `HOST/dist/core/sdk.js:213-217`, `transformProviderPayload`, accepts only `payload` and calls `runner.emitBeforeProviderRequest(payload)`, discarding the available model argument.
6. `HOST/dist/core/extensions/runner.js:1060-1087`, `emitBeforeProviderRequest`, constructs a payload-only event and obtains the ordinary selected-model context. `HOST/dist/core/extensions/types.d.ts:665-668`, `BeforeProviderRequestEvent`, likewise declares only `type` and `payload`.

The sibling `provider_stream_event` already exposes physical identity as `provider`, `api` and `model` (`HOST/dist/core/extensions/types.d.ts:685-691`; `HOST/dist/core/sdk.js:229-240`, `handleProviderStreamEvent`). Its public naming is a useful precedent, but it arrives after sending the request and cannot supply safe identity for request mutation.

These are source observations. No live provider request, ChatGPT sign-in compatibility test, or end-to-end routed request was used to establish them.

## Pi 1.3.0 revalidation

The blocker remains source-verified on Pi **1.3.0**. `BeforeProviderRequestEvent` still exposes only `type` and `payload`; SDK `transformProviderPayload()` and runner `emitBeforeProviderRequest()` still omit the physical model available to the adapter callback. The release's credential-aware model selection does not provide per-request physical dispatch identity, and stream-event identity still arrives too late for request mutation.

No fake-adapter routed-request acceptance or live provider request was executed for this revalidation. Keep the conservative direct-legacy Codex behavior and all identity/capability safety constraints below; no status change or provider-coverage expansion is justified.

## Proposed narrow host improvement

Carry physical request identity directly through the existing provider callback, SDK transform, runner dispatch, and public event declaration. An additive event property such as `requestModel` could expose public, read-only request identity, at least `provider`, `api`, and model `id`. Final naming and type belong to the upstream API design.

Requirements:

- Preserve `ctx.model` as the user's selected model. Do not redefine it to mean physical dispatch.
- Attach identity to each request invocation. Do not use a module-global "last dispatched model" or reconstruct identity from a previous response.
- Forward the actual adapter model, not a guess from `payload.model`, provider labels, or payload shape. Different providers can use the same model ID.
- Preserve handler order, payload-replacement composition, error handling, and existing extensions that only consume `payload`.
- Do not expose authentication tokens, resolved credentials, or authorization headers as new event fields. Identity metadata must not become a reason to log full requests or secrets.
- If a custom adapter cannot supply verified identity, represent it as unavailable; consumers must not fall back to the selected virtual model as a physical identity.

The change does not need to redesign virtual routing, authentication, provider registration, or response streaming.

## Identity is not capability

Knowing the destination does not prove that it accepts `text.verbosity`. A follow-up extension change must independently verify the relevant provider/API/model and endpoint behavior, including auth-mode differences where applicable.

Current source establishes only partial native verbosity support:

- `AI/dist/api/openai-codex-responses.d.ts` declares `textVerbosity`, and its request builder emits `text.verbosity`.
- `AI/dist/api/openai-codex-responses.js`, `streamSimple`, uses `buildBaseOptions`; `AI/dist/api/simple-options.js`, `buildBaseOptions`, does not carry that named option through the provider-neutral path.
- `AI/dist/api/openai-responses.d.ts` has no corresponding named verbosity option. Its builder merges generic sampling parameters, but passthrough is not a capability declaration or proof of ChatGPT sign-in acceptance.
- The public model contract has no explicit text-verbosity capability.

A native verbosity setting/options path may eventually replace payload patching, but that broader feature is not required to expose request identity. Do not make it a dependency of this narrow enhancement or silently expand provider support as part of it.

## Revalidation and acceptance criteria

Before implementation, read the current host extension, virtual-model, provider and custom-provider documentation, declarations, SDK wiring, and adapter callbacks. Confirm whether a newer host already exposes request identity.

In an authorized Pi source checkout, add focused failing tests through public SDK/extension seams with fake adapters or in-memory providers. No login, usable credentials, network calls, or paid requests are necessary. Cover:

- Direct physical selection: the event identifies the actual request model.
- A virtual selection listed under `openai-codex` that dispatches elsewhere: the event identifies the other physical provider while `ctx.model` remains virtual.
- A router under another provider that dispatches to Codex: the event identifies physical Codex.
- Successive routes, continuations, retries and concurrent calls: each payload remains paired with its own request identity, without stale or shared-state inference.
- Missing identity from a custom callback remains explicit and is safe for consumers to skip.
- Multiple request handlers still compose payload replacements in registration order. Existing payload-only extensions continue working.
- No new credential fields are added. Virtual models never masquerade as physical request identities.

Use approved scratch for any filesystem fixtures; see the [safe test scratch guidance](../../agent/extensions/permissions/README.md#safe-test-scratch-setup). Prefer public retained test seams; any private probe must be isolated and version-checked, and must not become a production import.

Close this record only after a supported public contract is implemented and validated. Separately authorize any Codex verbosity expansion, test physical identity and verified capability together, and keep unsupported requests untouched. Passing the local extension's conservative-selection tests does not satisfy these host acceptance criteria.
