# Hello World Compact — Midnight ZK Smart Contract

A minimal **zero-knowledge smart contract** written in [Compact](https://compact-lang.org/), Midnight's
domain-specific language for privacy-preserving smart contracts. The contract stores a string on-chain and
lets anyone read it back. The point is not complexity — it is proving that the full toolchain works end to end:

> write a Compact contract → compile it to ZK circuits + proving/verifying keys → deploy to Midnight Preprod → store & read a message on-chain.

---

## Table of contents

- [Status at a glance](#status-at-a-glance)
- [The contract](#the-contract)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Compiling (cross-platform notes)](#compiling-cross-platform-notes)
- [Deploying to Preprod](#deploying-to-preprod)
- [Using the CLI](#using-the-cli)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Verification log](#verification-log)
- [Roadmap](#roadmap)

---

## Status at a glance

| Step | What | Status |
| --- | --- | --- |
| 1 | Project scaffold (`contracts/`, `src/`, `package.json`, `tsconfig.json`) | ✅ Done |
| 2 | Contract written (`contracts/hello-world.compact`) | ✅ Done |
| 3 | Config + dependencies (`docker-compose.yml`, `npm install`) | ✅ Done |
| 4 | TypeScript type-check (`npm run build`) | ✅ Passing |
| 5 | Contract → JS + ZKIR (`npm run compile:no-keys`) | ✅ Passing |
| 6 | Proving/verifying key generation (`npm run compile`) | ✅ **In CI** ([run #1](https://github.com/IyanuOluwa001/hello-world-compact/actions/runs/36521810056)) — local CPU lacks ADX |
| 7 | Proof server running | ✅ Healthy on `127.0.0.1:6300` |
| 8 | Deploy to Midnight Preprod | 🔄 In progress — keys fetched from CI, wallet funded, deploy running |
| 9 | Store/read message via CLI | ⏳ Pending deploy |

> **Why is step 6 blocked?** The Compact compiler ships a `zkir` binary that generates the Groth16
> proving/verifying keys. That binary uses Intel **ADX** (`ADCX`/`ADOX`) instructions. The machine used for
> this build is an **Intel Core i5-4210U (Haswell, 2013)**, which predates ADX (introduced with Broadwell).
> Result: `zkir` dies with `SIGILL` inside WSL:
>
> ```
> Exception: zkir returned a non-zero exit status -4
> ```
>
> Emulating the binary with QEMU user-mode gets past the `SIGILL`, but the crypto layer then fails its own
> self-check (`from_uncompressed_unchecked should return a point`), so emulation is not a safe workaround.
> Everything up to and including ZKIR generation works; only key generation is affected.
>
> **To finish steps 6–9 you need one of:** a CPU with ADX (Broadwell+ Intel / Zen+ AMD), a cloud VM, or the
> included **GitHub Actions workflow** (`.github/workflows/compile.yml`), which compiles with keys on GitHub's
> ADX-capable runners and publishes them as the `managed-hello-world` artifact — see
> [Compiling with GitHub Actions](#compiling-with-github-actions-recommended-if-your-cpu-lacks-adx).

---

## The contract

`contracts/hello-world.compact`:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

// Public ledger state - stores the message visible on-chain
export ledger message: Opaque<"string">;

// Circuit to store a new message
export circuit storeMessage(newMessage: Opaque<"string">): [] {
  message = disclose(newMessage);
}
```

Line by line:

| Line | Meaning |
| --- | --- |
| `pragma language_version >= 0.23;` | Pins the minimum Compact language version (0.23.0 is what toolchain 0.31.1 provides), protecting against compiling with an incompatible compiler. |
| `import CompactStandardLibrary;` | Pulls in Compact's standard library (built-in types/functions). Required by every contract. |
| `export ledger message: Opaque<"string">;` | Declares on-chain state. `ledger` = permanent public state; `export` = readable from the DApp; `Opaque<"string">` = the circuit treats it as a hash, while the TypeScript frontend can decode the real string. |
| `export circuit storeMessage(...)` | An `export`ed circuit (on-chain function) callable from the frontend. Returns `[]` (nothing). |
| `message = disclose(newMessage);` | `disclose()` acknowledges that a private value may become public by being written to the ledger. It does not make the value public — it tells the compiler the disclosure is intentional. |

---

## How it works

```
┌────────────────┐   compile    ┌──────────────────────────────────────────┐
│ hello-world     │ ───────────▶ │ contracts/managed/hello-world/            │
│ .compact        │              │   compiler/  intermediate build info      │
└────────────────┘              │   contract/  index.js + index.d.ts        │
                                 │   zkir/      zero-knowledge IR (.zkir)    │
                                 │   keys/      proving + verifying keys     │
                                 └──────────────────────────────────────────┘
                                              │
                        ┌─────────────────────┴─────────────────────┐
                        ▼                                           ▼
              ┌──────────────────┐                        ┌──────────────────┐
              │ proof server      │                        │ Midnight Preprod  │
              │ (Docker, :6300)   │                        │ indexer + node    │
              │ generates proofs  │                        │ verifies + stores │
              └──────────────────┘                        └──────────────────┘
```

When you call `storeMessage`:

1. The wallet builds an unbound transaction containing the circuit call.
2. The **proof server** generates a zero-knowledge proof from the circuit's proving key.
3. The wallet **balances** the transaction (shielded + unshielded + DUST) and submits it.
4. Midnight's validators **verify** the proof before updating ledger state.
5. Anyone can then read `message` from the public ledger via the indexer — no proof, no transaction, no fee.

### The three-wallet model

Midnight uses separate wallets for different kinds of value, coordinated by a `WalletFacade` derived from one
HD seed:

- **Shielded (Zswap)** — private value, used for private transfers.
- **Unshielded (NightExternal)** — public tNIGHT.
- **DUST** — a non-transferable resource generated by holding tNIGHT; it pays for transaction fees/execution.
  You must *register* unshielded coins for DUST generation before you can deploy.

---

## Project structure

```
hello-world-compact/
├── contracts/
│   ├── hello-world.compact          # the Compact source
│   └── managed/                     # compiler output (gitignored)
│       └── hello-world/
│           ├── compiler/            # intermediate build info
│           ├── contract/            # index.js + index.d.ts (imported by TS)
│           ├── keys/                # proving/verifying keys (needs ADX)
│           └── zkir/                # zero-knowledge IR
├── src/
│   ├── deploy.ts                    # deploy contract, fund wallet, register DUST
│   └── cli.ts                       # interactive store/read menu
├── scripts/
│   └── compile.mjs                  # cross-platform `compact compile` wrapper
├── .github/
│   └── workflows/
│       └── compile.yml              # CI: compile with keys on ADX-capable runners
├── docs/
│   └── linkedin-post.md
├── docker-compose.yml               # local proof server
├── package.json
├── tsconfig.json
├── .gitignore
├── build.md                         # original lesson
└── README.md
```

---

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | v24.18.0 | `package.json` requires `>=22` |
| npm | 11.16.0 | |
| Docker | 29.7.2 | Required for the proof server |
| Compact toolchain | `compactc` 0.31.1 | Compact language **0.23.0**, runtime **0.16.0**, ledger 8.0.2 |
| WSL (Windows only) | WSL 2.7.14 / Ubuntu | Used to run the Linux `compactc` binary |
| Midnight SDK | `midnight-js-*` 4.1.1, `wallet-sdk` 1.2.0 | Installed by npm |

> **Version pairing matters.** `compactc` 0.31.1 emits code targeting `compact-runtime` 0.16.0, which is exactly
> what `@midnight-ntwrk/midnight-js-protocol@4.1.1` bundles. Using a newer compiler (e.g. 0.34.0 → runtime 0.19.0)
> would generate contract code incompatible with this SDK line.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Type-check the TypeScript
npm run build

# 3. Start the local proof server (Docker)
npm run proof-server:start

# 4. Compile the contract
npm run compile            # full compile incl. ZK keys (needs ADX-capable CPU)
npm run compile:no-keys    # JS + ZKIR only (works everywhere)

# 5. Deploy to Preprod
npm run deploy

# 6. Interact
npm run cli
```

---

## Compiling (cross-platform notes)

The lesson calls `compact compile <src> <out>` directly. On Windows there is **no native Compact toolchain**,
and `compact` resolves to `C:\Windows\system32\compact.exe` — the NTFS disk-compression utility — so the
command silently does the wrong thing. `scripts/compile.mjs` fixes this:

- **macOS/Linux:** if `compact` (or `compactc`, or `COMPACT_HOME`) is available, it delegates to it.
- **Windows:** it runs the Linux `compactc` binary inside WSL, downloading it from the public GitHub release
  on first use.

```bash
npm run compile            # generates keys/ too
npm run compile:no-keys    # --skip-zk: JS + ZKIR only
```

Environment overrides: `COMPACTC_VERSION` (default `0.31.1`), `WSL_DISTRO` (default `Ubuntu`),
`COMPACT_HOME` (native toolchain path).

Expected output tree after a successful compile:

```
contracts/managed/hello-world/
├── compiler/   # intermediate build files
├── contract/   # index.js (imported by src/deploy.ts and src/cli.ts)
├── keys/       # ZK proving + verifying keys
└── zkir/       # zero-knowledge intermediate representation
```

---

## Compiling with GitHub Actions (recommended if your CPU lacks ADX)

Proving-key generation needs Intel **ADX**. GitHub's `ubuntu-latest` runners have it, so
`.github/workflows/compile.yml` compiles the contract **with keys** in the cloud and publishes the result as
a downloadable artifact. Use this whenever your local CPU can't run `zkir`.

**When it runs:** on every push to `main`, on pull requests, and on demand via
*Actions → Compile Compact contract → Run workflow*.

**What it does:**

1. Checks out the repo and installs Node 22 + `npm ci`.
2. Downloads `compactc` 0.31.1 from the public GitHub release and caches it between runs.
3. Runs `npm run compile` (full compile, including `keys/`).
4. Runs `npm run build` (`tsc --noEmit`).
5. Verifies `contract/index.js`, `compiler/contract-info.json`, `zkir/storeMessage.zkir`, and `keys/` exist.
6. Uploads `contracts/managed/hello-world` as the **`managed-hello-world`** artifact (kept 30 days).

**How to use the artifact locally:**

1. Open the workflow run → scroll to **Artifacts** → download **`managed-hello-world`**.
2. Unzip it so the files land at `contracts/managed/hello-world/` (it should contain `contract/`, `compiler/`,
   `keys/`, and `zkir/`).
3. Then deploy from your machine:
   ```bash
   npm run proof-server:start
   npm run deploy
   ```
   The deploy script only needs `contracts/managed/hello-world/` plus the proof server — the keys travel in the
   artifact, so the deploy machine does not need ADX.

**Faster, no-auth download.** On every push to `main`, the workflow also attaches the same output to a rolling
release (`compiled-latest`), so you can fetch it with a single command — no GitHub login needed:

```bash
curl -L -o managed.zip \
  https://github.com/IyanuOluwa001/hello-world-compact/releases/download/compiled-latest/managed-hello-world.zip
```

The zip contains a `hello-world/` folder, so extract it into `contracts/managed/`:

> The toolchain version is pinned in one place: the `COMPACTC_VERSION` env var at the top of the workflow.
> Bump it (and the matching `midnight-js` versions) together when upgrading.

---

## Deploying to Preprod

Network configuration lives in `src/deploy.ts`:

| Setting | Value |
| --- | --- |
| Indexer (GraphQL) | `https://indexer.preprod.midnight.network/api/v4/graphql` |
| Indexer (WS) | `wss://indexer.preprod.midnight.network/api/v4/graphql/ws` |
| Node RPC | `https://rpc.preprod.midnight.network` |
| Proof server | `http://127.0.0.1:6300` |
| Faucet | `https://midnight-tmnight-preprod.nethermind.dev/` |
| Network ID | `preprod` |

```bash
npm run proof-server:start   # make sure the proof server is up
npm run deploy
```

The deploy script will:

1. Ask you to **create a new wallet** (option 1) or restore from a seed (option 2).
2. Print a new seed — **save it immediately**.
3. Print your wallet address and wait for you to fund it from the faucet.
4. Register your NIGHT for DUST generation and wait for DUST to accrue.
5. Deploy the contract (30–60s) and print the contract address.
6. Write `deployment.json` (contract address + seed + timestamp).

> `deployment.json` contains your **wallet seed** and is gitignored. Never commit it.

**Non-interactive deploy / automation.** Set `DEPLOY_SEED` to skip both prompts and restore a known
wallet — handy for scripts and CI:

```bash
DEPLOY_SEED=<64-char-hex-seed> npm run deploy
```

**Resilient sync.** The wallet SDK creates its indexer WebSocket client with
`shouldRetry: () => false`, so a single transient socket drop aborts an otherwise-healthy (and long)
sync — a fresh Preprod wallet must replay history from the start. `src/deploy.ts` therefore wraps
`waitForSyncedState()` in a retry loop that restarts the wallet (resuming from its in-memory applied
index) up to 10 times instead of crashing.

---

## Using the CLI

```bash
npm run cli
```

Enter the same wallet seed from deployment (also stored in `deployment.json`). Then:

| Option | Action | Cost |
| --- | --- | --- |
| `1` | Store a message — builds a tx, generates a ZK proof, writes on-chain | spends DUST, ~20–30s |
| `2` | Read the current message from the indexer | free |
| `3` | Exit | — |

The current DUST balance is shown in the menu.

---

## Security

- **Never commit** `deployment.json`, `.env`, or the level/private-state database — all are gitignored.
- The private-state password defaults to a lesson-only value in `src/*.ts`; override it with the
  `PRIVATE_STATE_PASSWORD` environment variable (minimum 16 characters) for anything real.
- Testnet only. Do not reuse mainnet seeds here.

---

## Troubleshooting

**`compact` lists files instead of compiling.**
You hit Windows' built-in `compact.exe`. Use `npm run compile`, which routes through `scripts/compile.mjs`.

**`Exception: zkir returned a non-zero exit status -4`.**
Your CPU lacks Intel **ADX** (Haswell and older, some low-power parts). `zkir` cannot generate proving keys.
Use an ADX-capable CPU (Broadwell+/Zen+), a cloud VM/CI runner, or ask for a non-ADX `zkir` build. As a
stopgap, `npm run compile:no-keys` still produces `contract/` and `zkir/`.

**`unauthorized` pulling `ghcr.io/midnight-ntwrk/compactc`.**
The GHCR compiler images require authentication. `scripts/compile.mjs` avoids them by using the public GitHub
release binaries in WSL instead.

**`docker: failed to connect ... dockerDesktopLinuxEngine`.**
Start Docker Desktop and wait for the daemon, then re-run `npm run proof-server:start`.

**Proof server unhealthy / port 6300 busy.**
`npm run proof-server:stop` then `npm run proof-server:start`; check `docker compose ps`.

**`Wallet.Sync: [object Object]` / sync aborts after a long wait.**
The SDK's indexer WebSocket client disables retries (`shouldRetry: () => false`), so a transient drop
kills the sync. `src/deploy.ts` now retries the sync automatically; if it still fails, check the
indexer (`https://indexer.preprod.midnight.network/api/v4/graphql`) and node
(`https://rpc.preprod.midnight.network`) reachability and re-run.

---

## Verification log

Performed on this machine:

- ✅ `npm install` — 179 packages, 0 vulnerabilities
- ✅ `npm run build` (`tsc --noEmit`) — no errors
- ✅ `npm run compile:no-keys` — produced `contract/index.js`, `compiler/contract-info.json`, `zkir/storeMessage.zkir`
- ✅ `npm run proof-server:start` — container `hello-world-compact-proof-server-1` **Up (healthy)** on `127.0.0.1:6300`
- ✅ Compiler identity verified: `compactc 0.31.1` → language `0.23.0`, runtime `0.16.0`, ledger `8.0.2`
- ⛔ `npm run compile` — blocked **locally** at `zkir` (missing ADX)
- ✅ `npm run compile` — **succeeds in GitHub Actions** (ubuntu-latest has ADX); run #1 generated proving/verifying keys and uploaded the `managed-hello-world` artifact
- ✅ Compiled keys fetched locally from the rolling `compiled-latest` release (`storeMessage.prover` 22 KB, `storeMessage.verifier` 1.3 KB)
- 🔄 `npm run deploy` — wallet funded from the Preprod faucet; syncing then deploying
- ⏳ `npm run cli` — pending a successful deployment

---

## Roadmap

1. ~~Generate the keys in CI and place them at `contracts/managed/hello-world/`~~ ✅ done (rolling release `compiled-latest`).
2. ~~Fund the Preprod wallet from the faucet~~ ✅ funded — DUST registration happens inside `npm run deploy`.
3. Deploy, then store and read back `"Hello from Midnight!"`.
4. Optionally scaffold with `npx create-mn-app my-app` to compare with the manual flow.
5. Extend the contract (e.g. access control, multiple messages) once the pipeline is proven.

---

## Credits

Based on the Midnight "Hello World" lesson (`build.md`). Contract, deploy script, and CLI follow that lesson;
the cross-platform compile wrapper and documentation here are additions to make the toolchain work on Windows.
