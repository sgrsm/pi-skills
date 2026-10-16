import { keyHint, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, Editor, getKeybindings, Spacer, Text, truncateToWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { waitForDialog } from "./dialogQueue.ts";

export const DIALOG_DETAILS_LIMIT = 8000;

type CustomFactory<T> = (tui: Parameters<Parameters<ExtensionUIContext["custom"]>[0]>[0], theme: ExtensionUIContext["theme"], keybindings: Parameters<Parameters<ExtensionUIContext["custom"]>[0]>[2], done: (result: T | undefined) => void) => Component & { dispose?(): void };

/**
 * Host `custom()` presentation options (for example `overlay`/`overlayOptions`), forwarded unchanged.
 * `onHandle` is omitted on purpose: Pi documents that an overlay created by `custom()` must complete
 * through the supplied callback, never by hiding its handle, so this API does not offer the handle.
 */
export type CancellableCustomOptions = Omit<NonNullable<Parameters<ExtensionUIContext["custom"]>[1]>, "onHandle">;

/**
 * Own completion and disposal, including abort between factory creation and host installation.
 * Completion always goes through the host-supplied callback; never hide an overlay handle directly.
 */
export function showCancellableCustom<T>(
	ui: Pick<ExtensionUIContext, "custom">,
	signal: AbortSignal,
	factory: CustomFactory<T>,
	options?: CancellableCustomOptions,
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
	}, options));
}

const editorHintText = (theme: ExtensionUIContext["theme"]) =>
	theme.fg("dim", `${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.input.newLine", "newline")}  ${keyHint("tui.select.cancel", "cancel")}\nExternal editor disabled in this cancellable dialog.`);

/**
 * Fit title, editor and hints into `rows` lines for an overlay whose height the host caps at the terminal
 * height. The editor line holding the cursor is never dropped: chrome is shed first (spacer, second hint
 * line, hints, title) and only then is the editor itself windowed around its cursor line. A title cut short
 * is marked with an ellipsis.
 */
export function fitEditorDialogLines(rows: number, width: number, title: string[], editor: string[], hints: string[]): string[] {
	const budget = Math.max(1, Math.floor(rows));
	const tiers = [
		{ spacer: 1, hints },
		{ spacer: 0, hints: hints.slice(0, 1) },
		{ spacer: 0, hints: [] as string[] },
	];
	for (const tier of tiers) {
		const fixed = editor.length + tier.spacer + tier.hints.length;
		const room = budget - fixed;
		if (room < 1) continue;
		const shownTitle = title.slice(0, room);
		if (title.length > room) shownTitle[room - 1] = truncateToWidth(`${shownTitle[room - 1]!.trimEnd()} …`, width, "…");
		return [...shownTitle, ...(tier.spacer ? [""] : []), ...editor, ...tier.hints];
	}
	if (editor.length <= budget) return editor;
	let cursor = editor.findIndex((line) => line.includes(CURSOR_MARKER));
	if (cursor < 0) cursor = editor.findIndex((line) => line.includes("\x1b[7m"));
	cursor = Math.max(0, cursor);
	const start = Math.max(0, Math.min(cursor - Math.floor(budget / 2), editor.length - budget));
	return editor.slice(start, start + budget);
}

/**
 * Cancellable multiline editor. Without `options` it keeps the host's default (dock) presentation. With
 * `options.overlay` it is bounded to the terminal height, consumes wheel input and is completed by the
 * host callback like any other overlay, so stacked overlays (for example transcript search) keep focus.
 * Outside the TUI the basic input dialog is used and `options` are ignored.
 */
export function showCancellableEditor(
	ctx: { mode: string; ui: ExtensionUIContext },
	signal: AbortSignal,
	title: string,
	prefill = "",
	options?: CancellableCustomOptions,
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
		// Themed strings are computed at render time so a theme change shows up without recreating the dialog.
		const themedText = (text: () => string): Component => ({ render: (width) => new Text(text(), 1, 0).render(width), invalidate() {} });
		const titleText = themedText(() => theme.fg("accent", title));
		const hintText = themedText(() => editorHintText(theme));
		const container = new Container();
		container.addChild(titleText);
		container.addChild(new Spacer(1));
		container.addChild(editor);
		container.addChild(hintText);
		const overlay = options?.overlay === true;
		const component: Component & { focused: boolean; handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined } = {
			get focused() { return editor.focused; },
			set focused(value: boolean) { editor.focused = value; },
			render: (width: number) => overlay
				? fitEditorDialogLines(tui.terminal.rows, width, titleText.render(width), editor.render(width), hintText.render(width))
				: container.render(width),
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
		// A wheel over an overlay would otherwise fall through to the transcript beneath it. Everything else
		// (selection, link clicks) keeps the host default.
		if (overlay) component.handleMouse = (event) => event.type === "wheel" ? { handled: true, render: false } : undefined;
		return component;
	}, options);
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
