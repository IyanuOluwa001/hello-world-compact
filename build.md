Time to write actual code. In the last lesson, you learned the building blocks of Compact like ledger declarations, circuits, witnesses, disclose, and how they fit together. Now you're going to use them.

By the end of this lesson, you'll have written a Compact contract, compiled it into zero-knowledge circuits, deployed it to Midnight's Preprod network, and stored a message on-chain.

We'll do this two ways.

First, the manual way, so you understand what's happening at each step. Then we'll look at create-mn-app, which scaffolds everything for you.

What we're building
The hello-world contract does one thing, it lets you store and read a message on the blockchain. Simple on purpose. The goal here isn't to build something complex, it's to prove that your entire toolchain works end to end.

Here's the full contract:


pragma language_version >= 0.23;

import CompactStandardLibrary;

export ledger message: Opaque<"string">;

export circuit storeMessage(newMessage: Opaque<"string">): [] {
  message = disclose(newMessage);
}
You already saw something similar in Lesson 23. Now let's build it, compile it, and put it on-chain.

Step 1: Create the project
Open your terminal and set up the project structure:


mkdir hello-world-compact
cd hello-world-compact
npm init -y
mkdir contracts src
Your directory should look like this:


hello-world-compact/
├── contracts/
├── src/
└── package.json
Step 2: Write the contract
Create the contract file:


touch contracts/hello-world.compact
Open contracts/hello-world.compact in VS Code and add the following:


pragma language_version >= 0.23;


import CompactStandardLibrary;

// Public ledger state - stores the message visible on-chain
export ledger message: Opaque<"string">;

// Circuit to store a new message
export circuit storeMessage(newMessage: Opaque<"string">): [] {
  message = disclose(newMessage);
}

Let's walk through each line one more time, now that you're actually writing it:

pragma language_version >= 0.23; Tells the compiler this contract requires Compact language version 0.23 or higher — the current language version. This protects you from accidentally compiling with an incompatible version.
import CompactStandardLibrary; Imports Compact's standard library. This gives you access to built-in types and functions. Every Compact contract needs this.
export ledger message: Opaque<"string">; Declares a single piece of on-chain state called message. The type Opaque<"string"> means the circuit treats it as a hash (it can't inspect the contents), but your TypeScript frontend can read the actual string value. export means your DApp can access this from the frontend. ledger means it lives on-chain, permanently.
export circuit storeMessage(newMessage: Opaque<"string">): [] Defines a circuit (an on-chain function) called storeMessage that takes a string parameter. The return type [] means it doesn't return anything. export means it can be called externally.
message = disclose(newMessage); Wrapping it in disclose() acknowledges that this private value may be exposed by being placed on the public ledger, it doesn't make the value public itself, but tells the compiler "I'm aware of the potential disclosure and accept it.”
Step 3: Configure the project
Before we compile, let's set up the project dependencies and configuration.

Create tsconfig.json:


{  
"compilerOptions": {    
"target": "ES2022",    
"module": "ESNext",    
"moduleResolution": "bundler",    
"outDir": "dist",    
"rootDir": "src",    
"strict": false,    
"esModuleInterop": true,    
"skipLibCheck": true,    
"declaration": true,    
"allowSyntheticDefaultImports": true,    
"resolveJsonModule": true
  },  
"include": ["src/**/*"]
}
Replace the contents of package.json with:


{  
"name": "hello-world-compact",  
"version": "1.0.0",  
"private": true,  
"type": "module",  
"engines": {    
"node": ">=22.0.0"  
},  
"scripts": {    
"compile": "compact compile contracts/hello-world.compact contracts/managed/hello-world",    
"build": "tsc --noEmit",    
"deploy": "tsx src/deploy.ts",    
"cli": "tsx src/cli.ts",    
"proof-server:start": "docker compose up -d",    
"proof-server:stop": "docker compose down"  
},  
"devDependencies": {    
"@types/node": "^22.0.0",    
"@types/ws": "^8.18.1",    
"tsx": "^4.23.1",    
"typescript": "^5.7.0"  
},  
"dependencies": {    
"@midnight-ntwrk/midnight-js-contracts": "4.1.1",    
"@midnight-ntwrk/midnight-js-http-client-proof-provider": "4.1.1",    
"@midnight-ntwrk/midnight-js-indexer-public-data-provider": "4.1.1",    
"@midnight-ntwrk/midnight-js-level-private-state-provider": "4.1.1",    
"@midnight-ntwrk/midnight-js-network-id": "4.1.1",    
"@midnight-ntwrk/midnight-js-node-zk-config-provider": "4.1.1",    
"@midnight-ntwrk/midnight-js-protocol": "4.1.1",    
"@midnight-ntwrk/midnight-js-types": "4.1.1",    
"@midnight-ntwrk/midnight-js-utils": "4.1.1",    
"@midnight-ntwrk/wallet-sdk": "1.2.0",    
"rxjs": "^7.8.2",    
"ws": "^8.21.1"  
},  
"overrides": {    
"@midnight-ntwrk/wallet-sdk": "1.2.0"  
}
}
A few things worth noting about these dependencies.

The midnight-js-* packages at version 4.1.1 are the SDK libraries that handle contract deployment, proof generation, indexer queries, and private state management. New in this line is @midnight-ntwrk/midnight-js-protocol — a barrel package that bundles the compact-js contract tooling, the Compact runtime (compact-runtime 0.16.0), and the ledger (ledger-v8) and re-exports them under stable subpaths like @midnight-ntwrk/midnight-js-protocol/ledger. That's why you won't see compact-runtime or ledger-v8 in the dependency list — they come in through the protocol package, and even the compiled contract's own import of compact-runtime resolves through it.

@midnight-ntwrk/wallet-sdk is the wallet stack. Midnight uses a multi-wallet architecture with separate wallets for shielded (private), unshielded (public), and DUST token operations — this used to be five separate wallet-sdk-* packages, now consolidated behind one package that exports everything (WalletFacade, ShieldedWallet, UnshieldedWallet, DustWallet, HDWallet, and friends).

We'll explain this architecture in detail in Lessons 28-29. For now, just know that deploying a contract requires all three wallet types working together.

The overrides field pins the wallet-sdk version so transitive dependencies can't pull in a different one. And rxjs is a direct dependency because our scripts use it to observe wallet state.

We're also using tsx instead of compiling TypeScript separately. It runs .ts files directly, which means you don't need a separate npm run build step before running your scripts.

Now create docker-compose.yml in the project root:


services:
  proof-server:
    image: 'midnightntwrk/proof-server:8.1.0'
    command: ['midnight-proof-server', '-v']
    ports:
      - '127.0.0.1:6300:6300'
    environment:
      RUST_BACKTRACE: 'full'
    healthcheck:
      test: ['CMD-SHELL', 'echo > /dev/tcp/127.0.0.1/6300']
      interval: 10s
      timeout: 5s
      retries: 20
      start_period: 10s
This gives you a cleaner way to manage the proof server than the raw docker run command from Lesson 22. The healthcheck lets Docker report when the server is actually listening, not just started.

Start it with npm run proof-server:start, stop it with npm run proof-server:stop.

Install everything:


npm install
Step 4: Compile the contract
Compile the contract:


npm run compile
(Compilation is fully local — it doesn't need the proof server. But go ahead and start it now with npm run proof-server:start so it's ready for the deploy step.)

This does several things:

Transforms your Compact code into zero-knowledge circuits
Generates cryptographic proving and verifying keys
Creates JavaScript bindings so your DApp can interact with the contract
After compilation, you'll see a new directory structure:


contracts/
├── hello-world.compact
└── managed/
    └── hello-world/
        ├── compiler/     # Intermediate build files
        ├── contract/     # Compiled contract artifacts (includes index.js)
        ├── keys/         # ZK proving and verifying keys
        └── zkir/         # Zero-Knowledge Intermediate Representation
The key output is contracts/managed/hello-world/contract/index.js this is what your TypeScript code imports to deploy and interact with the contract.

If compilation fails, check that:

The pragma version matches what your compiler supports (compact compile --version)
You're running the command from the project root, not inside contracts/
Your compiler is up to date (compact update)
Step 5: Write the deployment script
Create the deployment script:


touch src/deploy.ts
This is the most code-heavy part of the lesson. Don't worry about understanding every line right now, we'll break down the SDK patterns in Lessons 28-29.

For now, the goal is to get your contract on-chain.

Add the following to src/deploy.ts:


/**
 * Deploy Hello World contract to Midnight Preprod network
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
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
const choice = await rl.question('  [1] Create new wallet\n  [2] Restore from seed\n  > ');
    
const seed = choice.trim() === '2'      
? await rl.question('\n  Enter your 64-character seed: ')
      : crypto.randomBytes(32).toString('hex');
    
if (choice.trim() !== '2') {
      console.log(`\n  ⚠️  SAVE THIS SEED (you'll need it later):\n  ${seed}\n`);
    }

    console.log('  Creating wallet...');    
const walletCtx = await createWallet(seed);
    
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];    
let frame = 0;    
const syncSpinner = setInterval(() => {
      process.stdout.write(`\r  ${frames[frame++ % frames.length]} Syncing with network (this may take a few minutes)...`);
    }, 80);    
const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncSpinner);
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

main().catch(console.error);
That's a lot of code. Let's break down what the deployment script does at a high level, you don't need to memorize the details, but you should understand the flow:

1. Loads the compiled contract using CompiledContract.make() (from the midnight-js-protocol barrel), this wraps the compiled output with vacant witness implementations and file-based ZK assets.
2. Creates a wallet: Midnight uses an HD wallet (hierarchical deterministic) that derives three types of keys: one for shielded transactions (Zswap), one for unshielded transactions (NightExternal), and one for DUST. These get assembled into a WalletFacade that coordinates all three. The WalletFacade.init() method takes one consolidated configuration object plus factory functions for each wallet type. Everything comes from the single @midnight-ntwrk/wallet-sdk package.
3. Funds the wallet: If the balance is zero, it waits for you to send tNIGHT tokens from the faucet.
4. Registers for DUST: This is a step you won't see on other blockchains. Midnight uses DUST tokens (generated from your tNIGHT holdings) to pay for contract execution. The script registers your unshielded coins for DUST generation and waits until DUST tokens are available.
5. Deploys the contract: Assembles all providers (private state, public data, ZK config, proof generation, wallet) and submits the deployment transaction. Balancing is now just balanceUnboundTransaction → finalizeRecipe — older wallet-sdk versions needed a manual signing workaround here, which is no longer necessary.
6. Saves deployment info: Writes deployment.json with the contract address and your wallet seed, so the CLI script can find it.
Step 6: Deploy
Make sure your proof server is running:


npm run proof-server:start
Deploy to Preprod:


npm run deploy
The script will:

Ask if you want to create a new wallet or restore from an existing seed (pick option 1 for your first time)
Generate a new seed — save this immediately
Show your wallet address
Wait for you to fund it via the Preprod faucet (click Request tokens, you'll receive tNIGHT, which is what generates DUST)
Register for DUST generation and wait for DUST tokens
Deploy the contract (this takes 30-60 seconds)
Save the contract address and seed to deployment.json
When you see "Contract deployed successfully!" and a contract address, your contract is live on the Preprod network.

Step 7: Interact with your contract
Now let's store and read a message. Create the CLI script:


touch src/cli.ts
Add the following to src/cli.ts:



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
// Get wallet seed    
const seed = await rl.question('  Enter your wallet seed: ');

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
Run the CLI:


npm run cli
Enter your wallet seed when prompted (the same one from deployment, it's also saved in deployment.json). Once connected, try:

Option 1: Store a message like "Hello from Midnight!", this would create a transaction, generate a ZK proof, and write to the blockchain (takes 20-30 seconds)
Option 2: Read the current message back from the chain — this is a free query to the indexer, no transaction needed
Option 3: Exit
Notice the DUST balance displayed in the menu. Each time you store a message, you spend DUST tokens.

Reading is free because it's just querying the indexer, no proof generation, no transaction.

If you see your message come back, congratulations, you just deployed and interacted with a zero-knowledge smart contract.

The faster way
Everything above is the manual approach. Midnight also provides a scaffolding tool that sets all of this up for you:


npx create-mn-app my-app
cd my-app
npm run setup
This gives you a preconfigured project with the hello-world template (other templates include battleship, bboard, and leaderboard — run npx create-mn-app --list), complete with deployment scripts, TypeScript config, and all dependencies. If you want to skip the manual setup in future projects, this is the way to go.

What just happened
Let's step back and appreciate what you just did:

You wrote a Compact contract that declares on-chain state and a circuit
The compiler transformed that into zero-knowledge circuits with cryptographic keys
A deployment script created a multi-wallet setup (shielded + unshielded + DUST), funded it, and registered for DUST generation
A deployment transaction with a ZK proof was submitted to the Preprod network
You called a circuit that generated another ZK proof, which the network verified before updating state
You queried the public ledger and read your message back
The contract itself is four lines of logic (five if you count the import). But under the hood, zero-knowledge proofs were generated and verified for every state change, and three different wallet types coordinated to make the transaction possible.

What's next
You now have a working end-to-end flow. In the next lesson, we'll look at the proof server in more detail, what it's actually doing, how transactions flow through the system, and what happens between "submit" and "confirmed."