import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCommunityModerator,
  parseCommunitySubmission,
} from '../src/routes/communityValidation';

test('Community plugin submissions accept secure declarative URLs only', () => {
  const parsed = parseCommunitySubmission({
    type: 'plugin',
    name: 'Calendar',
    description: 'Open the user-selected calendar site in the HELIX browser tab.',
    manifest: { url: 'https://calendar.example.com/' },
  });

  assert.equal(parsed?.type, 'plugin');
  assert.equal(
    parseCommunitySubmission({
      type: 'plugin',
      name: 'Unsafe',
      description: 'Try to open an unsafe URL in a browser.',
      manifest: { url: 'javascript:alert(1)' },
    }),
    null,
  );
  assert.equal(
    parseCommunitySubmission({
      type: 'plugin',
      name: 'Credential URL',
      description: 'Try to open a URL with embedded credentials.',
      manifest: { url: 'https://user:password@example.com/' },
    }),
    null,
  );
});

test('Community skill submissions reject executable or unknown manifest fields', () => {
  const base = {
    type: 'skill',
    name: 'Meeting notes',
    description: 'Turn approved meeting notes into a concise action list.',
    manifest: {
      triggers: ['summarize meeting notes'],
      tools: [],
      instructions: 'Extract decisions, owners, and due dates from the provided notes.',
    },
  };
  assert.equal(parseCommunitySubmission(base)?.type, 'skill');
  assert.equal(
    parseCommunitySubmission({
      ...base,
      manifest: { ...base.manifest, javascript: 'run arbitrary code' },
    }),
    null,
  );
});

test('Community agent submissions accept a bounded declarative profile only', () => {
  const submission = {
    type: 'agent',
    name: 'Release reviewer',
    description: 'Checks release plans, builds, and publication evidence.',
    manifest: {
      role: 'analysis',
      capabilities: ['release-review', 'verification'],
      color: '#ee6018',
      instructions: 'Verify evidence and report unverified platform claims.',
    },
  };
  assert.equal(parseCommunitySubmission(submission)?.type, 'agent');
  assert.equal(
    parseCommunitySubmission({
      ...submission,
      manifest: { ...submission.manifest, model_route: { provider: 'google', key_slot: 0 } },
    }),
    null,
  );
  assert.equal(
    parseCommunitySubmission({
      ...submission,
      manifest: { ...submission.manifest, script: 'arbitrary code' },
    }),
    null,
  );
  assert.equal(
    parseCommunitySubmission({ ...submission, name: 'A'.repeat(41) }),
    null,
  );
});

test('Community moderation is deny-by-default and uses a case-insensitive allowlist', () => {
  assert.equal(isCommunityModerator('reviewer@example.com', ''), false);
  assert.equal(
    isCommunityModerator('Reviewer@Example.com', 'other@example.com, reviewer@example.com'),
    true,
  );
});
