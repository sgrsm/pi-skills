// These listeners intentionally capture no per-child state. They prevent unhandled late
// error events after an unconfirmed child is released.
const lateErrorSink = () => {};

export interface ChildProcessLifecycleStream {
	on(event: "data", listener: (data: { toString(): string }) => void): unknown;
	off(event: "data", listener: (data: { toString(): string }) => void): unknown;
	on(event: "error", listener: (error: unknown) => void): unknown;
	off(event: "error", listener: (error: unknown) => void): unknown;
	destroy?(): void;
}

export interface ChildProcessLifecycleProcess {
	stdout: ChildProcessLifecycleStream;
	stderr: ChildProcessLifecycleStream;
	stdin: ChildProcessLifecycleStream;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	off(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	off(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "error", listener: (error: unknown) => void): unknown;
	off(event: "error", listener: (error: unknown) => void): unknown;
	kill(signal: NodeJS.Signals): boolean;
	unref?(): void;
}

export interface ChildProcessTerminator {
	terminate(signal: NodeJS.Signals): boolean;
	terminateOwnedGroupAfterExit?(signal: NodeJS.Signals): boolean;
	diagnostics?(): string[];
}

export class ChildProcessTerminationConfirmationError extends Error {
	readonly sigtermDelivered: boolean | undefined;
	readonly sigkillDelivered: boolean | undefined;
	readonly sigtermError: unknown;
	readonly sigkillError: unknown;
	readonly terminationError: unknown;
	readonly terminationDiagnostics: string[];
	readonly normalExitWithoutClose: boolean;

	constructor({
		sigtermDelivered,
		sigkillDelivered,
		sigtermError,
		sigkillError,
		terminationError,
		terminationDiagnostics = [],
		normalExitWithoutClose = false,
	}: {
		sigtermDelivered: boolean | undefined;
		sigkillDelivered: boolean | undefined;
		sigtermError: unknown;
		sigkillError: unknown;
		terminationError: unknown;
		terminationDiagnostics?: string[];
		normalExitWithoutClose?: boolean;
	}) {
		const describeError = (error: unknown) => {
			if (typeof error !== "object" || error === null) return undefined;
			const { code, message } = error as { code?: unknown; message?: unknown };
			if (typeof code === "string" && typeof message === "string") return `${code}: ${message}`;
			if (typeof code === "string") return code;
			if (typeof message === "string") return message;
			return undefined;
		};
		const describeAttempt = (delivered: boolean | undefined, error: unknown) => {
			if (error !== undefined) {
				const details = describeError(error);
				return `threw an error${details ? ` (${details})` : ""}`;
			}
			if (delivered === true) return "reported delivered";
			if (delivered === false) return "reported not delivered";
			return "not attempted";
		};
		const terminationErrorDetails = describeError(terminationError);
		super(
			"Child process termination is unconfirmed; the child may still be running. " +
				`SIGTERM ${describeAttempt(sigtermDelivered, sigtermError)}; ` +
				`SIGKILL ${describeAttempt(sigkillDelivered, sigkillError)}.` +
				(normalExitWithoutClose
					? " The child exited but close was not observed before the close-confirmation ceiling; inherited pipes may still be open."
					: "") +
				(terminationErrorDetails ? ` Process error during termination: ${terminationErrorDetails}.` : "") +
				(terminationDiagnostics.length > 0 ? ` Termination diagnostics: ${terminationDiagnostics.join(" ")}` : ""),
		);
		this.name = "ChildProcessTerminationConfirmationError";
		this.sigtermDelivered = sigtermDelivered;
		this.sigkillDelivered = sigkillDelivered;
		this.sigtermError = sigtermError;
		this.sigkillError = sigkillError;
		this.terminationError = terminationError;
		this.terminationDiagnostics = terminationDiagnostics;
		this.normalExitWithoutClose = normalExitWithoutClose;
	}
}

export interface ChildProcessLifecycleOptions {
	signal?: AbortSignal;
	terminationGraceMs: number;
	terminationConfirmationMs: number;
	closeConfirmationMs: number;
	terminator?: ChildProcessTerminator;
	processLine(line: string): void;
	onStderr(data: string): void;
	onStdinError(error: unknown): void;
	onAbort(): void;
	onClose(code: number | null, signal: NodeJS.Signals | null): number;
	onProcessError(error: unknown): number;
	onTerminationConfirmationFailure(error: ChildProcessTerminationConfirmationError): number;
}

/**
 * Streams JSON-lines output and owns bounded termination. `close` confirms stream
 * release; `exit` alone is not enough because descendants may retain inherited pipes.
 */
export function waitForChildProcess(
	proc: ChildProcessLifecycleProcess,
	{
		signal,
		terminationGraceMs,
		terminationConfirmationMs,
		closeConfirmationMs,
		terminator,
		processLine,
		onStderr,
		onStdinError,
		onAbort,
		onClose,
		onProcessError,
		onTerminationConfirmationFailure,
	}: ChildProcessLifecycleOptions,
): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		let buffer = "";
		let closed = false;
		let settled = false;
		let sigtermRequested = false;
		let sigkillAttempted = false;
		let awaitingTerminationConfirmation = false;
		let normalExitWithoutClose = false;
		let sigtermDelivered: boolean | undefined;
		let sigkillDelivered: boolean | undefined;
		let sigtermError: unknown;
		let sigkillError: unknown;
		let terminationError: unknown;
		let hasProcessingError = false;
		let processingError: unknown;
		let escalationTimer: ReturnType<typeof setTimeout> | undefined;
		let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
		let closeTimer: ReturnType<typeof setTimeout> | undefined;
		let abortHandler: (() => void) | undefined;
		let lateErrorSinksInstalled = false;
		const clearTimers = () => {
			for (const timer of [escalationTimer, confirmationTimer, closeTimer]) if (timer) clearTimeout(timer);
			escalationTimer = undefined;
			confirmationTimer = undefined;
			closeTimer = undefined;
		};
		const removeActiveListeners = () => {
			proc.stdout.off("data", stdoutHandler);
			proc.stderr.off("data", stderrHandler);
			proc.stdout.off("error", stdoutErrorHandler);
			proc.stderr.off("error", stderrErrorHandler);
			proc.stdin.off("error", stdinErrorHandler);
		};
		const removeProcessListeners = () => {
			proc.off("close", closeHandler);
			proc.off("exit", exitHandler);
			proc.off("error", processErrorHandler);
		};
		const installLateErrorSinks = () => {
			if (lateErrorSinksInstalled) return;
			lateErrorSinksInstalled = true;
			removeActiveListeners();
			removeProcessListeners();
			proc.stdout.on("error", lateErrorSink);
			proc.stderr.on("error", lateErrorSink);
			proc.stdin.on("error", lateErrorSink);
			proc.on("error", lateErrorSink);
		};
		const removeLateErrorSinks = () => {
			if (!lateErrorSinksInstalled) return;
			proc.stdout.off("error", lateErrorSink);
			proc.stderr.off("error", lateErrorSink);
			proc.stdin.off("error", lateErrorSink);
			proc.off("error", lateErrorSink);
			lateErrorSinksInstalled = false;
		};
		const cleanup = ({ retainLateErrorSinks = false }: { retainLateErrorSinks?: boolean } = {}) => {
			clearTimers();
			if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
			if (retainLateErrorSinks) installLateErrorSinks();
			else {
				removeActiveListeners();
				removeLateErrorSinks();
				removeProcessListeners();
			}
		};
		const releaseHandles = () => {
			for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
				try {
					stream.destroy?.();
				} catch {
					// A best-effort release must not delay terminal settlement.
				}
			}
			try {
				proc.unref?.();
			} catch {
				// Ignore unref failures; diagnostic handling remains bounded.
			}
		};
		const finish = (code: number, retainLateErrorSinks = false) => {
			if (settled) return;
			settled = true;
			cleanup({ retainLateErrorSinks });
			resolve(code);
		};
		const rejectTerminal = (error: unknown, retainLateErrorSinks = false) => {
			if (settled) return;
			settled = true;
			cleanup({ retainLateErrorSinks });
			reject(error);
		};
		const attemptSignal = (signalToSend: NodeJS.Signals) => {
			try {
				return { delivered: terminator ? terminator.terminate(signalToSend) : proc.kill(signalToSend), error: undefined };
			} catch (error) {
				return { delivered: undefined, error };
			}
		};
		const createConfirmationFailure = () =>
			new ChildProcessTerminationConfirmationError({
				sigtermDelivered,
				sigkillDelivered,
				sigtermError,
				sigkillError,
				terminationError,
				terminationDiagnostics: terminator?.diagnostics?.() ?? [],
				normalExitWithoutClose,
			});
		const settleUnconfirmed = () => {
			if (closed || settled) return;
			// Destroying a stream can synchronously emit an error. Replace processing
			// listeners first so teardown cannot create a second terminal failure.
			installLateErrorSinks();
			releaseHandles();
			const confirmationFailure = createConfirmationFailure();
			if (hasProcessingError) {
				try {
					onTerminationConfirmationFailure(confirmationFailure);
				} catch {
					// The original stream-processing error remains terminal.
				}
				rejectTerminal(processingError, true);
				return;
			}
			try {
				finish(onTerminationConfirmationFailure(confirmationFailure), true);
			} catch (error) {
				rejectTerminal(error, true);
			}
		};
		const awaitTerminationConfirmation = () => {
			if (closed || settled || awaitingTerminationConfirmation) return;
			awaitingTerminationConfirmation = true;
			confirmationTimer = setTimeout(() => {
				confirmationTimer = undefined;
				awaitingTerminationConfirmation = false;
				settleUnconfirmed();
			}, terminationConfirmationMs);
		};
		const forceKill = () => {
			if (closed || settled || sigkillAttempted) return;
			sigkillAttempted = true;
			const attempt = attemptSignal("SIGKILL");
			sigkillDelivered = attempt.delivered;
			sigkillError = attempt.error;
		};
		const requestTermination = () => {
			// Once a normal direct-child exit is observed, its PID/PGID can be reused.
			// The close timer will diagnose unreleased inherited pipes without signaling it.
			if (closed || settled || sigtermRequested || normalExitWithoutClose) return;
			sigtermRequested = true;
			const attempt = attemptSignal("SIGTERM");
			sigtermDelivered = attempt.delivered;
			sigtermError = attempt.error;
			escalationTimer = setTimeout(() => {
				escalationTimer = undefined;
				if (closed || settled) return;
				forceKill();
				if (!closed && !settled) awaitTerminationConfirmation();
			}, terminationGraceMs);
		};
		const failProcessing = (error: unknown) => {
			if (hasProcessingError || closed || settled) return;
			hasProcessingError = true;
			processingError = error;
			requestTermination();
		};

		const stdoutHandler = (data: { toString(): string }) => {
			if (hasProcessingError || closed || settled) return;
			try {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			} catch (error) {
				failProcessing(error);
			}
		};
		const stderrHandler = (data: { toString(): string }) => {
			if (hasProcessingError || closed || settled) return;
			try {
				onStderr(data.toString());
			} catch (error) {
				failProcessing(error);
			}
		};
		const stdoutErrorHandler = (error: unknown) => failProcessing(error);
		const stderrErrorHandler = (error: unknown) => failProcessing(error);
		const stdinErrorHandler = (error: unknown) => {
			if (hasProcessingError || closed || settled) return;
			try {
				onStdinError(error);
			} catch (processingFailure) {
				failProcessing(processingFailure);
			}
		};
		const closeHandler = (code: number | null, termSignal: NodeJS.Signals | null) => {
			if (closed) return;
			closed = true;
			cleanup();
			if (settled) return;
			if (hasProcessingError) {
				rejectTerminal(processingError);
				return;
			}
			try {
				if (buffer.trim()) processLine(buffer);
			} catch (error) {
				rejectTerminal(error);
				return;
			}
			try {
				finish(onClose(code, termSignal));
			} catch (error) {
				rejectTerminal(error);
			}
		};
		const exitHandler = () => {
			if (closed || settled || sigtermRequested) return;
			normalExitWithoutClose = true;
			// Only a top-level POSIX child owns a dedicated group. Clean it while
			// the leader-exit event is fresh; nested children are never group-signaled.
			terminator?.terminateOwnedGroupAfterExit?.("SIGKILL");
			closeTimer = setTimeout(() => {
				closeTimer = undefined;
				if (closed || settled) return;
				settleUnconfirmed();
			}, closeConfirmationMs);
		};
		const processErrorHandler = (error: unknown) => {
			if (closed || settled) return;
			if (sigtermRequested) {
				terminationError ??= error;
				return;
			}
			try {
				finish(onProcessError(error));
			} catch (processError) {
				rejectTerminal(processError);
			}
		};

		proc.stdout.on("data", stdoutHandler);
		proc.stderr.on("data", stderrHandler);
		proc.stdout.on("error", stdoutErrorHandler);
		proc.stderr.on("error", stderrErrorHandler);
		proc.stdin.on("error", stdinErrorHandler);
		proc.on("close", closeHandler);
		proc.on("exit", exitHandler);
		proc.on("error", processErrorHandler);

		if (signal) {
			abortHandler = () => {
				if (closed || settled) return;
				try {
					onAbort();
				} catch (error) {
					failProcessing(error);
					return;
				}
				requestTermination();
			};
			if (signal.aborted) abortHandler();
			else signal.addEventListener("abort", abortHandler, { once: true });
		}
	});
}
