# README audit

Audit scope: the user-facing root README, linked repository documentation, landing media, live performance evidence, and GitHub repository presentation/release metadata. Updated against the current source tree and public GitHub/npm metadata on 2026-11-05. No application behavior was changed.

## Findings and changes

| Priority | Finding | Correction |
|---|---|---|
| P1 | The README asserted 637+ passing tests and component totals as current, without a reproducible result tied to this checkout. | Removed static test counts. Added live badges for the desktop/landing quality workflow and agent/relay matrix; these show workflow status, not a count or proof of a release build. |
| P1 | The README described 0.964 microseconds key failover, 99.9% compression, 115-byte packed output, sub-millisecond retrieval, 115 landing modules, and a 14.85-second build without a reproducible benchmark/report in the repository. | Removed these figures. The source contains a gzip-backed context store and retrieval implementation, but those previous timing/size claims are not reproduced by a checked-in benchmark. |
| P1 | “54 models supported” implied provider availability and verification. | Replaced it with an automatically generated inventory of entries and provider identifiers from `config/model-catalog.json`, explicitly labeled as catalog data—not tested compatibility or account access. |
| P1 | README's release matrix did not distinguish source release publication from installer availability. | Made release rows generated from GitHub release assets and npm registry metadata. Current Normal public release `v0.7.0` has no assets; the authenticated download flow is separate. Lite `lite-v0.7.0` has an installer and SHA-256 sidecar. Android `mobile-v0.7.0` has four APK variants and SHA-256 sidecars. |
| P1 | The README said the CLI was `0.7.0` while npm's `latest` was older. The old user-provided note (`0.2.14` pending `0.5.0`) no longer matches the public registry. | The source package is `0.7.0`; npm currently reports `latest=0.6.1`. The generated README shows both values and the feature-version requirement. |
| P1 | “Complete privacy,” “never broadcast,” and “zero silent privileges” wording overstated local-only handling and confirmation guarantees. | Replaced with scoped descriptions of risk tiers, confirmation, provider-bound prompts/screen context, optional remote services, and the linked privacy policy. |
| P1 | The landing page showed seven video demonstrations that were absent from the README. | Added linked previews for all four desktop and three CLI clips with production playback URLs; the README does not display video file sizes. |
| P1 | The README had no measured performance data for the deployed landing page. | Added dated k6 production-endpoint measurements and a single real-browser navigation: 48 HTTP requests, 110 ms median / 276 ms p95 / 712 ms max, zero failed requests, 611,433 bytes of critical HTML/JS/CSS, and 148,721,412 bytes across published video/image assets; browser FCP was 2,076 ms. The anomalous 31,503 ms browser load event is disclosed, not attributed. None of these are real-user telemetry. |
| P1 | GitHub About had no description and the repository had no topics, although the homepage URL was correct. | Set a concise Windows desktop-agent description and relevant topics; the homepage remains `https://helix-assistant.vercel.app`. |
| P2 | The repository slug `Helix-Assitant` appears to misspell “Assistant.” | Flagged for owner confirmation; no rename was attempted because it can affect existing links and integrations. |
| P2 | `npm run models:check` reported both generated catalogs stale on this Windows checkout even though their model content matched `config/model-catalog.json`. | Updated the catalog check to normalize CRLF/LF for comparison and to rethrow file errors other than a missing generated file. This changes validation only, not generated model data. |
| P2 | The README referenced `LICENSE`, but no `LICENSE` file existed in the audited checkout, so its MIT badge/text had no repository license file to support it. | The repository owner subsequently selected MIT; added the MIT license, restored the README badge, and linked the license text. |
| P2 | Screenshots existed, but showed a capabilities answer and masked key-slot UI rather than a verified end-to-end user task. | Removed them from the README and left a TODO for a current, real screenshot or GIF. The image files themselves were not deleted. |
| P2 | Contributor/release instructions were mixed into the user README, and install warnings and limitations were repeated. | Moved contributor and channel-release procedures to dedicated documents and consolidated user warnings. |
| P2 | The audited GitHub Community Profile lacked a license, code of conduct, issue template, and pull-request template. | Added the confirmed MIT license, FAQ, support guidance, and security policy. Code of conduct and issue/PR templates remain outside this documentation update. |

## Version and publication evidence

| Channel | Source version | Public status observed |
|---|---:|---|
| Desktop Normal | `0.7.0` | GitHub release `v0.7.0` is published; its public release has no assets. The installer uses a separate authenticated distribution flow. |
| Desktop Lite | `0.7.0` | `lite-v0.7.0` is published with `HELIX-Lite-Setup.exe` and its `.sha256` sidecar. |
| Android | `0.7.0+9` | `mobile-v0.7.0` is published with universal and three ABI APKs and SHA-256 sidecars. |
| CLI | `0.7.0` | npm registry reports `helix-assistant-cli@0.6.1` as `latest`; repository source is ahead. |

The release tags and asset names were read from the public GitHub Releases API/CLI, and the CLI version from the npm registry. This does not verify installation on a user's machine, website catalog selection, or live provider/model behavior.

The repository still uses `main` as its default branch; Issues and Wiki are enabled, Discussions are disabled, and the observed public count was 3 stars / 0 forks. These settings were not changed. The Wiki contents and GitHub social-preview image were not independently verified.

## Metric register

| Metric or claim | Source / method | Verification status |
|---|---|---|
| CI status | Live GitHub Actions badges for `test-quality.yml` and `test-multiplatform.yml` | Dynamic workflow status; not a test count, coverage measure, or installer test |
| Landing production response time | k6 against `https://helix-assistant.vercel.app/`, 2 VUs / 10 seconds / 12 iterations / 48 HTTP requests, 2026-11-05 UTC | Median 110 ms, p95 276 ms, max 712 ms; 0/48 failed. Synthetic single-location measurement, not real-user telemetry. |
| Landing browser navigation | One integrated-browser navigation to production on 2026-11-05 | DOMContentLoaded 1,878 ms; FCP 2,076 ms; load event 31,503 ms; LCP unavailable. Resource timing showed no individual resource over 1,165 ms, so the long load event's cause is unconfirmed and should be independently reproduced. |
| Browser-recorded resource transfer | `PerformanceResourceTiming` transfer sizes during that navigation | 714,464 bytes; single browser run, not an aggregate or field metric. |
| Landing critical page weight | Sum of production HTML, JavaScript, and CSS response bodies in the same k6 run | 611,433 bytes (597 KiB); excludes media files. |
| Published landing media size | Production `Content-Length` for seven MP4s, their posters, and two card images | 148,721,412 bytes (141.9 MiB) in total. Not the initial page transfer. |
| Model-catalog entries and provider IDs | Generated from `config/model-catalog.json` | Verified as registered catalog entries; provider access and successful requests are not verified |
| Channel versions and release assets | Generated from package manifests, Flutter `pubspec.yaml`, public GitHub release metadata, and npm registry metadata | Versions and public asset presence verified at refresh time; not runtime validation |
| Test totals | No stable, current, commit-tied report was used for the previous README totals | Not reported |
| Key failover latency | No matching reproducible benchmark with environment, iterations, and measurement method was found in the searched source/scripts/tests | Not reported |
| CCL compression/retrieval timings or byte reduction | `services/agent/core/context_compression.py` stores gzip-compressed content and compact references; retrieval decompresses the original from session storage or disk spill | Mechanism verified from source; previous exact-size and timing claims are not |
| Landing module count/build time | No reproducible build report tied to the previous numbers was found | Not reported |

The CCL's packed representation is a reference/summary placed in model context; the original is retained in compressed session storage. The source uses a 5 MiB disk-spill threshold when disk spill is enabled. This is not equivalent to reducing the original to the reference's byte count or proving a fixed token/storage saving.

## Links and media

- The architecture, environment, project-flow, contributing, and release documents linked by the new README exist in the repository.
- Landing routes for `/features`, `/download`, `/docs`, and `/privacy` exist in `apps/landing/src/App.tsx`; route existence does not substitute for an external uptime check.
- The seven production video URLs and their poster thumbnails were confirmed to return HTTP 200 on 2026-11-05. The README links to the current deployed media assets; their hashed URLs can change when those videos are replaced.
- Both previous README image files exist. The README no longer presents them as a current end-to-end demonstration.
- The former `LICENSE` link was broken in this checkout because the file is absent. The new README does not link to a nonexistent license.
- No private installer-repository link is included in the README.

## Code and tooling issues

No application behavior defect was confirmed. A Windows line-ending issue in `scripts/generate-model-catalog.mjs` was fixed as described above; the model entries themselves matched the source catalog. Several old README statements were unsupported or broader than the evidence; those were documentation issues, not proof that corresponding application code was defective.

## Verification limits and follow-up

- The full application test suites were not run for this documentation change. The workflow badges are live links and do not claim a locally executed test result.
- `npm run models:check` initially failed because generated working files used CRLF while the generator expected LF. The comparison was corrected; the command was rerun afterward.
- Public release metadata confirms assets are attached, but this audit did not download and install them. Checksums/signature status are based on the published sidecars and release workflows.
- No benchmark was run for key failover, CCL timings, or desktop runtime CPU/memory. No real-user performance telemetry was found; the browser and k6 observations are single-location measurements, and the long browser load event needs independent reproduction.
- The GitHub social-preview image was not confirmed; the About description, homepage, topics, README, badges, release-tag conventions, and community-profile files were reviewed.
- Pending TODOs: add a verified current screenshot/GIF under `docs/assets/`; add a `LICENSE` file after confirming the intended license.
- The scheduled documentation workflow proposes generated changes through a pull request; it does not merge them automatically.
