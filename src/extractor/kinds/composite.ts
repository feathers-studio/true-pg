import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import { CanonicalType, canonicaliseTypes } from "../canonicalise.ts";

/**
 * Composite type in a schema with details.
 */
export interface CompositeTypeDetails extends PgType<"composite"> {
	/**
	 * Canonical representation of the composite type
	 * with full attribute details.
	 */
	canonical: CanonicalType.Composite;
}

const extractComposite = async (db: DbAdapter, composite: PgType<"composite">): Promise<CompositeTypeDetails> => {
	// Form the fully qualified type name
	const fullTypeName = `${composite.schemaName}.${composite.name}`;

	// Get canonical type information with all the metadata
	const canonicalTypes = await canonicaliseTypes(db, [fullTypeName]);

	// The result should be a Composite type
	const canonicalType = canonicalTypes[0] as CanonicalType.Composite;

	// Return the composite type with its canonical representation
	return {
		...composite,
		canonical: canonicalType,
	};
};

export default extractComposite;
