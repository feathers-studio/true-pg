import {
	extractSchemas,
	type CompositeTypeAttribute,
	type CompositeTypeDetails,
	type EnumDetails,
	type FunctionDetails,
	type TableColumn,
	type TableDetails,
} from "extract-pg-schema";
import { rm, mkdir, writeFile } from "fs/promises";

export interface TruePGOpts {
	connectionString: string;
	outDir: string;
}

export interface Generator {
	table(table: TableDetails): string;
	enum(en: EnumDetails): string;
	composite_type(type: CompositeTypeDetails): string;
	function(type: FunctionDetails): string;
}

export interface createGenerator {
	(): Generator;
}

export const TruePG: createGenerator = () => {
	const generator = {
		column(col: TableColumn) {
			let out = col.name;

			if (col.isNullable) out += "?";
			// TODO: update imports for non-primitive types
			out += `: ${col.type.fullName}`;
			if (col.dimensions) out += "[]".repeat(col.dimensions);
			if (col.isNullable) out += " | null";

			return out;
		},

		table(table: TableDetails) {
			let out = `export interface ${table.name} {\n`;
			for (const col of table.columns) out += `\t${this.column(col)};\n`;
			out += "}\n";

			return out;
		},

		enum(en: EnumDetails) {
			let out = `export type ${en.name} = ${en.values.map(v => `"${v}"`).join(" | ")};\n`;
			return out;
		},

		composite_attribute(attr: CompositeTypeAttribute) {
			let out = attr.name;

			if (attr.isNullable) out += "?";
			out += `: ${attr.type.fullName}`;
			if (attr.isArray) out += "[]";
			if (attr.isNullable) out += " | null";

			return out;
		},

		composite_type(type: CompositeTypeDetails) {
			let out = `export type ${type.name} = {\n`;

			const props = type.attributes.map(c => this.composite_attribute(c)).map(t => `\t${t};`);
			out += props.join("\n");
			out += "\n}\n";

			return out;
		},

		function_return_table(type: Exclude<FunctionDetails["returnType"], string>) {
			let out = `{\n`;
			for (const col of type.columns) out += `\t${col.name}: ${col.type};\n`;
			out += "}";

			return out;
		},

		function(type: FunctionDetails) {
			let out = "";

			if (type.comment) {
				out += "/**\n";
				out += ` * ${type.comment}\n`;
				out += " */\n";
			}
			out += "export function ";

			out += type.name;

			// Get the input parameters (those that appear in function signature)
			const inputParams = type.parameters.filter(
				p => p.mode === "IN" || p.mode === "INOUT" || p.mode === "VARIADIC",
			);

			// If there are input parameters, create a params object
			if (inputParams.length > 0) {
				out += "(\n\tparams: {\n";

				for (const param of inputParams) {
					// Handle variadic parameters differently if needed
					const isVariadic = param.mode === "VARIADIC";
					const paramName = isVariadic ? `...${param.name}` : param.name;

					out += `\t\t${paramName}`;
					if (param.hasDefault) out += "?";
					// TODO: update imports for non-primitive types based on typeInfo.kind
					out += `: ${param.typeInfo.fullName}`;
					out += ";\n";
				}

				out += "\t}\n): ";
			} else {
				// No parameters
				out += "(): ";
			}

			if (type.returnTypeInfo.isTable) {
				out += "{\n";
				for (const col of type.returnTypeInfo.columns!) {
					out += `\t${col.name}: ${col.type};\n`;
				}
				out += "}";
			} else out += type.returnTypeInfo.fullName;

			// Add array brackets based on dimensions
			if (type.returnTypeInfo.dimensions > 0) {
				out += "[]".repeat(type.returnTypeInfo.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnTypeInfo.isSet) {
				out += "[]";
			}

			out += ";\n";

			return out;
		},

		// Add a helper method to explain volatility
		explainVolatility(volatility: FunctionDetails["volatility"]): string {
			switch (volatility) {
				case "IMMUTABLE":
					return "Function cannot modify the database and always returns the same result given the same arguments";
				case "STABLE":
					return "Function cannot modify the database and returns the same result given the same arguments within a single table scan";
				case "VOLATILE":
					return "Function can modify the database and may return different results on successive calls with the same arguments";
				default:
					return "";
			}
		},
	};

	return generator;
};

export async function generate(opts: TruePGOpts) {
	const { connectionString, outDir } = opts;

	const schemas = await extractSchemas({ connectionString });

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const generator = TruePG();

	for (const schema of Object.values(schemas)) {
		await mkdir(`${outDir}/${schema.name}/tables`, { recursive: true });

		for (const table of schema.tables) {
			await writeFile(`${outDir}/${schema.name}/tables/${table.name}.ts`, generator.table(table));
		}

		await mkdir(`${outDir}/${schema.name}/enums`, { recursive: true });

		for (const en of schema.enums) {
			await writeFile(`${outDir}/${schema.name}/enums/${en.name}.ts`, generator.enum(en));
		}

		await mkdir(`${outDir}/${schema.name}/composite_types`, { recursive: true });

		for (const type of schema.compositeTypes) {
			await writeFile(`${outDir}/${schema.name}/composite_types/${type.name}.ts`, generator.composite_type(type));
		}

		await mkdir(`${outDir}/${schema.name}/functions`, { recursive: true });

		for (const func of schema.functions) {
			await writeFile(`${outDir}/${schema.name}/functions/${func.name}.ts`, generator.function(func));
		}
	}
}

const connectionString = "postgres://mkrcal:mkrcal@localhost:5432/mkrcal";
const outDir = "./out";

generate({ connectionString, outDir });
