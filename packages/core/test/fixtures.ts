import { fileURLToPath } from 'node:url';

export const FIXTURES = ['shared', 'hd', 'hd-dup-index', 'mainnet'] as const;
export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/manifests/${name}.json`, import.meta.url));
/** The path as a seller would type it, so report snapshots do not depend on this machine. */
export const shownPath = (name: string): string => `fixtures/manifests/${name}.json`;
