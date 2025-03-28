# true-pg

A truthful and complete<sup>†</sup> TypeScript code generator for PostgreSQL database schemas.

## Installation

```bash
npm install true-pg
# or
yarn add true-pg
# or
bun add true-pg
```

## Usage

### Command Line Interface

```bash
true-pg [options]
```

Options:

- `-h, --help` - Show help information
- `-c, --config [path]` - Path to config file (JSON)
- `-u, --uri [uri]` - Database URI (Postgres only!)
- `-o, --out [path]` - Path to output directory (defaults to "models")
- `-a, --adapter [adapter]` - Adapter to use (e.g. `kysely`, `zod`). Can be specified multiple times.
- `-A, --all-adapters` - Enable all built-in adapters

You can configure true-pg either through command-line arguments or a config file.

### Configuration file

The tool looks for configuration in the following locations (in order):

1. `.truepgrc.json`
2. `.config/.truepgrc.json`

Example config file:

```json
{
	"uri": "postgres://user:password@localhost:5432/database",
	"out": "src/models",
	"adapters": ["kysely", "zod"],
	"defaultSchema": "public",
	"enumTo": "enum"
}
```

## Configuration Options

| Option          | Description                                                       | Default      |
| --------------- | ----------------------------------------------------------------- | ------------ |
| `uri`           | PostgreSQL connection URI                                         | Required     |
| `out`           | Output directory for generated files                              | `"models"`   |
| `adapters`      | Adapters to use (e.g. `["kysely", "zod"]`)                        | `["kysely"]` |
| `defaultSchema` | Default schema to use (Kysely schema will be unprefixed)          | `"public"`   |
| `enumTo`        | How to represent PostgreSQL enums (as TypeScript unions or enums) | `"enum"`     |

## Customising Code Generation

> 🔔 HERE BE DRAGONS!
>
> Keep in mind that programmatic usage of `true-pg` is not yet stable. Functions and methods may change until we're comfortable with the API.
>
> However, if you're interested, we welcome your feedback and contributions!

You can create a custom generator to control how code is generated:

```typescript
import { createGenerator, generate } from "true-pg";

const generator = createGenerator(opts => ({
	formatSchema: name => `${name}Schema`,
	formatSchemaType: type => `${type}Type`,
	formatType: type => `${type}Interface`,
	table: (types, table) => {
		// Custom table type generation
	},
	enum: (types, en) => {
		// Custom enum type generation
	},
	composite: (types, composite) => {
		// Custom composite type generation
	},
	function: (types, func) => {
		// Custom function type generation
	},
	imports: (types, context) => {
		// Custom imports generation
	},
	schemaKindIndex: (schema, kind) => {
		// Custom schema kind index generation
	},
	schemaIndex: schema => {
		// Custom schema index generation
	},
	fullIndex: schemas => {
		// Custom full index generation
	},
}));

await generate(
	{
		uri: "postgres://user:password@localhost:5432/database",
		out: "src/models",
	},
	[generator],
);
```

## Schema Generator Interface

The `SchemaGenerator` interface provides methods to customize code generation:

| Method                          | Description                                                       |
| ------------------------------- | ----------------------------------------------------------------- |
| `formatSchema(name)`            | Formats schema names (public -> PublicSchema)                     |
| `formatSchemaType(type)`        | Formats schema type names (user_sessions -> UserSessions)         |
| `formatType(type)`              | Formats type names (pg_catalog.int4 -> number)                    |
| `table(types, table)`           | Generates code for tables                                         |
| `enum(types, en)`               | Generates code for enums                                          |
| `composite(types, composite)`   | Generates code for composite types                                |
| `function(types, func)`         | Generates code for functions                                      |
| `imports(types, context)`       | Generates imports for given types                                 |
| `schemaKindIndex(schema, kind)` | Generates index for a schema kind (models/public/tables/index.ts) |
| `schemaIndex(schema)`           | Generates index for a schema (models/public/index.ts)             |
| `fullIndex(schemas)`            | Generates full index (models/index.ts)                            |

## License

[MIT](LICENSE)

<sup>†</sup> We only support tables, enums, composite types, and functions at the moment, but we're working on adding support for views, materialised views, domains, and more.
