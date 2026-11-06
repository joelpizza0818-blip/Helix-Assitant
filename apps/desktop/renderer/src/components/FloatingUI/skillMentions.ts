import type { Plugin } from 'unified'
import type { Content, Parent, Root, Strong } from 'mdast'

export interface SkillMentionSegment {
  value: string
  isSkillMention: boolean
}

export interface WorkflowMentionSegment {
  value: string
  isWorkflowMention: boolean
}

interface NamedMentionSegment {
  value: string
  isMention: boolean
}

function splitNamedMentions(
  text: string,
  names: readonly string[],
  trigger: '@' | '%',
): NamedMentionSegment[] {
  const uniqueNames = [...new Set(names.filter(Boolean))]
    .sort((left, right) => right.length - left.length)
  if (uniqueNames.length === 0) return [{ value: text, isMention: false }]

  const namesPattern = uniqueNames
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const mentionPattern = new RegExp(
    `(^|[^\\w${trigger}])(${trigger}(?:${namesPattern}))(?![\\w.-])`,
    'gi',
  )
  const segments: NamedMentionSegment[] = []
  let cursor = 0
  const appendPlainText = (value: string): void => {
    if (!value) return
    const previous = segments[segments.length - 1]
    if (previous && !previous.isMention) {
      previous.value += value
    } else {
      segments.push({ value, isMention: false })
    }
  }

  for (const match of text.matchAll(mentionPattern)) {
    const matchIndex = match.index ?? 0
    const prefix = match[1]
    const mention = match[2]
    const mentionIndex = matchIndex + prefix.length
    appendPlainText(text.slice(cursor, mentionIndex))
    segments.push({ value: mention, isMention: true })
    cursor = mentionIndex + mention.length
  }

  appendPlainText(text.slice(cursor))
  return segments.length > 0
    ? segments
    : [{ value: text, isMention: false }]
}

export function splitSkillMentions(
  text: string,
  skillNames: readonly string[],
): SkillMentionSegment[] {
  return splitNamedMentions(text, skillNames, '@').map((segment) => ({
    value: segment.value,
    isSkillMention: segment.isMention,
  }))
}

export function splitWorkflowMentions(
  text: string,
  workflowIds: readonly string[],
): WorkflowMentionSegment[] {
  return splitNamedMentions(text, workflowIds, '%').map((segment) => ({
    value: segment.value,
    isWorkflowMention: segment.isMention,
  }))
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

function createWorkflowMentionNode(value: string): Strong {
  return {
    type: 'strong',
    data: {
      hName: 'span',
      hProperties: { className: ['bubble__workflow-mention'] },
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

export function workflowMentionPlugin(
  workflowIds: readonly string[],
): Plugin<[], Root> {
  return () => (tree) => {
    transformWorkflowMentions(tree, workflowIds)
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

export function transformWorkflowMentions(
  tree: Root,
  workflowIds: readonly string[],
): void {
  const visit = (parent: Parent): void => {
    parent.children = parent.children.flatMap((node): Content[] => {
      if (node.type === 'text') {
        return splitWorkflowMentions(node.value, workflowIds).map((segment) => (
          segment.isWorkflowMention
            ? createWorkflowMentionNode(segment.value)
            : { type: 'text', value: segment.value }
        ))
      }
      if (isParent(node)) visit(node)
      return [node]
    })
  }

  visit(tree)
}
