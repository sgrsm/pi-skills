import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scopedExtensionFiles = [
	"../clarify/index.ts",
	"../web-search/index.ts",
	"../subagent/index.ts",
] as const;

test("Pi 0.79 custom tools do not return isError: true from execute failures", () => {
	for (const relativePath of scopedExtensionFiles) {
		const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
		assert.equal(
			/\breturn\s*{[\s\S]*?\bisError\s*:\s*true\b[\s\S]*?};/.test(source),
			false,
			`${relativePath} should throw Error from execute() instead of returning isError: true`,
		);
	}
});
