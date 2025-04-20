import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import { CanonicalType, canonicaliseTypes } from "../canonicalise.ts";

/**
 * Range type in a schema with details.
 */
export interface RangeDetails extends PgType<"range"> {
	/**
	 * Canonical representation of the range type
	 * with full attribute details.
	 */
	canonical: CanonicalType.Range;
}

const extractRange = async (db: DbAdapter, range: PgType<"range">): Promise<RangeDetails> => {
	// Form the fully qualified type name
	const fullTypeName = `"${range.schemaName}"."${range.name}"`;

	// Get canonical type information with all the metadata
	const canonicalTypes = await canonicaliseTypes(db, [fullTypeName]);

	// The result should be a Composite type
	const canonicalType = canonicalTypes[0] as CanonicalType.Range;

	// Return the composite type with its canonical representation
	return {
		...range,
		canonical: canonicalType,
	};
};

export default extractRange;
