import { resolveCommitHash } from "../infra/git-commit.js";
import { visibleWidth } from "../terminal/ansi.js";
import { isRich, theme } from "../terminal/theme.js";
import { pickTagline, type TaglineOptions } from "./tagline.js";

type BannerOptions = TaglineOptions & {
  argv?: string[];
  commit?: string | null;
  columns?: number;
  richTty?: boolean;
};

let bannerEmitted = false;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) {
    return Array.from(value);
  }
  try {
    return Array.from(graphemeSegmenter.segment(value), (seg) => seg.segment);
  } catch {
    return Array.from(value);
  }
}

const hasJsonFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--json" || arg.startsWith("--json="));

const hasVersionFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--version" || arg === "-V" || arg === "-v");

export function formatCliBannerLine(version: string, options: BannerOptions = {}): string {
  const commit = options.commit ?? resolveCommitHash({ env: options.env });
  const commitLabel = commit ?? "local";
  const tagline = pickTagline(options);
  const rich = options.richTty ?? isRich();
  const title = "BuilderForceAgents";
  const prefix = "";
  const columns = options.columns ?? process.stdout.columns ?? 120;
  const plainFullLine = `${title} ${version} (${commitLabel}) — ${tagline}`;
  const fitsOnOneLine = visibleWidth(plainFullLine) <= columns;
  if (rich) {
    if (fitsOnOneLine) {
      return `${theme.brand(title)} ${theme.brand(version)} ${theme.muted(
        `(${commitLabel})`,
      )} ${theme.muted("—")} ${theme.brand(tagline)}`;
    }
    const line1 = `${theme.brand(title)} ${theme.brand(version)} ${theme.muted(`(${commitLabel})`)}`;
    const line2 = `${" ".repeat(prefix.length)}${theme.brand(tagline)}`;
    return `${line1}\n${line2}`;
  }
  if (fitsOnOneLine) {
    return plainFullLine;
  }
  const line1 = `${title} ${version} (${commitLabel})`;
  const line2 = `${" ".repeat(prefix.length)}${tagline}`;
  return `${line1}\n${line2}`;
}

const LOBSTER_ASCII = [
  " ██████╗ ██████╗ ██████╗ ███████╗██████╗  ██████╗██╗      █████╗ ██╗    ██╗",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║",
  "██║     ██║   ██║██║  ██║█████╗  ██████╔╝██║     ██║     ███████║██║ █╗ ██║",
  "██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗██║     ██║     ██╔══██║██║███╗██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ",
  "                  🦞 BUILDERFORCE_AGENTS 🦞                   ",
  " ",
];

export function formatCliBannerArt(options: BannerOptions = {}): string {
  const rich = options.richTty ?? isRich();
  if (!rich) {
    return LOBSTER_ASCII.join("\n");
  }

  const colorChar = (ch: string) => {
    if (ch === "█") {
      return theme.brand(ch);
    }
    if (ch === "░") {
      return theme.info(ch);
    }
    if (ch === "▀") {
      return theme.brand(ch);
    }
    return theme.muted(ch);
  };

  const colored = LOBSTER_ASCII.map((line) => {
    if (line.includes("BUILDERFORCE_AGENTS")) {
      return (
        theme.muted("              ") +
        theme.brand("🦞") +
        theme.brand(" BUILDERFORCE_AGENTS ") +
        theme.brand("🦞")
      );
    }
    return splitGraphemes(line).map(colorChar).join("");
  });

  return colored.join("\n");
}

export function emitCliBanner(version: string, options: BannerOptions = {}) {
  if (bannerEmitted) {
    return;
  }
  const argv = options.argv ?? process.argv;
  if (!process.stdout.isTTY) {
    return;
  }
  if (hasJsonFlag(argv)) {
    return;
  }
  if (hasVersionFlag(argv)) {
    return;
  }
  const line = formatCliBannerLine(version, options);
  process.stdout.write(`\n${line}\n\n`);
  bannerEmitted = true;
}

export function hasEmittedCliBanner(): boolean {
  return bannerEmitted;
}
