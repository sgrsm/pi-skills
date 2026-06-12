import assert from "node:assert/strict";
import test from "node:test";
import { getPermissionsArgumentCompletions } from "./index.ts";

test("permissions command offers clear argument completion", () => {
	assert.deepEqual(getPermissionsArgumentCompletions(""), [
		{ value: "clear", label: "clear", description: "Clear current session permission grants" },
	]);
	assert.deepEqual(getPermissionsArgumentCompletions("cl"), [
		{ value: "clear", label: "clear", description: "Clear current session permission grants" },
	]);
	assert.equal(getPermissionsArgumentCompletions("show"), null);
	assert.equal(getPermissionsArgumentCompletions("clear now"), null);
});
