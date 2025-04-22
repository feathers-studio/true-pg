# true-pg

A truthful and complete [^1] TypeScript code generator for PostgreSQL database schemas.

## Installation

```bash
npm install true-pg
# or
yarn add true-pg
# or
bun add true-pg
```

## Quickstart

```bash
npx true-pg --all-adapters --uri postgres://user:password@localhost:5432/database --out ./models
```

This will generate a `models` directory with the following structure:

```
models/
├── index.ts
├── public/
│   ├── index.ts
│   ├── tables/
│   │   ├── index.ts
│   │   └── User.ts
│   └── views/
│   ├── enums/
│   └── ...
```

You can then import the `Database` type from the `index.ts` file and pass it to Kysely:

```typescript
import { Kysely } from "kysely";
import { Database } from "./models/index.ts";

const db = new Kysely<Database>( ... );
```

## Sample Database

A sample database and generated models are available in the `sample` directory. You can browse the generated models in the `sample/models` directory.

To run the sample yourself, run:

```bash
bun install # install dependencies
cd sample
bun run ../src/bin.ts
```

## Detailed Usage

### Command Line Interface

```bash
true-pg [options]
```

Options:

-   `-h, --help` - Show help information
-   `-c, --config [path]` - Path to config file (JSON)
-   `-u, --uri [uri]` - Database URI (Postgres only!)
-   `-o, --out [path]` - Path to output directory (defaults to "models")
-   `-a, --adapter [adapter]` - Adapter to use (e.g. `kysely`, `zod`). Can be specified multiple times.
-   `-A, --all-adapters` - Enable all built-in adapters

You can configure true-pg either through command-line arguments or a config file.

### Configuration file

If an explicit config file is not provided via `--config`, true-pg will look for a config file in the current working directory.

We use cosmiconfig to load the config file. See the [cosmiconfig docs](https://github.com/cosmiconfig/cosmiconfig#usage-for-end-users) for all possible config file formats.

The recommended default is `truepg.config.ts`, or `.config/truepg.ts`.

Example config file:

```typescript
import { config } from "true-pg";

export default config({
	uri: "postgres://user:password@localhost:5432/database",
	out: "src/models",
	adapters: ["kysely", "zod"],
	defaultSchema: "public",
});
```

## Configuration Options

| Option          | Description                                              | Default             |
| --------------- | -------------------------------------------------------- | ------------------- |
| `uri`           | PostgreSQL connection URI                                | Required, or config |
| `config`        | Knex connection config object                            | Required, or uri    |
| `out`           | Output directory for generated files                     | `"models"`          |
| `adapters`      | Adapters to use (e.g. `kysely`, `zod`)                   | `"kysely"`          |
| `defaultSchema` | Default schema to use (Kysely schema will be unprefixed) | `"public"`          |

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
	table: (imports, table) => {
		// Custom table type generation
	},
	enum: (imports, en) => {
		// Custom enum type generation
	},
	composite: (imports, composite) => {
		// Custom composite type generation
	},
	function: (imports, func) => {
		// Custom function type generation
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
		adapters: [], // empty array to disable adapters
		out: "src/models",
	},
	[generator],
);
```

Filenames will be created using the `format*` methods of the FIRST generator passed to `generate` or via the `--adapter` CLI option.

## Schema Generator Interface

The `SchemaGenerator` interface provides methods to customize code generation:

| Method                          | Description                                                       |
| ------------------------------- | ----------------------------------------------------------------- |
| `formatSchema(name)`            | Formats schema names (public -> PublicSchema)                     |
| `formatSchemaType(type)`        | Formats schema type names (user_sessions -> UserSessions)         |
| `formatType(type)`              | Formats type names (pg_catalog.int4 -> number)                    |
| `table(types, table)`           | Generates code for tables                                         |
| `view(types, view)`             | Generates code for views                                          |
| `materialisedView(types, view)` | Generates code for materialised views                             |
| `enum(types, en)`               | Generates code for enums                                          |
| `composite(types, composite)`   | Generates code for composite types                                |
| `domain(types, domain)`         | Generates code for domains                                        |
| `range(types, range)`           | Generates code for ranges                                         |
| `function(types, func)`         | Generates code for functions                                      |
| `schemaKindIndex(schema, kind)` | Generates index for a schema kind (models/public/tables/index.ts) |
| `schemaIndex(schema)`           | Generates index for a schema (models/public/index.ts)             |
| `fullIndex(schemas)`            | Generates full index (models/index.ts)                            |

## License

[MIT](LICENSE)

[^1]: We support codegen for tables, views, materialized views, enums, composite types, domains, ranges, and functions.
