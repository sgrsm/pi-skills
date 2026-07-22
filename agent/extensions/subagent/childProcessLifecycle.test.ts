import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { type ChildProcessTerminationConfirmationError, waitForChildProcess } from "./childProcessLifecycle.ts";

type KillResult = boolean | Error;

class FakeChildProcess extends EventEmitter {
	readonly destroyedStreams: string[] = [];
	readonly stdout = Object.assign(new EventEmitter(), { destroy: () => this.destroyedStreams.push("stdout") });
	readonly stderr = Object.assign(new EventEmitter(), { destroy: () => this.destroyedStreams.push("stderr") });
	readonly stdin = Object.assign(new EventEmitter(), { destroy: () => this.destroyedStreams.push("stdin") });
	readonly signals: NodeJS.Signals[] = [];
	readonly killResults: Partial<Record<NodeJS.Signals, KillResult[]>>;
	unrefCalls = 0;

	constructor(killResults: Partial<Record<NodeJS.Signals, KillResult[]>> = {}) {
		super();
		this.killResults = killResults;
	}

	kill(signal: NodeJS.Signals): boolean {
		this.signals.push(signal);
		const result = this.killResults[signal]?.shift() ?? true;
		if (result instanceof Error) throw result;
		return result;
	}

	unref() {
		this.unrefCalls++;
	}
}

interface LifecycleOverrides {
	signal?: AbortSignal;
	terminationGraceMs?: number;
	terminationConfirmationMs?: number;
	onStderr?: (data: string) => void;
	onAbort?: () => void;
	onClose?: (code: number | null, signal: NodeJS.Signals | null) => number;
	onProcessError?: (error: unknown) => number;
	onTerminationConfirmationFailure?: (error: ChildProcessTerminationConfirmationError) => number;
	terminator?: {
		terminate(signal: NodeJS.Signals): boolean;
		terminateOwnedGroupAfterExit?(signal: NodeJS.Signals): boolean;
		diagnostics?(): string[];
	};
}

function createLifecycle(
	child: FakeChildProcess,
	processLine: (line: string) => void,
	{
		signal,
		terminator,
		terminationGraceMs = 10,
		terminationConfirmationMs = 10,
		onStderr = () => {},
		onAbort = () => {},
		onClose = (code) => code ?? 1,
		onProcessError = () => 1,
		onTerminationConfirmationFailure = () => 1,
	}: LifecycleOverrides = {},
) {
	return waitForChildProcess(child, {
		signal,
		terminationGraceMs,
		terminationConfirmationMs,
		closeConfirmationMs: 10,
		processLine,
		onStderr,
		onStdinError: () => {},
		onAbort,
		onClose,
		onProcessError,
		onTerminationConfirmationFailure,
		terminator,
	});
}

function wait(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("stdout processing failure stops output, terminates once, and rejects only after close", async () => {
	const child = new FakeChildProcess();
	const processingError = new Error("update failed");
	const processedLines: string[] = [];
	const stderr: string[] = [];
	const completion = createLifecycle(child, (line) => {
		processedLines.push(line);
		if (line === "fail") throw processingError;
	}, { onStderr: (data) => stderr.push(data) });
	let settled = false;
	void completion.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);

	child.stdout.emit("data", Buffer.from("first\nfail\n"));
	child.stdout.emit("data", Buffer.from("after-failure\n"));
	child.stderr.emit("data", Buffer.from("after-failure stderr"));

	assert.deepEqual(processedLines, ["first", "fail"]);
	assert.deepEqual(stderr, []);
	assert.deepEqual(child.signals, ["SIGTERM"]);
	await Promise.resolve();
	assert.equal(settled, false);

	child.emit("close", 0, null);
	await assert.rejects(completion, (error: unknown) => error === processingError);
	await wait(25);
	assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("stream processing failure shares abort termination and escalates only once", async () => {
	const child = new FakeChildProcess();
	const abortController = new AbortController();
	let aborts = 0;
	const completion = createLifecycle(child, () => {
		throw new Error("processing failed");
	}, {
		signal: abortController.signal,
		terminationConfirmationMs: 50,
		onAbort: () => {
			aborts++;
		},
	});

	child.stdout.emit("data", Buffer.from("bad\n"));
	abortController.abort();

	assert.equal(aborts, 1);
	assert.deepEqual(child.signals, ["SIGTERM"]);
	await wait(25);
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);

	child.emit("close", null, "SIGKILL");
	await assert.rejects(completion, /processing failed/);
});

test("SIGTERM and SIGKILL false results are observed and do not prevent escalation", async () => {
	const child = new FakeChildProcess({ SIGTERM: [false], SIGKILL: [false] });
	const abortController = new AbortController();
	let failure: ChildProcessTerminationConfirmationError | undefined;
	const completion = createLifecycle(child, () => {}, {
		signal: abortController.signal,
		terminationGraceMs: 5,
		terminationConfirmationMs: 5,
		onTerminationConfirmationFailure: (error) => {
			failure = error;
			return 23;
		},
	});

	abortController.abort();
	assert.deepEqual(child.signals, ["SIGTERM"]);
	assert.equal(await completion, 23);
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
	assert.match(failure?.message ?? "", /termination is unconfirmed.*may still be running/i);
	assert.equal(failure?.sigtermDelivered, false);
	assert.equal(failure?.sigkillDelivered, false);
});

test("termination-related EPERM errors neither settle nor suppress SIGKILL before close", async () => {
	const child = new FakeChildProcess();
	const abortController = new AbortController();
	let processErrors = 0;
	let settled = false;
	const completion = createLifecycle(child, () => {}, {
		signal: abortController.signal,
		terminationConfirmationMs: 50,
		onProcessError: () => {
			processErrors++;
			return 1;
		},
	});
	void completion.then(() => {
		settled = true;
	});

	abortController.abort();
	child.emit("error", Object.assign(new Error("operation not permitted"), { code: "EPERM" }));
	await Promise.resolve();
	assert.equal(processErrors, 0);
	assert.equal(settled, false);
	await wait(25);
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
	assert.equal(settled, false);

	child.emit("close", null, "SIGKILL");
	assert.equal(await completion, 1);
	assert.equal(processErrors, 0);
});

test("termination process errors are included in bounded confirmation diagnostics", async () => {
	const child = new FakeChildProcess();
	const abortController = new AbortController();
	const terminationError = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
	let failure: ChildProcessTerminationConfirmationError | undefined;
	const completion = createLifecycle(child, () => {}, {
		signal: abortController.signal,
		terminationGraceMs: 5,
		terminationConfirmationMs: 5,
		onTerminationConfirmationFailure: (error) => {
			failure = error;
			return 1;
		},
	});

	abortController.abort();
	child.emit("error", terminationError);
	assert.equal(await completion, 1);
	assert.equal(failure?.terminationError, terminationError);
	assert.match(failure?.message ?? "", /EPERM/);
});

test("thrown kill errors are retained, still escalate, and fail bounded confirmation", async () => {
	const sigtermError = Object.assign(new Error("not permitted"), { code: "EPERM" });
	const sigkillError = Object.assign(new Error("kill failed"), { code: "ESRCH" });
	const child = new FakeChildProcess({ SIGTERM: [sigtermError], SIGKILL: [sigkillError] });
	const abortController = new AbortController();
	let failure: Error & { sigtermError: unknown; sigkillError: unknown } | undefined;
	const completion = createLifecycle(child, () => {}, {
		signal: abortController.signal,
		terminationGraceMs: 5,
		terminationConfirmationMs: 5,
		onTerminationConfirmationFailure: (error) => {
			failure = error;
			return 1;
		},
	});

	abortController.abort();
	assert.equal(await completion, 1);
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
	assert.equal(failure?.sigtermError, sigtermError);
	assert.equal(failure?.sigkillError, sigkillError);
	assert.match(failure?.message ?? "", /EPERM/);
	assert.match(failure?.message ?? "", /ESRCH/);
});

test("a successful SIGKILL without close fails after the confirmation bound", async () => {
	const child = new FakeChildProcess();
	const abortController = new AbortController();
	let failures = 0;
	const completion = createLifecycle(child, () => {}, {
		signal: abortController.signal,
		terminationGraceMs: 5,
		terminationConfirmationMs: 5,
		onTerminationConfirmationFailure: (error) => {
			failures++;
			assert.match(error.message, /termination is unconfirmed.*may still be running/i);
			return 7;
		},
	});

	abortController.abort();
	assert.equal(await completion, 7);
	assert.equal(failures, 1);
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("unconfirmed termination releases handles and retains only module-level error sinks", async () => {
	const child = new FakeChildProcess();
	const abortController = new AbortController();
	let settlements = 0;
	const completion = createLifecycle(child, () => {}, {
		signal: abortController.signal,
		terminationGraceMs: 5,
		terminationConfirmationMs: 5,
	});
	void completion.then(
		() => {
			settlements++;
		},
		() => {
			settlements++;
		},
	);

	abortController.abort();
	await completion;
	assert.equal(settlements, 1);
	assert.deepEqual(child.destroyedStreams.sort(), ["stderr", "stdin", "stdout"]);
	assert.equal(child.unrefCalls, 1);
	assert.equal(child.listenerCount("error"), 1);
	assert.equal(child.listenerCount("close"), 0);
	assert.equal(child.listenerCount("exit"), 0);
	assert.equal(child.stdout.listenerCount("data"), 0);
	assert.equal(child.stderr.listenerCount("data"), 0);
	assert.equal(child.stdout.listenerCount("error"), 1);
	assert.equal(child.stderr.listenerCount("error"), 1);
	assert.equal(child.stdin.listenerCount("error"), 1);
	assert.doesNotThrow(() => child.stdin.emit("error", new Error("late stdin error")));
	assert.doesNotThrow(() => child.stdout.emit("error", new Error("late stdout error")));
	assert.doesNotThrow(() => child.stderr.emit("error", new Error("late stderr error")));
	assert.doesNotThrow(() => child.emit("error", new Error("late process error")));
	assert.equal(settlements, 1);

	child.emit("close", null, "SIGKILL");
	assert.equal(child.listenerCount("error"), 1);
	assert.equal(child.listenerCount("close"), 0);
	assert.equal(child.stdin.listenerCount("error"), 1);
	assert.equal(child.stderr.listenerCount("error"), 1);
	assert.equal(settlements, 1);
});

test("stderr callback and stream errors use the bounded fatal-processing path", async () => {
	const callbackChild = new FakeChildProcess();
	const callbackFailure = new Error("stderr handling failed");
	const callbackCompletion = createLifecycle(callbackChild, () => {}, {
		onStderr: () => {
			throw callbackFailure;
		},
	});
	callbackChild.stderr.emit("data", Buffer.from("diagnostic"));
	assert.deepEqual(callbackChild.signals, ["SIGTERM"]);
	callbackChild.emit("close", null, "SIGTERM");
	await assert.rejects(callbackCompletion, (error: unknown) => error === callbackFailure);

	const streamChild = new FakeChildProcess();
	const streamFailure = new Error("stderr stream failed");
	const streamCompletion = createLifecycle(streamChild, () => {});
	assert.doesNotThrow(() => streamChild.stderr.emit("error", streamFailure));
	assert.deepEqual(streamChild.signals, ["SIGTERM"]);
	streamChild.emit("close", null, "SIGTERM");
	await assert.rejects(streamCompletion, (error: unknown) => error === streamFailure);

	const stdoutChild = new FakeChildProcess();
	const stdoutFailure = new Error("stdout stream failed");
	const stdoutCompletion = createLifecycle(stdoutChild, () => {});
	assert.doesNotThrow(() => stdoutChild.stdout.emit("error", stdoutFailure));
	assert.deepEqual(stdoutChild.signals, ["SIGTERM"]);
	stdoutChild.emit("close", null, "SIGTERM");
	await assert.rejects(stdoutCompletion, (error: unknown) => error === stdoutFailure);
});

test("a normal exit cleans only an owned process group and has a finite close ceiling", async () => {
	const child = new FakeChildProcess();
	const controller = new AbortController();
	const terminatorSignals: NodeJS.Signals[] = [];
	const ownedGroupSignals: NodeJS.Signals[] = [];
	let failure: ChildProcessTerminationConfirmationError | undefined;
	const completion = createLifecycle(child, () => {}, {
		signal: controller.signal,
		terminationGraceMs: 50,
		terminationConfirmationMs: 50,
		terminator: {
			terminate: (signal) => {
				terminatorSignals.push(signal);
				return true;
			},
			terminateOwnedGroupAfterExit: (signal) => { ownedGroupSignals.push(signal); return true; },
		},
		onTerminationConfirmationFailure: (error) => {
			failure = error;
			return 1;
		},
	});
	child.emit("exit", 0, null);
	controller.abort();
	assert.equal(await completion, 1);
	assert.deepEqual(ownedGroupSignals, ["SIGKILL"]);
	assert.deepEqual(child.signals, []);
	assert.deepEqual(terminatorSignals, []);
	assert.equal(child.unrefCalls, 1);
	assert.deepEqual(child.destroyedStreams.sort(), ["stderr", "stdin", "stdout"]);
	assert.equal(child.listenerCount("close"), 0);
	assert.equal(child.listenerCount("exit"), 0);
	assert.equal(child.listenerCount("error"), 1);
	assert.doesNotThrow(() => child.emit("error", new Error("late process error")));
	assert.doesNotThrow(() => child.stdout.emit("error", new Error("late stdout error")));
	assert.match(failure?.message ?? "", /exited but close was not observed.*inherited pipes/i);
});

test("processing error remains the rejection reason after a termination error then close", async () => {
	const child = new FakeChildProcess();
	const processingError = new Error("sentinel processing error");
	const abortController = new AbortController();
	let processErrors = 0;
	const completion = createLifecycle(child, () => {
		throw processingError;
	}, {
		signal: abortController.signal,
		onProcessError: () => {
			processErrors++;
			return 1;
		},
	});

	child.stdout.emit("data", Buffer.from("bad\n"));
	child.emit("error", Object.assign(new Error("operation not permitted"), { code: "EPERM" }));
	child.emit("close", null, "SIGTERM");

	await assert.rejects(completion, (error: unknown) => error === processingError);
	assert.equal(processErrors, 0);
});

test("processing error confirmation timeout reports diagnostics but rejects the original processing error", async () => {
	const child = new FakeChildProcess();
	const processingError = new Error("sentinel processing error");
	let confirmationFailures = 0;
	const completion = createLifecycle(child, () => {
		throw processingError;
	}, {
		terminationGraceMs: 5,
		terminationConfirmationMs: 5,
		onTerminationConfirmationFailure: () => {
			confirmationFailures++;
			return 1;
		},
	});

	child.stdout.emit("data", Buffer.from("bad\n"));
	await assert.rejects(completion, (error: unknown) => error === processingError);
	assert.equal(confirmationFailures, 1);
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("a trailing-buffer processing failure rejects from close without signaling a closed child", async () => {
	const child = new FakeChildProcess();
	const processingError = new Error("trailing buffer failed");
	const completion = createLifecycle(child, () => {
		throw processingError;
	});

	child.stdout.emit("data", Buffer.from("trailing event"));
	child.emit("close", 0, null);

	await assert.rejects(completion, (error: unknown) => error === processingError);
	assert.deepEqual(child.signals, []);
});
