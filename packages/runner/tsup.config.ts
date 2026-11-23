import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'wallet-cli': 'src/wallet-cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  dts: false,
  clean: false,
});
