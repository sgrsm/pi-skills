import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { SessionDialogQueue } from "./dialogQueue.ts";

function deferred() {
	let resolve!: () => void;
	return { promise: new Promise<void>((done) => { resolve = done; }), release: () => resolve() };
}

test("FIFO skips a cancelled waiter and releases after a failure", async () => {
	const queue = new SessionDialogQueue();
	const hold = deferred();
	const started = deferred();
	const order: string[] = [];
	const first = queue.run(queue.signal, async () => { order.push("first"); started.release(); await hold.promise; });
	await started.promise;
	const cancelled = new AbortController();
	const second = queue.run(cancelled.signal, async () => { order.push("must not run"); });
	const third = queue.run(queue.signal, async () => { order.push("third"); throw new Error("failed"); });
	const fourth = queue.run(queue.signal, async () => { order.push("fourth"); return 4; });
	cancelled.abort();
	await assert.rejects(second, { name: "AbortError" });
	const thirdFailure = assert.rejects(third, /failed/);
	hold.release();
	await first;
	await thirdFailure;
	assert.equal(await fourth, 4);
	assert.deepEqual(order, ["first", "third", "fourth"]);
});

test("abort in the acquired-before-operation window runs no callback and frees the queue", async () => {
	const queue = new SessionDialogQueue();
	const controller = new AbortController();
	let callbacks = 0;
	const first = queue.run(controller.signal, async () => { callbacks++; });
	controller.abort();
	await assert.rejects(first, { name: "AbortError" });
	assert.equal(callbacks, 0);
	assert.equal(await queue.run(queue.signal, async () => "next"), "next");
});

test("shutdown cancels unresolved displayed work and queued work; captured old lifetime cannot revive", async () => {
	const queue = new SessionDialogQueue();
	const oldSignal = queue.scopeSignal();
	const started = deferred();
	let displayedSignal!: AbortSignal;
	const first = queue.run(oldSignal, async (signal) => {
		displayedSignal = signal;
		started.release();
		return new Promise(() => {}); // A misbehaving client must not strand owned work.
	});
	await started.promise;
	const second = queue.run(oldSignal, async () => assert.fail("closed waiter ran"));
	queue.close();
	await assert.rejects(first, { name: "AbortError" });
	await assert.rejects(second, { name: "AbortError" });
	assert.deepEqual(getEventListeners(displayedSignal, "abort"), []);
	queue.start();
	await assert.rejects(queue.run(oldSignal, async () => assert.fail("stale callback ran")), { name: "AbortError" });
	assert.equal(await queue.run(queue.signal, async () => "fresh"), "fresh");
});
