import test from 'node:test'
import assert from 'node:assert/strict'
import type { Root } from 'mdast'
import {
  splitSkillMentions,
  transformSkillMentions,
} from './skillMentions'

test('highlights only exact registered skill mentions', () => {
  assert.deepEqual(
    splitSkillMentions(
      'Use @coding, not @unknown or email@coding.test.',
      ['coding'],
    ),
    [
      { value: 'Use ', isSkillMention: false },
      { value: '@coding', isSkillMention: true },
      { value: ', not @unknown or email@coding.test.', isSkillMention: false },
    ],
  )
})

test('matches skill names case-insensitively and prefers the longest name', () => {
  assert.deepEqual(
    splitSkillMentions('@CODING and @coding-tools', ['coding', 'coding-tools']),
    [
      { value: '@CODING', isSkillMention: true },
      { value: ' and ', isSkillMention: false },
      { value: '@coding-tools', isSkillMention: true },
    ],
  )
})

test('does not highlight skill-name prefixes or embedded mentions', () => {
  assert.deepEqual(
    splitSkillMentions('x@coding @coding.extra @coding-tools', ['coding']),
    [{ value: 'x@coding @coding.extra @coding-tools', isSkillMention: false }],
  )
})

test('leaves all text unchanged when there are no registered skills', () => {
  assert.deepEqual(
    splitSkillMentions('Use @coding', []),
    [{ value: 'Use @coding', isSkillMention: false }],
  )
})

test('markdown plugin marks skill mentions without rewriting inline code', async () => {
  const tree: Root = {
    type: 'root',
    children: [{
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Use @coding, but not ' },
        { type: 'inlineCode', value: '@coding' },
      ],
    }],
  }
  transformSkillMentions(tree, ['coding'])

  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  if (paragraph.type !== 'paragraph') return

  const mention = paragraph.children[1]
  assert.equal(mention.type, 'strong')
  if (mention.type !== 'strong') return
  assert.equal(mention.data?.hName, 'span')
  assert.deepEqual(mention.data?.hProperties?.className, ['bubble__skill-mention'])
  assert.deepEqual(paragraph.children[3], { type: 'inlineCode', value: '@coding' })
})
