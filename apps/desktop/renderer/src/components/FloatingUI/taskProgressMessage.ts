import type { TaskDefinition } from '../../types/global'

const LONG_TASK_NOTICE_MS = 30_000
const VERY_LONG_TASK_NOTICE_MS = 90_000
const EXTENDED_TASK_NOTICE_MS = 180_000

export function getTaskProgressMessage(
  task: TaskDefinition | null | undefined,
  now = Date.now(),
): string {
  if (!task) return 'Thinking…'

  if (task.status === 'queued') return 'Waiting in queue…'
  if (task.status === 'waiting_confirmation') return 'Waiting for your approval…'
  if (task.status === 'paused') return 'Paused — waiting for you to resume…'
  if (task.status === 'retrying') return 'Retrying safely…'

  const label = task.execution_summary.progress_label || 'Thinking…'
  if (task.status !== 'running' || !task.started_at) return label

  const startedAt = Date.parse(task.started_at)
  if (!Number.isFinite(startedAt)) return label
  const elapsed = Math.max(0, now - startedAt)

  if (elapsed >= EXTENDED_TASK_NOTICE_MS) {
    return 'This is a complex task. HELIX is still working; check the task details for its current step.'
  }
  if (elapsed >= VERY_LONG_TASK_NOTICE_MS) return 'Still working — so looooong…'
  if (elapsed >= LONG_TASK_NOTICE_MS) {
    return 'This is taking longer than expected; we’re sorry :('
  }
  return label
}
