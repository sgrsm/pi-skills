import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSessionContext as publicBuildSessionContext } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { buildCurrentSessionContext, ContinueWarningEditor } from "./index.ts";

const timestamp = "2026-01-01T00:00:00.000Z";

test("ContinueWarningEditor forwards mouse input to the wrapped editor", () => {
	const event: TuiMouseEvent = {
		type: "press",
		button: "left",
		x: 4,
		y: 2,
		screenX: 14,
		screenY: 8,
		width: 80,
		height: 4,
		shift: false,
		alt: false,
		ctrl: false,
	};
	const expected = { handled: true };
	let received: unknown;
	const base = {
		render: () => [],
		handleInput() {},
		handleMouse(actual: unknown) {
			received = actual;
			return expected;
		},
		invalidate() {},
		getText: () => "",
		setText() {},
	};

	const editor = new ContinueWarningEditor(base, () => {});
	assert.equal(editor.handleMouse(event), expected);
	assert.equal(received, event);
});

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

test("handoff summary dispatches through Pi's model runtime", () => {
	const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

	assert.match(source, /import \{ uuidv7 \} from "@earendil-works\/pi-ai"/);
	assert.doesNotMatch(source, /@earendil-works\/pi-ai\/compat/);
	assert.doesNotMatch(source, /\bgetApiKeyAndHeaders\s*\(/);
	assert.match(
		source,
		/const response = await ctx\.modelRegistry\.complete\(\s*ctx\.model,\s*\{ systemPrompt: HANDOFF_SUMMARY_SYSTEM_PROMPT, messages: \[userMessage\] \},/,
	);
	assert.match(source, /cacheRetention: "none"/);
	assert.match(source, /sessionId: uuidv7\(\)/);
});
