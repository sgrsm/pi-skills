import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSessionContext as publicBuildSessionContext } from "@earendil-works/pi-coding-agent";
import { buildCurrentSessionContext } from "./index.ts";

const timestamp = "2026-01-01T00:00:00.000Z";

function userEntry(id: string, parentId: string | null, text: string): any {
	return {
		type: "message" as const,
		id,
		parentId,
		timestamp,
		message: {
			role: "user" as const,
			content: text,
			timestamp: Date.parse(timestamp),
		},
	};
}

function assistantEntry(id: string, parentId: string | null, text: string): any {
	return {
		type: "message" as const,
		id,
		parentId,
		timestamp,
		message: {
			role: "assistant" as const,
			content: [{ type: "text" as const, text }],
			provider: "test-provider",
			model: "test-model",
			stopReason: "stop" as const,
			timestamp: Date.parse(timestamp),
		},
	};
}

test("buildCurrentSessionContext uses public read-only session methods and honors the leaf id", () => {
	const entries = [
		userEntry("root", null, "Initial request"),
		userEntry("ignored-branch", "root", "Alternate branch"),
		assistantEntry("selected-leaf", "root", "Selected branch response"),
	];
	const calls: string[] = [];
	const sessionManager = {
		getEntries() {
			calls.push("getEntries");
			return entries;
		},
		getLeafId() {
			calls.push("getLeafId");
			return "selected-leaf";
		},
	};

	const actual = buildCurrentSessionContext(sessionManager);
	const expected = publicBuildSessionContext(entries as any, "selected-leaf");

	assert.deepEqual(actual, expected);
	assert.deepEqual(
		actual.messages.map((message) => message.role),
		["user", "assistant"],
	);
	assert.deepEqual(calls, ["getEntries", "getLeafId"]);
});

test("handoff source avoids the private sessionManager.buildSessionContext instance API", () => {
	const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
	assert.equal(/\bsessionManager\.buildSessionContext\s*\(/.test(source), false);
});
