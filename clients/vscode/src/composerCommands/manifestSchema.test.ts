import { describe, expect, it } from "vitest";
import { APP_MANIFEST_SCHEMA_URL, hasStaleSchema, withoutStaleSchema } from "./manifestSchema";

const URL = "https://builderforce.ai/schema/app.v1.json";
const member = `"$schema": "${URL}"`;

describe("the stale manifest $schema", () => {
  it("is the runtime's schema URL", () => {
    expect(APP_MANIFEST_SCHEMA_URL).toBe(URL);
  });

  it.each([
    ["first of several, indented", `{\n  ${member},\n  "version": 1\n}\n`, `{\n  "version": 1\n}\n`],
    ["in the middle", `{\n  "version": 1,\n  ${member},\n  "name": "app"\n}`, `{\n  "version": 1,\n  "name": "app"\n}`],
    ["last", `{\n  "version": 1,\n  ${member}\n}\n`, `{\n  "version": 1\n}\n`],
    ["the only member", `{\n  ${member}\n}`, `{}`],
    ["on one line", `{"$schema":"${URL}","version":1}`, `{"version":1}`],
    ["after an object value", `{ "resources": { "db": { "kind": "postgres" } }, ${member} }`, `{ "resources": { "db": { "kind": "postgres" } } }`],
    ["after a string with escaped quotes and braces", `{"name":"a\\"},\\\\","on":true,"x":null,"list":[1,{"a":"]"}],${member},"n":2}`, `{"name":"a\\"},\\\\","on":true,"x":null,"list":[1,{"a":"]"}],"n":2}`],
    ["after a number that ends the previous member", `{"version":1 , ${member}}`, `{"version":1 }`],
    ["with tabs and CRLF", `{\r\n\t${member},\r\n\t"version": 1\r\n}\r\n`, `{\r\n\t"version": 1\r\n}\r\n`],
    ["first, with no trailing newline", `{\n  ${member},\n  "version": 1\n}`, `{\n  "version": 1\n}`],
    ["last, with no trailing newline", `{\n  "version": 1,\n  ${member}\n}`, `{\n  "version": 1\n}`],
    ["last, with CRLF", `{\r\n\t"version": 1,\r\n\t${member}\r\n}\r\n`, `{\r\n\t"version": 1\r\n}\r\n`],
  ])("removes it minimally when it is %s", (_case, before, after) => {
    expect(withoutStaleSchema(before)).toBe(after);
    expect(JSON.parse(withoutStaleSchema(before)!)).not.toHaveProperty("$schema");
  });

  it("keeps a nested $schema with the same URL", () => {
    const before = `{\n  ${member},\n  "resources": { "x": { ${member} } }\n}`;
    expect(withoutStaleSchema(before)).toBe(`{\n  "resources": { "x": { ${member} } }\n}`);
  });

  it.each([
    ["another URL", `{"$schema":"https://builderforce.ai/schema/app.v2.json","version":1}`],
    ["a URL that merely extends the stale one", `{"$schema":"${URL}.bak","version":1}`],
    ["a URL that merely contains the stale one", `{"$schema":"https://evil.example/${URL}","version":1}`],
    ["a relative path", `{"$schema":"./schema.json"}`],
    ["only a nested one", `{"resources":{"x":{${member}}}}`],
    ["no $schema", `{"version":1}`],
    ["text that is not JSON", `{ ${member}, // half-edited`],
    ["an array", `[${JSON.stringify(URL)}]`],
    ["a duplicated key", `{${member},"version":1,${member}}`],
  ])("leaves %s alone", (_case, text) => {
    expect(withoutStaleSchema(text)).toBeUndefined();
    expect(hasStaleSchema(text)).toBe(false);
  });

  it("matches an escaped spelling of the same URL", () => {
    expect(withoutStaleSchema(`{"$schema":"https:\\/\\/builderforce.ai\\/schema\\/app.v1.json","version":1}`)).toBe(`{"version":1}`);
  });

  it("has nothing to find in a missing file", () => {
    expect(hasStaleSchema(undefined)).toBe(false);
  });
});
