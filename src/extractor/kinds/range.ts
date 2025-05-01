import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import type { Canonical } from "../canonicalise/index.ts";

/**
 * Range type in a schema with details.
 */
export interface RangeDetails extends PgType<"range"> {
	/**
	 * Canonical representation of the range type
	 * with full attribute details.
	 */
	canonical: Canonical.Range;
}

const extractRange = async (db: DbAdapter, range: PgType<"range">): Promise<RangeDetails> => {
	// Form the fully qualified type name
	const fullTypeName = `"${range.schemaName}"."${range.name}"`;

	const canonical = db.enqueue(fullTypeName);

	// Return the composite type with its canonical representation
	return {
		...range,
		canonical: canonical as Canonical.Range,
	};
};

export default extractRange;
