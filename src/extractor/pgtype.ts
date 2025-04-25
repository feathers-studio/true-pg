export const typeKindMap = {
	e: "enum",
	d: "domain",
	r: "range",

	// Not supported (yet):
	// m: 'multiRange',
	// b: 'base',
	// p: 'pseudo',

	// c: 'composite', -- is also a class, handled below.
} as const;

export type TypeKind = (typeof typeKindMap)[keyof typeof typeKindMap];

export const classKindMap = {
	r: "table",
	p: "table", // Treat partitioned tables as tables
	v: "view",
	m: "materializedView",
	c: "composite",
	// f: "foreignTable",

	// Not supported (yet):
	// i: 'index',
	// S: 'sequence',
	// t: 'toastTable',
	// I: 'partitionedIndex',
} as const;

export type ClassKind = (typeof classKindMap)[keyof typeof classKindMap];

export const routineKindMap = {
	// p: "procedure",
	f: "function",

	// Not supported (yet):
	// a: 'aggregate',
	// w: 'windowFunction',
} as const;

export type RoutineKind = (typeof routineKindMap)[keyof typeof routineKindMap];

const unique = <T>(arr: T[]): T[] => [...new Set(arr)];

export const pgTypeKinds = unique([
	...Object.values(classKindMap),
	...Object.values(typeKindMap),
	...Object.values(routineKindMap),
] as const);

export type Kind = (typeof pgTypeKinds)[number];

/**
 * Base type for Postgres objects.
 */
export type PgType<K extends Kind = Kind> = {
	/**
	 * The name of the object.
	 */
	name: string;
	/**
	 * The name of the schema that the object is in.
	 */
	schemaName: string;
	/**
	 * The kind of the object.
	 */
	kind: K;
	/**
	 * The comment on the object, if any.
	 */
	comment: string | null;
};
