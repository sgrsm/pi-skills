import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type TruncationResult,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";

type WebSearchTruncationMetadata = Omit<TruncationResult, "content">;

type WebSearchVisibleOutput = {
	text: string;
	truncated: boolean;
	truncation?: WebSearchTruncationMetadata;
	fullOutputPath?: string;
};

type OutputPersistenceOperations = {
	createTempDir?: (prefix: string) => Promise<string>;
	writeFile?: (path: string, output: string) => Promise<void>;
	removeDirectory?: (path: string) => Promise<void>;
};

type WebSearchVisibleOutputOptions = {
	persistence?: OutputPersistenceOperations;
};

function countLines(text: string): number {
	if (!text) return 0;
	return text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
}

function formatTruncationMarker(fullOutputPath: string): string {
	return `[Output truncated: head preview is bounded to ${DEFAULT_MAX_LINES.toLocaleString()} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). Full formatted output saved to: ${fullOutputPath}]`;
}

async function writeFullOutputToTempFile(
	output: string,
	operations: OutputPersistenceOperations = {},
): Promise<string> {
	const createTempDir = operations.createTempDir ?? mkdtemp;
	const writeOutput = operations.writeFile ?? ((path: string, contents: string) =>
		writeFile(path, contents, { encoding: "utf8", mode: 0o600 }));
	const removeDirectory = operations.removeDirectory ?? ((path: string) =>
		rm(path, { recursive: true, force: true }));
	let tempDir: string | undefined;
	try {
		tempDir = await createTempDir(join(tmpdir(), "pi-web-search-"));
		const tempFile = join(tempDir, "formatted-output.txt");
		await withFileMutationQueue(tempFile, async () => {
			await writeOutput(tempFile, output);
		});
		return tempFile;
	} catch (error) {
		if (tempDir) {
			try {
				await removeDirectory(tempDir);
			} catch {
				// Preserve the original persistence error when cleanup is best-effort.
			}
		}
		throw error;
	}
}

function compactTruncationMetadata(truncation: TruncationResult): WebSearchTruncationMetadata {
	const { content: _content, ...metadata } = truncation;
	return metadata;
}

/**
 * Bounds text returned to the model while retaining exact full formatted output on disk.
 * The preview reserves room for its marker so the final visible text obeys Pi's limits.
 */
export async function truncateWebSearchVisibleOutput(
	output: string,
	options: WebSearchVisibleOutputOptions = {},
): Promise<WebSearchVisibleOutput> {
	const initialTruncation = truncateHead(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!initialTruncation.truncated) return { text: output, truncated: false };

	const fullOutputPath = await writeFullOutputToTempFile(output, options.persistence);
	const marker = formatTruncationMarker(fullOutputPath);
	const separator = "\n\n";
	const preview = truncateHead(output, {
		maxLines: Math.max(0, DEFAULT_MAX_LINES - countLines(marker) - 1),
		maxBytes: Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(marker, "utf8") - Buffer.byteLength(separator, "utf8")),
	});
	const text = preview.content ? `${preview.content}${separator}${marker}` : marker;

	return {
		text,
		truncated: true,
		truncation: compactTruncationMetadata(preview),
		fullOutputPath,
	};
}
