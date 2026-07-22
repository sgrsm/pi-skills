import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";

const DEFAULT_BASE_URL = "https://agentsearch.area55.me";
const MAX_RESULTS = 10;
const WEB_SEARCH_TOOL_NAME = "web_search";
const WEB_SEARCH_STATUS_KEY = FOOTER_STATUS_KEYS.webSearch;
const WEB_SEARCH_STATE_PATH = join(getAgentDir(), "web-search.json");

type WebSearchMode = "on" | "off";

type WebSearchState = {
	enabled: boolean;
};

const searchParamsSchema = Type.Object({
	query: Type.String({ description: "Web search query" }),
	limit: Type.Optional(Type.Number({ description: "Maximum results to return (1-10)" })),
	categories: Type.Optional(
		Type.String({ description: "Optional comma-separated SearXNG categories, e.g. general,news,it" }),
	),
	language: Type.Optional(Type.String({ description: "Optional language code, e.g. en-US or all" })),
	timeRange: Type.Optional(Type.String({ description: "Optional freshness filter: day, month, year" })),
});

type SearxResult = {
	title?: string;
	url?: string;
	content?: string;
	engine?: string;
	category?: string;
	publishedDate?: string;
};

type SearxResponse = {
	answers?: string[];
	infoboxes?: Array<{
		title?: string;
		content?: string;
		url?: string;
	}>;
	results?: SearxResult[];
	suggestions?: string[];
};

type SearchPayload = {
	mode: "json" | "html";
	data: SearxResponse;
	warning?: string;
};

function clampLimit(value: number | undefined): number {
	if (!Number.isFinite(value)) return 5;
	return Math.min(MAX_RESULTS, Math.max(1, Math.floor(value!)));
}

function normalizeText(text: string | undefined): string {
	if (!text) return "";
	return text.replace(/\s+/g, " ").trim();
}

function buildSearchUrl(
	baseUrl: string,
	params: { query: string; categories?: string; language?: string; timeRange?: string },
	format?: "json",
) {
	const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const url = new URL("search", normalizedBaseUrl);
	url.searchParams.set("q", params.query);
	url.searchParams.set("safesearch", "0");
	if (format) url.searchParams.set("format", format);
	if (params.categories) url.searchParams.set("categories", params.categories);
	if (params.language) url.searchParams.set("language", params.language);
	if (params.timeRange) url.searchParams.set("time_range", params.timeRange);
	return url;
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(parseInt(dec, 10)))
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ");
}

function stripHtml(text: string | undefined): string {
	if (!text) return "";
	return normalizeText(decodeHtmlEntities(text.replace(/<[^>]+>/g, " ")));
}

function parseHtmlSearchResponse(html: string): SearxResponse {
	const articles = html.match(/<article class="result[\s\S]*?<\/article>/g) ?? [];
	const results: SearxResult[] = articles.map((article) => {
		const urlMatch = article.match(/<a[^>]*(?:class="url_header"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="url_header")/);
		const url = urlMatch?.[1] ?? urlMatch?.[2];
		const title = stripHtml(article.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/)?.[1]);
		const content = stripHtml(article.match(/<p class="content">\s*([\s\S]*?)\s*<\/p>/)?.[1]);
		const category = article.match(/<article class="[^"]*category-([^" ]+)/)?.[1];
		const publishedDate = stripHtml(article.match(/<time class="published_date"[^>]*>([\s\S]*?)<\/time>/)?.[1]);
		const enginesBlock = article.match(/<div class="engines">([\s\S]*?)<\/div>/)?.[1] ?? "";
		const engineMatches = [...enginesBlock.matchAll(/<span>([\s\S]*?)<\/span>/g)]
			.map((match) => stripHtml(match[1]))
			.filter(Boolean);
		return {
			title,
			url,
			content,
			category,
			publishedDate: publishedDate || undefined,
			engine: engineMatches.length > 0 ? engineMatches.join(", ") : undefined,
		};
	});

	return { results };
}

async function fetchSearchPayload(
	baseUrl: string,
	params: { query: string; categories?: string; language?: string; timeRange?: string },
	signal: AbortSignal | undefined,
): Promise<SearchPayload> {
	const jsonUrl = buildSearchUrl(baseUrl, params, "json");
	let warning: string | undefined;
	try {
		const jsonResponse = await fetch(jsonUrl, {
			headers: { Accept: "application/json" },
			signal,
		});
		if (jsonResponse.ok) {
			return {
				mode: "json",
				data: (await jsonResponse.json()) as SearxResponse,
			};
		}
		warning = `JSON API unavailable (${jsonResponse.status} ${jsonResponse.statusText}); using HTML fallback.`;
	} catch (error) {
		if (signal?.aborted) throw error;
		const message = error instanceof Error && error.message ? ` (${error.message})` : "";
		warning = `JSON API unavailable${message}; using HTML fallback.`;
	}

	const htmlUrl = buildSearchUrl(baseUrl, params);
	const htmlResponse = await fetch(htmlUrl, {
		headers: { Accept: "text/html,application/xhtml+xml" },
		signal,
	});
	if (!htmlResponse.ok) {
		throw new Error(`SearXNG request failed: ${htmlResponse.status} ${htmlResponse.statusText}`);
	}

	return {
		mode: "html",
		data: parseHtmlSearchResponse(await htmlResponse.text()),
		warning,
	};
}

function formatResults(
	query: string,
	baseUrl: string,
	payload: SearchPayload,
	limit: number,
): { text: string; details: Record<string, unknown> } {
	const data = payload.data;
	const answers = (data.answers ?? []).map(normalizeText).filter(Boolean);
	const infoboxes = (data.infoboxes ?? []).slice(0, 2);
	const results = (data.results ?? []).slice(0, limit);
	const suggestions = (data.suggestions ?? []).map(normalizeText).filter(Boolean);
	const lines: string[] = [
		`Query: ${query}`,
		`Source: ${baseUrl}`,
		`Mode: ${payload.mode === "json" ? "JSON API" : "HTML fallback"}`,
	];

	if (payload.warning) {
		lines.push("", `Warning: ${payload.warning}`);
	}

	if (answers.length > 0) {
		lines.push("", "Direct answers:");
		for (const answer of answers.slice(0, 3)) {
			lines.push(`- ${answer}`);
		}
	}

	if (infoboxes.length > 0) {
		lines.push("", "Infoboxes:");
		for (const infobox of infoboxes) {
			const title = normalizeText(infobox.title) || "Untitled";
			const content = normalizeText(infobox.content) || "No summary provided.";
			lines.push(`- ${title}: ${content}`);
			if (infobox.url) lines.push(`  URL: ${infobox.url}`);
		}
	}

	if (results.length > 0) {
		lines.push("", `Results (${results.length}):`);
		for (const [index, result] of results.entries()) {
			const title = normalizeText(result.title) || "Untitled";
			const snippet = normalizeText(result.content) || "No snippet provided.";
			const meta = [result.engine, result.category, result.publishedDate].filter(Boolean).join(" | ");
			lines.push(`${index + 1}. ${title}`);
			if (meta) lines.push(`   Meta: ${meta}`);
			lines.push(`   URL: ${result.url ?? "(missing URL)"}`);
			lines.push(`   Snippet: ${snippet}`);
		}
	} else {
		lines.push("", "No results found.");
	}

	if (suggestions.length > 0) {
		lines.push("", `Suggestions: ${suggestions.slice(0, 5).join(", ")}`);
	}

	return {
		text: lines.join("\n"),
		details: {
			query,
			baseUrl,
			mode: payload.mode,
			warning: payload.warning,
			answers,
			infoboxes,
			results,
			suggestions,
		},
	};
}

function loadWebSearchState(defaultEnabled = true): WebSearchState {
	try {
		const parsed = JSON.parse(readFileSync(WEB_SEARCH_STATE_PATH, "utf-8")) as Partial<WebSearchState>;
		return {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaultEnabled,
		};
	} catch {
		return { enabled: defaultEnabled };
	}
}

async function saveWebSearchState(state: WebSearchState): Promise<void> {
	await mkdir(dirname(WEB_SEARCH_STATE_PATH), { recursive: true });
	await writeFile(WEB_SEARCH_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function formatWebSearchMode(enabled: boolean): WebSearchMode {
	return enabled ? "on" : "off";
}

function parseWebSearchModeArg(args?: string): WebSearchMode | undefined | "invalid" {
	const value = args?.trim().toLowerCase();
	if (!value) return undefined;
	if (value === "on" || value === "off") return value;
	return "invalid";
}

function removeWebSearchTool(pi: ExtensionAPI): void {
	const activeTools = pi.getActiveTools();
	if (!activeTools.includes(WEB_SEARCH_TOOL_NAME)) return;
	pi.setActiveTools(activeTools.filter((toolName) => toolName !== WEB_SEARCH_TOOL_NAME));
}

function addWebSearchTool(pi: ExtensionAPI): void {
	const activeTools = pi.getActiveTools();
	if (activeTools.includes(WEB_SEARCH_TOOL_NAME)) return;
	pi.setActiveTools([...activeTools, WEB_SEARCH_TOOL_NAME]);
}

function updateWebSearchStatus(ctx: {
	hasUI: boolean;
	ui: {
		setStatus(key: string, text: string | undefined): void;
		theme: { fg(color: string, text: string): string };
	};
}, enabled: boolean): void {
	if (!ctx.hasUI) return;
	clearLegacyFooterStatus(ctx, "webSearch");
	ctx.ui.setStatus(WEB_SEARCH_STATUS_KEY, ctx.ui.theme.fg("dim", `web-search: ${formatWebSearchMode(enabled)} •`));
}

function notify(
	ctx: { hasUI: boolean; ui: { notify(message: string, type?: "info" | "warning" | "error"): void } },
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
	else console.log(message);
}

export default function searxngSearchExtension(pi: ExtensionAPI) {
	let webSearchEnabled = loadWebSearchState().enabled;

	pi.registerCommand("web-search", {
		description: "Enable or disable web_search globally (on|off)",
		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const normalizedPrefix = prefix.trim().toLowerCase();
			const items: AutocompleteItem[] = [
				{ value: "on", label: "on", description: "Enable web_search and save globally" },
				{ value: "off", label: "off", description: "Disable web_search and save globally" },
			];
			const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const mode = parseWebSearchModeArg(args);
			if (mode === "invalid") {
				notify(ctx, `Usage: /web-search on|off (currently ${formatWebSearchMode(webSearchEnabled)})`, "warning");
				return;
			}

			if (mode === undefined) {
				notify(ctx, `web-search is ${formatWebSearchMode(webSearchEnabled)}`);
				return;
			}

			const nextEnabled = mode === "on";
			if (webSearchEnabled === nextEnabled) {
				notify(ctx, `web-search is already ${mode}`);
				return;
			}

			webSearchEnabled = nextEnabled;
			await saveWebSearchState({ enabled: webSearchEnabled });

			if (webSearchEnabled) addWebSearchTool(pi);
			else removeWebSearchTool(pi);
			updateWebSearchStatus(ctx, webSearchEnabled);

			notify(ctx, `web-search ${mode} (saved globally to ${WEB_SEARCH_STATE_PATH})`);
		},
	});

	pi.registerTool({
		name: WEB_SEARCH_TOOL_NAME,
		label: "Web Search",
		description: "Search the web using a self-hosted SearXNG instance and return snippets with source URLs.",
		promptSnippet: "Use web_search to search the live web using SearXNG for current information, external docs, or sources outside the local workspace.",
		promptGuidelines: [
			"Use web_search when the user asks for current web information or when the answer is not available in local files.",
			"After using web_search, cite the returned URLs in the final answer.",
		],
		parameters: searchParamsSchema,
		async execute(_toolCallId, params, signal) {
			if (!webSearchEnabled) {
				throw new Error("web_search is disabled. Run /web-search on to enable it.");
			}

			const baseUrl = process.env.PI_SEARXNG_URL ?? process.env.SEARXNG_URL ?? DEFAULT_BASE_URL;
			const limit = clampLimit(params.limit);
			const payload = await fetchSearchPayload(
				baseUrl,
				{
					query: params.query,
					categories: params.categories,
					language: params.language,
					timeRange: params.timeRange,
				},
				signal,
			);
			const formatted = formatResults(params.query, baseUrl, payload, limit);

			return {
				content: [{ type: "text", text: formatted.text }],
				details: formatted.details,
			};
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		webSearchEnabled = loadWebSearchState().enabled;
		if (webSearchEnabled) addWebSearchTool(pi);
		else removeWebSearchTool(pi);
		updateWebSearchStatus(ctx, webSearchEnabled);
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== WEB_SEARCH_TOOL_NAME || webSearchEnabled) return;
		return {
			block: true,
			reason: "web_search is disabled. Run /web-search on to enable it.",
		};
	});
}
