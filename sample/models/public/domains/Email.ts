import { z } from "zod";

export type Email = string;

export const email = z.string();
