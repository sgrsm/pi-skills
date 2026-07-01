import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	SelectList,
	Text,
	truncateToWidth,
	type AutocompleteItem,
	type SelectItem,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";

interface ClarifyOption {
	label: string;
	description?: string;
}

interface ClarifyDetails {
	question: string;
	options: ClarifyOption[];
	answer: string | null;
	answerType: "option" | "custom" | "cancelled" | "error";
	selectedIndex?: number;
	message?: string;
}

type ClarifyMode = "on" | "off";

type ClarifyModeState = {
	enabled: boolean;
};

const AGENT_DIR = getAgentDir();
const CLARIFY_TOOL_NAME = "clarify";
const CLARIFY_STATUS_KEY = FOOTER_STATUS_KEYS.clarify;
const CLARIFY_MODE_STATE_PATH = join(AGENT_DIR, "clarify.json");
const CLARIFY_LEGACY_MODE_STATE_PATH = join(AGENT_DIR, "clarify-choice.json");

const ClarifyOptionSchema = Type.Object({
	label: Type.String({
		description: "Short label for the option shown to the user.",
	}),
	description: Type.Optional(
		Type.String({
			description: "Optional short explanation of the trade-off, consequence, or assumption behind this option.",
		}),
	),
});

const ClarifyParamsSchema = Type.Object({
	question: Type.String({
		description: "The decision, ambiguity, or assumption that needs the user's input.",
	}),
	options: Type.Array(ClarifyOptionSchema, {
		description:
			"Suggested choices for the user. Prefer a small set of materially different options, ideally around 2-5.",
	}),
	allowCustom: Type.Optional(
		Type.Boolean({
			description: "Allow the user to provide custom instructions instead of choosing a listed option. Defaults to true.",
			default: true,
		}),
	),
	customPrompt: Type.Optional(
		Type.String({
			description: "Optional prefilled text for the custom-instructions editor.",
		}),
	),
});

function normalizeText(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptions(options: ClarifyOption[] | undefined): ClarifyOption[] {
	if (!Array.isArray(options)) return [];
	return options
		.map((option) => ({
			label: normalizeText(option?.label) ?? "",
			description: normalizeText(option?.description),
		}))
		.filter((option) => option.label.length > 0);
}

function buildChoiceLabel(index: number, label: string): string {
	return `${index + 1}. ${label}`;
}

type ClarifySelection = { kind: "option"; index: number } | { kind: "custom" };

export function canUseClarifyCustomSelector(ctx: { mode: string }): boolean {
	return ctx.mode === "tui";
}

const ENABLE_MOUSE_SCROLL = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE_SCROLL = "\x1b[?1000l\x1b[?1006l";
const MOUSE_WHEEL_SEQUENCE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;
const CLARIFY_SELECTED_OPTION_COLOR = "#0066CC";
const CLARIFY_MAX_VISIBLE_OPTIONS = 8;

type ClarifySelectorTheme = { fg(color: string, text: string): string };

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

export function styleClarifyOptionLine(text: string, selected: boolean, theme: ClarifySelectorTheme): string {
	return selected ? fgHex(CLARIFY_SELECTED_OPTION_COLOR, boldAnsi(text)) : theme.fg("accent", text);
}

export function renderClarifyOptionLines(
	items: SelectItem[],
	selectedValue: string | undefined,
	width: number,
	theme: ClarifySelectorTheme,
	maxVisible = CLARIFY_MAX_VISIBLE_OPTIONS,
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
		const line = truncateToWidth(`${prefix}${item.label}`, lineWidth, "");
		lines.push(styleClarifyOptionLine(line, selected, theme));
	}

	if (startIndex > 0 || endIndex < items.length) {
		lines.push(theme.fg("dim", truncateToWidth(`  (${selectedIndex + 1}/${items.length})`, lineWidth, "")));
	}

	return lines;
}

function parseMouseWheelDirection(data: string): -1 | 1 | null {
	const match = data.match(MOUSE_WHEEL_SEQUENCE);
	if (!match) return null;
	const code = Number.parseInt(match[1] ?? "", 10);
	if (code === 64) return -1;
	if (code === 65) return 1;
	return null;
}

function buildDescriptionPreviewLines(
	description: string | undefined,
	innerWidth: number,
	maxLines: number,
	theme: { fg(color: string, text: string): string },
): string[] {
	if (!description || innerWidth <= 0 || maxLines <= 0) return [];

	const prefix = "↳ ";
	const continuationPrefix = "  ";
	const descriptionWidth = Math.max(1, innerWidth - prefix.length);
	const wrappedLines = wrapTextWithAnsi(description, descriptionWidth);
	if (wrappedLines.length === 0) return [];

	const visibleLines = wrappedLines.slice(0, maxLines);
	if (wrappedLines.length > maxLines) {
		const lastIndex = visibleLines.length - 1;
		if (lastIndex >= 0) {
			visibleLines[lastIndex] = truncateToWidth(`${visibleLines[lastIndex]} …`, descriptionWidth);
		}
	}

	return visibleLines.map((line, index) => theme.fg("muted", `${index === 0 ? prefix : continuationPrefix}${line}`));
}

async function showClarifySelector(
	ctx: {
		mode: string;
		ui: {
			custom<T>(factory: (tui: any, theme: any, keybindings: any, done: (result: T) => void) => any): Promise<T>;
		};
	},
	question: string,
	options: ClarifyOption[],
	allowCustom: boolean,
): Promise<ClarifySelection | undefined> {
	if (!canUseClarifyCustomSelector(ctx)) return undefined;

	const optionItems = options.map((option, index) => ({
		value: `option:${index}`,
		label: buildChoiceLabel(index, option.label),
		description: option.description,
	}));

	if (allowCustom) {
		optionItems.push({
			value: "__custom__",
			label: buildChoiceLabel(options.length, "Custom instructions"),
			description: "Open the editor to type a custom answer.",
		});
	}

	// SelectList descriptions are single-line, so render only labels in the list and show
	// the selected option description in a wrapped preview below.
	const items: SelectItem[] = optionItems.map(({ value, label }) => ({ value, label }));
	const descriptionsByValue = new Map(optionItems.map((item) => [item.value, item.description]));

	return ctx.ui.custom<ClarifySelection | undefined>((tui, theme, _keybindings, done) => {
		const selectList = new SelectList(items, Math.min(items.length, CLARIFY_MAX_VISIBLE_OPTIONS), {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});

		let scrollOffset = 0;
		let questionLines: string[] = [];
		let questionViewportHeight = 1;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;

		const invalidate = () => {
			cachedWidth = undefined;
			cachedLines = undefined;
		};

		const clampScroll = () => {
			const maxScroll = Math.max(0, questionLines.length - questionViewportHeight);
			scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
		};

		const scrollBy = (delta: number): boolean => {
			clampScroll();
			const maxScroll = Math.max(0, questionLines.length - questionViewportHeight);
			const nextOffset = Math.max(0, Math.min(scrollOffset + delta, maxScroll));
			if (nextOffset === scrollOffset) return false;
			scrollOffset = nextOffset;
			return true;
		};

		const requestRender = () => {
			invalidate();
			tui.requestRender();
		};

		const resolveSelection = (item: SelectItem | null): ClarifySelection | undefined => {
			if (!item) return undefined;
			if (item.value === "__custom__") return { kind: "custom" };
			if (!item.value.startsWith("option:")) return undefined;
			const index = Number.parseInt(item.value.slice("option:".length), 10);
			return Number.isInteger(index) && index >= 0 ? { kind: "option", index } : undefined;
		};

		selectList.onSelect = (item) => done(resolveSelection(item));
		selectList.onCancel = () => done(undefined);

		tui.terminal.write(ENABLE_MOUSE_SCROLL);

		return {
			render(width: number): string[] {
				if (cachedLines && cachedWidth === width) return cachedLines;

				const innerWidth = Math.max(1, width - 2);
				questionLines = wrapTextWithAnsi(theme.fg("text", question), innerWidth);
				const selectedItem = selectList.getSelectedItem();
				const selectLines = renderClarifyOptionLines(items, selectedItem?.value, innerWidth, theme);

				const maxDialogHeight = Math.max(1, tui.terminal.rows - 1);
				const previewLines = buildDescriptionPreviewLines(
					selectedItem ? descriptionsByValue.get(selectedItem.value) : undefined,
					innerWidth,
					Math.max(0, maxDialogHeight - selectLines.length - 6),
					theme,
				);
				questionViewportHeight = Math.max(
					1,
					Math.min(questionLines.length, maxDialogHeight - selectLines.length - previewLines.length - 5),
				);
				clampScroll();

				const visibleQuestionLines = questionLines.slice(scrollOffset, scrollOffset + questionViewportHeight);
				const startLine = questionLines.length === 0 ? 0 : scrollOffset + 1;
				const endLine = Math.min(questionLines.length, scrollOffset + questionViewportHeight);
				const questionStatus =
					questionLines.length > questionViewportHeight
						? `Context ${startLine}-${endLine}/${questionLines.length} • PgUp/PgDn/Home/End or wheel to scroll`
						: `Context ${questionLines.length}/${questionLines.length}`;
				const helpText = `↑↓ navigate • Enter select • Esc cancel${
					questionLines.length > questionViewportHeight ? " • PgUp/PgDn/Home/End or wheel scroll context" : ""
				}`;

				const lines = [
					theme.fg("accent", "─".repeat(width)),
					truncateToWidth(` ${theme.fg("accent", theme.bold("Clarify"))}`, width),
					...visibleQuestionLines.map((line) => truncateToWidth(` ${line}`, width)),
					truncateToWidth(` ${theme.fg("dim", questionStatus)}`, width),
					...selectLines.map((line) => truncateToWidth(` ${line}`, width)),
					...previewLines.map((line) => truncateToWidth(` ${line}`, width)),
					truncateToWidth(` ${theme.fg("dim", helpText)}`, width),
					theme.fg("accent", "─".repeat(width)),
				];

				cachedWidth = width;
				cachedLines = lines;
				return lines;
			},

			invalidate() {
				invalidate();
				selectList.invalidate();
			},

			handleInput(data: string): void {
				const wheelDirection = parseMouseWheelDirection(data);
				if (wheelDirection !== null) {
					if (scrollBy(wheelDirection * 3)) {
						requestRender();
					}
					return;
				}

				if (matchesKey(data, Key.pageUp)) {
					scrollBy(-Math.max(1, questionViewportHeight - 1));
					requestRender();
					return;
				}

				if (matchesKey(data, Key.pageDown)) {
					scrollBy(Math.max(1, questionViewportHeight - 1));
					requestRender();
					return;
				}

				if (matchesKey(data, Key.home)) {
					scrollOffset = 0;
					requestRender();
					return;
				}

				if (matchesKey(data, Key.end)) {
					scrollOffset = Math.max(0, questionLines.length - questionViewportHeight);
					requestRender();
					return;
				}

				selectList.handleInput(data);
				requestRender();
			},

			dispose() {
				tui.terminal.write(DISABLE_MOUSE_SCROLL);
			},
		};
	});
}

function buildBasicSelectTitle(question: string, options: ClarifyOption[], allowCustom: boolean): string {
	const lines = [question];
	const describedOptions = options
		.map((option, index) => (option.description ? `${buildChoiceLabel(index, option.label)}: ${option.description}` : undefined))
		.filter((line): line is string => Boolean(line));

	if (describedOptions.length > 0) {
		lines.push("", "Option details:", ...describedOptions);
	}

	if (allowCustom) {
		lines.push("", `${buildChoiceLabel(options.length, "Custom instructions")}: Open the editor to type a custom answer.`);
	}

	return lines.join("\n");
}

async function showClarifyBasicSelect(
	ctx: { ui: { select(title: string, items: string[]): Promise<string | undefined> } },
	question: string,
	options: ClarifyOption[],
	allowCustom: boolean,
): Promise<ClarifySelection | undefined> {
	const choices = options.map((option, index) => buildChoiceLabel(index, option.label));
	const customChoice = buildChoiceLabel(options.length, "Custom instructions");
	if (allowCustom) choices.push(customChoice);

	const selected = await ctx.ui.select(buildBasicSelectTitle(question, options, allowCustom), choices);
	if (!selected) return undefined;
	if (allowCustom && selected === customChoice) return { kind: "custom" };

	const selectedIndex = choices.indexOf(selected);
	return selectedIndex >= 0 && selectedIndex < options.length ? { kind: "option", index: selectedIndex } : undefined;
}

async function showClarifySelection(
	ctx: {
		mode: string;
		ui: {
			custom<T>(factory: (tui: any, theme: any, keybindings: any, done: (result: T) => void) => any): Promise<T>;
			select(title: string, items: string[]): Promise<string | undefined>;
		};
	},
	question: string,
	options: ClarifyOption[],
	allowCustom: boolean,
): Promise<ClarifySelection | undefined> {
	if (canUseClarifyCustomSelector(ctx)) {
		return showClarifySelector(ctx, question, options, allowCustom);
	}
	return showClarifyBasicSelect(ctx, question, options, allowCustom);
}

function buildCancelledDetails(question: string, options: ClarifyOption[]): ClarifyDetails {
	return {
		question,
		options,
		answer: null,
		answerType: "cancelled",
	};
}

function getOptionPreview(options: ClarifyOption[], max = 5): string {
	const visible = options.slice(0, max).map((option, index) => buildChoiceLabel(index, option.label));
	if (options.length > max) visible.push(`+${options.length - max} more`);
	return visible.join(", ");
}

function loadClarifyModeState(defaultEnabled = true): ClarifyModeState {
	for (const statePath of [CLARIFY_MODE_STATE_PATH, CLARIFY_LEGACY_MODE_STATE_PATH]) {
		try {
			const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as Partial<ClarifyModeState>;
			return {
				enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaultEnabled,
			};
		} catch {
			// try next path
		}
	}
	return { enabled: defaultEnabled };
}

async function saveClarifyModeState(state: ClarifyModeState): Promise<void> {
	await mkdir(dirname(CLARIFY_MODE_STATE_PATH), { recursive: true });
	await writeFile(CLARIFY_MODE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function formatClarifyMode(enabled: boolean): ClarifyMode {
	return enabled ? "on" : "off";
}

function parseClarifyModeArg(args?: string): ClarifyMode | undefined | "invalid" {
	const value = args?.trim().toLowerCase();
	if (!value) return undefined;
	if (value === "on" || value === "off") return value;
	return "invalid";
}

function notify(
	ctx: { hasUI: boolean; ui: { notify(message: string, type?: "info" | "warning" | "error"): void } },
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
	else console.log(message);
}

function removeClarifyTool(pi: ExtensionAPI): void {
	const activeTools = pi.getActiveTools();
	if (!activeTools.includes(CLARIFY_TOOL_NAME)) return;
	pi.setActiveTools(activeTools.filter((toolName) => toolName !== CLARIFY_TOOL_NAME));
}

function addClarifyTool(pi: ExtensionAPI): void {
	const activeTools = pi.getActiveTools();
	if (activeTools.includes(CLARIFY_TOOL_NAME)) return;
	pi.setActiveTools([...activeTools, CLARIFY_TOOL_NAME]);
}

function updateClarifyStatus(ctx: {
	hasUI: boolean;
	ui: {
		setStatus(key: string, text: string | undefined): void;
		theme: { fg(color: string, text: string): string };
	};
}, enabled: boolean): void {
	if (!ctx.hasUI) return;
	clearLegacyFooterStatus(ctx, "clarify");
	ctx.ui.setStatus(CLARIFY_STATUS_KEY, ctx.ui.theme.fg("dim", `clarify: ${formatClarifyMode(enabled)} •`));
}

export default function clarifyExtension(pi: ExtensionAPI) {
	let clarifyEnabled = loadClarifyModeState().enabled;

	pi.registerTool({
		name: CLARIFY_TOOL_NAME,
		label: "Clarify",
		description:
			"Ask the user to choose between different paths or confirm/adjust an assumption. Use when multiple meaningful ways forward exist or when a non-trivial assumption needs confirmation.",
		promptSnippet:
			"Ask the user to choose between materially different approaches or confirm/adjust a non-trivial assumption.",
		promptGuidelines: [
			"Use clarify when you detect multiple materially different ways to proceed, or when a non-trivial assumption would affect correctness, behavior, scope, safety, or user intent.",
			"Prefer asking the user instead of silently choosing whenever the branch you pick would materially change the outcome.",
			"Keep clarify options concise and distinct. Prefer around 2-5 options plus the custom-instructions path.",
			"Use option descriptions to explain trade-offs or consequences, not to repeat the label.",
			"Do not use clarify for trivial defaults, obvious next steps, or issues the user has already decided.",
			"After the user answers, follow that choice and continue without re-asking the same question unless the requirements change.",
		],
		parameters: ClarifyParamsSchema,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!clarifyEnabled) {
				throw new Error("clarify is disabled. Run /clarify on to enable it.");
			}

			const question = params.question.trim();
			const options = normalizeOptions(params.options);
			const allowCustom = params.allowCustom !== false;

			if (!question) {
				throw new Error("clarify requires a non-empty question.");
			}

			if (!ctx.hasUI) {
				throw new Error("interactive clarification UI is not available in this mode. Ask the user in plain text instead.");
			}

			if (options.length === 0 && !allowCustom) {
				throw new Error("clarify needs at least one option or allowCustom=true.");
			}

			if (options.length === 0) {
				const customAnswer = await ctx.ui.editor(question, params.customPrompt ?? "");
				const trimmed = customAnswer?.trim();
				if (!trimmed) {
					return {
						content: [{ type: "text", text: "User cancelled the clarification." }],
						details: buildCancelledDetails(question, options),
					};
				}

				return {
					content: [{ type: "text", text: `User provided custom instructions: ${trimmed}` }],
					details: {
						question,
						options,
						answer: trimmed,
						answerType: "custom",
					} as ClarifyDetails,
				};
			}

			const selected = await showClarifySelection(ctx, question, options, allowCustom);
			if (!selected) {
				return {
					content: [{ type: "text", text: "User cancelled the clarification." }],
					details: buildCancelledDetails(question, options),
				};
			}

			if (selected.kind === "custom") {
				const customAnswer = await ctx.ui.editor(`Custom instructions\n\n${question}`, params.customPrompt ?? "");
				const trimmed = customAnswer?.trim();
				if (!trimmed) {
					return {
						content: [{ type: "text", text: "User cancelled the clarification." }],
						details: buildCancelledDetails(question, options),
					};
				}

				return {
					content: [{ type: "text", text: `User provided custom instructions: ${trimmed}` }],
					details: {
						question,
						options,
						answer: trimmed,
						answerType: "custom",
					} as ClarifyDetails,
				};
			}

			const selectedIndex = selected.index;
			const selectedOption = options[selectedIndex];
			if (!selectedOption) {
				throw new Error("selected option could not be resolved.");
			}

			return {
				content: [{ type: "text", text: `User selected: ${buildChoiceLabel(selectedIndex, selectedOption.label)}` }],
				details: {
					question,
					options,
					answer: selectedOption.label,
					answerType: "option",
					selectedIndex: selectedIndex + 1,
				} as ClarifyDetails,
			};
		},

		renderCall(args, theme, _context) {
			const question = typeof args.question === "string" ? args.question : "Clarify this choice";
			const options = normalizeOptions(Array.isArray(args.options) ? (args.options as ClarifyOption[]) : []);
			const allowCustom = args.allowCustom !== false;

			let text = theme.fg("toolTitle", theme.bold("clarify ")) + theme.fg("muted", question);
			if (options.length > 0) {
				text += `\n${theme.fg("dim", `Options: ${getOptionPreview(options)}`)}`;
			}
			if (allowCustom) {
				text += `\n${theme.fg("dim", "Includes custom instructions")}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as ClarifyDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.answerType === "error") {
				return new Text(theme.fg("error", details.message ?? "Clarification failed"), 0, 0);
			}

			if (details.answerType === "cancelled") {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}

			if (details.answerType === "custom") {
				return new Text(
					theme.fg("success", "✓ ") + theme.fg("muted", "custom: ") + theme.fg("accent", details.answer ?? ""),
					0,
					0,
				);
			}

			const prefix = details.selectedIndex ? `${details.selectedIndex}. ` : "";
			return new Text(theme.fg("success", "✓ ") + theme.fg("accent", `${prefix}${details.answer ?? ""}`), 0, 0);
		},
	});

	pi.registerCommand("clarify", {
		description: "Enable or disable clarify globally (on|off)",
		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const normalizedPrefix = prefix.trim().toLowerCase();
			const items: AutocompleteItem[] = [
				{ value: "on", label: "on", description: "Enable clarify and save globally" },
				{ value: "off", label: "off", description: "Disable clarify and save globally" },
			];
			const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const mode = parseClarifyModeArg(args);
			if (mode === "invalid") {
				notify(ctx, `Usage: /clarify on|off (currently ${formatClarifyMode(clarifyEnabled)})`, "warning");
				return;
			}

			if (mode === undefined) {
				notify(ctx, `clarify is ${formatClarifyMode(clarifyEnabled)}`);
				return;
			}

			const nextEnabled = mode === "on";
			if (clarifyEnabled === nextEnabled) {
				notify(ctx, `clarify is already ${mode}`);
				return;
			}

			clarifyEnabled = nextEnabled;
			await saveClarifyModeState({ enabled: clarifyEnabled });

			if (clarifyEnabled) addClarifyTool(pi);
			else removeClarifyTool(pi);
			updateClarifyStatus(ctx, clarifyEnabled);

			notify(ctx, `clarify ${mode} (saved globally to ${CLARIFY_MODE_STATE_PATH})`);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		clarifyEnabled = loadClarifyModeState().enabled;
		if (clarifyEnabled) addClarifyTool(pi);
		else removeClarifyTool(pi);
		updateClarifyStatus(ctx, clarifyEnabled);
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== CLARIFY_TOOL_NAME || clarifyEnabled) return;
		return {
			block: true,
			reason: "clarify is disabled. Run /clarify on to enable it.",
		};
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!clarifyEnabled || !pi.getActiveTools().includes(CLARIFY_TOOL_NAME)) return;

		if (!ctx.hasUI) {
			return {
				systemPrompt: `${event.systemPrompt}\n\nClarification note:\n- The clarify tool requires interactive UI and is not usable in this mode.\n- If user input is required, ask in plain text instead of calling clarify.`,
			};
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\nClarification policy:\n- If you discover multiple materially different ways to proceed, stop and use clarify before committing to one.\n- If you would otherwise make a non-trivial assumption that affects correctness, behavior, scope, safety, or user intent, use clarify first.\n- Keep choices focused and distinct. Prefer around 2-5 options plus the custom-instructions path.\n- Phrase options as actionable paths, and use descriptions only for brief trade-offs or consequences.\n- Do not interrupt for trivial defaults, obvious next steps, or decisions the user already made.\n- After the user answers, follow that direction and continue.`,
		};
	});
}
