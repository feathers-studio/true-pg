// extended from https://github.com/kristiandupont/kanel/blob/e9332f03ff5e38f5b844dd7a4563580c0d9d1444/packages/kanel/src/defaultTypeMap.ts

export const builtins: Record<string, string> = {
	"pg_catalog.int2": "z.number()",
	"pg_catalog.int4": "z.number()",

	// JS numbers are always floating point, so there is only 53 bits of precision
	// for the integer part. Thus, storing a 64-bit integer in a JS number will
	// result in potential data loss. We therefore use strings for 64-bit integers
	// the same way that the pg driver does.
	"pg_catalog.int8": "z.string()",

	"pg_catalog.float4": "z.number()",
	"pg_catalog.float8": "z.number()",
	"pg_catalog.numeric": "z.string()",
	"pg_catalog.bool": "z.boolean()",
	"pg_catalog.json": "z.unknown()",
	"pg_catalog.jsonb": "z.unknown()",
	"pg_catalog.char": "z.string()",
	"pg_catalog.bpchar": "z.string()",
	"pg_catalog.varchar": "z.string()",
	"pg_catalog.text": "z.string()",
	"pg_catalog.uuid": "z.string()",
	"pg_catalog.inet": "z.string()",
	"pg_catalog.date": "z.date()",
	"pg_catalog.time": "z.date()",
	"pg_catalog.timetz": "z.date()",
	"pg_catalog.timestamp": "z.date()",
	"pg_catalog.timestamptz": "z.date()",
	"pg_catalog.int4range": "z.string()",
	"pg_catalog.int8range": "z.string()",
	"pg_catalog.numrange": "z.string()",
	"pg_catalog.tsrange": "z.string()",
	"pg_catalog.tstzrange": "z.string()",
	"pg_catalog.daterange": "z.string()",
	"pg_catalog.record": "z.record(z.string(), z.unknown())",
	"pg_catalog.void": "z.void()",
};
