import { DbAdapter } from "./adapter.ts";

const removeNulls = <T>(o: T): T => {
	for (const key in o) if (o[key] == null) delete o[key];
	return o;
};

export namespace CanonicalType {
	export enum TypeKind {
		Base = "base",
		Composite = "composite",
		Domain = "domain",
		Enum = "enum",
		Range = "range",
		Pseudo = "pseudo",
		Unknown = "unknown",
	}

	interface Abstract {
		original_type: string;
		canonical_name: string;
		schema: string;
		name: string;
		kind: TypeKind;
		dimensions: number;
		modifiers?: string | null;
	}

	export interface Base extends Abstract {
		kind: TypeKind.Base;
	}

	export interface Enum extends Abstract {
		kind: TypeKind.Enum;
		enum_values: string[];
	}

	// Enhanced attribute with additional metadata
	export interface CompositeAttribute {
		name: string;
		index: number;
		type: CanonicalType;
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
		kind: TypeKind.Composite;
		attributes: CompositeAttribute[];
	}

	export interface Domain extends Abstract {
		kind: TypeKind.Domain;
		domain_base_type: CanonicalType;
	}

	export interface Range extends Abstract {
		kind: TypeKind.Range;
		range_subtype: string | null;
	}

	export interface Pseudo extends Abstract {
		kind: TypeKind.Pseudo;
	}
}
export type CanonicalType =
	| CanonicalType.Base
	| CanonicalType.Enum
	| CanonicalType.Composite
	| CanonicalType.Domain
	| CanonicalType.Range
	| CanonicalType.Pseudo;

export const canonicaliseTypes = async (db: DbAdapter, types: string[]): Promise<CanonicalType[]> => {
	if (types.length === 0) return [];

	const placeholders = types.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ");

	const query = `
	WITH RECURSIVE 
	-- Parameters with sequence numbers to preserve order
	input(type_name, seq) AS (
		VALUES ${placeholders}
	),
	-- Parse array dimensions and base type
	type_parts AS (
		SELECT
			type_name,
			seq,
			CASE 
				WHEN type_name ~ '\\(.*\\)' THEN regexp_replace(type_name, '\\(.*\\)', '')
				ELSE type_name
			END AS clean_type,
			CASE 
				WHEN type_name ~ '\\(.*\\)' THEN substring(type_name from '\\((.*\\?)\\)')
				ELSE NULL
			END AS modifiers
		FROM input
	),
	array_dimensions AS (
		SELECT
			type_name,
			seq,
			modifiers,
			CASE 
				WHEN clean_type ~ '.*\\[\\].*' THEN 
					(length(clean_type) - length(regexp_replace(clean_type, '\\[\\]', '', 'g'))) / 2
				ELSE 0
			END AS dimensions,
			regexp_replace(clean_type, '\\[\\]', '', 'g') AS base_type_name
		FROM type_parts
	),
	-- Get base type information
	base_type_info AS (
		SELECT
			a.type_name,
			a.seq,
			a.modifiers,
			a.dimensions,
			t.oid AS type_oid,
			t.typname AS internal_name,
			n.nspname AS schema_name,
			t.typtype AS type_kind_code,
			t.typbasetype,
			CASE t.typtype
				WHEN 'b' THEN 'base'
				WHEN 'c' THEN 'composite'
				WHEN 'd' THEN 'domain'
				WHEN 'e' THEN 'enum'
				WHEN 'p' THEN 'pseudo'
				WHEN 'r' THEN 'range'
				ELSE 'unknown'
			END AS type_kind
		FROM array_dimensions a
		JOIN pg_type t ON t.oid = a.base_type_name::regtype
		JOIN pg_namespace n ON t.typnamespace = n.oid
	),
	-- Handle enum values for enum types
	enum_values AS (
		SELECT
			b.type_name,
			jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
		FROM base_type_info b
		JOIN pg_enum e ON b.type_oid = e.enumtypid
		WHERE b.type_kind_code = 'e'
		GROUP BY b.type_name
	),
	-- Enhanced composite attributes with additional metadata
	composite_attributes AS (
		SELECT
			b.type_name,
			jsonb_agg(
				jsonb_build_object(
					'name', a.attname,
					'index', a.attnum,
					'type_oid', a.atttypid,
					'type_name', format_type(a.atttypid, null),
					'comment', col_description(c.oid, a.attnum::int),
					'defaultValue', pg_get_expr(d.adbin, d.adrelid),
					'isNullable', NOT a.attnotnull,
					'isIdentity', a.attidentity IS NOT NULL AND a.attidentity != '',
					'generated', CASE 
						WHEN a.attidentity = 'a' THEN 'ALWAYS'
						WHEN a.attidentity = 'd' THEN 'BY DEFAULT'
						WHEN a.attgenerated = 's' THEN 'ALWAYS'
						ELSE 'NEVER'
					END
				)
				ORDER BY a.attnum
			) AS attributes
		FROM base_type_info b
		JOIN pg_type t ON t.oid = b.type_oid
		JOIN pg_class c ON c.oid = t.typrelid
		JOIN pg_attribute a ON a.attrelid = c.oid
		LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
		WHERE b.type_kind_code = 'c' AND a.attnum > 0 AND NOT a.attisdropped
		GROUP BY b.type_name
	),
	-- Recursive CTE to resolve domain base types
	domain_types AS (
		-- Base case: start with initial domain type
		SELECT
			b.type_name AS original_type,
			b.type_oid AS domain_oid,
			b.typbasetype AS base_type_oid,
			1 AS level
		FROM base_type_info b
		WHERE b.type_kind_code = 'd'
		
		UNION ALL
		
		-- Recursive case: follow chain of domains
		SELECT
			d.original_type,
			t.oid AS domain_oid,
			t.typbasetype AS base_type_oid,
			d.level + 1 AS level
		FROM domain_types d
		JOIN pg_type t ON d.base_type_oid = t.oid
		WHERE t.typtype = 'd'-- Only continue if the base is also a domain
	),
	-- Get ultimate base type for domains
	domain_base_types AS (
		SELECT DISTINCT ON (original_type)
			d.original_type,
			format('%s.%s', n.nspname, t.typname) AS base_canonical_name
		FROM (
			-- Get the max level for each original type
			SELECT original_type, MAX(level) AS max_level
			FROM domain_types
			GROUP BY original_type
		) m
		JOIN domain_types d ON d.original_type = m.original_type AND d.level = m.max_level
		JOIN pg_type t ON d.base_type_oid = t.oid
		JOIN pg_namespace n ON t.typnamespace = n.oid
	),
	-- Range type subtype information
	range_subtypes AS (
		SELECT
			b.type_name,
			r.rngsubtype AS subtype_oid,
			format_type(r.rngsubtype, NULL) AS subtype_name
		FROM base_type_info b
		JOIN pg_range r ON b.type_oid = r.rngtypid
		WHERE b.type_kind_code = 'r'
	)
	-- Final result as JSON
	SELECT jsonb_build_object(
		'canonical_name', b.schema_name || '.' || b.internal_name,
		'schema', b.schema_name,
		'name', b.internal_name,
		'kind', b.type_kind,
		'dimensions', b.dimensions,
		'original_type', b.type_name,
		'modifiers', b.modifiers,
		'enum_values', e.values,
		'attributes', c.attributes,
		'domain_base_type', CASE
			WHEN b.type_kind_code = 'd' THEN d.base_canonical_name
			ELSE NULL
		END,
		'range_subtype', CASE
			WHEN b.type_kind_code = 'r' THEN r.subtype_name
			ELSE NULL
		END
	) AS type_info,
	b.seq
	FROM base_type_info b
	LEFT JOIN enum_values e ON b.type_name = e.type_name
	LEFT JOIN composite_attributes c ON b.type_name = c.type_name
	LEFT JOIN domain_base_types d ON b.type_name = d.original_type
	LEFT JOIN range_subtypes r ON b.type_name = r.type_name
	ORDER BY b.seq::integer;
	`;

	interface Resolved {
		type_info:
			| Exclude<CanonicalType, CanonicalType.Composite | CanonicalType.Domain>
			| (Omit<CanonicalType.Composite, "attributes"> & {
					kind: CanonicalType.TypeKind;
					attributes: {
						name: string;
						index: number;
						type_oid: number;
						type_name: string;
						comment: string | null;
						defaultValue: any;
						isNullable: boolean;
						isIdentity: boolean;
						generated: "ALWAYS" | "NEVER" | "BY DEFAULT";
					}[];
			  })
			| (Omit<CanonicalType.Domain, "domain_base_type"> & {
					kind: CanonicalType.TypeKind;
					domain_base_type: string;
			  });
	}

	const resolved = await db.query<Resolved, (string | number)[]>(
		query,
		types.flatMap((type, index) => [type, index]),
	);
	return Promise.all(
		resolved
			.map(each => each.type_info)
			.map(async each => {
				if (each.kind === CanonicalType.TypeKind.Composite) {
					const types = each.attributes.map(each => each.type_name);
					const canonical = await canonicaliseTypes(db, types);

					const attributes: CanonicalType.CompositeAttribute[] = await Promise.all(
						each.attributes.map(async (each, index) => {
							return {
								name: each.name,
								index: each.index,
								type: canonical[index]!,
								comment: each.comment,
								defaultValue: each.defaultValue,
								isNullable: each.isNullable,
								isIdentity: each.isIdentity,
								generated: each.generated,
							};
						}),
					);

					return removeNulls({
						...each,
						kind: CanonicalType.TypeKind.Composite,
						attributes,
					}) satisfies CanonicalType.Composite;
				}

				if (each.kind === CanonicalType.TypeKind.Domain) {
					const canonical = await canonicaliseTypes(db, [each.domain_base_type]);

					return removeNulls({
						...each,
						kind: CanonicalType.TypeKind.Domain,
						domain_base_type: canonical[0]!,
					}) satisfies CanonicalType.Domain;
				}

				return removeNulls(each) satisfies CanonicalType;
			}),
	);
};
