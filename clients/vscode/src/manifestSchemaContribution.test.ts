/**
 * The app manifest's schema association (`contributes.jsonValidation`): which files VS Code
 * validates as a manifest, and against what. Matched the way VS Code's JSON service matches a
 * contributed `fileMatch`: a leading `!` excludes, a leading `/` is dropped, and every pattern
 * is anchored at any depth (a globstar segment, then the pattern) against the file's path.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_MANIFEST_SCHEMA_V1 } from "@seanhogg/builderforce-webcontainers-core/manifest";
import { manifestEditorSchema } from "../scripts/manifest-editor-schema.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  contributes: { jsonValidation: Array<{ fileMatch: string | string[]; url: string }> };
};
const entry = pkg.contributes.jsonValidation.find((item) => item.url === "./out/schemas/app.v1.schema.json")!;
const patterns = ([] as string[]).concat(entry.fileMatch);

function validated(file: string): boolean {
  const glob = (pattern: string) => `**/${pattern.replace(/^\//, "")}`;
  const included = patterns.filter((p) => !p.startsWith("!")).some((p) => path.posix.matchesGlob(file, glob(p)));
  const excluded = patterns.filter((p) => p.startsWith("!")).some((p) => path.posix.matchesGlob(file, glob(p.slice(1))));
  return included && !excluded;
}

describe("the app manifest's schema association", () => {
  it("validates a project's .builderforce/builderforce.json and the two legacy root names", () => {
    expect(validated("/work/app/.builderforce/builderforce.json")).toBe(true);
    expect(validated("/c:/Users/sean/code/app/.builderforce/builderforce.json")).toBe(true);
    expect(validated("/work/app/builderforce.json")).toBe(true);
    expect(validated("/work/app/bfwc.app.json")).toBe(true);
    expect(validated("/work/app/.builderforce/hooks.json")).toBe(false);
  });

  it("never validates agent-runtime's own config in the home folder (flat, per install, per profile)", () => {
    expect(validated("/c:/Users/sean/.builderforce/builderforce.json")).toBe(false);
    expect(validated("/Users/sean/.builderforce/builderforce.json")).toBe(false);
    expect(validated("/home/sean/.builderforce/builderforce.json")).toBe(false);
    expect(validated("/root/.builderforce/builderforce.json")).toBe(false);
    expect(validated("/home/sean/.builderforce/3f2a9c/builderforce.json")).toBe(false);
    expect(validated("/home/sean/.builderforce-dev/builderforce.json")).toBe(false);
  });

  it("never validates a copy inside node_modules", () => {
    expect(validated("/work/app/node_modules/pkg/builderforce.json")).toBe(false);
  });
});

describe("the editor schema built from the runtime's", () => {
  const schema = manifestEditorSchema(APP_MANIFEST_SCHEMA_V1 as unknown as Record<string, unknown>);

  it("holds a file with a version to the v1 schema in full, with its definitions", () => {
    const { $id: _id, $schema: _meta, title: _title, $defs, ...body } = APP_MANIFEST_SCHEMA_V1 as unknown as Record<string, unknown>;
    expect(schema.if).toEqual({ required: ["version"] });
    expect(schema.then).toEqual(body);
    expect(schema.$defs).toEqual($defs);
  });

  it("does not validate an unversioned legacy file, and is never fetched from a URL", () => {
    expect(schema).not.toHaveProperty("else");
    expect(schema).not.toHaveProperty("required");
    expect(schema).not.toHaveProperty("$id");
  });
});
