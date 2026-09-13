import type {
	CompiledExpression,
	ExpressionLimits,
	ExpressionOperatorDefinition,
	JsonValue,
	ValueExpression,
} from "kuery/expression";

export type ArbitreReference =
	| { readonly source: "root"; readonly path: string }
	| { readonly source: "namespace"; readonly namespace: string; readonly path: string }
	| { readonly source: "binding"; readonly binding: string; readonly path: string };

export type ArbitreValueExpression = ValueExpression<ArbitreReference>;

export interface CanonicalArbitreExpression {
	readonly $expression: ArbitreValueExpression;
}

export interface ArbitreExpressionConfig {
	readonly extensions?: readonly ExpressionOperatorDefinition[] | undefined;
	readonly limits?: Partial<ExpressionLimits> | undefined;
}

export interface CompiledArbitreValue {
	readonly expression: CompiledExpression<ArbitreReference>;
}

export interface RuleDependencies {
	readonly conditionReads: readonly string[];
	readonly rhsReads: readonly ArbitreReference[];
	readonly actionWrites: readonly string[];
	readonly bindingReads: readonly ArbitreReference[];
}

export function expression(value: ArbitreValueExpression): CanonicalArbitreExpression {
	return Object.freeze({ $expression: value });
}

export function literal(value: JsonValue): CanonicalArbitreExpression {
	return expression({ kind: "literal", value });
}
