# Publishing the BuilderForce VS Code extension

The extension ships to **two** registries so every editor flavor can install it:

| Registry | Serves | CLI | Token |
| --- | --- | --- | --- |
| **VS Code Marketplace** | VS Code (Microsoft build) | `vsce` | `VSCE_PAT` |
| **Open VSX** | Cursor, Windsurf, VSCodium, code-server | `ovsx` | `OVSX_PAT` |

## One-time setup

### VS Code Marketplace
1. Create a publisher at <https://marketplace.visualstudio.com/manage>. The `publisher`
   field in `package.json` (`builderforce`) must match it.
2. Back it with an **Azure DevOps** organization and create a **Personal Access Token**
   with scope **Marketplace → Manage** (full).
3. Store the token as the `VSCE_PAT` repo secret (CI) and/or run `vsce login builderforce`
   locally.

### Open VSX
1. Sign in at <https://open-vsx.org> with GitHub and create an access token.
2. Create the `builderforce` namespace once: `npx ovsx create-namespace builderforce -p $OVSX_PAT`.
3. Store the token as the `OVSX_PAT` repo secret.

## Local publish

```bash
npm install
npm run compile
npm run package                 # → builderforce-ai-<version>.vsix
code --install-extension builderforce-ai-*.vsix   # smoke-test the .vsix

npm run publish:marketplace     # vsce publish --no-dependencies
npm run publish:openvsx -- builderforce-ai-*.vsix
```

## CI publish (recommended)

Every push to `main` runs `.github/workflows/release.yml`, whose `publish-extension` job
packages the extension once, launches it in a real VS Code, and publishes the same `.vsix`
to both registries. There is no tag step; bump `version` in `package.json` and push.

**Each registry is skipped, with only a warning, while its secret is unset.** A green
release therefore does NOT mean the extension shipped. Check the job's log for
`VSCE_PAT is not set` / `OVSX_PAT is not set`, or check the listing itself.

To publish a version whose release already ran, set the secrets and re-run just that
job: `gh run rerun <run-id> --job <publish-extension job id>`. A version that already
exists is rejected and reported as a warning, so a re-run is always safe.

## Versioning

Use the repo's `YYYY.M.D[-beta.N]` scheme — it is valid Marketplace semver
(e.g. `2026.6.17`). Bump `version` in `package.json` before tagging.

## Notes

- `--no-dependencies` is used because the extension bundles no runtime npm deps in v0 (the
  webview is vanilla; the host uses only the `vscode` API + global `fetch`). When Phase 2
  adds `@seanhogg/builderforce-brain-embedded/ui` and `@seanhogg/builderforce-agents`,
  switch to bundling (esbuild) and drop `--no-dependencies`.
- Replace `media/icon.png` with the final 128×128 brand icon before a marketing release
  (the current one is a generated placeholder).
