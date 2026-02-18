import { randomUUID } from 'crypto';

// Lazily generated once per process lifetime
let _sessionId: string | undefined;

export function generateSessionId(): string {
  return randomUUID();
}

export function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = generateSessionId();
  }
  return _sessionId;
}
