import { Canonical, type ExclusiveComposite } from "./types.ts";
import type { DbAdapter } from "../adapter.ts";
import { minifyQuery, removeNulls } from "../../util.ts";

const query = minifyQuery(`
SELECT
	input.seq,
	input.relid,
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
			'generated', CASE
				WHEN a.attidentity = 'a' THEN 'ALWAYS'
				WHEN a.attidentity = 'd' THEN 'BY DEFAULT'
				WHEN a.attgenerated = 's' THEN 'ALWAYS'
				ELSE 'NEVER'
			END
		) ORDER BY a.attnum
	) AS attributes
FROM unnest($1::oid[]) WITH ORDINALITY AS input(relid, seq)
JOIN pg_attribute a ON a.attrelid = input.relid
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attnum > 0 AND NOT a.attisdropped
GROUP BY input.relid, input.seq
ORDER BY input.seq;
`);

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

type QueryResult = {
	// this does get returned, but we don't need it and hence it's dangerous to expose
	// seq: number;
	relid: number;
	attributes: RawAttributeInfo[];
};

type QueryParams = [number[]];

export type { ExclusiveComposite };

// TODO: combine all recursive canonicalise calls into a single call then unnest the results

export async function getCompositeDetails(
	db: DbAdapter,
	enqueue: (types: string) => Canonical,
	entries: { typrelid: number; canonical_name: string }[],
): Promise<ExclusiveComposite[]> {
	if (entries.length === 0) return [];

	const results = await db.query<QueryResult, QueryParams>(query, [entries.map(r => r.typrelid)]);

	return results.map((result, index) => {
		const attributes: Canonical.CompositeAttribute[] = result.attributes.map((attr, index) => {
			const canonical = enqueue(attr.type_name);

			return removeNulls({
				name: attr.name,
				index: attr.index,
				type: canonical,
				comment: attr.comment,
				defaultValue: attr.defaultValue,
				isNullable: attr.isNullable,
				isIdentity: attr.isIdentity,
				generated: attr.generated,
			});
		});

		return { kind: Canonical.Kind.Composite, canonical_name: entries[index]!.canonical_name, attributes };
	});
}
