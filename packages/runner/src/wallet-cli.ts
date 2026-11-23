// The command that creates the throwaway testnet buyer and relayer keys (Base Sepolia only). Run it
// yourself, in your own Terminal: node packages/runner/dist/wallet-cli.js --network eip155:84532
// This is the only place that reads HOME and the command line. It prints the two addresses and the
// folder (as a ~ path) on success, or one line with a code on refusal. It never prints a key, the
// random bytes, HOME or a full path. Nothing here signs, funds or sends anything.
import { createWallets, parseArgs, walletFolderParts } from './wallet.js';

const args = parseArgs(process.argv.slice(2));
if (!args.ok) {
  process.stderr.write(`${args.code}\n`);
  process.exitCode = 2;
} else {
  const result = createWallets({ home: process.env.HOME, network: args.network });
  if (!result.ok) {
    const written = result.written && result.written.length > 0 ? ` (written: ${result.written.join(', ')})` : '';
    process.stderr.write(`${result.code}${written}\n`);
    process.exitCode = 1;
  } else {
    for (const w of result.wallets) process.stdout.write(`${w.role} ${w.address}\n`);
    process.stdout.write(`folder: ~/${walletFolderParts().join('/')}\n`);
  }
}
