mport type { Plugin } from 'unified'
import type { Content, Parent, Root, Strong } from 'mdast'

export interface SkillMentionSegment {
  value: string
  isSkillMention: boolean
}

export function splitSkillMentions(
  text: string,
  skillNames: readonly string[],
): SkillMentionSegment[] {
  const names = [...new Set(skillNames.filter(Boolean))]
    .sort((left, right) => right.length - left.length)
  if (names.length === 0) return [{ value: text, isSkillMention: false }]

  const namesPattern = names
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const mentionPattern = new RegExp(
    `(^|[^\\w@])(@(?:${namesPattern}))(?![\\w.-])`,
    'gi',
  )
  const segments: SkillMentionSegment[] = []
  let cursor = 0
  const appendPlainText = (value: string): void => {
    if (!value) return
    const previous = segments[segments.length - 1]
    if (previous && !previous.isSkillMention) {
      previous.value += value
    } else {
      segments.push({ value, isSkillMention: false })
    }
  }

  for (const match of text.matchAll(mentionPattern)) {
    const matchIndex = match.index ?? 0
    const prefix = match[1]
    const mention = match[2]
    const mentionIndex = matchIndex + prefix.length
    appendPlainText(text.slice(cursor, mentionIndex))
    segments.push({ value: mention, isSkillMention: true })
    cursor = mentionIndex + mention.length
  }

  appendPlainText(text.slice(cursor))
  return segments.length > 0
    ? segments
    : [{ value: text, isSkillMention: false }]
}

function isParent(node: Content): node is Content & Parent {
  return 'children' in node
}

function createSkillMentionNode(value: string): Strong {
  return {
    type: 'strong',
    data: {
      hName: 'span',
      hProperties: { className: ['bubble__skill-mention'] },
    },
    children: [{ type: 'text', value }],
  }
}

export function skillMentionPlugin(
  skillNames: readonly string[],
): Plugin<[], Root> {
  return () => (tree) => {
    transformSkillMentions(tree, skillNames)
  }
}

export function transformSkillMentions(
  tree: Root,
  skillNames: readonly string[],
): void {
  const visit = (parent: Parent): void => {
    parent.children = parent.children.flatMap((node): Content[] => {
      if (node.type === 'text') {
        return splitSkillMentions(node.value, skillNames).map((segment) => (
          segment.isSkillMention
            ? createSkillMentionNode(segment.value)
            : { type: 'text', value: segment.value }
        ))
      }
      if (isParent(node)) visit(node)
      return [node]
    })
  }

  visit(tree)
}
