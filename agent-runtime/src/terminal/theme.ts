import chalk, { Chalk } from "chalk";
import { BRAND_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  brand: baseChalk.bold.hex(BRAND_PALETTE.brand),
  accent: hex(BRAND_PALETTE.accent),
  accentBright: hex(BRAND_PALETTE.accentBright),
  accentDim: hex(BRAND_PALETTE.accentDim),
  info: hex(BRAND_PALETTE.info),
  success: hex(BRAND_PALETTE.success),
  warn: hex(BRAND_PALETTE.warn),
  error: hex(BRAND_PALETTE.error),
  muted: hex(BRAND_PALETTE.muted),
  heading: baseChalk.bold.hex(BRAND_PALETTE.brand),
  command: hex(BRAND_PALETTE.brand),
  option: hex(BRAND_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
