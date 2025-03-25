import {
	Extractor,
	type CanonicalType,
	type CompositeTypeDetails,
	type EnumDetails,
	type FunctionDetails,
	type TableColumn,
	type TableDetails,
} from "pg-extract";
import { rm, mkdir, writeFile } from "fs/promises";

export interface TruePGOpts {
	connectionString: string;
	outDir: string;
	enumTo?: "union" | "enum";
}

export interface Generator {
	table(table: TableDetails): string;
	enum(en: EnumDetails, to?: "union" | "enum"): string;
	composite_type(type: CompositeTypeDetails): string;
	function(type: FunctionDetails): string;
}

export interface createGenerator {
	(): Generator;
}

export const TruePG: createGenerator = (): Generator => {
	const column = (col: TableColumn) => {
		let out = "";

		if (col.comment) out += `/** ${col.comment} */\n\t`;

		out += col.name;
		if (col.isNullable) out += "?";
		// TODO: update imports for non-primitive types
		out += `: ${col.type.canonical_name}`;
		if (col.type.dimensions > 0) out += "[]".repeat(col.type.dimensions);
		if (col.isNullable) out += " | null";

		return out;
	};

	const composite_attribute = (attr: CanonicalType.CompositeAttribute) => {
		let out = attr.name;

		if (attr.isNullable) out += "?";
		out += `: ${attr.type.canonical_name}`;
		if (attr.type.dimensions > 0) out += "[]".repeat(attr.type.dimensions);
		if (attr.isNullable) out += " | null";

		return out;
	};

	return {
		table(table: TableDetails) {
			let out = "";

			if (table.comment) out += `/** ${table.comment} */\n`;
			out += `export interface ${table.name} {\n`;
			for (const col of table.columns) out += `\t${column(col)};\n`;
			out += "}\n";

			return out;
		},

		enum(en: EnumDetails, to: "union" | "enum" = "union") {
			let out = "";

			if (en.comment) out += `/** ${en.comment} */\n`;

			if (to === "union") {
				out += `export type ${en.name} = ${en.values.map(v => `"${v}"`).join(" | ")};\n`;
			} else {
				out += `export enum ${en.name} {\n`;
				for (const v of en.values) out += `\t"${v}" = "${v}",\n`;
				out += "}\n";
			}

			return out;
		},

		composite_type(type: CompositeTypeDetails) {
			let out = "";

			if (type.comment) out += `/** ${type.comment} */\n`;
			out += `export interface ${type.name} {\n`;

			const props = type.canonical.attributes.map(c => composite_attribute(c)).map(t => `\t${t};`);
			out += props.join("\n");
			out += "\n}\n";

			return out;
		},

		function(type: FunctionDetails) {
			let out = "";

			out += "/**\n";
			if (type.comment) out += ` * ${type.comment}\n`;
			out += ` * @volatility ${type.volatility}\n`;
			out += ` * @parallelSafety ${type.parallelSafety}\n`;
			out += ` * @isStrict ${type.isStrict}\n`;
			out += " */\n";
			out += "export interface ";
			out += type.name;
			out += " {\n\t";

			// Get the input parameters (those that appear in function signature)
			const inputParams = type.parameters.filter(
				p => p.mode === "IN" || p.mode === "INOUT" || p.mode === "VARIADIC",
			);

			if (inputParams.length === 0) {
				out += "(): ";
			} else if (inputParams.length === 1) {
				out += "(";
				out += inputParams[0]!.name;
				out += ": ";
				out += inputParams[0]!.type.canonical_name;
				if (inputParams[0]!.type.dimensions > 0) out += "[]".repeat(inputParams[0]!.type.dimensions);
				out += "): ";
			} else if (inputParams.length > 0) {
				out += "(\n";

				for (const param of inputParams) {
					// Handle variadic parameters differently if needed
					const isVariadic = param.mode === "VARIADIC";
					const paramName = isVariadic ? `...${param.name}` : param.name;

					out += `\t\t${paramName}`;
					if (param.hasDefault && !isVariadic) out += "?";
					// TODO: update imports for non-primitive types based on typeInfo.kind
					out += `: ${param.type.canonical_name}`;
					if (param.type.dimensions > 0) out += "[]".repeat(param.type.dimensions);
					if (!isVariadic) out += ",";
					out += "\n";
				}

				out += "\t): ";
			}

			if (type.returnType.kind === "table") {
				out += "{\n";
				for (const col of type.returnType.columns) {
					out += `\t\t${col.name}: `;
					out += col.type.canonical_name;
					if (col.type.dimensions > 0) out += "[]".repeat(col.type.dimensions);
					out += `;\n`;
				}
				out += "\t}";
			} else {
				out += type.returnType.type.canonical_name;
				if (type.returnType.type.dimensions > 0) out += "[]".repeat(type.returnType.type.dimensions);
			}

			// Add array brackets based on dimensions
			if (type.returnType.kind === "regular" && type.returnType.type.dimensions > 0) {
				out += "[]".repeat(type.returnType.type.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) {
				out += "[]";
			}

			out += ";\n}\n";

			return out;
		},
	};
};

export async function generate(opts: TruePGOpts) {
	const { connectionString, outDir } = opts;

	const extractor = new Extractor(connectionString);

	const schemas = await extractor.extractSchemas();

	console.log("Clearing outDir %s", outDir);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const generator = TruePG();

	console.log("Generating schemas at %s", outDir);

	for (const schema of Object.values(schemas)) {
		console.log("Generating schema %s", schema.name);

		const schemaDir = `${outDir}/${schema.name}`;

		await mkdir(`${schemaDir}/tables`, { recursive: true });

		for (const table of schema.tables) {
			console.log("Creating table %s at %s", table.name, `${schemaDir}/tables/${table.name}.ts`);
			await writeFile(`${schemaDir}/tables/${table.name}.ts`, generator.table(table));
		}

		await mkdir(`${schemaDir}/enums`, { recursive: true });

		for (const en of schema.enums) {
			console.log("Creating enum %s at %s", en.name, `${schemaDir}/enums/${en.name}.ts`);
			await writeFile(`${schemaDir}/enums/${en.name}.ts`, generator.enum(en, opts.enumTo));
		}

		await mkdir(`${schemaDir}/composite_types`, { recursive: true });

		for (const type of schema.compositeTypes) {
			console.log("Creating composite type %s at %s", type.name, `${schemaDir}/composite_types/${type.name}.ts`);
			await writeFile(`${schemaDir}/composite_types/${type.name}.ts`, generator.composite_type(type));
		}

		await mkdir(`${schemaDir}/functions`, { recursive: true });

		for (const func of schema.functions) {
			console.log("Creating function %s at %s", func.name, `${schemaDir}/functions/${func.name}.ts`);
			await writeFile(`${schemaDir}/functions/${func.name}.ts`, generator.function(func));
		}
	}
}

const connectionString = "postgres://mkrcal:mkrcal@localhost:5432/mkrcal";
const outDir = "./out";

generate({ connectionString, outDir });
