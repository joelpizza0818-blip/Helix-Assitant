import type {
  ModelInputSummary,
  TaskDefinition,
  TaskExecutionSummary,
  TaskResultSummary,
  TaskToolCallSummary,
} from '../../types/global'

const SECRET_VALUE = /\b(?:bearer\s+|sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\S*/gi
const NAMED_SECRET = /(\b(?:api[_-]?key|authorization|password|secret|token|credential)\b\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi

export function safeSummaryText(value: unknown, limit = 240): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    .replace(NAMED_SECRET, '$1[REDACTED]')
    .replace(SECRET_VALUE, '[REDACTED]')
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export function toggleSummaryExpanded(expanded: boolean): boolean {
  return !expanded
}

const emptyInput: ModelInputSummary = {
  message_count: 0,
  roles: [],
  character_count: 0,
  image_count: 0,
  context_labels: [],
}

export function getExecutionSummary(task: TaskDefinition): TaskExecutionSummary {
  const summary = task.execution_summary
  if (summary) return summary
  return {
    model_input: emptyInput,
    context: { labels: [], item_count: 0 },
    steps: [],
    tool_calls: [],
    progress_label: task.status,
    result: null,
  }
}

export function safeInputSummary(input?: Partial<ModelInputSummary>): ModelInputSummary {
  return {
    message_count: input?.message_count ?? 0,
    roles: input?.roles ?? [],
    character_count: input?.character_count ?? 0,
    image_count: input?.image_count ?? 0,
    context_labels: input?.context_labels ?? [],
  }
}

export function safeToolCall(call: TaskToolCallSummary): TaskToolCallSummary {
  return {
    tool: safeSummaryText(call.tool, 100),
    status: call.status === 'succeeded' ? 'succeeded' : 'failed',
    result_summary: safeSummaryText(call.result_summary),
  }
}

export function safeResult(result: TaskResultSummary | null): TaskResultSummary | null {
  if (!result) return null
  return { status: safeSummaryText(result.status, 40), summary: safeSummaryText(result.summary) }
}
