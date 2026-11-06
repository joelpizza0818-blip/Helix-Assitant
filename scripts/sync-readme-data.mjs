import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = path.join(root, 'README.md');
const dataPath = path.join(root, 'docs', 'project-data.json');
const repository = 'joelpizza0818-blip/Helix-Assitant';
const releasesUrl = `https://github.com/${repository}/releases`;
const npmUrl = 'https://www.npmjs.com/package/helix-assistant-cli';
const downloadUrl = 'https://helix-assistant.vercel.app/download';
const markerPairs = {
  modelSummary: [
    '<!-- HELIX-DATA:model-summary:start -->',
    '<!-- HELIX-DATA:model-summary:end -->',
  ],
  downloadRows: [
    '<!-- HELIX-DATA:download-rows:start -->',
    '<!-- HELIX-DATA:download-rows:end -->',
  ],
  cliVersion: [
    '<!-- HELIX-DATA:cli-version:start -->',
    '<!-- HELIX-DATA:cli-version:end -->',
  ],
  projectStatus: [
    '<!-- HELIX-DATA:project-status:start -->',
    '<!-- HELIX-DATA:project-status:end -->',
  ],
};

function assertVersion(value, label) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\+\d+)?$/.test(value)) {
    throw new Error(`${label} must be a semantic version, received ${JSON.stringify(value)}.`);
  }
  return value;
}

async function readLocalFacts() {
  const [normalPackage, litePackage, cliPackage, mobileManifest, catalogText] =
    await Promise.all([
      readFile(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'),
      readFile(path.join(root, 'apps', 'desktop-tauri', 'package.json'), 'utf8'),
      readFile(path.join(root, 'apps', 'cli', 'package.json'), 'utf8'),
      readFile(path.join(root, 'movil', 'pubspec.yaml'), 'utf8'),
      readFile(path.join(root, 'config', 'model-catalog.json'), 'utf8'),
    ]);

  const mobileMatch = mobileManifest.match(/^version:\s*["']?([^\s"'#]+)["']?\s*$/m);
  if (!mobileMatch) throw new Error('Could not read the mobile version from movil/pubspec.yaml.');

  const normalVersion = assertVersion(JSON.parse(normalPackage).version, 'Desktop Normal version');
  const liteVersion = assertVersion(JSON.parse(litePackage).version, 'Desktop Lite version');
  const cliVersion = assertVersion(JSON.parse(cliPackage).version, 'CLI source version');
  const mobileVersion = assertVersion(mobileMatch[1], 'Mobile version');
  const catalog = JSON.parse(catalogText);
  if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
    throw new Error('config/model-catalog.json must contain a non-empty models array.');
  }

  const providerCounts = new Map();
  for (const model of catalog.models) {
    if (!model || typeof model.provider !== 'string' || !model.provider.trim()) {
      throw new Error('Every model-catalog entry must have a provider identifier.');
    }
    providerCounts.set(model.provider, (providerCounts.get(model.provider) ?? 0) + 1);
  }

  return {
    sourceVersions: {
      normal: normalVersion,
      lite: liteVersion,
      mobile: mobileVersion,
      cli: cliVersion,
    },
    modelCatalog: {
      entries: catalog.models.length,
      providers: Object.fromEntries(
        [...providerCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}

function releaseTag(version) {
  return version.split('+', 1)[0];
}

async function fetchJson(url, accept) {
  const headers = {
    accept,
    'user-agent': 'helix-readme-data-sync',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

async function readPublicData(localFacts) {
  const releases = await fetchJson(
    `https://api.github.com/repos/${repository}/releases?per_page=100`,
    'application/vnd.github+json',
  );
  if (!Array.isArray(releases)) throw new Error('GitHub releases response was not a list.');

  const registryLatest = await fetchJson(
    'https://registry.npmjs.org/helix-assistant-cli/latest',
    'application/json',
  );
  const npmVersion = assertVersion(registryLatest.version, 'npm latest version');
  const tags = {
    normal: `v${localFacts.sourceVersions.normal}`,
    lite: `lite-v${localFacts.sourceVersions.lite}`,
    mobile: `mobile-v${releaseTag(localFacts.sourceVersions.mobile)}`,
  };

  const publicReleases = Object.fromEntries(
    Object.entries(tags).map(([channel, tag]) => {
      const release = releases.find((item) => item.tag_name === tag);
      if (!release || release.draft || !release.published_at) {
        return [
          channel,
          {
            tag,
            published: false,
            prerelease: false,
            url: releasesUrl,
            assetNames: [],
          },
        ];
      }

      if (!Array.isArray(release.assets)) {
        throw new Error(`Release ${tag} has an invalid assets list.`);
      }
      if (release.assets.some((asset) => typeof asset?.name !== 'string')) {
        throw new Error(`Release ${tag} contains an asset without a name.`);
      }
      return [
        channel,
        {
          tag,
          published: true,
          prerelease: Boolean(release.prerelease),
          url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`,
          assetNames: release.assets.map((asset) => asset.name).sort(),
        },
      ];
    }),
  );

  return {
    ...localFacts,
    publicReleases,
    npm: {
      sourceVersion: localFacts.sourceVersions.cli,
      latestVersion: npmVersion,
      url: npmUrl,
    },
  };
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function releaseLink(release) {
  return `[${escapeCell(release.tag)}](${release.url})`;
}

function channelStatus(release, requiredAssets = []) {
  if (!release.published) return `Source ${release.tag}; no published public release found.`;
  if (release.prerelease) return `Pre-release ${release.tag}.`;
  const missing = requiredAssets.filter((asset) => !release.assetNames.includes(asset));
  if (missing.length > 0) {
    return `Release published; expected public asset(s) missing: ${missing.join(', ')}.`;
  }
  return '';
}

function renderDownloadRows(data) {
  const normal = data.publicReleases.normal;
  const lite = data.publicReleases.lite;
  const mobile = data.publicReleases.mobile;
  const normalHasInstaller = normal.assetNames.some((name) => /\.exe$/i.test(name));
  const normalStatus = !normal.published || normal.prerelease
    ? channelStatus(normal)
    : !normalHasInstaller
      ? 'Public release published; no installer asset is attached. Use the authenticated download page.'
      : 'Public release published with a Windows installer; verify its checksum assets.';
  const liteAssets = ['HELIX-Lite-Setup.exe', 'HELIX-Lite-Setup.exe.sha256'];
  const mobileAssets = [
    'HELIX-Mobile.apk',
    'HELIX-Mobile.apk.sha256',
    'HELIX-Mobile-armeabi-v7a.apk',
    'HELIX-Mobile-armeabi-v7a.apk.sha256',
    'HELIX-Mobile-arm64-v8a.apk',
    'HELIX-Mobile-arm64-v8a.apk.sha256',
    'HELIX-Mobile-x86_64.apk',
    'HELIX-Mobile-x86_64.apk.sha256',
  ];
  const liteStatus = channelStatus(lite, liteAssets) ||
    'Published with Windows installer and SHA-256 sidecar.';
  const mobileStatus = channelStatus(mobile, mobileAssets) ||
    'Published with four APK variants and SHA-256 sidecars.';
  const npmStatus = data.npm.latestVersion === data.npm.sourceVersion
    ? `npm latest ${data.npm.latestVersion}; source matches.`
    : `npm latest ${data.npm.latestVersion}; repository source is ${data.npm.sourceVersion}.`;

  return [
    '| Product | Platform | Public release / download | Status |',
    '|---|---|---|---|',
    `| HELIX Normal | Windows x64 | ${releaseLink(normal)} / [Download page](${downloadUrl}) | ${escapeCell(normalStatus)} |`,
    `| HELIX Lite | Windows x64 | ${releaseLink(lite)} | ${escapeCell(liteStatus)} |`,
    `| HELIX Mobile | Android APK | ${releaseLink(mobile)} | ${escapeCell(mobileStatus)} |`,
    `| HELIX CLI | Node.js / npm | [npm package](${npmUrl}) | ${escapeCell(npmStatus)} |`,
  ].join('\n');
}

function renderModelSummary(data) {
  const providers = Object.entries(data.modelCatalog.providers)
    .map(([provider, count]) => `\`${provider}\` (${count})`)
    .join(', ');
  return `The repository catalog contains **${data.modelCatalog.entries} entries** across ${Object.keys(data.modelCatalog.providers).length} provider identifiers: ${providers}. These are configured catalog entries, not a guarantee of provider access or successful live requests. See [config/model-catalog.json](config/model-catalog.json).`;
}

function renderCliVersion(data) {
  return `npm's current \`latest\` version is **${data.npm.latestVersion}**; the repository source package is **${data.npm.sourceVersion}**. The \`/subagents\` and \`/browser live\` commands require version **0.5.0 or newer**.`;
}

function renderProjectStatus(data) {
  const releaseState = (release) => {
    if (!release.published) return 'not published';
    return release.prerelease ? 'a pre-release' : 'published';
  };
  const normalHasInstaller = data.publicReleases.normal.assetNames.some((name) =>
    /\.exe$/i.test(name),
  );
  const normalStatus = normalHasInstaller
    ? releaseState(data.publicReleases.normal)
    : `${releaseState(data.publicReleases.normal)} (no installer asset on the public release)`;
  return `Normal ${data.sourceVersions.normal}: ${normalStatus}; Lite ${data.sourceVersions.lite}: ${releaseState(data.publicReleases.lite)}; Android ${releaseTag(data.sourceVersions.mobile)}: ${releaseState(data.publicReleases.mobile)}; CLI npm latest ${data.npm.latestVersion} (repository source ${data.sourceVersions.cli}).`;
}

function renderReadme(readme, data) {
  const sections = {
    modelSummary: renderModelSummary(data),
    downloadRows: renderDownloadRows(data),
    cliVersion: renderCliVersion(data),
    projectStatus: renderProjectStatus(data),
  };
  let result = readme;
  const lineEnding = readme.includes('\r\n') ? '\r\n' : '\n';
  for (const [section, content] of Object.entries(sections)) {
    const [startMarker, endMarker] = markerPairs[section];
    if (result.split(startMarker).length !== 2 || result.split(endMarker).length !== 2) {
      throw new Error(`README must contain exactly one pair of markers for ${section}.`);
    }
    const start = result.indexOf(startMarker);
    const contentStart = start + startMarker.length;
    const end = result.indexOf(endMarker, contentStart);
    if (end < 0) throw new Error(`README markers are out of order for ${section}.`);
    const formattedContent = content.replace(/\r?\n/g, lineEnding);
    result = `${result.slice(0, contentStart)}${lineEnding}${formattedContent}${lineEnding}${result.slice(end)}`;
  }
  return result;
}

function checkLocalLinks(readme) {
  const errors = [];
  const links = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of readme.matchAll(links)) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|data:)/i.test(target) || target.startsWith('#')) continue;
    const relativePath = decodeURIComponent(target.split(/[?#]/, 1)[0]);
    if (!relativePath) continue;
    const resolved = path.resolve(root, relativePath);
    if (!existsSync(resolved)) errors.push(target);
  }
  if (errors.length > 0) {
    throw new Error(`README contains missing local link target(s): ${[...new Set(errors)].join(', ')}`);
  }
}

function assertSnapshotMatchesLocal(snapshot, localFacts) {
  if (
    JSON.stringify(snapshot.sourceVersions) !== JSON.stringify(localFacts.sourceVersions) ||
    JSON.stringify(snapshot.modelCatalog) !== JSON.stringify(localFacts.modelCatalog)
  ) {
    throw new Error('Generated README data is stale against local manifests/catalog. Run npm run docs:sync.');
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const localFacts = await readLocalFacts();
  const readme = await readFile(readmePath, 'utf8');

  if (checkOnly) {
    const snapshot = JSON.parse(await readFile(dataPath, 'utf8'));
    assertSnapshotMatchesLocal(snapshot, localFacts);
    const expected = renderReadme(readme, snapshot);
    checkLocalLinks(expected);
    if (expected !== readme) {
      throw new Error('Generated README sections are stale. Run npm run docs:sync.');
    }
    console.log('README data, local links, manifests, and model catalog are in sync.');
    return;
  }

  const data = await readPublicData(localFacts);
  const updatedReadme = renderReadme(readme, data);
  checkLocalLinks(updatedReadme);
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await writeFile(readmePath, updatedReadme, 'utf8');
  console.log('Refreshed generated README data from manifests, model catalog, GitHub Releases, and npm.');
}

main().catch((error) => {
  console.error(`README data sync failed: ${error.message}`);
  process.exitCode = 1;
});
