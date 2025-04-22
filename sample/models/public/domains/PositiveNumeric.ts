import { z } from "zod";

export type PositiveNumeric = bigint;

export const positive_numeric = z.bigint();
