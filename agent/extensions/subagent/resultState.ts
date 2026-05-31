export interface ResultStatusLike {
	exitCode: number;
	stopReason?: string;
}

export interface ResultOutputLike extends ResultStatusLike {
	stderr?: string;
	errorMessage?: string;
	finalOutput?: string;
}

export function isRunningResult(result: ResultStatusLike): boolean {
	return result.exitCode === -1;
}

export function isFailedResult(result: ResultStatusLike): boolean {
	return !isRunningResult(result) && (result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted");
}

export function getFailureDiagnosticOutput(result: Pick<ResultOutputLike, "stderr" | "errorMessage">): string {
	const parts: string[] = [];
	const errorMessage = result.errorMessage?.trim();
	const stderr = result.stderr?.trim() ?? "";
	if (errorMessage) parts.push(errorMessage);
	if (stderr && stderr !== errorMessage) parts.push(stderr);
	return parts.join("\n\n");
}

export function getResultOutput(result: ResultOutputLike): string {
	if (isRunningResult(result)) {
		return result.finalOutput || "(running...)";
	}
	if (isFailedResult(result)) {
		return getFailureDiagnosticOutput(result) || result.finalOutput || "(no output)";
	}
	return result.finalOutput || "(no output)";
}
