import { randomBytes } from 'crypto'

export function createWebSocketToken(): string {
  return randomBytes(32).toString('hex')
}

export function websocketAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export function websocketTokenEnvironment(token: string): Record<string, string> {
  return { HELIX_WS_TOKEN: token }
}
