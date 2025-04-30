import { Deferred, unreachable } from "../util.ts";
import { DbAdapter } from "./adapter.ts";

const removeNulls = <T>(o: T): T => {
	for (const key in o) if (o[key] == null) delete o[key];
	return o;
};

interface ParsedTypeName {
	/** Name after removing modifiers and brackets, e.g. "varchar" in "varchar(50)" */
	base: string;
	/** Modifiers, e.g. "50" in "varchar(50)" */
	modifiers: string | null;
	/** Number of dimensions from explicit brackets, e.g. 1 in "int[]" */
	dimensions: number;
	/** Original type name, e.g. "varchar(50)" */
	original: string;
}

/**
 * Parses a PostgreSQL type name string to extract its base name,
 * modifiers, and dimensions from explicit '[]' brackets.
 *
 * Examples:
 *
 * - `parseTypeName("varchar(50)")`
 *
 *		`⤷ { baseTypeName: "varchar", modifiers: "50", dimensions: 0, originalTypeName: "varchar(50)" }`
 *
 * - `parseTypeName("int[]")`
 *
 *		`⤷ { baseTypeName: "int", modifiers: null, dimensions: 1, originalTypeName: "int[]" }`
 *
 * - `parseTypeName("public.my_table[][]")`
 *
 *		`⤷ { baseTypeName: "public.my_table", modifiers: null, dimensions: 2, originalTypeName: "public.my_table[][]" }`
 *
 * - `parseTypeName("numeric(10, 2)[]")`
 *
 *		`⤷ { baseTypeName: "numeric", modifiers: "10, 2", dimensions: 1, originalTypeName: "numeric(10, 2)[]" }`
 *
 * - `parseTypeName("geometry(Point, 4326)")`
 *
 *		`⤷ { baseTypeName: "geometry", modifiers: "Point, 4326", dimensions: 0, originalTypeName: "geometry(Point, 4326)" }`
 *
 * - `parseTypeName("_text")`
 *
 *		`⤷ { baseTypeName: "_text", modifiers: null, dimensions: 0, originalTypeName: "_text" }`
 *
 *		Internal arrays aren't handled here
 */
export function parseTypeName(type: string): ParsedTypeName {
	let base = type;
	let modifiers: string | null = null;
	let dimensions = 0;

	// 1. Extract modifiers (content within the last parentheses)
	const modifierMatch = base.match(/\(([^)]*)\)$/);
	if (modifierMatch) {
		modifiers = modifierMatch[1]!;
		base = base.substring(0, modifierMatch.index).trim();
	}

	// 2. Count and remove explicit array brackets '[]'
	// Repeatedly remove '[]' from the end and count dimensions
	while (base.endsWith("[]")) {
		dimensions++;
		base = base.slice(0, -2);
	}

	return { original: type, base, modifiers, dimensions };
}

export namespace Canonical {
	export enum Kind {
		Base = "base",
		Composite = "composite",
		Domain = "domain",
		Enum = "enum",
		Range = "range",
		Pseudo = "pseudo",
		Unknown = "unknown",
	}

	export interface Abstract {
		original_type: string;
		canonical_name: string;
		schema: string;
		name: string;
		kind: Kind;
		dimensions: number;
		modifiers?: string | null;
	}

	export interface Base extends Abstract {
		kind: Kind.Base;
	}

	export interface Enum extends Abstract {
		kind: Kind.Enum;
		enum_values: string[];
	}

	// Enhanced attribute with additional metadata
	export interface CompositeAttribute {
		name: string;
		index: number;
		type: Canonical;
		comment: string | null;
		defaultValue: any;
		isNullable: boolean;
		/**
		 * Whether the attribute is an identity attribute.
		 */
		isIdentity: boolean;
		/**
		 * Behavior of the generated attribute. "ALWAYS" if always generated,
		 * "NEVER" if never generated, "BY DEFAULT" if generated when a value
		 * is not provided.
		 */
		generated: "ALWAYS" | "NEVER" | "BY DEFAULT";
	}

	export interface Composite extends Abstract {
		kind: Kind.Composite;
		attributes: CompositeAttribute[];
	}

	export interface Domain extends Abstract {
		kind: Kind.Domain;
		domain_base_type: Canonical;
	}

	export interface Range extends Abstract {
		kind: Kind.Range;
		range_subtype: Canonical;
	}

	export interface Pseudo extends Abstract {
		kind: Kind.Pseudo;
	}
}

export type Canonical =
	| Canonical.Base
	| Canonical.Enum
	| Canonical.Composite
	| Canonical.Domain
	| Canonical.Range
	| Canonical.Pseudo;

interface ResolvedBasicInfo {
	seq: number;
	oid: number;
	internal_dimensions: number;
	schema: string;
	name: string;
	canonical_name: string;
	kind: Canonical.Kind;
	typrelid: number;
	typbasetype: number;
	rngsubtype: number;
}

/**
 * Takes base type names (without modifiers/brackets), resolves them to their ultimate base type OID
 * and internal array dimensions, and fetches basic kind information
 */
async function resolveBasicInfo(
	db: DbAdapter,
	types: { parsed: ParsedTypeName; seq: number }[],
): Promise<ResolvedBasicInfo[]> {
	const query = `
		WITH RECURSIVE
		input(base_type_name, seq) AS (
			SELECT * FROM unnest($1::text[], $2::int[])
		),
		type_resolution(seq, current_oid, level) AS (
			-- Base case: Look up the initial base type name
			SELECT i.seq, t.oid, 1
			FROM input i JOIN pg_type t ON t.oid = i.base_type_name::regtype
			UNION ALL
			-- Recursive step: Follow typelem for standard arrays (_)
			SELECT r.seq, t.typelem, r.level + 1
			FROM type_resolution r JOIN pg_type t ON r.current_oid = t.oid
			WHERE t.typelem != 0 AND left(t.typname, 1) = '_'
		),
		final_resolution AS (
			-- Get the OID and max level (depth) for each sequence number
			SELECT DISTINCT ON (seq) seq, current_oid AS base_type_oid, level
			FROM type_resolution ORDER BY seq, level DESC
		)
		-- Combine resolution with basic type info fetching
		SELECT
			fr.seq,
			fr.base_type_oid AS oid,
			(fr.level - 1) AS internal_dimensions,
			n.nspname AS schema,
			t.typname AS name,
			n.nspname || '.' || t.typname AS canonical_name,
			CASE t.typtype
				WHEN 'b' THEN 'base'::text WHEN 'c' THEN 'composite'::text WHEN 'd' THEN 'domain'::text
				WHEN 'e' THEN 'enum'::text WHEN 'p' THEN 'pseudo'::text    WHEN 'r' THEN 'range'::text
				ELSE 'unknown'::text
			END AS kind,
			t.typrelid,
			t.typbasetype,
			COALESCE(r.rngsubtype, 0) AS rngsubtype
		FROM final_resolution fr
		JOIN pg_type t ON t.oid = fr.base_type_oid
		JOIN pg_namespace n ON t.typnamespace = n.oid
		LEFT JOIN pg_range r ON t.oid = r.rngtypid AND t.typtype = 'r'
		ORDER BY fr.seq;
	`;

	// Need to handle the string 'kind' coming back from the DB
	const results = await db.query<ResolvedBasicInfo, [string[], number[]]>(query, [
		types.map(t => t.parsed.base),
		types.map(t => t.seq),
	]);
	return results;
}

async function resolveBasicInfo1(db: DbAdapter, type: ParsedTypeName): Promise<ResolvedBasicInfo> {
	const query = `
		WITH RECURSIVE
		input(base_type_name) AS (
			SELECT $1::text
		),
		type_resolution(current_oid, level) AS (
			-- Base case: Look up the initial base type name
			SELECT t.oid, 1
			FROM input i JOIN pg_type t ON t.oid = i.base_type_name::regtype
			UNION ALL
			-- Recursive step: Follow typelem for standard arrays (_)
			SELECT t.typelem, r.level + 1
			FROM type_resolution r JOIN pg_type t ON r.current_oid = t.oid
			WHERE t.typelem != 0 AND left(t.typname, 1) = '_'
		),
		final_resolution AS (
			-- Get the OID and max level (depth) for each sequence number
			SELECT DISTINCT ON (current_oid) current_oid AS base_type_oid, level
			FROM type_resolution ORDER BY current_oid, level DESC
		)
		-- Combine resolution with basic type info fetching
		SELECT
			fr.base_type_oid AS oid,
			(fr.level - 1) AS internal_dimensions,
			n.nspname AS schema,
			t.typname AS name,
			n.nspname || '.' || t.typname AS canonical_name,
			CASE t.typtype
				WHEN 'b' THEN 'base'::text WHEN 'c' THEN 'composite'::text WHEN 'd' THEN 'domain'::text
				WHEN 'e' THEN 'enum'::text WHEN 'p' THEN 'pseudo'::text    WHEN 'r' THEN 'range'::text
				ELSE 'unknown'::text
			END AS kind,
			t.typrelid,
			t.typbasetype,
			COALESCE(r.rngsubtype, 0) AS rngsubtype
		FROM final_resolution fr
		JOIN pg_type t ON t.oid = fr.base_type_oid
		JOIN pg_namespace n ON t.typnamespace = n.oid
		LEFT JOIN pg_range r ON t.oid = r.rngtypid AND t.typtype = 'r';
	`;

	// Need to handle the string 'kind' coming back from the DB
	const results = await db.query<ResolvedBasicInfo, [string]>(query, [type.base]);
	return results[0]!;
}

/** Fetches enum values for given enum type OIDs */
async function getEnumValues(db: DbAdapter, oid: number): Promise<string[]> {
	const query = `
		SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
		FROM pg_enum e
		WHERE e.enumtypid = $1::oid
		GROUP BY e.enumtypid;
	`;
	const results = await db.query<{ values: string[] }, [number]>(query, [oid]);
	return results[0]?.values ?? [];
}

/** Raw composite attribute info from the database */
interface RawAttributeInfo {
	name: string;
	index: number;
	type_oid: number;
	type_name: string;
	comment: string | null;
	defaultValue: any;
	isNullable: boolean;
	isIdentity: boolean;
	generated: "ALWAYS" | "NEVER" | "BY DEFAULT";
}

/** Fetches composite attributes for given composite type OIDs (typrelid) */
async function getCompositeAttributes(db: DbAdapter, relid: number): Promise<RawAttributeInfo[]> {
	const query = `
		SELECT
			a.attrelid AS relid,
			jsonb_agg(
				jsonb_build_object(
					'name', a.attname,
					'index', a.attnum,
					'type_oid', a.atttypid,
					'type_name', format_type(a.atttypid, null),
					'comment', col_description(a.attrelid, a.attnum::int),
					'defaultValue', pg_get_expr(d.adbin, d.adrelid),
					'isNullable', NOT a.attnotnull,
					'isIdentity', a.attidentity IS NOT NULL AND a.attidentity != '',
					'generated', CASE WHEN a.attidentity = 'a' THEN 'ALWAYS' WHEN a.attidentity = 'd' THEN 'BY DEFAULT' WHEN a.attgenerated = 's' THEN 'ALWAYS' ELSE 'NEVER' END
				) ORDER BY a.attnum
			) AS attributes
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
		GROUP BY a.attrelid;
	`;
	const results = await db.query<{ relid: number; attributes: RawAttributeInfo[] }, [number]>(query, [relid]);
	return results[0]?.attributes ?? [];
}

/** Recursive helper to find the ultimate base type OID for a domain */
async function findUltimateDomainBaseOid(db: DbAdapter, oid: number): Promise<number> {
	const query = `
		WITH RECURSIVE domain_chain(oid, base_oid, level) AS (
			SELECT $1::oid, t.typbasetype, 1
			FROM pg_type t WHERE t.oid = $1::oid AND t.typtype = 'd'
			UNION ALL
			SELECT t.oid, t.typbasetype, dc.level + 1
			FROM domain_chain dc JOIN pg_type t ON dc.base_oid = t.oid
			WHERE t.typtype = 'd'
		)
		SELECT base_oid FROM domain_chain ORDER BY level DESC LIMIT 1;
	`;
	const result = await db.query<{ base_oid: number }, [number]>(query, [oid]);
	return result[0]?.base_oid ?? oid; // Return original if not a domain or chain ends
}

/** Fetches the canonical name of the ultimate base type for given domain OIDs */
async function getDomainBaseTypeName(db: DbAdapter, typbasetype: number): Promise<string> {
	const ultimateBaseOid = await findUltimateDomainBaseOid(db, typbasetype);

	const query = `
		SELECT t.oid, format('%I.%I', n.nspname, t.typname) AS name
		FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
		WHERE t.oid = $1::oid
	`;

	const results = await db.query<{ name: string }, [number]>(query, [ultimateBaseOid]);
	return results[0]?.name ?? "";
}

/** Fetches the canonical name of the subtype for given range OIDs */
async function getRangeSubtypeName(db: DbAdapter, oid: number): Promise<string> {
	const query = `
		SELECT t.oid, format('%I.%I', n.nspname, t.typname) AS name
		FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
		WHERE t.oid = $1::oid
	`;
	const results = await db.query<{ name: string }, [number]>(query, [oid]);
	return results[0]?.name ?? "";
}

interface BasicCommonProps {
	kind: Canonical.Kind;
	oid: number;
	typrelid: number;
	typbasetype: number;
	rngsubtype: number;
	canonical_name: string;
	schema: string;
	name: string;
	original_type: string;
	modifiers: string | null;
	dimensions: number;
}

type ExclusiveCanonProps = Omit<Canonical, keyof Canonical.Abstract>;

async function canonicaliseType(
	db: DbAdapter,
	basic: BasicCommonProps,
	rawTypeCache: Map<string, Promise<Canonical>>,
	canonicalCache: Map<string, Promise<ExclusiveCanonProps>>,
): Promise<ExclusiveCanonProps> {
	switch (basic.kind) {
		case Canonical.Kind.Base:
			return { kind: Canonical.Kind.Base };
		case Canonical.Kind.Enum:
			const enumValues = await getEnumValues(db, basic.oid);
			if (enumValues.length === 0) {
				throw new Error(`Enum ${basic.canonical_name} (OID: ${basic.oid}) lacks values.`);
			}
			return { kind: Canonical.Kind.Enum, enum_values: enumValues };
		case Canonical.Kind.Composite: {
			const rawAttributes = await getCompositeAttributes(db, basic.typrelid);
			const attributeTypes = rawAttributes.map(attr => attr.type_name);
			const canonicalAttributeTypes = await canonicalise(db, attributeTypes, rawTypeCache, canonicalCache); // Recursive call
			const attributes: Canonical.CompositeAttribute[] = await Promise.all(
				rawAttributes.map(async (attr, index) => {
					return removeNulls({
						name: attr.name,
						index: attr.index,
						type: canonicalAttributeTypes[index]!,
						comment: attr.comment,
						defaultValue: attr.defaultValue,
						isNullable: attr.isNullable,
						isIdentity: attr.isIdentity,
						generated: attr.generated,
					});
				}),
			);
			return { kind: Canonical.Kind.Composite, attributes };
		}
		case Canonical.Kind.Domain: {
			const baseTypeName = await getDomainBaseTypeName(db, basic.typbasetype);
			if (!baseTypeName) {
				throw new Error(`Domain ${basic.canonical_name} (OID: ${basic.oid}) lacks a resolved base type name.`);
			}
			const canonicalBaseType = await canonicalise(db, [baseTypeName], rawTypeCache, canonicalCache); // Recursive call
			return { kind: Canonical.Kind.Domain, domain_base_type: canonicalBaseType[0]! };
		}
		case Canonical.Kind.Range: {
			const subtypeName = await getRangeSubtypeName(db, basic.rngsubtype);
			if (!subtypeName) {
				throw new Error(`Range ${basic.canonical_name} (OID: ${basic.oid}) lacks a resolved subtype name.`);
			}
			const canonicalSubtype = await canonicalise(db, [subtypeName], rawTypeCache, canonicalCache); // Recursive call
			return { kind: Canonical.Kind.Range, range_subtype: canonicalSubtype[0]! };
		}
		case Canonical.Kind.Pseudo:
			return { kind: Canonical.Kind.Pseudo };
		case Canonical.Kind.Unknown:
			throw new Error(`Canonicalising "${basic.original_type}" resulted in unknown kind: ${basic.canonical_name}`);
		default:
			return unreachable(basic.kind);
	}
}

export const canonicalise = async (
	db: DbAdapter,
	types: string[],
	rawTypeCache: Map<string, Promise<Canonical>>,
	canonicalCache: Map<string, Promise<ExclusiveCanonProps>>,
): Promise<Canonical[]> => {
	if (types.length === 0) return [];

	const withSeq = types.map((type, seq) => ({ type, seq }));

	// final list of resolved canonical types
	const results: Promise<Canonical>[] = [];

	// unresolved types, awaiting resolution
	const unresolved: { seq: number; parsed: ParsedTypeName; deferred: Deferred<Canonical> }[] = [];

	for (const { type, seq } of withSeq) {
		// if the type is already resolved, add it to the results
		const cached = rawTypeCache.get(type);
		if (cached) results.push(cached);
		else {
			// if the type is not resolved, create a deferred promise and add it to the unresolved list
			const deferred = new Deferred<Canonical>();
			rawTypeCache.set(type, deferred.promise);
			results.push(deferred.promise);
			const parsed = parseTypeName(type);
			unresolved.push({ seq, parsed, deferred });
		}
	}

	const resolved = await resolveBasicInfo(db, unresolved);

	Promise.all(
		resolved.map(async (info, index) => {
			const { parsed, deferred } = unresolved[index]!;

			try {
				const dimensions = parsed.dimensions + info.internal_dimensions;

				const common = {
					kind: info.kind,
					oid: info.oid,
					typrelid: info.typrelid,
					typbasetype: info.typbasetype,
					rngsubtype: info.rngsubtype,
					canonical_name: info.canonical_name,
					schema: info.schema,
					name: info.name,
					original_type: parsed.original,
					modifiers: parsed.modifiers,
					dimensions,
				};

				let cached = canonicalCache.get(info.canonical_name);
				if (cached) {
					const exclusive = await cached;
					const result = { ...common, ...exclusive } as Canonical;
					deferred.resolve(result);
				} else {
					const deferred2 = new Deferred<ExclusiveCanonProps>();
					canonicalCache.set(info.canonical_name, deferred2.promise);
					cached = deferred2.promise;

					const exclusive = await canonicaliseType(db, common, rawTypeCache, canonicalCache);
					deferred2.resolve(exclusive);

					const result = { ...common, ...exclusive } as Canonical;
					deferred.resolve(result);
				}
			} catch (error) {
				deferred.reject(error);
			}
		}),
	);

	const ret = await Promise.all(results);
	return ret;
};

export const oidsToQualifiedNames = async (db: DbAdapter, oids: number[]): Promise<string[]> => {
	if (oids.length === 0) return [];

	const query = `
		SELECT
			input.ord,
			format('%I.%I', n.nspname, t.typname) AS qualified_name
		-- Use unnest WITH ORDINALITY because SQL doesn't guarantee order of SELECT results
		FROM unnest($1::oid[]) WITH ORDINALITY AS input(oid, ord)
		JOIN pg_type t ON t.oid = input.oid
		JOIN pg_namespace n ON t.typnamespace = n.oid
		ORDER BY input.ord;
	`;

	const results = await db.query<{ ord: number; qualified_name: string }, [number[]]>(query, [oids]);
	return results.map(r => r.qualified_name);
};

export const canonicaliseFromOids = async (db: DbAdapter, oids: number[]): Promise<Canonical[]> => {
	if (oids.length === 0) return [];

	const types = await oidsToQualifiedNames(db, oids);

	const unknown = types.filter(name => name == undefined);
	if (unknown.length > 0) throw new Error(`Failed to resolve OIDs to type names: ${unknown.join(", ")}`);

	return db.canonicalise(types);
};
