import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', bin: 'src/bin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  dts: false,
  clean: false,
  banner: { js: '#!/usr/bin/env node' },
});
