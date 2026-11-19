import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', next: 'src/next/index.ts', 'lint-cli': 'src/lint-cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  dts: false,
  clean: false,
});
