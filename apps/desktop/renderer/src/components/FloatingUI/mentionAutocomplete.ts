export interface ActiveMention {
  trigger: '@' | '/'
  query: string
  start: number
  end: number
}

export interface MentionOption {
  trigger: '@' | '/'
  name: string
  description: string
}

export function findActiveMention(
  value: string,
  caretPosition = value.length,
): ActiveMention | null {
  const beforeCaret = value.slice(0, caretPosition)
  const match = /(^|\s)([@/])([A-Za-z0-9_.-]*)$/.exec(beforeCaret)
  if (!match) return null

  const start = beforeCaret.length - match[0].length + match[1].length
  return {
    trigger: match[2] as ActiveMention['trigger'],
    query: match[3],
    start,
    end: caretPosition,
  }
}

export function filterMentionOptions(
  options: MentionOption[],
  mention: ActiveMention | null,
): MentionOption[] {
  if (!mention) return []
  const query = mention.query.toLocaleLowerCase()
  return options.filter((option) => (
    option.trigger === mention.trigger
    && option.name.toLocaleLowerCase().includes(query)
  ))
}

export function replaceActiveMention(
  value: string,
  mention: ActiveMention,
  option: MentionOption,
): { value: string; caretPosition: number } {
  const suffix = value.slice(mention.end)
  const token = `${option.trigger}${option.name}`
  const spacing = suffix.startsWith(' ') ? '' : ' '
  const replacement = `${token}${spacing}`
  return {
    value: `${value.slice(0, mention.start)}${replacement}${suffix}`,
    caretPosition: mention.start + replacement.length,
  }
}
