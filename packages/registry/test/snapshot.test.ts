// Snapshots for review: any change to registry text or to the JSON Schema shows up in the diff.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checks, RegistryEntrySchema } from '../src/index.js';

describe('snapshots', () => {
  it('registry', () => {
    expect(checks).toMatchSnapshot();
  });
  it('JSON Schema', () => {
    expect(z.toJSONSchema(RegistryEntrySchema)).toMatchSnapshot();
  });
});
