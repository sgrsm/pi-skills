import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { expectRequestCount, type DialogRequest } from "./dialogTestHarness.ts";

test("dialog expectations wait for asynchronous preflight rather than a fixed number of turns", async () => {
	const requests: DialogRequest[] = [];
	const arrival = setTimeout(20).then(() => {
		requests.push({ method: "select", title: "Ready", doneCalls: 0, answer() {} });
	});
	try {
		await expectRequestCount(requests, 1);
		assert.equal(requests[0].title, "Ready");
	} finally {
		await arrival;
	}
});
