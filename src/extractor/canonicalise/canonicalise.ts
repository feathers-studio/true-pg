import { Canonical, type ExclusiveCanonProps } from "./types.ts";
import { DbAdapter } from "../adapter.ts";
import { Deferred, type MaybePromise } from "../../util.ts";
import { resolveBasicInfo, type ResolvedBasicInfo } from "./resolve.ts";
import { parseRawType } from "./parse.ts";
import type { ParsedType } from "./parse.ts";
import { getEnumDetails } from "./enum.ts";
import { getCompositeDetails } from "./composite.ts";
import { getDomainDetails } from "./domain.ts";
import { getRangeDetails } from "./range.ts";

export { Canonical, type ExclusiveCanonProps };

type Unresolved = { parsed: ParsedType; deferred: Deferred<Canonical> };

// The new strategy is to minimise the effort spent on resolving types
// Don't care about keeping track of the order of types
// Ensure that all types are already cached or will be cached by the end of the function
// Then map over the input types and wait for all cached promises to resolve

export const canonicalise = async (
	db: DbAdapter,
	types: string[],
	plainTypeCache: Map<string, Promise<Canonical>>,
	canonicalCache: Map<string, Promise<ExclusiveCanonProps>>,
): Promise<Canonical[]> => {
	if (types.length === 0) return [];

	// unresolved types, awaiting resolution
	const unresolved: Unresolved[] = [];

	const unique = new Set<string>();

	for (const type of types) {
		if (!plainTypeCache.has(type)) {
			// strip modifiers and brackets
			const parsed = parseRawType(type);

			const deferred = new Deferred<Canonical>();
			// cache promise immediately for other calls to resolve the same type
			plainTypeCache.set(parsed.plain, deferred.promise);

			// keep track of parsed types to include its modifiers and dimensions later
			unresolved.push({ parsed, deferred });

			// for now we only need unique base types to move forward from here
			unique.add(parsed.plain);
		}
	}

	const uniqueArray = Array.from(unique);

	// resolve whole batch at once
	const resolved = await resolveBasicInfo(db, uniqueArray);

	const resolvedMap = new Map<string, ResolvedBasicInfo>();
	for (const r of resolved) resolvedMap.set(r.original_name, r);

	type ResolvedAndDeferred = ResolvedBasicInfo & { deferred: Deferred<ExclusiveCanonProps> };

	type Kind = Exclude<Canonical.Kind, Canonical.Kind.Unknown>;

	// split by kind
	const kinds: Record<Kind, ResolvedAndDeferred[]> = {
		[Canonical.Kind.Base]: [],
		[Canonical.Kind.Enum]: [],
		[Canonical.Kind.Composite]: [],
		[Canonical.Kind.Domain]: [],
		[Canonical.Kind.Range]: [],
		[Canonical.Kind.Pseudo]: [],
	};

	for (const r of resolved) {
		if (canonicalCache.has(r.canonical_name)) continue;

		const deferred = new Deferred<ExclusiveCanonProps>();
		canonicalCache.set(r.canonical_name, deferred.promise);

		if (r.kind === Canonical.Kind.Unknown) {
			throw new Error(`Unknown kind "${r.schema}.${r.name}" (original: ${r.original_name}, oid: ${r.oid})`);
		}

		// I want to do r.deferred = deferred, but type-safety...
		kinds[r.kind].push(Object.assign(r, { deferred }));
	}

	const _canonicalise = (types: string[]) => canonicalise(db, types, plainTypeCache, canonicalCache);

	// get details for each kind
	const kind_details: Record<Kind, MaybePromise<ExclusiveCanonProps[]>> = {
		[Canonical.Kind.Base]: kinds[Canonical.Kind.Base].map(r => ({ kind: Canonical.Kind.Base })),
		[Canonical.Kind.Enum]: getEnumDetails(db, kinds[Canonical.Kind.Enum]),
		[Canonical.Kind.Composite]: getCompositeDetails(db, _canonicalise, kinds[Canonical.Kind.Composite]),
		[Canonical.Kind.Domain]: getDomainDetails(db, _canonicalise, kinds[Canonical.Kind.Domain]),
		[Canonical.Kind.Range]: getRangeDetails(db, _canonicalise, kinds[Canonical.Kind.Range]),
		[Canonical.Kind.Pseudo]: kinds[Canonical.Kind.Pseudo].map(r => ({ kind: Canonical.Kind.Pseudo })),
	};

	const details_promises = [];

	for (const kind in kind_details) {
		const key = kind as Kind;
		const resolved = kinds[key];

		details_promises.push(
			Promise.resolve(kind_details[key]).then(details => {
				for (let i = 0; i < details.length; i++) {
					const { deferred } = resolved[i]!;
					deferred.resolve(details[i]!);
				}
			}),
		);
	}

	// await all resolutions at once in parallel
	await Promise.all(details_promises);

	/* ---- We've guaranteed that all canonical types are resolved now ---- */

	await Promise.all(
		unresolved.map(async u => {
			const info = resolvedMap.get(u.parsed.plain);
			if (!info) throw new Error(`Type ${u.parsed.plain} not found in resolved map`);

			try {
				const dimensions = u.parsed.dimensions + info.internal_dimensions;

				const common = {
					kind: info.kind,
					oid: info.oid,
					typrelid: info.typrelid,
					typbasetype: info.typbasetype,
					rngsubtype: info.rngsubtype,
					canonical_name: info.canonical_name,
					schema: info.schema,
					name: info.name,
					original_type: u.parsed.original,
					modifiers: u.parsed.modifiers,
					dimensions,
				};

				const exclusive = await canonicalCache.get(info.canonical_name);
				if (!exclusive) throw new Error(`Type ${info.canonical_name} not found in canonical cache`);

				const result = { ...common, ...exclusive } as Canonical;

				/* ---- We've guaranteed that all input types (w/ modifiers and dimensions) are resolved now ---- */
				u.deferred.resolve(result);
			} catch (error) {
				// concurrent canonicalise calls that are awaiting this promise will be rejected
				u.deferred.reject(error);
				// delete the cache entry so that subsequent calls to canonicalise may retry
				canonicalCache.delete(info.canonical_name);
				throw error;
			}
		}),
	);

	// since we've already resolved and cached all types, we can just return the cached results

	const results = await Promise.all(
		types.map(async t => {
			const cached = plainTypeCache.get(t);
			if (!cached) throw new Error(`Type ${t} not found in raw type cache`);
			const result = await cached;
			return result;
		}),
	);

	return results;
};
