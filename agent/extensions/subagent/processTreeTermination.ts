export interface TerminationChildProcess {
	pid?: number;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ProcessTreeTerminator {
	terminate(signal: NodeJS.Signals): boolean;
	terminateOwnedGroupAfterExit(signal: NodeJS.Signals): boolean;
	diagnostics(): string[];
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		const code = (error as { code?: unknown }).code;
		return `${typeof code === "string" ? `${code}: ` : ""}${error.message}`;
	}
	return String(error);
}

/**
 * Terminates a top-level child and its dedicated POSIX process group. Nested
 * children never own a group and are signaled directly.
 */
export function createProcessTreeTerminator(
	child: TerminationChildProcess,
	ownsDedicatedProcessGroup: boolean,
	killProcessGroup: (pid: number, signal: NodeJS.Signals) => boolean = (pid, signal) => process.kill(pid, signal),
): ProcessTreeTerminator {
	const diagnostics: string[] = [];

	const directChildFallback = (signal: NodeJS.Signals, reason: string): boolean => {
		diagnostics.push(`${reason}; falling back to direct-child ${signal}.`);
		try {
			return child.kill(signal);
		} catch (error) {
			diagnostics.push(`Direct-child ${signal} threw: ${describeError(error)}.`);
			throw error;
		}
	};

	return {
		terminate(signal) {
			if (!ownsDedicatedProcessGroup) return child.kill(signal);

			const pid = child.pid;
			if (!Number.isSafeInteger(pid) || pid === undefined || pid <= 0) {
				return directChildFallback(signal, "Process-group PID is unavailable");
			}

			try {
				const delivered = killProcessGroup(-pid, signal);
				if (delivered) return true;
				return directChildFallback(signal, `Process-group ${signal} reported not delivered`);
			} catch (error) {
				return directChildFallback(signal, `Process-group ${signal} failed: ${describeError(error)}`);
			}
		},
		terminateOwnedGroupAfterExit(signal) {
			if (!ownsDedicatedProcessGroup) return false;
			const pid = child.pid;
			if (!Number.isSafeInteger(pid) || pid === undefined || pid <= 0) return false;
			try {
				return killProcessGroup(-pid, signal);
			} catch (error) {
				diagnostics.push(`Owned process-group ${signal} after leader exit failed: ${describeError(error)}.`);
				return false;
			}
		},
		diagnostics: () => [...diagnostics],
	};
}
