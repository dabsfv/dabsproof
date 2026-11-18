import type { WatchInput } from '../schema.js';
import { FIRST_DATE } from '../shared.js';

export const x402_03_upstream_binding = {
  id: 'X402-03.upstream-binding',
  version: 1,
  status: 'watch',
  title: 'Watch: can the x402 protocol itself tie a payment to a route?',
  kind: 'static',
  whatItTests:
    'Whether the x402 protocol or its official software offers a built-in way to tie a payment to the route it was made for. That would make X402-03 easier to fix.',
  watch: {
    status: 'could-not-verify',
    note: 'The upstream status has not been checked yet. This entry gives information only and never reports a problem.',
  },
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: 'First version.' }],
} satisfies WatchInput;
