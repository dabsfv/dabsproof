// The target check. Only the literal loopback addresses are accepted, and only with an explicit
// local flag: ownership proof is not built yet. The raw text is checked as given and is never passed
// through new URL first, because new URL rewrites forms such as 127.1 or [0:0:0:0:0:0:0:1] into the
// loopback addresses. A refusal carries a code only, never the input.

/** A local target the runner may send to. */
export interface LocalTarget {
  /** Exactly as given and checked, for example http://127.0.0.1:4319 or http://[::1]:4319. */
  origin: string;
  host: '127.0.0.1' | '[::1]';
  port: number;
}

export type TargetCode =
  | 'local-flag-required'
  | 'target-not-text'
  | 'unsupported-scheme'
  | 'userinfo-not-allowed'
  | 'host-not-loopback-literal'
  | 'port-missing'
  | 'port-invalid'
  | 'target-has-path';

const refuse = (code: TargetCode): { ok: false; code: TargetCode } => ({ ok: false, code });

/** Plain http only, our choice for this stage: the demo seller is plain HTTP on loopback. */
const SCHEME = 'http://';
const HOSTS = ['127.0.0.1', '[::1]'] as const;
const PORT = /^[1-9][0-9]{0,4}$/;

export function checkTarget(
  target: unknown,
  options: { local: boolean },
): { ok: true; target: LocalTarget } | { ok: false; code: TargetCode } {
  if (options?.local !== true) return refuse('local-flag-required');
  if (typeof target !== 'string') return refuse('target-not-text');
  if (!target.startsWith(SCHEME)) return refuse('unsupported-scheme');
  const rest = target.slice(SCHEME.length);
  // The authority ends at the first /, ? or #. Anything from there on is a path, query or fragment.
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  if (authority.includes('@')) return refuse('userinfo-not-allowed');
  const host = HOSTS.find(
    (h) => authority.startsWith(h) && (authority.length === h.length || authority[h.length] === ':'),
  );
  if (!host) return refuse('host-not-loopback-literal');
  const portText = authority.slice(host.length + 1);
  if (authority.length === host.length || portText === '') return refuse('port-missing');
  if (!PORT.test(portText) || Number(portText) > 65535) return refuse('port-invalid');
  if (end !== -1) return refuse('target-has-path');
  return { ok: true, target: { origin: target, host, port: Number(portText) } };
}
