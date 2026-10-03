import assert from "node:assert/strict";
import test from "node:test";
import type {
	BeforeProviderRequestEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerCodexVerbosityExtension, type CodexVerbosityDependencies } from "./index.ts";

type Selection = { provider: string; api?: string } | undefined;
const LEGACY_CODEX = { provider: "openai-codex", api: "openai-codex-responses" };
const OPENAI_RESPONSES = { provider: "openai", api: "openai-responses" };
const OTHER_PROVIDER = { provider: "anthropic", api: "anthropic-messages" };
const VIRTUAL_CODEX = { provider: "openai-codex", api: "pi-virtual" };
const VIRTUAL_ROUTER = { provider: "router", api: "pi-virtual" };

type RequestHandler = (event: BeforeProviderRequestEvent, ctx: ExtensionContext) => unknown | Promise<unknown>;

function harness(options: { config?: string; readError?: boolean; saveError?: boolean } = {}) {
	let config = options.config;
	let saveError = options.saveError ?? false;
	let reads = 0;
	let requestHandler!: RequestHandler;
	let command!: Parameters<ExtensionAPI["registerCommand"]>[1];
	const writes: string[] = [];
	const notifications: Array<{ message: string; kind: string }> = [];
	const ctx = {
		model: LEGACY_CODEX,
		ui: { notify(message: string, kind = "info") { notifications.push({ message, kind }); } },
	} as unknown as ExtensionCommandContext;
	const pi = {
		on(name: string, handler: RequestHandler) {
			assert.equal(name, "before_provider_request");
			requestHandler = handler;
			return () => {};
		},
		registerCommand(name: string, definition: typeof command) {
			assert.equal(name, "codex-verbosity");
			command = definition;
		},
	} as unknown as ExtensionAPI;
	const dependencies: CodexVerbosityDependencies = {
		readConfig() {
			reads++;
			if (options.readError) throw new Error("Read failed");
			return config;
		},
		writeConfig(contents) {
			if (saveError) throw new Error("Write failed");
			writes.push(contents);
			config = contents;
		},
	};
	const register = () => registerCodexVerbosityExtension(pi, dependencies);
	register();
	return {
		writes, notifications,
		get command() { return command; },
		get reads() { return reads; },
		setSaveError(value: boolean) { saveError = value; },
		register,
		async request(payload: unknown, ...selection: [Selection?]) {
			ctx.model = (selection.length === 0 ? LEGACY_CODEX : selection[0]) as ExtensionContext["model"];
			return requestHandler({ type: "before_provider_request", payload }, ctx);
		},
		async run(args: string, ...selection: [Selection?]) {
			ctx.model = (selection.length === 0 ? LEGACY_CODEX : selection[0]) as ExtensionContext["model"];
			await command.handler(args, ctx);
			return notifications.at(-1)!;
		},
	};
}

test("legacy Codex receives default low verbosity without mutating the payload", async () => {
	const h = harness();
	const payload = Object.freeze({ model: "fixture", input: [] });
	assert.deepEqual(await h.request(payload), { ...payload, text: { verbosity: "low" } });
	assert.equal(Object.hasOwn(payload, "text"), false);
	assert.equal(h.reads, 1);
	assert.deepEqual(h.writes, []);
	assert.deepEqual(h.notifications, [], "request hooks must not emit repeated warnings");
});

test("configured verbosity replaces only verbosity and preserves other text and body fields", async () => {
	const h = harness({ config: '{"verbosity":"medium"}' });
	const text = Object.freeze({ verbosity: "low", format: { type: "json_schema", name: "fixture" } });
	const payload = Object.freeze({ model: "fixture", text, instructions: "fixture instructions" });
	const result = await h.request(payload) as { text: { format: unknown } };
	assert.deepEqual(result, { ...payload, text: { ...text, verbosity: "medium" } });
	assert.equal(result.text.format, text.format);
	assert.equal(text.verbosity, "low");
});

test("unsupported provider/API pairs and missing models leave requests untouched", async () => {
	const h = harness({ config: '{"verbosity":"high"}' });
	const selections = [
		OPENAI_RESPONSES, OTHER_PROVIDER,
		{ provider: "openai-codex", api: "openai-completions" },
		{ provider: "openai-codex" },
		{ provider: "custom", api: "openai-codex-responses" },
	];
	const payload = Object.freeze({ text: Object.freeze({ verbosity: "medium" }), model: "fixture" });
	for (const model of selections) assert.equal(await h.request(payload, model), undefined);
	assert.equal(await h.request(payload, undefined), undefined);
	assert.deepEqual(payload, { text: { verbosity: "medium" }, model: "fixture" });
	assert.deepEqual(h.notifications, []);
});

test("virtual selections are skipped regardless of provider label or payload resemblance", async () => {
	const h = harness({ config: '{"verbosity":"high"}' });
	for (const model of [VIRTUAL_CODEX, VIRTUAL_ROUTER]) {
		assert.equal(await h.request({ model: "gpt-fixture", text: { verbosity: "low" } }, model), undefined);
		assert.equal(await h.request({ model: "claude-fixture", messages: [] }, model), undefined);
	}
	assert.deepEqual(h.notifications, []);
});

test("malformed payloads and existing text values are left untouched", async () => {
	const h = harness();
	for (const payload of [undefined, null, false, 1, "body", [], new Date(), new Map()]) {
		assert.equal(await h.request(payload), undefined);
	}
	for (const text of [null, false, 1, "text", [], new Date(), new Map()]) {
		const payload = Object.freeze({ text });
		assert.equal(await h.request(payload), undefined);
		assert.equal(payload.text, text);
	}
	assert.deepEqual(await h.request({ text: undefined }), { text: { verbosity: "low" } });
	const payload = Object.assign(Object.create(null), { text: Object.create(null), input: [] });
	assert.deepEqual(await h.request(payload), { text: { verbosity: "low" }, input: [] });
});

test("valid persisted values retain normalization and low/medium/high behavior", async () => {
	for (const [stored, expected] of [["low", "low"], [" Medium ", "medium"], ["HIGH", "high"]]) {
		const h = harness({ config: JSON.stringify({ verbosity: stored, ignored: true }) });
		assert.deepEqual(await h.request({}), { text: { verbosity: expected } });
		assert.deepEqual(h.writes, []);
	}
});

test("missing, unreadable, malformed and invalid config falls back to low without writing", async () => {
	for (const options of [
		{}, { readError: true },
		...['{', 'null', '[]', '{}', '{"verbosity":false}', '{"verbosity":"unknown"}'].map((config) => ({ config })),
	]) {
		const h = harness(options);
		assert.deepEqual(await h.request({}), { text: { verbosity: "low" } });
		assert.deepEqual(h.writes, []);
	}
});

test("commands save the backward-compatible config and report supported coverage", async () => {
	const h = harness();
	for (const value of ["low", "medium", "high"]) {
		const notice = await h.run(`  ${value.toUpperCase()}  `);
		assert.equal(h.writes.at(-1), `${JSON.stringify({ verbosity: value }, null, 2)}\n`);
		assert.equal(notice.kind, "info");
		assert.match(notice.message, new RegExp(`preference saved as ${value}`));
		assert.match(notice.message, /Applies to the selected legacy Codex model/);
		assert.deepEqual(await h.request({}), { text: { verbosity: value } });
	}
});

test("query shows the preference, usage and supported coverage without saving", async () => {
	const h = harness({ config: '{"verbosity":"medium"}' });
	const notice = await h.run("  ");
	assert.equal(notice.kind, "info");
	assert.match(notice.message, /preference is medium/);
	assert.match(notice.message, /Applies to the selected legacy Codex model/);
	assert.match(notice.message, /Usage: \/codex-verbosity low\|medium\|high/);
	assert.deepEqual(h.writes, []);
});

test("save and query feedback explain unsupported and virtual coverage", async () => {
	const cases: Array<[Selection, RegExp]> = [
		[OPENAI_RESPONSES, /Not applied to openai\/Responses, including ChatGPT sign-in/],
		[OTHER_PROVIDER, /Not applied to the selected provider\/API/],
		[{ provider: "openai-codex", api: "openai-completions" }, /Not applied to the selected provider\/API/],
		[VIRTUAL_CODEX, /Not applied to virtual-model requests/],
		[VIRTUAL_ROUTER, /Not applied to virtual-model requests/],
		[undefined, /Not applied: no model is selected/],
	];
	for (const [model, expected] of cases) {
		const h = harness();
		const saved = await h.run("high", model);
		assert.match(saved.message, /preference saved as high/);
		assert.match(saved.message, expected);
		assert.doesNotMatch(saved.message, /Applies to/);
		const queried = await h.run("", model);
		assert.match(queried.message, /preference is high/);
		assert.match(queried.message, expected);
		assert.equal(h.writes.length, 1);
	}
});

test("invalid arguments warn without changing or saving the preference", async () => {
	const h = harness({ config: '{"verbosity":"medium"}' });
	for (const args of ["verbose", "low high", "medium extra", "1"]) {
		assert.deepEqual(await h.run(args), { message: "Usage: /codex-verbosity low|medium|high", kind: "warning" });
	}
	assert.deepEqual(h.writes, []);
	assert.deepEqual(await h.request({}), { text: { verbosity: "medium" } });
});

test("save failure reports an error and keeps the running preference without reporting successful persistence", async () => {
	const h = harness({ config: '{"verbosity":"medium"}', saveError: true });
	const notice = await h.run("high");
	assert.equal(notice.kind, "error");
	assert.match(notice.message, /Could not save/);
	assert.match(notice.message, /previous preference is unchanged/);
	assert.doesNotMatch(notice.message, /saved as/);
	assert.deepEqual(h.writes, []);
	assert.deepEqual(await h.request({}), { text: { verbosity: "medium" } });
	h.register();
	assert.deepEqual(await h.request({}), { text: { verbosity: "medium" } });
	h.setSaveError(false);
	await h.run("high");
	assert.deepEqual(await h.request({}), { text: { verbosity: "high" } });
});

test("independent extension instances do not share mutable preferences", async () => {
	const first = harness({ config: '{"verbosity":"medium"}' });
	const second = harness({ config: '{"verbosity":"high"}' });
	await first.run("low");
	assert.deepEqual(await first.request({}), { text: { verbosity: "low" } });
	assert.deepEqual(await second.request({}), { text: { verbosity: "high" } });
	assert.deepEqual(second.writes, []);
	first.register();
	assert.deepEqual(await first.request({}), { text: { verbosity: "low" } });
	assert.equal(first.reads, 2);
});

test("argument completion retains prefix matching and all valid values", async () => {
	const h = harness();
	assert.deepEqual(await h.command.getArgumentCompletions!(""), [
		{ value: "low", label: "low" }, { value: "medium", label: "medium" }, { value: "high", label: "high" },
	]);
	assert.deepEqual(await h.command.getArgumentCompletions!(" M "), [{ value: "medium", label: "medium" }]);
	assert.deepEqual(await h.command.getArgumentCompletions!("bad"), []);
});
