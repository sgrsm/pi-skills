# Pi host dependency links

Maintains the local `agent/extensions/node_modules` links for Pi packages that are provided by the installed Pi host.

## What it does

`agent/extensions` treats Pi runtime packages as peer dependencies so local extensions can typecheck and run against the same Pi packages that the `pi` command uses. This utility checks or refreshes symlinks from the extension package to host-provided packages:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

`sync` replaces missing, copied, broken, or stale local entries with links to the current host package tree. It only touches those configured package entries under `agent/extensions/node_modules`. Both nested npm dependencies and sibling packages in Pi's managed installer layout are supported.

## When to run it

Run `sync` after changing the host Pi installation context, especially when you:

- upgrade a managed Pi installation to a new host release;
- switch Node/nvm versions;
- change npm's global prefix;
- move or reinstall the Pi host;
- run `npm install` in `agent/extensions` and it leaves copied peer dependency folders.

An in-place npm/global host upgrade can keep package paths stable. Managed installs instead select `install/releases/<version>`, so refresh links after each managed host upgrade, before typechecking or direct tests. Stale links can silently validate against an old host, then become broken when release pruning removes that tree. Refreshing these links does not require a local `npm install`.

Run `check` before typechecking or testing when you want to verify the local links without changing them. The `typecheck` package script runs `check` first.

## Commands

Run commands from `agent/extensions`:

```bash
npm run sync:pi-host-deps
npm run check:pi-host-deps
```

Direct script usage is also available:

```bash
node pi-host-deps/piHostDeps.ts sync
node pi-host-deps/piHostDeps.ts check
```

With no command, the script defaults to `check`.

## Environment override

The utility normally searches npm's global root and the active `pi` command. To select a particular host installation, point `PI_HOST_PACKAGE_ROOT` at the installed Pi package root, or any path inside that package:

```bash
PI_HOST_PACKAGE_ROOT=/path/to/@earendil-works/pi-coding-agent npm run sync:pi-host-deps
```

Use the same Node/npm environment that provides the `pi` command when possible. For managed installs, use an explicit active-release root for both `sync` and validation commands, including `npm run verify`. A managed launcher sits outside the actual package tree; automatic discovery can fail or select a separate npm/global installation.

### Managed-install recipe

For the default managed layout under `~/.pi/agent/install`, derive the host root from `current-version` rather than pinning a release number:

```bash
cd ~/.pi/agent/extensions &&
IFS= read -r pi_version < "$HOME/.pi/agent/install/current-version" &&
export PI_HOST_PACKAGE_ROOT="$HOME/.pi/agent/install/releases/$pi_version/node_modules/@earendil-works/pi-coding-agent" &&
npm run sync:pi-host-deps &&
npm run typecheck
```

Run the recipe again after each managed host upgrade so the exported override follows the newly active release. For a custom config/install location, adjust the paths accordingly. To inspect existing links without changing them, replace `npm run sync:pi-host-deps` with `npm run check:pi-host-deps`.

For the full verification gate, keep the same exported override and prepare the [approved test scratch](../permissions/README.md#safe-test-scratch-setup) before running `npm run verify`.

## Troubleshooting

- `Unable to locate installed @earendil-works/pi-coding-agent` - run from the Node/npm environment where `pi` is installed, or set `PI_HOST_PACKAGE_ROOT`.
- `missing ...; run npm run sync:pi-host-deps` - run `npm run sync:pi-host-deps` from `agent/extensions`.
- `is a real directory; expected a symlink` - a local install copied a peer dependency; run `sync` to replace it with a host link.
- `resolves to ...; expected ...` - the link points at an old host tree; run `sync` after changing Node, npm prefix, or Pi installation.
