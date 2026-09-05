import type { IpcResult } from './index';

export const MANAGER_PROTOCOL_VERSION = 1;
export const MANAGER_REQUEST_CHANNELS = [
  'project:scan', 'project:list', 'task:create', 'task:list', 'task:get',
  'worktree:create', 'turn:start', 'turn:steer', 'turn:interrupt',
  'approval:decide', 'diff:get', 'verify:run', 'recovery:load',
] as const;
export interface ManagerEnvelope {
  version: number;
  messageId: number;
  requestId: number;
  kind: 'ready' | 'request' | 'ack' | 'response' | 'notification' | 'shutdown';
  channel?: string;
  args?: unknown[];
  payload?: unknown;
  result?: IpcResult<unknown>;
}
export function isManagerEnvelope(value: unknown): value is ManagerEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as ManagerEnvelope;
  return v.version === MANAGER_PROTOCOL_VERSION
    && Number.isSafeInteger(v.messageId) && v.messageId > 0
    && Number.isSafeInteger(v.requestId) && v.requestId >= 0
    && ['ready', 'request', 'ack', 'response', 'notification', 'shutdown'].includes(v.kind);
}
/** 在业务处理前校验白名单及参数。 */
export function validManagerRequest(channel: unknown, args: unknown): args is unknown[] {
  if (!Array.isArray(args)) return false;
  const strings = (n: number) => args.length === n && args.every(a => typeof a === 'string' && a.length > 0);
  switch (channel) {
    case 'project:list': case 'recovery:load': return args.length === 0;
    case 'task:list': return args.length === 0 || (args.length === 1 && (args[0] === undefined || typeof args[0] === 'string'));
    case 'task:create': return strings(2);
    case 'approval:decide': return strings(2) && ['approved', 'denied'].includes(args[1] as string);
    case 'project:scan': case 'task:get': case 'worktree:create':
    case 'turn:start': case 'diff:get': case 'verify:run': return strings(1);
    default: return false;
  }
}
