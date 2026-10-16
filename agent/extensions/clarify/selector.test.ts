import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { createClarifySelector, type ClarifySelection } from "./selector.ts";

const choices = [
	{ label: "1. First", selection: { kind: "option", index: 0 } as const },
	{ label: "2. Second", selection: { kind: "option", index: 1 } as const },
];
const question = Array.from({ length: 40 }, (_, i) => `Context line ${i + 1}`).join("\n");
const plainTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

function create(options: { theme?: typeof plainTheme; userBindings?: ConstructorParameters<typeof KeybindingsManager>[1] } = {}) {
	const results: Array<ClarifySelection | undefined> = [];
	const tui = { mode: "fullscreen" as const, terminal: { rows: 24, columns: 80 }, requestRender() {} };
	const selector = createClarifySelector({
		tui: tui as never, theme: options.theme ?? plainTheme,
		keybindings: new KeybindingsManager(TUI_KEYBINDINGS, options.userBindings),
		done: (result) => results.push(result), question, choices,
	});
	return { selector, results };
}
const mouse = (type: TuiMouseEvent["type"], extra: Partial<TuiMouseEvent> = {}): TuiMouseEvent => ({
	type, button: type === "wheel" ? "none" : "left", x: 5, y: 5, screenX: 5, screenY: 5, width: 80, height: 24,
	shift: false, alt: false, ctrl: false, ...extra,
});

test("only wheel input is consumed; every other pointer gesture is left to the host default", () => {
	const { selector } = create();
	selector.render(80);
	for (const type of ["press", "drag", "release", "click", "move"] as const) {
		assert.equal(selector.handleMouse?.(mouse(type)), undefined, `${type} must follow host selection/link behavior`);
	}
	assert.deepEqual(selector.handleMouse?.(mouse("wheel", { wheelDelta: 3 })), { handled: true, render: true });
});

test("wheel at either scroll boundary and a zero-delta wheel are still consumed without rendering", () => {
	const { selector } = create();
	selector.render(80);
	assert.deepEqual(selector.handleMouse?.(mouse("wheel", { wheelDelta: -3 })), { handled: true, render: false }, "top boundary");
	assert.deepEqual(selector.handleMouse?.(mouse("wheel", { wheelDelta: 0 })), { handled: true, render: false });
	selector.handleInput!("\x1b[F"); // End
	selector.render(80);
	assert.deepEqual(selector.handleMouse?.(mouse("wheel", { wheelDelta: 3 })), { handled: true, render: false }, "bottom boundary");
});

test("wheel stays consumed after completion while other gestures remain unhandled", () => {
	const { selector, results } = create();
	selector.render(80);
	selector.handleInput!("\r");
	assert.deepEqual(results, [{ kind: "option", index: 0 }]);
	assert.deepEqual(selector.handleMouse?.(mouse("wheel", { wheelDelta: 3 })), { handled: true, render: false });
	assert.equal(selector.handleMouse?.(mouse("press")), undefined);
});

test("invalidate drops the wrapped question so a theme change is re-applied", () => {
	let color = "red";
	const theme = { fg: (name: string, text: string) => name === "text" ? `<${color}>${text}</${color}>` : text, bold: (text: string) => text };
	const { selector } = create({ theme });
	assert.match(selector.render(80).join("\n"), /<red>/);
	color = "blue";
	assert.match(selector.render(80).join("\n"), /<red>/, "cached until invalidated");
	selector.invalidate();
	const rendered = selector.render(80).join("\n");
	assert.match(rendered, /<blue>/);
	assert.doesNotMatch(rendered, /<red>/);
});

test("navigation help names the up and down keys separately, including remapped keys", () => {
	const help = (userBindings?: ConstructorParameters<typeof KeybindingsManager>[1]) =>
		create({ userBindings }).selector.render(80).map(stripVTControlCharacters).join(" ").replace(/\s+/g, " ");
	assert.match(help(), /↑\/↓ navigate/);
	assert.match(help({ "tui.select.up": "ctrl+p", "tui.select.down": "ctrl+n" }), /ctrl\+p\/ctrl\+n navigate/);
});
