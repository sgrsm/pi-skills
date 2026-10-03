import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type CodexVerbosity = "low" | "medium" | "high";

const VERBOSITY_VALUES = ["low", "medium", "high"] as const;
const DEFAULT_VERBOSITY: CodexVerbosity = "low";
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXTENSION_DIR, "config.json");

export interface CodexVerbosityDependencies {
	readConfig(): string | undefined;
	writeConfig(contents: string): void;
}

function isVerbosity(value: string): value is CodexVerbosity {
	return (VERBOSITY_VALUES as readonly string[]).includes(value);
}

function normalizeVerbosity(value: unknown): CodexVerbosity | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return isVerbosity(normalized) ? normalized : undefined;
}

function loadVerbosity(dependencies: CodexVerbosityDependencies): CodexVerbosity {
	try {
		const contents = dependencies.readConfig();
		if (contents === undefined) return DEFAULT_VERBOSITY;
		const config = JSON.parse(contents);
		return normalizeVerbosity(config?.verbosity) ?? DEFAULT_VERBOSITY;
	} catch {
		return DEFAULT_VERBOSITY;
	}
}

function usage() {
	return "Usage: /codex-verbosity low|medium|high";
}

function supportsSelection(model: ExtensionContext["model"]): boolean {
	return model?.provider === "openai-codex" && model.api === "openai-codex-responses";
}

function coverageMessage(model: ExtensionContext["model"]): string {
	if (!model) return "Not applied: no model is selected.";
	// Pi 1.0 internal marker refines wording only; support is gated by the positive API allowlist.
	if (model.api === "pi-virtual") {
		return "Not applied to virtual-model requests; the actual request provider is unavailable to this extension.";
	}
	if (supportsSelection(model)) return "Applies to the selected legacy Codex model.";
	if (model.provider === "openai" && model.api === "openai-responses") {
		return "Not applied to openai/Responses, including ChatGPT sign-in.";
	}
	return "Not applied to the selected provider/API.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function applyTextVerbosity(payload: unknown, verbosity: CodexVerbosity): unknown | undefined {
	if (!isRecord(payload)) return undefined;
	if (payload.text !== undefined && !isRecord(payload.text)) return undefined;

	const text = payload.text ?? {};

	return {
		...payload,
		text: {
			...(text as Record<string, unknown>),
			verbosity,
		},
	};
}

export function registerCodexVerbosityExtension(pi: ExtensionAPI, dependencies: CodexVerbosityDependencies) {
	let verbosity = loadVerbosity(dependencies);

	pi.on("before_provider_request", (event, ctx) => {
		// Pi exposes selection, not dispatch: exclude routers and unknown APIs rather than guess.
		if (!supportsSelection(ctx.model)) return;
		return applyTextVerbosity(event.payload, verbosity);
	});

	pi.registerCommand("codex-verbosity", {
		description: "Save legacy OpenAI Codex text verbosity: low, medium, or high",
		getArgumentCompletions: (prefix) => {
			const normalizedPrefix = prefix.trim().toLowerCase();
			return VERBOSITY_VALUES.filter((value) => value.startsWith(normalizedPrefix)).map((value) => ({
				value,
				label: value,
			}));
		},
		handler: async (args, ctx) => {
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);

			if (parts.length === 0) {
				ctx.ui.notify(`OpenAI Codex verbosity preference is ${verbosity}. ${coverageMessage(ctx.model)} ${usage()}`, "info");
				return;
			}

			if (parts.length !== 1 || !isVerbosity(parts[0])) {
				ctx.ui.notify(usage(), "warning");
				return;
			}

			const nextVerbosity = parts[0];
			try {
				dependencies.writeConfig(`${JSON.stringify({ verbosity: nextVerbosity }, null, 2)}\n`);
			} catch {
				ctx.ui.notify("Could not save OpenAI Codex verbosity; the previous preference is unchanged for this session.", "error");
				return;
			}
			verbosity = nextVerbosity;
			ctx.ui.notify(`OpenAI Codex verbosity preference saved as ${verbosity}. ${coverageMessage(ctx.model)}`, "info");
		},
	});
}

export default function codexVerbosityExtension(pi: ExtensionAPI) {
	registerCodexVerbosityExtension(pi, {
		readConfig: () => existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : undefined,
		writeConfig(contents) {
			mkdirSync(EXTENSION_DIR, { recursive: true });
			writeFileSync(CONFIG_PATH, contents, "utf8");
		},
	});
}
