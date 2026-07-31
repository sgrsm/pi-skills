# Extension maintenance

## Pi host dependency links

`agent/extensions` treats Pi host packages as peer dependencies and links them from the currently installed global Pi package tree.

After an ordinary `pi update`, no local `npm install` is normally needed.

For command details, environment overrides, and troubleshooting, see [`pi-host-deps/README.md`](./pi-host-deps/README.md).

If switching Node/nvm versions, changing npm global prefix, or moving/reinstalling the global Pi install, refresh the host-package symlinks:

From the Pi config root:

```bash
cd agent/extensions
npm run sync:pi-host-deps
npm run typecheck
```

Alternatively, from anywhere, use the standard Pi config path:

```bash
cd ~/.pi/agent/extensions
npm run sync:pi-host-deps
npm run typecheck
```

## Extension verification

First prepare an approved test scratch root as described in the permissions extension's [safe test scratch setup](./permissions/README.md#safe-test-scratch-setup). Then run the combined Pi host declaration, TypeScript, and full test gate from `agent/extensions/`:

```bash
npm run verify
```

`npm run verify` requires `PI_PERMISSIONS_TEST_SCRATCH_ROOT`; it does not create or choose an approved scratch root automatically.

Run npm dependency commands from `agent/extensions/`, not from `agent/`.
