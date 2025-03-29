export declare namespace True {
	export type Column<Selectable, Insertable = Selectable, Updateable = Selectable> = {
		"@true-pg/insert": Insertable;
		"@true-pg/update": Updateable;
		"@true-pg/select": Selectable;
	};

	export type Generated<T> = Column<T, T | undefined, T | undefined>;
	export type HasDefault<T> = Column<T, T | undefined, T | undefined>;
	export type AlwaysGenerated<T> = Column<T, never, never>;

	type DrainOuterGeneric<T> = [T] extends [unknown] ? T : never;
	type Simplify<T> = DrainOuterGeneric<{ [K in keyof T]: T[K] } & {}>;

	export type Selectable<T extends Record<string, any>> = Simplify<{
		[K in keyof T]: T[K] extends Record<string, any>
			? Selectable<T[K]>
			: T[K] extends Column<infer S, infer I, infer U>
				? S
				: T[K];
	}>;

	export type Insertable<T extends Record<string, any>> = Simplify<{
		[K in keyof T]: T[K] extends Record<string, any>
			? Insertable<T[K]>
			: T[K] extends Column<infer S, infer I, infer U>
				? I
				: T[K];
	}>;

	export type Updateable<T extends Record<string, any>> = Simplify<{
		[K in keyof T]?: T[K] extends Record<string, any>
			? Updateable<T[K]>
			: T[K] extends Column<infer S, infer I, infer U>
				? U
				: T[K];
	}>;
}
