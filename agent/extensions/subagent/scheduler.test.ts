import assert from "node:assert/strict";
import test from "node:test";
import { createAbortError, mapWithConcurrencyLimit } from "./scheduler.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

test("pre-aborted scheduling rejects without claiming work", async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;

	await assert.rejects(
		mapWithConcurrencyLimit(["one", "two"], 2, async () => {
			calls++;
			return "unexpected";
		}, controller.signal),
		(error: unknown) => error instanceof Error && error.name === "AbortError",
	);
	assert.equal(calls, 0);
});

test("parallel workers stop claiming queued work after abort and reject after active work settles", async () => {
	const controller = new AbortController();
	const first = deferred<string>();
	const second = deferred<string>();
	const claimed: number[] = [];
	let settled = false;
	const completion = mapWithConcurrencyLimit(
		[0, 1, 2, 3],
		2,
		async (item) => {
			claimed.push(item);
			return item === 0 ? first.promise : second.promise;
		},
		controller.signal,
	);
	void completion.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);

	await Promise.resolve();
	assert.deepEqual(claimed, [0, 1]);
	controller.abort();
	first.resolve("first");
	await Promise.resolve();
	assert.equal(settled, false);
	assert.deepEqual(claimed, [0, 1]);
	second.resolve("second");

	await assert.rejects(completion, (error: unknown) => error instanceof Error && error.name === "AbortError");
	assert.deepEqual(claimed, [0, 1]);
});

test("an undefined rejection stops workers and is rethrown", async () => {
	const second = deferred<void>();
	const claimed: number[] = [];
	const completion = mapWithConcurrencyLimit([0, 1, 2], 2, async (item) => {
		claimed.push(item);
		if (item === 0) throw undefined;
		await second.promise;
	});

	await Promise.resolve();
	assert.deepEqual(claimed, [0, 1]);
	second.resolve();
	await completion.then(
		() => assert.fail("expected undefined rejection"),
		(error) => assert.equal(error, undefined),
	);
	assert.deepEqual(claimed, [0, 1]);
});

test("abort errors are recognizable without relying on DOMException", () => {
	const error = createAbortError();
	assert.equal(error.name, "AbortError");
	assert.match(error.message, /aborted/i);
});
