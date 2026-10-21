import test from 'node:test'
import assert from 'node:assert/strict'
import { safeSummaryText, toggleSummaryExpanded } from './taskExecutionSummary.ts'

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
