import test from 'node:test'
import assert from 'node:assert/strict'
import { safeSummaryText, toggleSummaryExpanded } from './taskExecutionSummary.ts'
import { getTaskProgressMessage } from './taskProgressMessage.ts'

test('safe summary text redacts named secrets and truncates payloads', () => {
  const summary = safeSummaryText('authorization: bearer super-secret sk-private-value')
  assert.equal(summary.includes('super-secret'), false)
  assert.equal(summary.includes('sk-private-value'), false)
  assert.equal(safeSummaryText('x'.repeat(20), 10).length, 10)
})

test('summary expansion toggles between collapsed and expanded states', () => {
  assert.equal(toggleSummaryExpanded(false), true)
  assert.equal(toggleSummaryExpanded(true), false)
})

test('task progress messages describe waiting, approval, pause, and retry states', () => {
  const task = {
    status: 'running',
    started_at: '2026-11-05T12:00:00.000Z',
    execution_summary: { progress_label: 'Thinking…' },
  } as Parameters<typeof getTaskProgressMessage>[0]

  assert.equal(getTaskProgressMessage({ ...task!, status: 'queued' }), 'Waiting in queue…')
  assert.equal(
    getTaskProgressMessage({ ...task!, status: 'waiting_confirmation' }),
    'Waiting for your approval…',
  )
  assert.equal(
    getTaskProgressMessage({ ...task!, status: 'paused' }),
    'Paused — waiting for you to resume…',
  )
  assert.equal(getTaskProgressMessage({ ...task!, status: 'retrying' }), 'Retrying safely…')
})

test('long-running tasks show an apology, a lighthearted update, then actionable guidance', () => {
  const startedAt = Date.parse('2026-11-05T12:00:00.000Z')
  const task = {
    status: 'running',
    started_at: new Date(startedAt).toISOString(),
    execution_summary: { progress_label: 'Thinking…' },
  } as Parameters<typeof getTaskProgressMessage>[0]

  assert.equal(getTaskProgressMessage(task, startedAt + 29_999), 'Thinking…')
  assert.equal(
    getTaskProgressMessage(task, startedAt + 30_000),
    'This is taking longer than expected; we’re sorry :(',
  )
  assert.equal(
    getTaskProgressMessage(task, startedAt + 90_000),
    'Still working — so looooong…',
  )
  assert.equal(
    getTaskProgressMessage(task, startedAt + 180_000),
    'This is a complex task. HELIX is still working; check the task details for its current step.',
  )
})
