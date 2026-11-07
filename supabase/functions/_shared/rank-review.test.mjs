import assert from 'node:assert/strict'
import test from 'node:test'
import { handleRankEscalationAttempt } from './rank-review.ts'

const profileId = 'c5a5a17e-2479-4ad3-a21e-9640a6fb1947'

function makeAdmin(activeCase = null) {
  const state = { inserted: null }
  const query = {
    select() { return this },
    eq() { return this },
    in() { return this },
    order() { return this },
    limit() { return this },
    maybeSingle: async () => ({ data: activeCase, error: null }),
    insert(value) {
      state.inserted = value
      return this
    },
    single: async () => ({
      data: {
        id: 'a26bed85-6cf4-4a50-8ff1-7790b9de3e67',
        profile_id: profileId,
        incident_type: 'rank_escalation',
        attempted_rank: state.inserted.attempted_rank,
        status: 'pending',
        created_at: '2026-11-06T00:00:00.000Z',
      },
      error: null,
    }),
  }
  return {
    state,
    from(table) {
      assert.equal(table, 'github_rank_review_cases')
      return query
    },
  }
}

test('self-promotion is suspended and recorded for review', async () => {
  const admin = makeAdmin()
  const response = await handleRankEscalationAttempt(
    new Request('https://example.test/installer-admin/profiles/test/rank', {
      method: 'PUT',
      body: JSON.stringify({ rank: 'admin' }),
    }),
    `profiles/${profileId}/rank`,
    {
      profileId,
      githubUserId: '123',
      githubLogin: 'user',
      displayName: 'User',
      avatarUrl: null,
      rank: 'user',
    },
    admin,
  )

  assert.equal(response.status, 423)
  assert.equal(admin.state.inserted.profile_id, profileId)
  assert.equal(admin.state.inserted.attempted_rank, 'admin')
})

test('rank requests targeting another profile are denied without a review case', async () => {
  const admin = makeAdmin()
  const response = await handleRankEscalationAttempt(
    new Request('https://example.test/installer-admin/profiles/other/rank', {
      method: 'PUT',
      body: JSON.stringify({ rank: 'admin' }),
    }),
    'profiles/aa8a6e66-b335-4f4e-9ef7-83823a72f4d0/rank',
    {
      profileId,
      githubUserId: '123',
      githubLogin: 'user',
      displayName: 'User',
      avatarUrl: null,
      rank: 'user',
    },
    admin,
  )

  assert.equal(response.status, 403)
  assert.equal(admin.state.inserted, null)
})

test('a user with an active case remains suspended without creating duplicates', async () => {
  const activeCase = {
    id: 'a26bed85-6cf4-4a50-8ff1-7790b9de3e67',
    status: 'pending',
    profile_id: profileId,
  }
  const admin = makeAdmin(activeCase)
  const response = await handleRankEscalationAttempt(
    new Request('https://example.test/installer-admin/profiles/test/rank', {
      method: 'PUT',
      body: JSON.stringify({ rank: 'admin' }),
    }),
    `profiles/${profileId}/rank`,
    {
      profileId,
      githubUserId: '123',
      githubLogin: 'user',
      displayName: 'User',
      avatarUrl: null,
      rank: 'user',
    },
    admin,
  )

  assert.equal(response.status, 423)
  assert.equal(admin.state.inserted, null)
})
