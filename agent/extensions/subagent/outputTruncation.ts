import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type TruncationOptions,
	type TruncationResult,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";

export interface SubagentVisibleOutputTruncationOptions extends TruncationOptions {
	tempFilePrefix?: string;
	tempFileName?: string;
}

export interface SubagentVisibleOutputTruncationResult {
	text: string;
	truncated: boolean;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

function formatLimit(truncation: TruncationResult): string {
	if (truncation.truncatedBy === "lines") return `${truncation.maxLines} line limit`;
	if (truncation.truncatedBy === "bytes") return `${formatSize(truncation.maxBytes)} byte limit`;
	return "configured limit";
}

export function formatSubagentOutputTruncationMarker(
	truncation: TruncationResult,
	fullOutputPath: string,
): string {
	const omittedLines = Math.max(0, truncation.totalLines - truncation.outputLines);
	const omittedBytes = Math.max(0, truncation.totalBytes - truncation.outputBytes);
	return [
		`Output truncated by ${formatLimit(truncation)}: showing ${truncation.outputLines} of ${truncation.totalLines} lines`,
		`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
		`${omittedLines} lines (${formatSize(omittedBytes)}) omitted.`,
		`Full output saved to: ${fullOutputPath}`,
	].join(" ");
}

async function writeFullOutputToTempFile(
	output: string,
	options: SubagentVisibleOutputTruncationOptions,
): Promise<string> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), options.tempFilePrefix ?? "pi-subagent-output-"));
	const tempFile = path.join(tempDir, options.tempFileName ?? "output.txt");
	await withFileMutationQueue(tempFile, async () => {
		await fs.writeFile(tempFile, output, { encoding: "utf8", mode: 0o600 });
	});
	return tempFile;
}

export async function truncateSubagentVisibleOutput(
	output: string,
	options: SubagentVisibleOutputTruncationOptions = {},
): Promise<SubagentVisibleOutputTruncationResult> {
	const truncation = truncateHead(output, {
		maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
		maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return { text: output, truncated: false };

	const fullOutputPath = await writeFullOutputToTempFile(output, options);
	const marker = `[${formatSubagentOutputTruncationMarker(truncation, fullOutputPath)}]`;
	const text = truncation.content ? `${truncation.content}\n\n${marker}` : marker;
	return { text, truncated: true, truncation, fullOutputPath };
}
