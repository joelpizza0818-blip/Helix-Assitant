import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterMentionOptions,
  findActiveMention,
  replaceActiveMention,
  type MentionOption,
} from './mentionAutocomplete.ts'

const options: MentionOption[] = [
  { trigger: '@', name: 'coding', description: 'Code assistance' },
  { trigger: '@', name: 'meeting-notes', description: 'Meeting notes' },
  { trigger: '/', name: 'github', description: 'GitHub MCP server' },
]

test('finds only a mention token at the caret', () => {
  assert.deepEqual(findActiveMention('Please use @cod'), {
    trigger: '@',
    query: 'cod',
    start: 11,
    end: 15,
  })
  assert.equal(findActiveMention('email@domain.test'), null)
  assert.equal(findActiveMention('path/to/file'), null)
})

test('filters suggestions by mention type and query', () => {
  assert.deepEqual(
    filterMentionOptions(options, findActiveMention('Use @meet')),
    [options[1]],
  )
  assert.deepEqual(
    filterMentionOptions(options, findActiveMention('Use /')),
    [options[2]],
  )
})

test('replaces the active mention and preserves text after the caret', () => {
  const mention = findActiveMention('Use @cod now', 8)
  assert.ok(mention)
  assert.deepEqual(
    replaceActiveMention('Use @cod now', mention, options[0]),
    { value: 'Use @coding now', caretPosition: 11 },
  )
  const unfinishedMention = findActiveMention('Use @cod')
  assert.ok(unfinishedMention)
  assert.deepEqual(
    replaceActiveMention('Use @cod', unfinishedMention, options[0]),
    { value: 'Use @coding ', caretPosition: 12 },
  )
})
