import assert from "node:assert/strict";
import test from "node:test";
import { getGuardrailsArgumentCompletions } from "./index.ts";

test("guardrails command offers clear argument completion", () => {
	assert.deepEqual(getGuardrailsArgumentCompletions(""), [
		{ value: "clear", label: "clear", description: "Clear current session guardrail permission grants" },
	]);
	assert.deepEqual(getGuardrailsArgumentCompletions("cl"), [
		{ value: "clear", label: "clear", description: "Clear current session guardrail permission grants" },
	]);
	assert.equal(getGuardrailsArgumentCompletions("show"), null);
	assert.equal(getGuardrailsArgumentCompletions("clear now"), null);
});
