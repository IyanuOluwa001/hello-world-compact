// Diagnostic: instrument wallet sync progress + real error causes.
//
// Usage:
//   $env:DEPLOY_SEED="<seed>"; node node_modules/tsx/dist/cli.mjs scripts/sync-debug.mjs
//
// It prints the shielded/unshielded/dust sync progress (applied index vs. the
// chain tip) every 5s and exits once `waitForSyncedState()` resolves. Useful for
// telling "slow but healthy" apart from "stuck / erroring" on a new network.
// See the "Troubleshooting" section of the README.
import * as util from 'node:util';
import { WebSocket } from 'ws';
globalThis.WebSocket = WebSocket;

import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  WalletFacade, DustWallet, HDWallet, Roles, ShieldedWallet, UnshieldedWallet,
  createKeystore, NoOpTransactionHistoryStorage, PublicKey,
} from '@midnight-ntwrk/wallet-sdk';

process.on('uncaughtException', (e) => console.log('uncaughtException', util.inspect(e, { depth: 8 })));
process.on('unhandledRejection', (e) => console.log('unhandledRejection', util.inspect(e, { depth: 8 })));

setNetworkId('preprod');
const seed = process.env.DEPLOY_SEED;
const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
const res = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
const keys = res.keys;
const networkId = getNetworkId();
const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

const wallet = await WalletFacade.init({
  configuration: {
    networkId,
    indexerClientConnection: {
      indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
      indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    },
    provingServerUrl: new URL('http://127.0.0.1:6300'),
    relayURL: new URL('wss://rpc.preprod.midnight.network'),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  },
  shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
  unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
});

await wallet.start(shieldedSecretKeys, dustSecretKey);
console.log('started at', new Date().toISOString());

let n = 0;
let last = null;
let dumped = false;
const sub = wallet.state().subscribe({
  next: (s) => {
    n++;
    last = s;
    if (!dumped) {
      dumped = true;
      console.log('ROOT KEYS', Object.keys(s));
      console.log('GETTERS shielded', Object.getOwnPropertyNames(Object.getPrototypeOf(s.shielded ?? {})));
    }
  },
  error: (e) => console.log('STATE STREAM ERROR', util.inspect(e, { depth: 10, showHidden: true })),
});

const p = (w) => {
  const pr = w?.progress;
  if (!pr) return 'n/a';
  return JSON.stringify({
    applied: String(pr.appliedIndex),
    hrw: String(pr.highestRelevantWalletIndex),
    hi: String(pr.highestIndex),
    hri: String(pr.highestRelevantIndex),
    connected: pr.isConnected,
  });
};

const started = Date.now();
const iv = setInterval(() => {
  console.log(
    `... elapsed ${Math.round((Date.now() - started) / 1000)}s emissions=${n} synced=${last?.isSynced} ` +
    `shielded=${p(last?.shielded)} unshielded=${p(last?.unshielded)} dust=${p(last?.dust)}`,
  );
}, 5000);

try {
  const st = await wallet.waitForSyncedState();
  console.log('SYNCED at', new Date().toISOString(), 'isSynced=', st.isSynced);
} catch (e) {
  console.log('SYNC FAILED', util.inspect(e, { depth: 12, showHidden: true }));
}
clearInterval(iv);
sub.unsubscribe();
process.exit(0);
