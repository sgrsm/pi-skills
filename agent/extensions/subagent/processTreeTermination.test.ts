import assert from "node:assert/strict";
import test from "node:test";
import { createProcessTreeTerminator } from "./processTreeTermination.ts";

test("an owned top-level process group receives negative-PID termination signals", () => {
	const groupCalls: Array<[number, NodeJS.Signals]> = [];
	const childSignals: NodeJS.Signals[] = [];
	const terminator = createProcessTreeTerminator(
		{ pid: 123, kill: (signal) => { childSignals.push(signal); return true; } },
		true,
		(pid, signal) => { groupCalls.push([pid, signal]); return true; },
	);

	assert.equal(terminator.terminate("SIGTERM"), true);
	assert.deepEqual(groupCalls, [[-123, "SIGTERM"]]);
	assert.deepEqual(childSignals, []);
	assert.deepEqual(terminator.diagnostics(), []);
});

test("a nested child is terminated directly without signaling an inherited process group", () => {
	const groupCalls: Array<[number, NodeJS.Signals]> = [];
	const childSignals: NodeJS.Signals[] = [];
	const terminator = createProcessTreeTerminator(
		{ pid: 56, kill: (signal) => { childSignals.push(signal); return true; } },
		false,
		(pid, signal) => { groupCalls.push([pid, signal]); return true; },
	);

	assert.equal(terminator.terminate("SIGKILL"), true);
	assert.deepEqual(groupCalls, []);
	assert.deepEqual(childSignals, ["SIGKILL"]);
	assert.equal(terminator.terminateOwnedGroupAfterExit("SIGKILL"), false);
});

test("owned-group cleanup after exit never falls back to the exited child", () => {
	const groupCalls: Array<[number, NodeJS.Signals]> = [];
	const childSignals: NodeJS.Signals[] = [];
	const terminator = createProcessTreeTerminator(
		{ pid: 55, kill: (signal) => { childSignals.push(signal); return true; } },
		true,
		(pid, signal) => { groupCalls.push([pid, signal]); return true; },
	);

	assert.equal(terminator.terminateOwnedGroupAfterExit("SIGKILL"), true);
	assert.deepEqual(groupCalls, [[-55, "SIGKILL"]]);
	assert.deepEqual(childSignals, []);
});

test("owned process-group failures fall back to the direct child with diagnostics", () => {
	const childSignals: NodeJS.Signals[] = [];
	const terminator = createProcessTreeTerminator(
		{ pid: 42, kill: (signal) => { childSignals.push(signal); return true; } },
		true,
		() => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); },
	);

	assert.equal(terminator.terminate("SIGKILL"), true);
	assert.deepEqual(childSignals, ["SIGKILL"]);
	assert.match(terminator.diagnostics().join("\n"), /process-group.*EPERM.*direct-child/i);
});

test("an unavailable owned-group PID falls back to the direct child with diagnostics", () => {
	const childSignals: NodeJS.Signals[] = [];
	const terminator = createProcessTreeTerminator(
		{ kill: (signal) => { childSignals.push(signal); return true; } },
		true,
	);

	assert.equal(terminator.terminate("SIGTERM"), true);
	assert.deepEqual(childSignals, ["SIGTERM"]);
	assert.match(terminator.diagnostics().join("\n"), /process-group PID is unavailable.*direct-child/i);
});
