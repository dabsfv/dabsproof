import { describe, expect, it } from 'vitest';
import { checks } from '../src/index.js';

describe('registry', () => {
  it('exports a list of checks', () => {
    expect(Array.isArray(checks)).toBe(true);
  });
});
