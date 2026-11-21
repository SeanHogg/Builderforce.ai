/**
 * The app manifest schema VS Code validates `.builderforce/builderforce.json` (and the legacy
 * root files) against — `contributes.jsonValidation` → `out/schemas/app.v1.schema.json`,
 * written by `esbuild.mjs` from the runtime's own `APP_MANIFEST_SCHEMA_V1`.
 *
 * - A file with `version` is held to the v1 schema in full.
 * - A file without `version` is NOT validated: the runtime reads it as its unversioned legacy
 *   format (an info-level `legacy-format` issue asking for `"version": 1`), and app detection
 *   still lays it over a blueprint, so the editor must not mark it as an error.
 * - No `$id`: the schema is served from the extension, never fetched from a URL.
 *
 * @param {Record<string, unknown>} v1 the runtime's `APP_MANIFEST_SCHEMA_V1`
 * @returns {Record<string, unknown>}
 */
export function manifestEditorSchema(v1) {
  const { $schema, $id: _id, title, $defs, ...body } = v1;
  return {
    $schema,
    title,
    description: 'An app manifest v1 is validated in full; a file without "version" is the legacy format and is not validated.',
    if: { required: ['version'] },
    then: body,
    $defs,
  };
}
