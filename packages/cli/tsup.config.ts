import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  dts: false,
  clean: false,
});
