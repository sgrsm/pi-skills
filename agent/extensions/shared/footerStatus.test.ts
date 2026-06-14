import assert from "node:assert/strict";
import test from "node:test";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS, FOOTER_STATUS_ORDER } from "./footerStatus.ts";

const EXPECTED_DISPLAY_ORDER = ["permissions", "clarify", "web-search", "subagents", "mcp"];
const DISPLAY_LABEL_BY_STATUS_NAME = {
	permissions: "permissions",
	clarify: "clarify",
	webSearch: "web-search",
	subagents: "subagents",
	mcp: "mcp",
} as const;

test("managed footer status keys sort in requested last-line indicator order", () => {
	assert.deepEqual(
		FOOTER_STATUS_ORDER.map((name) => DISPLAY_LABEL_BY_STATUS_NAME[name]),
		EXPECTED_DISPLAY_ORDER,
	);

	const sortedLabels = FOOTER_STATUS_ORDER
		.map((name) => ({ key: FOOTER_STATUS_KEYS[name], label: DISPLAY_LABEL_BY_STATUS_NAME[name] }))
		.sort((a, b) => a.key.localeCompare(b.key))
		.map(({ label }) => label);

	assert.deepEqual(sortedLabels, EXPECTED_DISPLAY_ORDER);
});

test("legacy footer status keys are cleared when managed statuses refresh", () => {
	const calls: Array<[string, string | undefined]> = [];
	const ctx = {
		ui: {
			setStatus(key: string, value: string | undefined) {
				calls.push([key, value]);
			},
		},
	};

	for (const name of FOOTER_STATUS_ORDER) clearLegacyFooterStatus(ctx, name);

	assert.deepEqual(calls, [
		["3-permissions", undefined],
		["2-clarify", undefined],
		["1-web-search", undefined],
		["0-subagents", undefined],
		["mcp", undefined],
	]);
});
