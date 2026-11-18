import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Manifest fixtures. The first four existed before step 1.1; their report snapshots must not change. */
export const FIXTURES = [
  'shared',
  'hd',
  'hd-dup-index',
  'mainnet',
  'hd-per-resource',
  'tiers',
  'schemes',
  'not-exported',
  'range-overlap',
  'range-unknown',
  'dynamic-per-item',
  'tiers-same-terms',
  'stale-previous',
  'stale-reuse',
  'hd-moved',
] as const;
export const DEMO_FIXTURES = ['shared', 'hd', 'hd-dup-index', 'hd-per-resource', 'hd-moved'] as const;

export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/manifests/${name}.json`, import.meta.url));
export const demoFixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/demo-format/${name}.json`, import.meta.url));
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
/** The path as a seller would type it, so report snapshots do not depend on this machine. */
export const shownPath = (name: string): string => `fixtures/manifests/${name}.json`;
export const fake = (n: number): string => `0x${String(n).padStart(40, '0')}`;
