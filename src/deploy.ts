/**
 * Deploy Hello World contract to Midnight Preprod network
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as util from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// Midnight SDK imports
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
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
  faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
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

  // One consolidated configuration object serves all three child wallets.
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
    // In Midnight.js 4.1.x the WalletProvider interface returns the key
    // objects directly — no more hex-string conversion.
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      // balanceUnboundTransaction → finalizeRecipe is the complete balancing
      // path in wallet-sdk 1.x. (Older wallet-sdk versions needed a manual
      // per-intent signing workaround here; that bug is fixed.)
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

// ─── Main Deploy Script ────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Deploy Hello World to Midnight Preprod             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check if contract is compiled
  if (!fs.existsSync(path.join(zkConfigPath, 'contract', 'index.js'))) {
    console.error('Contract not compiled! Run: npm run compile');
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    // 1. Wallet setup
    console.log('─── Step 1: Wallet Setup ───────────────────────────────────────\n');

    // Non-interactive path: set DEPLOY_SEED to skip both prompts. Useful for
    // automation / restoring the same funded wallet without an interactive TTY.
    const envSeed = process.env.DEPLOY_SEED?.trim();
    let seed: string;
    if (envSeed) {
      seed = envSeed;
      console.log('  Using seed from DEPLOY_SEED.\n');
    } else {
      const choice = await rl.question('  [1] Create new wallet\n  [2] Restore from seed\n  > ');
      seed = choice.trim() === '2'
        ? await rl.question('\n  Enter your 64-character seed: ')
        : crypto.randomBytes(32).toString('hex');

      if (choice.trim() !== '2') {
        console.log(`\n  ⚠️  SAVE THIS SEED (you'll need it later):\n  ${seed}\n`);
      }
    }

    console.log('  Creating wallet...');
    const walletCtx = await createWallet(seed);

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    let syncSpinner: NodeJS.Timeout | undefined;
    const startSpinner = () => {
      frame = 0;
      syncSpinner = setInterval(() => {
        process.stdout.write(`\r  ${frames[frame++ % frames.length]} Syncing with network (this may take a few minutes)...`);
      }, 80);
    };
    const stopSpinner = () => {
      if (syncSpinner) clearInterval(syncSpinner);
      syncSpinner = undefined;
    };

    // The wallet SDK's indexer WebSocket client is created with `shouldRetry: () => false`,
    // so a single transient socket drop aborts an otherwise-healthy sync. Restart the wallet
    // (which resumes from its in-memory applied index) and retry rather than losing the sync.
    startSpinner();
    let state: Awaited<ReturnType<typeof walletCtx.wallet.waitForSyncedState>>;
    const MAX_SYNC_ATTEMPTS = 10;
    for (let attempt = 1; ; attempt++) {
      try {
        state = await walletCtx.wallet.waitForSyncedState();
        break;
      } catch (err) {
        if (attempt >= MAX_SYNC_ATTEMPTS) {
          stopSpinner();
          throw err;
        }
        stopSpinner();
        console.log(`\r  ! Sync interrupted (attempt ${attempt}/${MAX_SYNC_ATTEMPTS}); reconnecting...        `);
        await walletCtx.wallet.stop().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        await walletCtx.wallet.start(walletCtx.shieldedSecretKeys, walletCtx.dustSecretKey);
        startSpinner();
      }
    }
    stopSpinner();
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    const address = walletCtx.unshieldedKeystore.getBech32Address();
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

    console.log(`\n  Wallet Address: ${address}`);
    console.log(`  Balance: ${balance.toLocaleString()} tNIGHT\n`);

    // 2. Fund wallet if needed
    if (balance === 0n) {
      console.log('─── Step 2: Fund Your Wallet ───────────────────────────────────\n');
      console.log(`  Visit: ${CONFIG.faucet}`);
      console.log(`  Address: ${address}\n`);
      console.log('  Waiting for funds...');

      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(10000),
          Rx.filter((s) => s.isSynced),
          Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
          Rx.filter((b) => b > 0n),
        ),
      );
      console.log('  Funds received!\n');
    }

    // 3. Register for DUST
    console.log('─── Step 3: DUST Token Setup ───────────────────────────────────\n');
    const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

    if (dustState.dust.balance(new Date()) > 0n) {
      console.log(`  DUST already available (${dustState.dust.balance(new Date()).toLocaleString()} DUST)`);
    } else {
      const nightUtxos = dustState.unshielded.availableCoins.filter((c: any) => !c.meta?.registeredForDustGeneration);
      if (nightUtxos.length > 0) {
        console.log('  Registering for DUST generation...');
        // The signing callback below already produces a fully signed recipe —
        // do NOT sign it again afterwards.
        const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
          nightUtxos,
          walletCtx.unshieldedKeystore.getPublicKey(),
          (payload) => walletCtx.unshieldedKeystore.signData(payload),
        );
        const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
        await walletCtx.wallet.submitTransaction(finalized);
      }

      console.log('  Waiting for DUST tokens to accrue (this may take a few minutes)...');
      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(10000),
          Rx.filter((s) => s.isSynced),
          Rx.tap((s) => {
            const dustBal = s.dust.balance(new Date());
            if (dustBal > 0n) console.log(`  DUST balance: ${dustBal.toLocaleString()}`);
          }),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      );
    }
    console.log('  DUST tokens ready!\n');

    // 4. Deploy contract
    console.log('─── Step 4: Deploy Contract ────────────────────────────────────\n');
    console.log('  Setting up providers...');
    const providers = await createProviders(walletCtx);

    console.log('  Deploying contract (this may take 30-60 seconds)...\n');
    // args is the contract constructor's argument list — empty for
    // hello-world's no-arg constructor. The contract is loaded dynamically,
    // so we widen the compiled contract type here.
    const deployed = await deployContract(providers as any, {
      compiledContract: compiledContract as any,
      args: [],
      privateStateId: 'helloWorldState',
      initialPrivateState: {},
    });

    const contractAddress = deployed.deployTxData.public.contractAddress;
    console.log('  ✅ Contract deployed successfully!\n');
    console.log(`  Contract Address: ${contractAddress}\n`);

    // 5. Save deployment info
    const deploymentInfo = {
      contractAddress,
      seed,
      network: 'preprod',
      deployedAt: new Date().toISOString(),
    };

    fs.writeFileSync('deployment.json', JSON.stringify(deploymentInfo, null, 2));
    console.log('  Saved to deployment.json\n');

    await walletCtx.wallet.stop();
    console.log('─── Deployment Complete! ───────────────────────────────────────\n');
    console.log('  Next: Run `npm run cli` to interact with your contract.\n');
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  // The SDK throws Effect tagged errors whose useful context lives on `cause`; a plain
  // console.error prints "[object Object]", so inspect deeply instead.
  console.error(util.inspect(err, { depth: 10, colors: false }));
  process.exit(1);
});
