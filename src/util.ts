export const unreachable = (value: never): never => {
	throw new Error(`Fatal: Reached unreachable code: ${value}`);
};

const NO_COLOR = Boolean(process.env.NO_COLOR || process.env.CI);

export const ansi_esc = {
	red: `\x1b[31m`,
	green: `\x1b[32m`,
	yellow: `\x1b[33m`,
	blue: `\x1b[34m`,
	bold: `\x1b[1m`,
	underline: `\x1b[4m`,
	reset: `\x1b[0m`,
};

// just dummy each colour to an empty string if NO_COLOR is set
if (NO_COLOR) for (const key in ansi_esc) ansi_esc[key as keyof typeof ansi_esc] = "";

export const ansi = Object.fromEntries(
	Object.entries(ansi_esc).map(([key, value]) => [key, (str: string | number) => value + str + ansi_esc.reset]),
) as { [esc in keyof typeof ansi_esc]: (str: string | number) => string };

const formatTime = (time: number): string => {
	const mins = Math.floor(time / 60000);
	const secs = Math.floor((time % 60000) / 1000);
	const ms = Math.floor(time % 1000);
	const us = Math.floor((time * 1000) % 1000)
		.toString()
		.padStart(3, "0");

	const parts = [];
	if (mins) parts.push(mins + "m");
	if (secs) parts.push(secs + "s");
	if (!mins) parts.push(ms + (!secs && us ? "." + us : "") + "ms");

	return parts.join("");
};

const THRESHOLD1 = 800;
const THRESHOLD2 = 1500;

export const time = (start: number, addParens = true) => {
	const diff = performance.now() - start;
	const diffstr = formatTime(diff);
	const str = addParens ? parens(diffstr) : diffstr;

	if (diff < THRESHOLD1) return ansi.green(str);
	if (diff < THRESHOLD2) return ansi.yellow(str);
	return ansi.red(str);
};

export const eq = <T>(a: T, b: T): boolean => {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;

	for (const key in a) if (!eq(a[key], b[key])) return false;
	return true;
};

export const toPascalCase = (str: string) => {
	let result = "";

	let index = 0;
	let space = false;
	let leading = true;
	const len = str.length;
	while (index < len) {
		const char = str[index]!;

		// keep trailing underscores
		if (index === len - 1 && char === "_") {
			// iterate backwards until a non-underscore character is found
			let index = len - 1;
			while (index >= 0 && str[index]! === "_") {
				result += "_";
				index--;
			}

			break;
		}

		if (leading) {
			if (char === "_") {
				result += char;
			} else if (/[a-zA-Z]/.test(char)) {
				result += char.toUpperCase();
				leading = false;
			} else {
				// skip leading non-alphabetic characters
			}
		} else if (/[a-zA-Z0-9]/.test(char)) {
			// valid characters
			if (space) result += char.toUpperCase();
			else result += char;
			space = false;
		} else {
			// invalid characters, space, underscore, or hyphen
			// treat as space
			space = true;
		}

		index++;
	}

	return result;
};

export const to_snake_case = (str: string) => {
	let result = "";

	let index = 0;
	let space = false;
	let leading = true;
	let upper = false;
	const len = str.length;
	while (index < len) {
		const char = str[index]!;

		// keep trailing underscores
		if (index === len - 1 && char === "_") {
			// iterate backwards until a non-underscore character is found
			let index = len - 1;
			while (index >= 0 && str[index]! === "_") {
				result += "_";
				index--;
			}

			break;
		}

		if (leading) {
			if (char === "_") {
				result += char;
			} else if (/[A-Z]/.test(char)) {
				result += char.toLowerCase();
				leading = false;
				upper = true;
			} else if (/[a-z]/.test(char)) {
				result += char.toLowerCase();
				leading = false;
			} else {
				// skip leading non-alphabetic characters
			}
		} else if (/[A-Z]/.test(char)) {
			if (!upper) result += "_";
			if (space) result += "_";
			// uppercase characters
			result += char.toLowerCase();
			space = false;
			upper = true;
		} else if (/[a-z0-9]/.test(char)) {
			// valid characters
			if (space) result += "_";
			result += char;
			space = false;
			upper = false;
		} else {
			// invalid characters, space, underscore, or hyphen
			// treat as space
			space = true;
		}

		index++;
	}

	return result;
};

export const join = (parts: Iterable<string>, joiner = "\n\n") => Array.from(parts).filter(Boolean).join(joiner);

export type UnionKeys<T> = T extends unknown ? keyof T : never;

type AddOptionalKeys<K extends PropertyKey> = { [P in K]?: never };

export type Deunionise<B extends object | undefined, T = B> = Simplify<
	T extends object ? T & AddOptionalKeys<Exclude<UnionKeys<B>, keyof T>> : T
>;

export type Simplify<T> = {
	[KeyType in keyof T]: T[KeyType];
} & {};

const isIdentifierInvalid = (str: string) => {
	const invalid = str.match(/[^a-zA-Z0-9_]/);
	return invalid !== null;
};

export const parens = (str: string, type = "()"): string => `${type[0]!}${str}${type[1]!}`;

export const quote = (str: string, using = '"') => `${using}${str.replaceAll(using, "\\" + using)}${using}`;

export const quoteI = (str: string, using = '"') => (isIdentifierInvalid(str) ? quote(str, using) : str);

export const removeNulls = <T>(o: T): T => {
	for (const key in o) if (o[key] == null) delete o[key];
	return o;
};

export const pos = (num: number) => (num < 0 ? undefined : num);

export const minifyQuery = (query: string) => {
	return query
		.split("\n")
		.map(line => line.slice(0, pos(line.indexOf("--"))))
		.join("\n")
		.replaceAll(/\s+/g, " ")
		.trim();
};
