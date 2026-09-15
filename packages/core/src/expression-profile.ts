import { standardV1 } from "kuery/expression";
import type { ExpressionOperatorDefinition, ExpressionProfile, JsonValue } from "kuery/expression";

function finiteNumbers(args: readonly JsonValue[]): readonly number[] {
	if (args.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError();
	return args as readonly number[];
}

function finite(value: number): number {
	if (!Number.isFinite(value)) throw new TypeError();
	return value;
}

const extras: readonly ExpressionOperatorDefinition[] = [
	numeric("arbitre:min", (values) => Math.min(...values)),
	numeric("arbitre:max", (values) => Math.max(...values)),
	numeric("arbitre:avg", (values) => values.reduce((total, value) => total + value, 0) / values.length),
	{
		name: "arbitre:round",
		arity: 2,
		inputTypes: ["number", "number"],
		resultType: "number",
		execute: ([value, places]: readonly JsonValue[]) => {
			if (!Number.isInteger(places) || (places as number) < -15 || (places as number) > 15) throw new TypeError();
			const factor = 10 ** (places as number);
			return finite(Math.round((value as number) * factor) / factor);
		},
	},
	{
		name: "arbitre:ceil",
		arity: 1,
		inputTypes: ["number"],
		resultType: "number",
		execute: ([value]: readonly JsonValue[]) => Math.ceil(value as number),
	},
	{
		name: "arbitre:floor",
		arity: 1,
		inputTypes: ["number"],
		resultType: "number",
		execute: ([value]: readonly JsonValue[]) => Math.floor(value as number),
	},
	{
		name: "arbitre:concat",
		minArgs: 1,
		maxArgs: 32,
		inputTypes: ["string"],
		resultType: "string",
		execute: (args: readonly JsonValue[]) => (args as readonly string[]).join(""),
	},
];

function numeric(name: string, calculate: (values: readonly number[]) => number): ExpressionOperatorDefinition {
	return {
		name,
		minArgs: 1,
		maxArgs: 32,
		inputTypes: ["number"],
		resultType: "number",
		execute: (args: readonly JsonValue[]) => finite(calculate(finiteNumbers(args))),
	};
}

/** The immutable built-in RHS profile. */
export const arbitreV1: ExpressionProfile = standardV1.extend("arbitre-v1", extras);

export function createArbitreProfile(extensions?: readonly ExpressionOperatorDefinition[]): ExpressionProfile {
	if (!extensions?.length) return arbitreV1;
	try {
		return arbitreV1.extend("arbitre-v1", extensions);
	} catch {
		throw new TypeError("Invalid Arbitre expression profile extension");
	}
}
