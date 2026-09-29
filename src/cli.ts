/**
 * Interactive CLI to interact with deployed Hello World contract
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  WalletFacade,
  DustWallet,
  HDWallet,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  createKeystore,
  NoOpTransactionHistoryStorage,
  PublicKey,
} from '@midnight-ntwrk/wallet-sdk';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Set network to preprod
setNetworkId('preprod');

// Preprod network configuration
const CONFIG = {
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  proofServer: 'http://127.0.0.1:6300',
};

// The SDK requires the private-state password to be at least 16 characters.
const PRIVATE_STATE_PASSWORD = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Hello-World-Lesson-Password-1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'hello-world');

// Load compiled contract
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
const HelloWorld = await import(pathToFileURL(contractPath).href);

const compiledContract = CompiledContract.make('hello-world', HelloWorld.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// ─── Wallet Functions ──────────────────────────────────────────────────────────

function deriveKeys(seed: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
  const result = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
}

async function createWallet(seed: string) {
  const keys = deriveKeys(seed);
  const networkId = getNetworkId();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

  const walletConfig = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
    provingServerUrl: new URL(CONFIG.proofServer),
    relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg: any) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg: any) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

async function createProviders(walletCtx: Awaited<ReturnType<typeof createWallet>>) {
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'hello-world-state',
      accountId,
      privateStoragePasswordProvider: () => PRIVATE_STATE_PASSWORD,
    }),
    publicDataProvider: indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Main CLI Script ───────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Hello World Contract CLI                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check for deployment.json
  if (!fs.existsSync('deployment.json')) {
    console.error('No deployment.json found! Run `npm run deploy` first.\n');
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync('deployment.json', 'utf-8'));
  console.log(`  Contract: ${deployment.contractAddress}\n`);

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    // Get wallet seed: prefer env (so CI can run unattended), otherwise prompt.
    const seed = (
      process.env.WALLET_SEED?.trim() ||
      process.env.DEPLOY_SEED?.trim() ||
      (await rl.question('  Enter your wallet seed: '))
    ).trim();

    console.log('\n  Connecting to Midnight Preprod...');
    const walletCtx = await createWallet(seed.trim());

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    const syncSpinner = setInterval(() => {
      process.stdout.write(`\r  ${frames[frame++ % frames.length]} Syncing wallet (this may take a few minutes)...`);
    }, 80);
    await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncSpinner);
    process.stdout.write('\r  ✓ Wallet synced.                                            \n');

    console.log('  Setting up providers...');
    const providers = await createProviders(walletCtx);

    console.log('  Joining contract...');
    const contract = await findDeployedContract(providers as any, {
      contractAddress: deployment.contractAddress,
      compiledContract: compiledContract as any,
      privateStateId: 'helloWorldState',
      initialPrivateState: {},
    });

    console.log('  Connected!\n');

    // ── Non-interactive mode (used by CI) ────────────────────────────────────
    // Set STORE_MESSAGE to store that text, read it back, verify, and exit.
    const scriptedMessage = process.env.STORE_MESSAGE?.trim();
    if (scriptedMessage) {
      console.log(`  Storing message: "${scriptedMessage}"`);
      const tx = await (contract as any).callTx.storeMessage(scriptedMessage);
      console.log(`  ✅ Message stored! tx=${tx.public.txHash} block=${tx.public.blockHeight}`);

      let readBack = '';
      for (let attempt = 1; attempt <= 12; attempt++) {
        const state = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
        if (state) {
          const ledgerState = HelloWorld.ledger(state.data);
          readBack = ledgerState.message ? String(ledgerState.message) : '';
          if (readBack) break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      console.log(`  Read back from chain: "${readBack || '(not indexed yet)'}"`);
      fs.writeFileSync(
        'store-result.json',
        JSON.stringify(
          {
            storedMessage: scriptedMessage,
            readBack,
            txHash: tx.public.txHash,
            blockHeight: tx.public.blockHeight,
            verified: readBack === scriptedMessage,
          },
          null,
          2,
        ),
      );

      await walletCtx.wallet.stop();
      if (readBack !== scriptedMessage) {
        console.error('  ❌ Stored and read-back messages differ.');
        process.exit(1);
      }
      console.log('  ✅ Store + read verified.\n');
      rl.close();
      return;
    }

    // Main menu loop
    let running = true;
    while (running) {
      const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
      const dust = dustState.dust.balance(new Date());

      console.log('─────────────────────────────────────────────────────────────────');
      console.log(`  DUST: ${dust.toLocaleString()}`);
      console.log('─────────────────────────────────────────────────────────────────');
      const choice = await rl.question('  [1] Store a message\n  [2] Read current message\n  [3] Exit\n  > ');

      switch (choice.trim()) {
        case '1':
          try {
            const message = await rl.question('\n  Enter message: ');
            console.log('  Storing message (this may take 20-30 seconds)...\n');
            const tx = await (contract as any).callTx.storeMessage(message);
            console.log(`  ✅ Message stored!`);
            console.log(`  Transaction: ${tx.public.txHash}`);
            console.log(`  Block: ${tx.public.blockHeight}\n`);
          } catch (e) {
            console.error(`  ❌ Error: ${e instanceof Error ? e.message : e}\n`);
          }
          break;

        case '2':
          try {
            console.log('\n  Reading message from blockchain...');
            const state = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
            if (state) {
              const ledgerState = HelloWorld.ledger(state.data);
              console.log(`  Current message: "${ledgerState.message || '(empty)'}"\n`);
            } else {
              console.log('  No message found.\n');
            }
          } catch (e) {
            console.error(`  ❌ Error: ${e instanceof Error ? e.message : e}\n`);
          }
          break;

        case '3':
          running = false;
          break;
      }
    }

    await walletCtx.wallet.stop();
    console.log('\n  Goodbye!\n');
  } finally {
    rl.close();
  }
}

main().catch(console.error);
