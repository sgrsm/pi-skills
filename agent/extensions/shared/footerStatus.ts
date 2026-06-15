/**
 * Stable logical order for local-extension footer indicators.
 *
 * `FOOTER_STATUS_KEYS` encodes this order with sortable numeric prefixes so Pi
 * displays managed statuses left-to-right in the order listed here.
 */
export const FOOTER_STATUS_ORDER = ["permissions", "clarify", "webSearch", "subagents", "mcp"] as const;

/** Names of local-extension footer statuses managed by the shared key helper. */
export type FooterStatusName = (typeof FOOTER_STATUS_ORDER)[number];

/**
 * Current UI status keys for managed footer indicators.
 *
 * Numeric prefixes are intentional: Pi sorts footer statuses by key, and these
 * prefixes preserve `FOOTER_STATUS_ORDER` while keeping readable key suffixes.
 */
export const FOOTER_STATUS_KEYS: Record<FooterStatusName, string> = {
	permissions: "0-permissions",
	clarify: "1-clarify",
	webSearch: "2-web-search",
	subagents: "3-subagents",
	mcp: "4-mcp",
};

/**
 * Previously used footer status keys to clear when a managed status refreshes.
 *
 * Clearing old prefixed or unprefixed keys prevents duplicate footer indicators
 * after the managed display order or key naming changes.
 */
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

/**
 * Clears stale keys for `name` before the caller writes its current status key.
 *
 * Consumers should call this before `ctx.ui.setStatus(FOOTER_STATUS_KEYS[name], ...)`
 * so migrated legacy keys do not continue rendering next to the current status.
 */
export function clearLegacyFooterStatus(ctx: FooterStatusContext, name: FooterStatusName): void {
	const currentKey = FOOTER_STATUS_KEYS[name];
	for (const legacyKey of LEGACY_FOOTER_STATUS_KEYS[name]) {
		if (legacyKey !== currentKey) ctx.ui.setStatus(legacyKey, undefined);
	}
}
