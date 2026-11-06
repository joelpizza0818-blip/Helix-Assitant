# Frequently Asked Questions

## What is HELIX?

HELIX is a local-first AI desktop assistant. Its agent runs on the user's
machine and can use configured models, desktop tools, skills, and opt-in MCP
servers. See [the architecture guide](docs/ARCHITECTURE.md) for component
boundaries and request flow.

## Which operating systems have official desktop installers?

Official desktop installers are currently available for Windows x64 only.
Agent and relay tests on Linux or macOS do not mean Electron or Tauri desktop
installers are available for those systems. The Android companion and Node.js
CLI are separate distribution channels; see the current [release matrix in the
README](README.md#download).

## Does HELIX work without an internet connection?

The agent and desktop tools run locally, but many setups use a remote AI
provider and other optional services. A local model endpoint can avoid sending
model requests to a cloud provider, but other configured integrations may still
require network access. Offline operation depends on the selected model,
downloaded dependencies, and enabled features; it is not guaranteed for every
installation.

## Is my data always kept on my computer?

No blanket local-only guarantee applies. Prompts and context you choose to
share, including selected screen content, may be sent to the configured AI
provider. Remote speech, account, download, and other enabled integrations may
also process data. Review the [privacy policy](https://helix-assistant.vercel.app/privacy),
[environment guide](docs/ENVIRONMENT.md), and each provider's terms before
enabling integrations.

## Does HELIX ask before taking actions?

Tool actions are governed by the configured permission policy and risk
classification. System and critical operations require confirmation; other
actions depend on the selected policy. Confirmation is not a replacement for
operating-system permissions. See [architecture and permission behavior](docs/ARCHITECTURE.md).

## Which AI models and providers can I use?

The repository includes a catalog of configured model entries. An entry does
not guarantee provider access, account eligibility, or a successful request.
Availability depends on credentials, provider service, model capabilities,
configuration, and hardware. See [the model catalog](config/model-catalog.json)
and [provider configuration](docs/ENVIRONMENT.md#provider-routing).

## How do I install the CLI?

Run it without a global installation:

```powershell
npx helix-assistant-cli@latest
```

Or install it globally:

```powershell
npm install --global helix-assistant-cli
helix
```

The package's published `latest` version may differ from the version in this
repository. Check the [npm package](https://www.npmjs.com/package/helix-assistant-cli)
for the version currently published.

## How do I build HELIX from source?

Start with the [contribution guide](CONTRIBUTING.md). It documents prerequisites,
development commands, and focused test commands. Some components require
additional platform tooling, such as Rust and Cargo for the Tauri shell or
Flutter for mobile.

## Where can I get help or report a bug?

Read [Support](SUPPORT.md), check existing reports, or open a
[GitHub issue](https://github.com/joelpizza0818-blip/Helix-Assitant/issues).
Do not include API keys, access tokens, private URLs, or unredacted logs.

## How do I report a security vulnerability?

Please do not publish vulnerability details in an issue or pull request. See
the current reporting instructions in [SECURITY.md](SECURITY.md).
