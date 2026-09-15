export const ArbiterErrorCode = {
	RULE_COMPILATION_FAILED: "ARBITER_RULE_COMPILATION_FAILED",
	INVALID_PATH: "ARBITER_INVALID_PATH",
	INVALID_OPERATOR: "ARBITER_INVALID_OPERATOR",
	CYCLE_LIMIT_EXCEEDED: "ARBITER_CYCLE_LIMIT_EXCEEDED",
	FIRING_LIMIT_EXCEEDED: "ARBITER_FIRING_LIMIT_EXCEEDED",
	WRITE_CONFLICT: "ARBITER_WRITE_CONFLICT",
	TMS_RETRACT_FAILED: "ARBITER_TMS_RETRACT_FAILED",
	INVALID_NAMESPACE: "ARBITER_INVALID_NAMESPACE",
	SESSION_DISPOSED: "ARBITER_SESSION_DISPOSED",
	PROTOTYPE_POLLUTION: "ARBITER_PROTOTYPE_POLLUTION",
	EXPRESSION_COMPILATION_FAILED: "ARBITER_EXPRESSION_COMPILATION_FAILED",
	EXPRESSION_EVALUATION_FAILED: "ARBITER_EXPRESSION_EVALUATION_FAILED",
	RULE_NOT_FOUND: "ARBITER_RULE_NOT_FOUND",
	INVALID_CLOCK_OPERATION: "ARBITER_INVALID_CLOCK_OPERATION",
	REENTRANT_FIRE: "ARBITER_REENTRANT_FIRE",
} as const;

export type ArbiterErrorCode = (typeof ArbiterErrorCode)[keyof typeof ArbiterErrorCode];

export class ArbiterError extends Error {
	readonly code: ArbiterErrorCode;
	readonly ruleName?: string | undefined;
	readonly details?: unknown;

	constructor(
		code: ArbiterErrorCode,
		message: string,
		options?: { ruleName?: string; details?: unknown; cause?: Error },
	) {
		super(message, options?.cause ? { cause: options.cause } : undefined);
		this.name = "ArbiterError";
		this.code = code;
		this.ruleName = options?.ruleName;
		this.details = options?.details;
	}
}
