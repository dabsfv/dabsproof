export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.DEMO_SKIP_REGISTER === '1') return;
  const { registerPayTo } = await import('@dabsproof/fixkit/next');
  const { mappingPath } = await import('./lib/payto.js');
  const mapping = mappingPath();
  if (mapping) registerPayTo({ mapping });
}
