// extended from https://github.com/kristiandupont/kanel/blob/e9332f03ff5e38f5b844dd7a4563580c0d9d1444/packages/kanel/src/defaultTypeMap.ts

export const builtins: Record<string, string> = {
	"pg_catalog.int2": "number",
	"pg_catalog.int4": "number",

	// JS numbers are always floating point, so there is only 53 bits of precision
	// for the integer part. Thus, storing a 64-bit integer in a JS number will
	// result in potential data loss.
	"pg_catalog.int8": "bigint",
	"pg_catalog.numeric": "bigint",

	"pg_catalog.float4": "number",
	"pg_catalog.float8": "number",
	"pg_catalog.bool": "boolean",
	"pg_catalog.json": "unknown",
	"pg_catalog.jsonb": "unknown",
	"pg_catalog.char": "string",
	"pg_catalog.bpchar": "string",
	"pg_catalog.varchar": "string",
	"pg_catalog.text": "string",
	"pg_catalog.uuid": "string",
	"pg_catalog.inet": "string",
	"pg_catalog.date": "Date",
	"pg_catalog.time": "Date",
	"pg_catalog.timetz": "Date",
	"pg_catalog.timestamp": "Date",
	"pg_catalog.timestamptz": "Date",
	"pg_catalog.int4range": "string",
	"pg_catalog.int8range": "string",
	"pg_catalog.numrange": "string",
	"pg_catalog.tsrange": "string",
	"pg_catalog.tstzrange": "string",
	"pg_catalog.daterange": "string",
	"pg_catalog.record": "Record<string, unknown>",
	"pg_catalog.void": "void",
	"pg_catalog.bytea": "string",
	"pg_catalog.vector": "number[]",
	"pg_catalog.tsvector": "string[]",
};
