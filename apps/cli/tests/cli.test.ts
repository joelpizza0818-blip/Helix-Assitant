mport test from 'node:test';
import assert from 'node:assert/strict';
import { Autocompleter, SLASH_COMMANDS } from '../src/ui/autocomplete';
import { formatSkill, formatMcp, highlightMentions, ORANGE } from '../src/ui/colors';
import { getAsciiLogo, getStatusBar, getVoiceIndicator } from '../src/ui/banner';

test('Autocompleter suggests slash commands', () => {
  const completer = new Autocompleter();

  // Test slash prefix
  const [completions] = completer.completer('/');
  assert.ok(completions.includes('/create-skill'));
  assert.ok(completions.includes('/skill'));
  assert.ok(completions.includes('/mcp'));
  assert.ok(completions.includes('/create-mcp'));
  assert.ok(completions.includes('/browser'));
  assert.ok(completions.includes('/config-apikey'));
  assert.ok(completions.includes('/show-apikey'));
  assert.ok(completions.includes('/microphone'));
  assert.ok(completions.includes('/help'));
  assert.ok(completions.includes('/tasks'));
  assert.ok(completions.includes('/models'));
  assert.ok(completions.includes('/status'));
  assert.ok(completions.includes('/clear'));
});

test('Autocompleter filters slash commands by prefix', () => {
  const completer = new Autocompleter();

  const [createMatches] = completer.completer('/create');
  assert.ok(createMatches.includes('/create-skill'));
  assert.ok(createMatches.includes('/create-mcp'));
  assert.ok(!createMatches.includes('/microphone'));

  const [micMatches] = completer.completer('/micro');
  assert.deepEqual(micMatches, ['/microphone']);
});

test('Autocompleter handles microphone sub-arguments', () => {
  const completer = new Autocompleter();

  const [micArgs] = completer.completer('/microphone ');
  assert.ok(micArgs.includes('/microphone enable'));
  assert.ok(micArgs.includes('/microphone disable'));
});

test('Autocompleter handles @skills and #mcps autocompletion', () => {
  const completer = new Autocompleter();
  // Inject mock skills and mcp tools
  (completer as any).skills = ['web-search', 'code-reviewer', 'email-assistant'];
  (completer as any).mcpTools = ['filesystem_read_file', 'github_create_issue'];

  // Test @ prefix
  const [atMatches] = completer.completer('@');
  assert.ok(atMatches.some((m: string) => m.includes('@web-search')));
  assert.ok(atMatches.some((m: string) => m.includes('@code-reviewer')));

  // Test @ partial query
  const [codeMatches] = completer.completer('Please run @code');
  assert.ok(codeMatches.some((m: string) => m.includes('@code-reviewer')));

  // Test # prefix
  const [hashMatches] = completer.completer('#');
  assert.ok(hashMatches.some((m: string) => m.includes('#filesystem_read_file')));

  // Test /skill sub-command
  const [skillSub] = completer.completer('/skill web');
  assert.deepEqual(skillSub, ['/skill web-search']);
});

test('Colors: formatSkill applies strong orange formatting', () => {
  const formatted = formatSkill('web-researcher');
  assert.ok(formatted.includes('@web-researcher'));
  // Verify it contains ANSI color escape sequence
  assert.ok(formatted.includes('\u001b['));
});

test('Colors: highlightMentions formats @skills and #mcps', () => {
  const input = 'Use @summarize and #filesystem_read to check this report';
  const highlighted = highlightMentions(input, ['summarize']);

  assert.ok(highlighted.includes('@summarize'));
  assert.ok(highlighted.includes('#filesystem_read'));
  assert.ok(highlighted.includes('\u001b['));
});

test('Banner: getAsciiLogo contains HELIX art', () => {
  const logo = getAsciiLogo();
  assert.ok(logo.length > 20);
  assert.ok(logo.includes('â–ˆ') || logo.includes('ELIX'));
});

test('Banner: getStatusBar reflects connection and mic state', () => {
  const statusActive = getStatusBar({
    connected: true,
    wsUrl: 'ws://127.0.0.1:8765',
    voiceEnabled: true,
    isCapturingVoice: false,
    currentModel: 'gpt-4o',
    activeTasksCount: 0,
  });

  assert.ok(statusActive.includes('CONECTADO'));
  assert.ok(statusActive.includes('hey helix'));
  assert.ok(statusActive.includes('gpt-4o'));

  const statusInactive = getStatusBar({
    connected: false,
    wsUrl: 'ws://127.0.0.1:8765',
    voiceEnabled: false,
    isCapturingVoice: false,
  });

  assert.ok(statusInactive.includes('DESCONECTADO'));
  assert.ok(statusInactive.includes('Mic Off'));

  const statusCapturing = getStatusBar({
    connected: true,
    wsUrl: 'ws://127.0.0.1:8765',
    voiceEnabled: true,
    isCapturingVoice: true,
  });

  assert.ok(statusCapturing.includes('CAPTURANDO'));
});

test('Banner: getVoiceIndicator outputs proper badge', () => {
  assert.ok(getVoiceIndicator(true, true).includes('HEY HELIX'));
  assert.ok(getVoiceIndicator(false, true).includes('Mic Activo'));
  assert.ok(getVoiceIndicator(false, false).includes('Mic Inactivo'));
});

test('Launcher: probePort resolves false on closed random port', async () => {
  const { probePort, isAgentStarting, findPythonExecutable } = await import('../src/client/agent-launcher');
  // Port 59123 should be closed
  const isListening = await probePort(59123, '127.0.0.1', 200);
  assert.equal(isListening, false);
  assert.equal(isAgentStarting(), false);
  const pythonExec = findPythonExecutable(process.cwd());
  assert.ok(pythonExec.length > 0);
});
