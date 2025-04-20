import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import { CanonicalType, canonicaliseTypes } from "../canonicalise.ts";

/**
 * Domain type in a schema with details.
 */
export interface DomainDetails extends PgType<"domain"> {
	/**
	 * Canonical representation of the domain type
	 * with full attribute details.
	 */
	canonical: CanonicalType.Domain;
}

const extractDomain = async (db: DbAdapter, domain: PgType<"domain">): Promise<DomainDetails> => {
	// Form the fully qualified type name
	const fullTypeName = `"${domain.schemaName}"."${domain.name}"`;

	// Get canonical type information with all the metadata
	const canonicalTypes = await canonicaliseTypes(db, [fullTypeName]);

	// The result should be a Composite type
	const canonicalType = canonicalTypes[0] as CanonicalType.Domain;

	// Return the composite type with its canonical representation
	return {
		...domain,
		canonical: canonicalType,
	};
};

export default extractDomain;
