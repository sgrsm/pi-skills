import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CodexVerbosity = "low" | "medium" | "high";

const VERBOSITY_VALUES = ["low", "medium", "high"] as const;
const DEFAULT_VERBOSITY: CodexVerbosity = "low";
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXTENSION_DIR, "config.json");

let verbosity = loadVerbosity();

function isVerbosity(value: string): value is CodexVerbosity {
	return (VERBOSITY_VALUES as readonly string[]).includes(value);
}

function normalizeVerbosity(value: unknown): CodexVerbosity | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return isVerbosity(normalized) ? normalized : undefined;
}

function loadVerbosity(): CodexVerbosity {
	try {
		if (!existsSync(CONFIG_PATH)) return DEFAULT_VERBOSITY;
		const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return normalizeVerbosity(config?.verbosity) ?? DEFAULT_VERBOSITY;
	} catch {
		return DEFAULT_VERBOSITY;
	}
}

function saveVerbosity(nextVerbosity: CodexVerbosity) {
	mkdirSync(EXTENSION_DIR, { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify({ verbosity: nextVerbosity }, null, 2)}\n`, "utf8");
}

function usage() {
	return "Usage: /codex-verbosity low|medium|high";
}

function applyTextVerbosity(payload: unknown): unknown | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;

	const body = payload as Record<string, unknown>;
	const text = body.text && typeof body.text === "object" && !Array.isArray(body.text) ? body.text : {};

	return {
		...body,
		text: {
			...(text as Record<string, unknown>),
			verbosity,
		},
	};
}

export default function codexVerbosityExtension(pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== "openai-codex") return;
		return applyTextVerbosity(event.payload);
	});

	pi.registerCommand("codex-verbosity", {
		description: "Set OpenAI Codex text verbosity: low, medium, or high",
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
				ctx.ui.notify(`OpenAI Codex verbosity is ${verbosity}. ${usage()}`, "info");
				return;
			}

			if (parts.length !== 1 || !isVerbosity(parts[0])) {
				ctx.ui.notify(usage(), "warning");
				return;
			}

			verbosity = parts[0];
			saveVerbosity(verbosity);
			ctx.ui.notify(`OpenAI Codex verbosity set to ${verbosity}`, "info");
		},
	});
}
