import {
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
	type Component,
	type KeybindingsManager,
	type SelectItem,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export type ClarifySelection = { kind: "option"; index: number } | { kind: "custom" };

export interface ClarifyChoice {
	label: string;
	description?: string;
	selection: ClarifySelection;
}

export interface ClarifySelectorTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

type FgTheme = { fg(color: string, text: string): string };
type Keys = Pick<KeybindingsManager, "matches" | "getKeys">;

const CLARIFY_SELECTED_OPTION_COLOR = "#0066CC";
const CLARIFY_MAX_VISIBLE_OPTIONS = 8;
const MAX_HELP_LINES = 3;

/**
 * custom() receives a width but no editor-slot height. Keep both Clarify stages to at most
 * half the terminal (16 rows on large screens), leaving room for the transcript and host chrome.
 * Tiny terminals degrade to one content row; the host may still clip the surrounding dock.
 */
export function clarifyDockHeight(rows: number): number {
	return Math.max(1, Math.min(16, Math.floor(rows / 2), Math.floor(rows) - 6));
}

function fgHex(hex: string, text: string): string {
	const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
	if (!match) return text;
	const value = match[1];
	const r = Number.parseInt(value.slice(0, 2), 16);
	const g = Number.parseInt(value.slice(2, 4), 16);
	const b = Number.parseInt(value.slice(4, 6), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function boldAnsi(text: string): string {
	return `\x1b[1m${text}\x1b[22m`;
}

export function styleClarifyOptionLine(text: string, selected: boolean, theme: FgTheme): string {
	return selected ? fgHex(CLARIFY_SELECTED_OPTION_COLOR, boldAnsi(text)) : theme.fg("accent", text);
}

/** Rows used by a window of `visible` options, including the position line when the list is windowed. */
function optionRows(total: number, visible: number, position: boolean): number {
	return visible + (position && total > visible ? 1 : 0);
}

export function renderClarifyOptionLines(
	items: SelectItem[],
	selectedValue: string | undefined,
	width: number,
	theme: FgTheme,
	maxVisible = CLARIFY_MAX_VISIBLE_OPTIONS,
	showPosition = true,
): string[] {
	if (items.length === 0) return [theme.fg("warning", "  No matching options")];

	const visibleCount = Math.max(1, Math.min(maxVisible, items.length));
	const selectedIndex = Math.max(
		0,
		items.findIndex((item) => item.value === selectedValue),
	);
	const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), items.length - visibleCount));
	const endIndex = Math.min(startIndex + visibleCount, items.length);
	const lineWidth = Math.max(1, width);
	const lines: string[] = [];

	for (let index = startIndex; index < endIndex; index++) {
		const item = items[index];
		if (!item) continue;
		const selected = index === selectedIndex;
		const prefix = selected ? "→ " : "  ";
		lines.push(styleClarifyOptionLine(truncateToWidth(`${prefix}${item.label}`, lineWidth), selected, theme));
	}

	if (showPosition && (startIndex > 0 || endIndex < items.length)) {
		lines.push(theme.fg("dim", truncateToWidth(`  (${selectedIndex + 1}/${items.length})`, lineWidth)));
	}

	return lines;
}

/** Wrapped description rows (plain text), prefixed for the selected-option preview. */
function descriptionRows(description: string | undefined, innerWidth: number): string[] {
	if (!description) return [];
	const descriptionWidth = Math.max(1, innerWidth - 2);
	return wrapTextWithAnsi(description, descriptionWidth).map((line, index) => `${index === 0 ? "↳ " : "  "}${line}`);
}

const KEY_LABELS: Record<string, string> = {
	up: "↑", down: "↓", enter: "Enter", escape: "Esc", pageUp: "PgUp", pageDown: "PgDn", home: "Home", end: "End",
};

function keyLabel(keybindings: Keys, action: Parameters<KeybindingsManager["getKeys"]>[0]): string {
	const key = keybindings.getKeys(action)[0];
	return key ? key.split("+").map((part) => KEY_LABELS[part] ?? part).join("+") : "unbound";
}

interface Chrome { border: boolean; title: boolean; status: boolean; help: "full" | "one" | "none" }
/** Chrome shed, in order, as the available height shrinks. The selected option is never dropped. */
const CHROME_TIERS: readonly Chrome[] = [
	{ border: true, title: true, status: true, help: "full" },
	{ border: false, title: true, status: true, help: "full" },
	{ border: false, title: false, status: true, help: "one" },
	{ border: false, title: false, status: false, help: "one" },
	{ border: false, title: false, status: false, help: "none" },
];

export interface ClarifySelectorInput {
	tui: Pick<TUI, "terminal" | "requestRender" | "mode">;
	theme: ClarifySelectorTheme;
	/** The keybindings injected by the host; actions are never matched against raw key bytes. */
	keybindings: Keys;
	done: (result: ClarifySelection | undefined) => void;
	question: string;
	choices: ClarifyChoice[];
}

/**
 * Clarify's editor-slot selector. Bound its natural height so the conversation remains above it.
 * Consume normalized wheel input only over the panel; other gestures follow the host default.
 * Completion happens only through `done`; the host restores the normal editor.
 */
export function createClarifySelector(input: ClarifySelectorInput): Component {
	const { tui, theme, keybindings, done, question, choices } = input;
	const items: SelectItem[] = choices.map((choice, index) => ({ value: String(index), label: choice.label }));

	let selectedIndex = 0;
	let finished = false;
	let scrollOffset = 0;
	let questionLines: string[] = [];
	let questionViewport = 1;
	let wrappedAt: number | undefined;
	let cache: { key: string; lines: string[] } | undefined;

	const maxScroll = () => Math.max(0, questionLines.length - questionViewport);
	const clampScroll = () => { scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll())); };
	const scrollBy = (delta: number): boolean => {
		clampScroll();
		const next = Math.max(0, Math.min(scrollOffset + delta, maxScroll()));
		if (next === scrollOffset) return false;
		scrollOffset = next;
		return true;
	};
	// Theme changes call invalidate(); the wrapped question carries theme colors, so it is re-wrapped too.
	const invalidate = () => { cache = undefined; wrappedAt = undefined; };
	const refresh = () => { invalidate(); tui.requestRender(); };
	const finish = (result: ClarifySelection | undefined) => {
		if (finished) return;
		finished = true;
		done(result);
	};

	// Fullscreen intercepts viewport paging before an inline component. Keep those keys for the
	// transcript and use the editor's alternate Ctrl+PageUp/PageDown bindings for the question.
	const pageKeys = (direction: "Up" | "Down") => {
		const keys = [...keybindings.getKeys(`tui.select.page${direction}`), ...keybindings.getKeys(`tui.editor.page${direction}`)];
		const viewport = tui.mode === "regular" ? [] : keybindings.getKeys(`tui.altScreen.page${direction}`);
		return [...new Set(keys)].filter((key) => !viewport.includes(key));
	};
	const pageLabel = (direction: "Up" | "Down") => {
		const key = pageKeys(direction)[0];
		return key ? key.split("+").map((part) => KEY_LABELS[part] ?? part).join("+") : "unbound";
	};
	const helpText = (scrollable: boolean) => {
		const parts = [
			`${keyLabel(keybindings, "tui.select.up")}/${keyLabel(keybindings, "tui.select.down")} navigate`,
			`${keyLabel(keybindings, "tui.select.confirm")} select`,
			`${keyLabel(keybindings, "tui.select.cancel")} cancel`,
		];
		if (scrollable) {
			const keys = [pageLabel("Up"), pageLabel("Down"), keyLabel(keybindings, "tui.editor.cursorLineStart"), keyLabel(keybindings, "tui.editor.cursorLineEnd")];
			const wheel = tui.mode === "regular" ? "" : " or wheel";
			parts.push(`${keys.join("/")}${wheel} scroll context`);
		}
		return parts.join(" • ");
	};

	/** Lay out one frame; `scrollHint` says whether the help line reserves the scroll hint. */
	const layout = (width: number, height: number, scrollHint: boolean) => {
		const innerWidth = Math.max(1, width - 2);
		const description = descriptionRows(choices[selectedIndex]?.description, innerWidth);
		const help = wrapTextWithAnsi(helpText(scrollHint), innerWidth).slice(0, MAX_HELP_LINES);

		// Prefer several readable context rows to decoration; on short screens keep a usable choice.
		const preferredContent = Math.min(questionLines.length, 3) + Math.min(items.length, 3) + Math.min(description.length, 2);
		const readableContent = Math.min(questionLines.length, 3) + 1 + Math.min(description.length, 1);
		const minimumContent = 1 + (questionLines.length > 0 ? 1 : 0);
		const chromeRows = (chrome: Chrome) => (chrome.border ? 2 : 0) + (chrome.title ? 1 : 0) + (chrome.status ? 1 : 0)
			+ (chrome.help === "full" ? help.length : chrome.help === "one" ? 1 : 0);
		const chrome = CHROME_TIERS.find((candidate) => candidate.help !== "none" && height - chromeRows(candidate) >= preferredContent)
			?? CHROME_TIERS.find((candidate) => candidate.help !== "none" && height - chromeRows(candidate) >= readableContent)
			?? CHROME_TIERS.find((candidate) => height - chromeRows(candidate) >= minimumContent + 1)
			?? CHROME_TIERS[CHROME_TIERS.length - 1]!;
		const budget = Math.max(1, height - chromeRows(chrome));

		// The question and option window can scroll; the description preview cannot. Shrink the
		// scrollable parts first so every description row that fits is shown (no fixed cap).
		const wantOptions = Math.min(items.length, CLARIFY_MAX_VISIBLE_OPTIONS);
		const alloc = { options: wantOptions, question: questionLines.length, description: description.length, position: true };
		const used = () => optionRows(items.length, alloc.options, alloc.position) + alloc.question + alloc.description;
		const shrink = (field: "options" | "question" | "description", floor: number) => {
			while (used() > budget && alloc[field] > floor) alloc[field]--;
		};
		shrink("question", Math.min(questionLines.length, 3));
		shrink("options", Math.min(wantOptions, 3));
		shrink("description", Math.min(description.length, 2));
		shrink("options", 1);
		shrink("description", Math.min(description.length, 1));
		shrink("question", Math.min(questionLines.length, 1));
		shrink("description", 0);
		if (used() > budget) alloc.position = false;
		shrink("question", 0);

		return { innerWidth, description, help, chrome, alloc };
	};

	return {
		render(width: number): string[] {
			const height = clarifyDockHeight(tui.terminal.rows);
			const key = `${width}x${height}`;
			if (cache?.key === key) return cache.lines;

			const innerWidth = Math.max(1, width - 2);
			if (wrappedAt !== innerWidth) {
				questionLines = wrapTextWithAnsi(theme.fg("text", question), innerWidth);
				wrappedAt = innerWidth;
			}
			let frame = layout(width, height, false);
			if (questionLines.length > Math.max(1, frame.alloc.question)) frame = layout(width, height, true);
			const { description, help, chrome, alloc } = frame;

			questionViewport = Math.max(1, alloc.question);
			clampScroll();
			const visibleQuestion = alloc.question > 0 ? questionLines.slice(scrollOffset, scrollOffset + alloc.question) : [];
			const status = questionLines.length > questionViewport
				? `Context ${scrollOffset + 1}-${scrollOffset + visibleQuestion.length}/${questionLines.length}`
				: `Context ${questionLines.length}/${questionLines.length}`;

			let preview = description.slice(0, alloc.description);
			if (alloc.description > 0 && description.length > alloc.description) {
				preview[alloc.description - 1] = truncateToWidth(`${preview[alloc.description - 1]} …`, innerWidth, "…");
			}
			const optionLines = renderClarifyOptionLines(items, items[selectedIndex]?.value, innerWidth, theme, alloc.options, alloc.position);

			const row = (text: string) => truncateToWidth(` ${text}`, width);
			const rule = () => theme.fg("accent", "─".repeat(width));
			const compactHelp = `${keyLabel(keybindings, "tui.select.up")}/${keyLabel(keybindings, "tui.select.down")} · ${keyLabel(keybindings, "tui.select.confirm")} select · ${keyLabel(keybindings, "tui.select.cancel")} cancel`;
			const helpRows = chrome.help === "full" ? help : chrome.help === "one" ? [truncateToWidth(compactHelp, innerWidth)] : [];
			const lines = [
				...(chrome.border ? [rule()] : []),
				...(chrome.title ? [row(theme.fg("accent", theme.bold("Clarify")))] : []),
				...visibleQuestion.map(row),
				...(chrome.status ? [row(theme.fg("dim", status))] : []),
				...optionLines.map(row),
				...preview.map((line) => row(theme.fg("muted", line))),
				...helpRows.map((line) => row(theme.fg("dim", line))),
				...(chrome.border ? [rule()] : []),
			].slice(0, height);

			cache = { key, lines };
			return lines;
		},

		invalidate,

		handleInput(data: string): void {
			if (finished) return;
			if (keybindings.matches(data, "tui.select.cancel")) return finish(undefined);
			if (keybindings.matches(data, "tui.select.confirm")) return finish(choices[selectedIndex]?.selection);
			if (keybindings.matches(data, "tui.select.up")) selectedIndex = selectedIndex === 0 ? choices.length - 1 : selectedIndex - 1;
			else if (keybindings.matches(data, "tui.select.down")) selectedIndex = selectedIndex === choices.length - 1 ? 0 : selectedIndex + 1;
			else if (pageKeys("Up").some((key) => matchesKey(data, key))) scrollBy(-Math.max(1, questionViewport - 1));
			else if (pageKeys("Down").some((key) => matchesKey(data, key))) scrollBy(Math.max(1, questionViewport - 1));
			else if (keybindings.matches(data, "tui.editor.cursorLineStart")) scrollOffset = 0;
			else if (keybindings.matches(data, "tui.editor.cursorLineEnd")) scrollOffset = maxScroll();
			else return;
			refresh();
		},

		handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
			// Keep wheel input over the panel local, including at a scroll boundary. Leave other
			// pointer gestures to the host (link activation and terminal/host text selection).
			if (event.type !== "wheel") return undefined;
			if (finished) return { handled: true, render: false };
			const delta = Math.trunc(event.wheelDelta ?? 0);
			const changed = delta !== 0 && scrollBy(delta);
			if (changed) invalidate();
			return { handled: true, render: changed };
		},
	};
}
