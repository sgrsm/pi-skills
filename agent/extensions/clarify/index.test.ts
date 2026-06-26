import assert from "node:assert/strict";
import test from "node:test";
import { renderClarifyOptionLines, styleClarifyOptionLine } from "./index.ts";

const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};

test("styleClarifyOptionLine keeps unselected options on the accent color", () => {
	assert.equal(styleClarifyOptionLine("  1. keep", false, theme), "<accent>  1. keep</accent>");
});

test("styleClarifyOptionLine makes the selected option fixed blue and bold", () => {
	assert.equal(
		styleClarifyOptionLine("→ 2. try", true, theme),
		"\x1b[38;2;0;102;204m\x1b[1m→ 2. try\x1b[22m\x1b[39m",
	);
});

test("renderClarifyOptionLines inverts the old clarify selector emphasis", () => {
	const lines = renderClarifyOptionLines(
		[
			{ value: "keep", label: "1. keep #0066CC" },
			{ value: "try", label: "2. try #00D7FF" },
		],
		"try",
		80,
		theme,
	);

	assert.deepEqual(lines, [
		"<accent>  1. keep #0066CC</accent>",
		"\x1b[38;2;0;102;204m\x1b[1m→ 2. try #00D7FF\x1b[22m\x1b[39m",
	]);
});
