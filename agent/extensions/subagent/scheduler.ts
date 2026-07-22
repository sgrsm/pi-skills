export function createAbortError(): Error {
	const error = new Error("Subagent execution was aborted.");
	error.name = "AbortError";
	return error;
}

/**
 * Runs work in input order with a bounded number of active workers. Once aborted,
 * workers finish only the work they already claimed; no queued item is started and
 * the returned promise rejects after those active workers settle.
 */
export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: readonly TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
	signal?: AbortSignal,
): Promise<TOut[]> {
	if (signal?.aborted) throw createAbortError();
	if (items.length === 0) return [];

	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	let firstError: unknown;
	let hasError = false;
	let aborted = false;
	const observeAbort = () => {
		aborted = true;
	};
	signal?.addEventListener("abort", observeAbort, { once: true });

	try {
		const workers = new Array(limit).fill(null).map(async () => {
			while (!hasError && !aborted && !signal?.aborted) {
				const current = nextIndex++;
				if (current >= items.length) return;
				try {
					results[current] = await fn(items[current], current);
				} catch (error) {
					if (!hasError) {
						firstError = error;
						hasError = true;
					}
				}
			}
		});
		await Promise.all(workers);
	} finally {
		signal?.removeEventListener("abort", observeAbort);
	}

	if (signal?.aborted || aborted) throw createAbortError();
	if (hasError) throw firstError;
	return results;
}
