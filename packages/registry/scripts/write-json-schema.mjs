// Writes the registry's JSON Schema into dist/. It is generated, never committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { RegistryEntrySchema } from '../dist/index.js';

const out = new URL('../dist/registry-entry.schema.json', import.meta.url);
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify(z.toJSONSchema(RegistryEntrySchema), null, 2)}\n`);
console.log('wrote dist/registry-entry.schema.json');
