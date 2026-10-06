export const CAPABILITIES = {
  TEXT: 'text',
  VISION: 'vision',
  AUDIO: 'audio',
  REALTIME: 'realtime',
  TOOL_CALLING: 'tool_calling',
  FUNCTION_CALLING: 'function_calling',
  STRUCTURED_OUTPUT: 'structured_output',
  COMPUTER_USE: 'computer_use',
  BROWSER_USE: 'browser_use',
  CODING: 'coding',
  REASONING: 'reasoning',
  STREAMING: 'streaming',
  SPEECH_TO_TEXT: 'speech_to_text',
  TEXT_TO_SPEECH: 'text_to_speech',
  LOW_LATENCY: 'low_latency',
  LONG_CONTEXT: 'long_context'
} as const;

export const ERROR_CODES = {
  AUTH_ERROR: 'AUTH_ERROR',
  RATE_LIMIT: 'RATE_LIMIT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TIMEOUT: 'TIMEOUT',
  TEMPORARY_PROVIDER_ERROR: 'TEMPORARY_PROVIDER_ERROR',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  CONTENT_POLICY: 'CONTENT_POLICY',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN: 'UNKNOWN'
} as const;

export const PERMISSION_LEVELS = {
  ALLOW: 'allow',
  DENY: 'deny',
  PROMPT: 'prompt'
} as const;
