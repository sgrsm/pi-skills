import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Await an abort-aware operation even when a test/client fails to settle its UI promise. */
export function waitForDialog<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const onAbort = () => { cleanup(); reject(signal.reason); };
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			start().then(
				(value) => { cleanup(); if (signal.aborted) reject(signal.reason); else resolve(value); },
				(error) => { cleanup(); reject(error); },
			);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}

type Waiter = { enter(): void; cancel(): void };

export class SessionDialogQueue {
	private lifetime = new AbortController();
	private active = false;
	private readonly waiting: Waiter[] = [];

	get signal(): AbortSignal { return this.lifetime.signal; }

	/** Capture before any asynchronous request analysis, not just before displaying UI. */
	scopeSignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
		return AbortSignal.any([this.signal, ...signals.filter((signal): signal is AbortSignal => Boolean(signal))]);
	}

	close(): void { this.lifetime.abort(); }
	start(): void { this.close(); this.lifetime = new AbortController(); }

	async run<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const scoped = this.scopeSignal(signal);
		const release = await this.acquire(scoped);
		try {
			return await waitForDialog(scoped, () => operation(scoped));
		} finally {
			release();
		}
	}

	private acquire(signal: AbortSignal): Promise<() => void> {
		signal.throwIfAborted();
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				enter: () => {
					signal.removeEventListener("abort", waiter.cancel);
					this.active = true;
					resolve(() => {
						this.active = false;
						this.waiting.shift()?.enter();
					});
				},
				cancel: () => {
					const index = this.waiting.indexOf(waiter);
					if (index >= 0) this.waiting.splice(index, 1);
					signal.removeEventListener("abort", waiter.cancel);
					reject(signal.reason);
				},
			};
			if (!this.active) waiter.enter();
			else {
				this.waiting.push(waiter);
				signal.addEventListener("abort", waiter.cancel, { once: true });
			}
		});
	}
}

const QUEUE_CHANNEL = "local:session-dialog-queue:v1";
type QueueQuery = { queue?: SessionDialogQueue };

/**
 * Pi creates a distinct API/events wrapper and jiti module instance per extension.
 * Rendezvous through the public, synchronous session event bus, not a module singleton
 * or process-global queue (which could mix independent SDK sessions).
 */
export function getSessionDialogQueue(pi: ExtensionAPI): SessionDialogQueue {
	const query: QueueQuery = {};
	pi.events.emit(QUEUE_CHANNEL, query);
	if (query.queue) return query.queue;

	const queue = new SessionDialogQueue();
	let unsubscribe: (() => void) | undefined;
	const subscribe = () => {
		unsubscribe ??= pi.events.on(QUEUE_CHANNEL, (data) => { (data as QueueQuery).queue ??= queue; });
	};
	subscribe();
	pi.on("session_start", () => { queue.start(); subscribe(); });
	pi.on("session_shutdown", () => {
		queue.close();
		unsubscribe?.();
		unsubscribe = undefined;
	});
	return queue;
}
