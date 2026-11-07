# HELIX release process

This guide covers the independent desktop, mobile, CLI, and web channels. A source version, successful workflow, public release, published installer, and deployment are separate states; verify each one before announcing availability.

## Before a release

1. Confirm the intended version in the channel's source manifest and inspect the complete diff.
2. Check that the release tag is unused and matches the channel format:
   - Desktop Normal: `vX.Y.Z`
   - Android: `mobile-vX.Y.Z`
   - CLI: npm package version and `latest` dist-tag; it does not share a GitHub release tag.
3. Run the tests and builds required by the channel, including security/dependency checks in the release workflow.
4. Confirm required signing keys, repository variables, tokens, and deployment credentials are present in their secret stores. Never put them in the repository or release notes.
5. For Desktop, verify `VITE_API_URL` is configured as the deployed HTTPS Community API base URL and that `/api/health/live` and `/api/community/` respond successfully.
6. Review migration state and prepare any user-facing release notes. Do not treat either as an automatic side effect of publishing.

For example, verify a GitHub tag/release with `git ls-remote --tags origin "refs/tags/<tag>"` and `gh release view <tag>`. Confirm package publication independently with `npm view helix-assistant-cli dist-tags`.

## Windows release credential preflight

Use the manually dispatched **Validate Windows release credentials** workflow before retrying a Windows installer release. It checks the stored `INSTALLER_REPO_TOKEN` against the private installer repository, checks the public Supabase updater endpoints configured by `VITE_SUPABASE_URL` (which depend on `GITHUB_INSTALLER_TOKEN` stored in Supabase Edge Function secrets), and verifies the Community API configured by `VITE_API_URL`. It never accepts token input or prints credential values.

Run it from the `main` branch with `publish_installer` unchecked to validate access only. To explicitly dispatch the existing `publish-windows-installer.yml` workflow for `v0.8.0` after all checks pass, select `publish_installer`. This does not create another source tag or release. The validation job has read-only repository access; only the opt-in dispatch job receives `actions: write`. A failed preflight identifies which secret store or service needs attention; configure secret values only in GitHub Actions Secrets or Supabase Edge Function Secrets.

## Desktop Normal (Electron, Windows x64)

1. Set the version in `apps/desktop/package.json`; the release workflow runs from `main`, checks a clean checkout and the previous published baseline, then creates the `vX.Y.Z` tag and GitHub source release.
2. The release workflow starts `publish-windows-installer.yml`. That workflow validates the tag against the desktop package version, builds the Windows installer, calculates SHA-256 sidecars, and publishes installer assets to the configured download distribution repository.
3. Confirm the workflow completed, the public source release exists, the installer is available through the configured download flow, and its checksum matches the downloaded file.
4. The Windows installer is not Authenticode-signed; do not describe it as signed. SmartScreen may show an unknown-publisher warning.

The public source release may contain no installer assets. A published source release alone is not evidence that a user can download the installer.

## Mobile (Android)

1. Increment `movil/pubspec.yaml` version and Android build number. The release tag must be `mobile-vX.Y.Z`, matching the version before the `+build` suffix.
2. Publish the tag to run `build-mobile.yml`. Android signing secrets are required for a release.
3. Verify `flutter analyze`, `flutter test`, all expected APK variants, the signing certificate, and a SHA-256 sidecar for each APK.
4. Confirm the public release assets and checksums. CI signing/build evidence does not establish installation or pairing on a physical device.

An Android release does not imply an iOS release or mobile availability in the website catalog.

## CLI (npm)

1. Update `apps/cli/package.json` and run the CLI build and tests.
2. Dispatch `publish-cli.yml`. It builds the package and stages an npm publication with the `latest` tag.
3. A maintainer must separately review and approve the npm stage with 2FA. The workflow completing or a package being staged does not mean it is published.
4. Verify the public version and dist-tag with `npm view helix-assistant-cli dist-tags` and `npm view helix-assistant-cli version`.

The repository source version may be ahead of npm `latest`. User documentation must report both values when they differ.

## Web and download catalog

The landing site deployment and its download/catalog data are separate from GitHub release creation. Build and inspect the landing changes, deploy them through the configured hosting process, then verify the public `/download`, `/features`, `/docs`, and `/privacy` routes. Check that each download entry points to an existing artifact with a matching checksum and that authentication behaves as intended.

Do not announce an installer as available because its source tag exists. Linux and macOS agent/relay test-matrix results do not prove that desktop installers exist for those operating systems.

## Artifacts, signatures, and checksums

- Check the exact asset names, platform, architecture, version, and release status.
- Compare SHA-256 using `Get-FileHash -Algorithm SHA256` on Windows or `sha256sum` where available.
- Verify Android APK signatures against the configured release certificate.
- State the signing status and any SmartScreen/platform warning next to the relevant download.
- Do not publish a checksum until it is calculated from the exact published artifact.

## Separate operations

Database migrations are a separate, explicitly approved operation. Validate the target database and migration ownership/history before applying one; do not infer migration success from a release workflow.

Release announcements, changelog/What's New updates, and download-catalog changes are also separate operations. Publish them only after checking which artifacts and platforms are actually available, and state exclusions and unverified behavior.

## Generated README release data

The README download/status table and model-catalog summary are generated from the repository manifests, `config/model-catalog.json`, public GitHub release metadata, and the npm registry. `npm run docs:sync` refreshes them. A daily workflow opens or updates a pull request when those values change; review the data and links before merging. `npm run docs:check` validates the committed snapshot and generated sections without making network requests.
