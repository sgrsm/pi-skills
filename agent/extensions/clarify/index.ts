import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, type AgentToolResult, type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { registerToolAvailability } from "../shared/toolAvailability.ts";
import { getSessionDialogQueue, waitForDialog } from "../shared/dialogQueue.ts";
import { boundedDialogDetails, showCancellableCustom, showCancellableEditor } from "../shared/dialogUi.ts";
import { clarifyDockHeight, createClarifySelector, type ClarifyChoice, type ClarifySelection } from "./selector.ts";

export { renderClarifyOptionLines, styleClarifyOptionLine } from "./selector.ts";

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
const CLARIFY_DIRECT_CALL_GUIDANCE = "Call clarify directly as a model tool; it is model-only. Do not invoke tools.clarify() from codemode or call clarify through another tool.";
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

export function canUseClarifyCustomSelector(ctx: { mode: string }): boolean {
	return ctx.mode === "tui";
}

async function showClarifySelector(
	ctx: { mode: string; ui: Pick<ExtensionUIContext, "custom"> },
	signal: AbortSignal,
	question: string,
	options: ClarifyOption[],
	allowCustom: boolean,
): Promise<ClarifySelection | undefined> {
	if (!canUseClarifyCustomSelector(ctx)) return undefined;

	const choices: ClarifyChoice[] = options.map((option, index) => ({
		label: buildChoiceLabel(index, option.label),
		description: option.description,
		selection: { kind: "option", index },
	}));
	if (allowCustom) {
		choices.push({
			label: buildChoiceLabel(options.length, "Custom instructions"),
			description: "Open the editor to type a custom answer.",
			selection: { kind: "custom" },
		});
	}

	// Use the normal editor slot below the transcript, not an overlay covering the conversation.
	return showCancellableCustom<ClarifySelection>(
		ctx.ui,
		signal,
		(tui, theme, keybindings, done) => createClarifySelector({ tui, theme, keybindings, done, question, choices }),
	);
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
	ctx: { ui: Pick<ExtensionUIContext, "select"> },
	signal: AbortSignal,
	question: string,
	options: ClarifyOption[],
	allowCustom: boolean,
): Promise<ClarifySelection | undefined> {
	const choices = options.map((option, index) => buildChoiceLabel(index, option.label));
	const customChoice = buildChoiceLabel(options.length, "Custom instructions");
	if (allowCustom) choices.push(customChoice);

	const selected = await waitForDialog(signal, () => ctx.ui.select(boundedDialogDetails(buildBasicSelectTitle(question, options, allowCustom)), choices, { signal }));
	if (!selected) return undefined;
	if (allowCustom && selected === customChoice) return { kind: "custom" };

	const selectedIndex = choices.indexOf(selected);
	return selectedIndex >= 0 && selectedIndex < options.length ? { kind: "option", index: selectedIndex } : undefined;
}

async function showClarifySelection(
	ctx: { mode: string; ui: ExtensionUIContext },
	signal: AbortSignal,
	question: string,
	options: ClarifyOption[],
	allowCustom: boolean,
): Promise<ClarifySelection | undefined> {
	if (canUseClarifyCustomSelector(ctx)) {
		return showClarifySelector(ctx, signal, question, options, allowCustom);
	}
	return showClarifyBasicSelect(ctx, signal, question, options, allowCustom);
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

export interface ClarifyExtensionOptions {
	/** Injectable state reader for isolated tests; production uses the agent-dir state files. */
	loadModeState?: () => { enabled: boolean };
}

export default function clarifyExtension(pi: ExtensionAPI, options: ClarifyExtensionOptions = {}) {
	const dialogs = getSessionDialogQueue(pi);
	const readModeState = options.loadModeState ?? loadClarifyModeState;
	let clarifyEnabled = readModeState().enabled;

	const setClarifyAvailability = registerToolAvailability(pi, {
		name: CLARIFY_TOOL_NAME,
		label: "Clarify",
		exposure: "model-only",
		executionMode: "sequential",
		description:
			`Ask the user to choose between different paths or confirm/adjust an assumption. Use when multiple meaningful ways forward exist or when a non-trivial assumption needs confirmation. ${CLARIFY_DIRECT_CALL_GUIDANCE}`,
		promptSnippet:
			"Call clarify directly to ask the user to choose between materially different approaches or confirm/adjust a non-trivial assumption.",
		promptGuidelines: [
			CLARIFY_DIRECT_CALL_GUIDANCE,
			"Use clarify when you detect multiple materially different ways to proceed, or when a non-trivial assumption would affect correctness, behavior, scope, safety, or user intent.",
			"Prefer clarify instead of silently choosing whenever the branch you pick would materially change the outcome.",
			"Keep clarify options concise and distinct. Prefer around 2-5 options plus the custom-instructions path.",
			"Use clarify option descriptions to explain trade-offs or consequences, not to repeat the label.",
			"Do not use clarify for trivial defaults, obvious next steps, or issues the user has already decided.",
			"After clarify receives the user's answer, follow that choice and continue without re-asking the same question unless the requirements change.",
		],
		parameters: ClarifyParamsSchema,

		async execute(_toolCallId, params, executionSignal, _onUpdate, ctx) {
			const signal = dialogs.scopeSignal(executionSignal, ctx.signal);
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

			const cancelled = (): AgentToolResult<ClarifyDetails> => ({
				content: [{ type: "text", text: "User cancelled the clarification." }],
				details: buildCancelledDetails(question, options),
			});
			try {
				return await dialogs.run<AgentToolResult<ClarifyDetails>>(signal, async (signal) => {
					if (!clarifyEnabled) throw new Error("clarify is disabled. Run /clarify on to enable it.");
					const selected = options.length === 0
						? { kind: "custom" } as const
						: await showClarifySelection(ctx, signal, question, options, allowCustom);
					signal.throwIfAborted();
					if (!selected) return cancelled();
					if (selected.kind === "custom") {
						const title = options.length === 0 ? question : `Custom instructions\n\n${question}`;
						// Keep the answer in the same bounded editor slot as the selector.
						const customAnswer = await showCancellableEditor(ctx, signal, title, params.customPrompt ?? "", undefined, { maxRows: clarifyDockHeight });
						signal.throwIfAborted();
						const trimmed = customAnswer?.trim();
						if (!trimmed) return cancelled();
						return {
							content: [{ type: "text", text: `User provided custom instructions: ${trimmed}` }],
							details: { question, options, answer: trimmed, answerType: "custom" },
						};
					}
					const selectedIndex = selected.index;
					const selectedOption = options[selectedIndex];
					if (!selectedOption) throw new Error("selected option could not be resolved.");
					return {
						content: [{ type: "text", text: `User selected: ${buildChoiceLabel(selectedIndex, selectedOption.label)}` }],
						details: { question, options, answer: selectedOption.label, answerType: "option", selectedIndex: selectedIndex + 1 },
					};
				});
			} catch (error) {
				if (signal.aborted) return cancelled();
				throw error;
			}
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
	}, clarifyEnabled);

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

			// Explicit user deactivation may intentionally replace a restored loadout.
			if (!clarifyEnabled) removeClarifyTool(pi);
			setClarifyAvailability(clarifyEnabled);
			if (clarifyEnabled) addClarifyTool(pi);
			updateClarifyStatus(ctx, clarifyEnabled);

			notify(ctx, `clarify ${mode} (saved globally to ${CLARIFY_MODE_STATE_PATH})`);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		clarifyEnabled = readModeState().enabled;
		setClarifyAvailability(clarifyEnabled);
		if (clarifyEnabled) addClarifyTool(pi);
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
		const { sections } = event.systemPromptOptions;
		if (!clarifyEnabled || !pi.getActiveTools().includes(CLARIFY_TOOL_NAME)) {
			delete sections.clarify_policy;
			return;
		}

		if (!ctx.hasUI) {
			sections.clarify_policy = "Clarification note:\n- The clarify tool requires interactive UI and is not usable in this mode.\n- If user input is required, ask in plain text instead of calling clarify.";
			return;
		}

		sections.clarify_policy = `Clarification policy:\n- ${CLARIFY_DIRECT_CALL_GUIDANCE}\n- If you discover multiple materially different ways to proceed, stop and use clarify before committing to one.\n- If you would otherwise make a non-trivial assumption that affects correctness, behavior, scope, safety, or user intent, use clarify first.\n- Keep choices focused and distinct. Prefer around 2-5 options plus the custom-instructions path.\n- Phrase options as actionable paths, and use descriptions only for brief trade-offs or consequences.\n- Do not interrupt for trivial defaults, obvious next steps, or decisions the user already made.\n- After the user answers, follow that direction and continue.`;
	});
}
