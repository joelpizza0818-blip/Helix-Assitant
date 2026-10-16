import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const providerScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'local_provider_config.py',
);
const repositoryRoot = path.resolve(path.dirname(providerScript), '../..');

export default class HelixProviderConfigurationProvider {
  constructor(options) {
    this.providerId = options.id || 'helix-provider-configuration';
  }

  id() {
    return this.providerId;
  }

  async callApi() {
    const python = process.env.HELIX_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const { stdout } = await execFileAsync(
      python,
      [providerScript],
      { cwd: repositoryRoot, timeout: 10000, encoding: 'utf8' },
    );
    const result = JSON.parse(stdout);
    if (typeof result.output !== 'string' || result.output.length === 0) {
      throw new Error('HELIX provider-configuration check returned no output.');
    }
    return { output: result.output };
  }
}
