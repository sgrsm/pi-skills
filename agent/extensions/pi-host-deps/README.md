# Pi host dependency links

Maintains the local `agent/extensions/node_modules` links for Pi packages that are provided by the installed Pi host.

## What it does

`agent/extensions` treats Pi runtime packages as peer dependencies so local extensions can typecheck and run against the same Pi packages that the `pi` command uses. This utility checks or refreshes symlinks from the extension package to host-provided packages:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

`sync` replaces missing, copied, broken, or stale local entries with links to the current host package tree. It only touches those configured package entries under `agent/extensions/node_modules`.

## When to run it

Run `sync` after changing the host Pi installation context, especially when you:

- switch Node/nvm versions;
- change npm's global prefix;
- move or reinstall the global Pi package;
- run `npm install` in `agent/extensions` and it leaves copied peer dependency folders.

An ordinary `pi update` usually leaves the links valid because the host paths do not change.

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

The utility normally finds the host package through npm's global root or the active `pi` command. If that lookup fails, point it at the installed Pi package root, or any path inside that package:

```bash
PI_HOST_PACKAGE_ROOT=/path/to/@earendil-works/pi-coding-agent npm run sync:pi-host-deps
```

Use the same Node/npm environment that provides the `pi` command when possible.

## Troubleshooting

- `Unable to locate installed @earendil-works/pi-coding-agent` - run from the Node/npm environment where `pi` is installed, or set `PI_HOST_PACKAGE_ROOT`.
- `missing ...; run npm run sync:pi-host-deps` - run `npm run sync:pi-host-deps` from `agent/extensions`.
- `is a real directory; expected a symlink` - a local install copied a peer dependency; run `sync` to replace it with a host link.
- `resolves to ...; expected ...` - the link points at an old host tree; run `sync` after changing Node, npm prefix, or Pi installation.
