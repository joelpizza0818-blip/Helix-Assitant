import { canLinkGithubProfileByLogin } from '../_shared/profile-link.ts'

Deno.test('profile login linking preserves only verified role ownership', () => {
  const cases = [
    {
      label: 'same immutable GitHub ID',
      profile: { github_user_id: '123', rank: 'master-admin' as const },
      incomingId: '123',
      expected: true,
    },
    {
      label: 'legacy unlinked ordinary user',
      profile: { github_user_id: null, rank: 'user' as const },
      incomingId: '123',
      expected: true,
    },
    {
      label: 'unlinked privileged profile',
      profile: { github_user_id: null, rank: 'admin' as const },
      incomingId: '123',
      expected: false,
    },
    {
      label: 'different immutable GitHub ID',
      profile: { github_user_id: '456', rank: 'user' as const },
      incomingId: '123',
      expected: false,
    },
  ]

  for (const testCase of cases) {
    const actual = canLinkGithubProfileByLogin(testCase.profile, testCase.incomingId)
    if (actual !== testCase.expected) {
      throw new Error(`Unexpected profile-link decision for ${testCase.label}.`)
    }
  }
})
