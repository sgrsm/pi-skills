export const FOOTER_STATUS_ORDER = ["permissions", "clarify", "webSearch", "subagents", "mcp"] as const;

export type FooterStatusName = (typeof FOOTER_STATUS_ORDER)[number];

export const FOOTER_STATUS_KEYS: Record<FooterStatusName, string> = {
	permissions: "0-permissions",
	clarify: "1-clarify",
	webSearch: "2-web-search",
	subagents: "3-subagents",
	mcp: "4-mcp",
};

export const LEGACY_FOOTER_STATUS_KEYS: Record<FooterStatusName, readonly string[]> = {
	permissions: ["3-permissions"],
	clarify: ["2-clarify"],
	webSearch: ["1-web-search"],
	subagents: ["0-subagents"],
	mcp: ["mcp"],
};

type FooterStatusContext = {
	ui: {
		setStatus(key: string, value: string | undefined): void;
	};
};

export function clearLegacyFooterStatus(ctx: FooterStatusContext, name: FooterStatusName): void {
	const currentKey = FOOTER_STATUS_KEYS[name];
	for (const legacyKey of LEGACY_FOOTER_STATUS_KEYS[name]) {
		if (legacyKey !== currentKey) ctx.ui.setStatus(legacyKey, undefined);
	}
}
