# Contributing to HELIX

Thanks for helping improve HELIX. Keep changes focused, preserve existing contracts, and report only results you verified.

## Contribution workflow

1. **Read project context.** Consult the relevant Helix-vault notes, starting with `00 - Contexto/Helix.md` and `00 - Contexto/Estado actual.md`, then the notes for the affected component. If the vault is unavailable, state that limitation rather than assuming its contents.
2. **Inspect the implementation.** Trace the contract, its callers/consumers, related tests, and CI or release workflows before editing.
3. **Make the smallest safe change.** Preserve existing behavior and interfaces unless the change explicitly requires a documented contract update.
4. **Run the relevant checks.** Use the focused checks for the affected surface and the repository-wide suite when practical. Record the exact command and outcome.
5. **Review the diff.** Check UTF-8/encoding, accidental secrets, generated files, dependency changes, and database migrations. Do not apply a migration or publish a release as part of routine development.
6. **Update documentation.** Keep user guidance, architecture notes, environment references, and release information aligned with verified behavior.
7. **Open a pull request.** Explain the problem, the change, tests and other evidence, platform/provider conditions, and known limits. Separate verified results from assumptions or untested behavior.
8. **Close work only with evidence.** Do not mark a feature or task complete based solely on code being present; include the test, build, installation, hardware, or service evidence that supports the status.

Use the repository's existing conventions and keep changes respectful and reviewable. Report security vulnerabilities privately to the maintainers rather than opening a public issue.

## Test and validation commands

Run commands from the repository root unless a working directory is shown. Install dependencies with `npm ci` first for JavaScript workspaces.

### Repository-wide and agent

```powershell
npm test
npm run lint:encoding
npm run models:check
npm run docs:check
npm run test:agent
npm run test:docker
```

`npm test` checks encoding, generated model catalogs, generated README data, workspace tests, and the Python agent suite. Build the image before `test:docker` if it is not already available:

```powershell
docker build -f Dockerfile.test-linux -t helix-test-linux .
```

`test:docker` also requires Docker.

### JavaScript workspaces

```powershell
npm run build --workspace=helix-assistant-cli
npm test --workspace=helix-assistant-cli
npm test --workspace=@helix/desktop
npm run typecheck --workspace=@helix/desktop
npm test --workspace=@helix/relay-worker
npm run typecheck --workspace=@helix/relay-worker
npm test --workspace=@helix/server
npm run typecheck --workspace=@helix/server
```

The CLI test command expects its TypeScript build first. The root `npm test` runs the workspace test scripts where present.

### Mobile (Flutter)

```powershell
Push-Location movil
flutter pub get
flutter analyze
flutter test
Pop-Location
```

The CI multiplatform matrix also runs `python -m pytest services/agent/tests/ services/relay/tests/ -v --tb=short` on Windows and macOS, and runs the same suites in Docker with Xvfb on Linux.

### Optional load test

```powershell
npm run test:k6
```

`test:k6` requires k6 and a reachable landing preview. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for environment setup and [docs/PROJECT_FLOW.md](docs/PROJECT_FLOW.md) for the development and evidence flow.
