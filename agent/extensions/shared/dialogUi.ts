import { keyHint, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Container, Editor, getKeybindings, Spacer, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { waitForDialog } from "./dialogQueue.ts";

export const DIALOG_DETAILS_LIMIT = 8000;

type CustomFactory<T> = (tui: Parameters<Parameters<ExtensionUIContext["custom"]>[0]>[0], theme: ExtensionUIContext["theme"], keybindings: Parameters<Parameters<ExtensionUIContext["custom"]>[0]>[2], done: (result: T | undefined) => void) => Component & { dispose?(): void };

/** Own completion and disposal, including abort between factory creation and host installation. */
export function showCancellableCustom<T>(
	ui: Pick<ExtensionUIContext, "custom">,
	signal: AbortSignal,
	factory: CustomFactory<T>,
): Promise<T | undefined> {
	return waitForDialog(signal, () => ui.custom<T | undefined>((tui, theme, keybindings, done) => {
		let settled = false;
		let disposed = false;
		let component: ReturnType<CustomFactory<T>> | undefined;
		let disposeComponent: (() => void) | undefined;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			signal.removeEventListener("abort", onAbort);
			disposeComponent?.();
		};
		const finish = (result: T | undefined) => {
			if (settled) return;
			settled = true;
			try { dispose(); } finally { done(signal.aborted ? undefined : result); }
		};
		const onAbort = () => finish(undefined);
		if (signal.aborted) { finish(undefined); return { render: () => [], invalidate() {} }; }
		try {
			component = factory(tui, theme, keybindings, finish);
			disposeComponent = component.dispose?.bind(component);
			component.dispose = dispose;
			// A factory may complete synchronously. Pi then skips installing/disposal.
			if (disposed) disposeComponent?.();
			else {
				signal.addEventListener("abort", onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			return component;
		} catch (error) {
			dispose();
			throw error;
		}
	}));
}

export function showCancellableEditor(
	ctx: { mode: string; ui: ExtensionUIContext },
	signal: AbortSignal,
	title: string,
	prefill = "",
): Promise<string | undefined> {
	if (ctx.mode !== "tui") {
		// Pi 1.0 editor() has no signal, and leaves an RPC pending request on abort.
		return waitForDialog(signal, () => ctx.ui.input(title, prefill || undefined, { signal }));
	}
	return showCancellableCustom<string>(ctx.ui, signal, (tui, theme, keybindings, done) => {
		const editor = new Editor(tui, {
			borderColor: (text) => theme.fg("borderMuted", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text), selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text), scrollInfo: (text) => theme.fg("muted", text), noMatch: (text) => theme.fg("muted", text),
			},
		});
		editor.setText(prefill);
		editor.onSubmit = done;
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", title), 1, 0));
		container.addChild(new Spacer(1));
		container.addChild(editor);
		container.addChild(new Text(theme.fg("dim", `${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.input.newLine", "newline")}  ${keyHint("tui.select.cancel", "cancel")}\nExternal editor disabled in this cancellable dialog.`), 1, 0));
		const component = {
			get focused() { return editor.focused; },
			set focused(value: boolean) { editor.focused = value; },
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput(data: string) {
				if (signal.aborted) return;
				if (getKeybindings().matches(data, "tui.select.cancel")) done(undefined);
				else if (keybindings.matches(data, "app.editor.external")) {
					// The host's ExtensionEditorComponent starts an uncancellable process
					// which can restart the TUI after abort/reload. Keep this editor local.
					ctx.ui.notify("External editor is disabled in cancellable dialogs; edit inside Pi instead.", "warning");
				} else editor.handleInput(data);
			},
		};
		return component;
	});
}

/** Keep permission choices in the fullscreen dock; detailed scope stays in a notification. */
export function permissionDialogTitle(kind: string, summary: string): string {
	return [`Permission: ${kind}`, summary.replace(/\s+/g, " ").trim(), "See request details above."].map((line) => truncateToWidth(line, 26)).join("\n");
}

export function showPermissionSelect(
	ctx: { mode: string; ui: ExtensionUIContext },
	signal: AbortSignal,
	details: string,
	compactTitle: string,
	choices: string[],
): Promise<string | undefined> {
	const boundedDetails = boundedDialogDetails(details);
	if (ctx.mode === "tui") {
		// Info notifications coalesce/overwrite in Pi. A warning remains in the
		// transcript while compact choices occupy the fixed fullscreen dock.
		ctx.ui.notify(boundedDetails, "warning");
	}
	return waitForDialog(signal, () => ctx.ui.select(ctx.mode === "tui" ? compactTitle : boundedDetails, choices, { signal }))
		.then((choice) => choice !== undefined && choices.includes(choice) ? choice : undefined);
}

export function boundedDialogDetails(details: string): string {
	if (details.length <= DIALOG_DETAILS_LIMIT) return details;
	const suffix = "\n[TRUNCATED: details exceed the display limit.]";
	let end = DIALOG_DETAILS_LIMIT - suffix.length;
	const last = details.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end--; // Do not split a UTF-16 surrogate pair.
	return details.slice(0, end) + suffix;
}
