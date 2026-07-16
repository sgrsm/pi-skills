import type { BashOperations } from "@earendil-works/pi-coding-agent";
import {
	analyzeCatastrophicDeletion,
	type CatastrophicDeletionContext,
	type CatastrophicDeletionDecision,
	type CatastrophicDeletionReasonCode,
} from "./catastrophicDeletion.ts";

export class CatastrophicDeletionBlockedError extends Error {
	readonly reasonCode: CatastrophicDeletionReasonCode;
	readonly decision: CatastrophicDeletionDecision;

	constructor(decision: CatastrophicDeletionDecision) {
		super(formatCatastrophicDeletionBlock(decision));
		this.name = "CatastrophicDeletionBlockedError";
		this.reasonCode = decision.reasonCode;
		this.decision = decision;
	}
}

export function createGuardedBashOperations(
	delegate: BashOperations,
	context: Pick<CatastrophicDeletionContext, "home" | "maxShellDepth"> = {},
): BashOperations {
	return {
		async exec(command, cwd, options) {
			const decision = await analyzeCatastrophicDeletion(command, { ...context, cwd });
			if (decision.kind === "hard-deny") throw new CatastrophicDeletionBlockedError(decision);
			return delegate.exec(command, cwd, options);
		},
	};
}

export function formatCatastrophicDeletionBlock(decision: CatastrophicDeletionDecision): string {
	return `Blocked catastrophic deletion (${decision.reasonCode}): ${decision.reason}`;
}
