import assert from "node:assert/strict";
import test from "node:test";
import { getGuardArgumentCompletions } from "./index.ts";

test("guard command offers clear argument completion", () => {
	assert.deepEqual(getGuardArgumentCompletions(""), [
		{ value: "clear", label: "clear", description: "Clear current session guardrail permission grants" },
	]);
	assert.deepEqual(getGuardArgumentCompletions("cl"), [
		{ value: "clear", label: "clear", description: "Clear current session guardrail permission grants" },
	]);
	assert.equal(getGuardArgumentCompletions("show"), null);
	assert.equal(getGuardArgumentCompletions("clear now"), null);
});
