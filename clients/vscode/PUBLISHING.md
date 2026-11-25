# Publishing the BuilderForce VS Code extension

The extension ships to **two** registries so every editor flavor can install it:

| Registry | Serves | CLI | Token |
| --- | --- | --- | --- |
| **VS Code Marketplace** | VS Code (Microsoft build) | `vsce` | GitHub Actions trusted publishing |
| **Open VSX** | Cursor, Windsurf, VSCodium, code-server | `ovsx` | `OVSX_PAT` |

## One-time setup

### VS Code Marketplace
In the [BuilderForce publisher's Trusted Publishing settings](https://marketplace.visualstudio.com/manage/publishers/builderforce/trustedpublishing), create a GitHub Actions policy for owner `SeanHogg`, repository `Builderforce.ai`, and workflow `release.yml`. Leave Environment blank. The publish job runs on `main` and exchanges its GitHub OIDC identity for a short-lived Marketplace credential.

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

npm run publish:openvsx -- builderforce-ai-*.vsix
```

## CI publish (recommended)

Every push to `main` runs `.github/workflows/release.yml`, whose `publish-extension` job
packages the extension once, launches it in a real VS Code, and publishes the same `.vsix`
to both registries. There is no tag step; bump `version` in `package.json` and push.

Marketplace publishing fails if trusted authentication or upload fails. An existing universal package at the same version is a no-op. Open VSX still uses `OVSX_PAT`; check its listing to confirm publication.

After fixing Marketplace policy or Open VSX credentials, retry the publish job with `gh run rerun <run-id> --job <publish-extension job id>` while its packaged artifact is still available.

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
