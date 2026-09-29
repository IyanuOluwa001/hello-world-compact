#!/usr/bin/env node
/**
 * Cross-platform `compact compile` wrapper.
 *
 * Why this exists
 * ---------------
 * The lesson calls `compact compile <source> <out>` directly. That works on
 * macOS/Linux once the Compact toolchain is installed, but:
 *   - There is no native Windows build of the Compact toolchain.
 *   - On Windows, `compact` resolves to C:\Windows\system32\compact.exe
 *     (the NTFS disk-compression utility), so the command silently does the
 *     wrong thing.
 *
 * This wrapper keeps the same UX:
 *   1. If a real native `compact`/`compactc` is available (macOS/Linux or
 *      COMPACT_HOME set), delegate to it.
 *   2. Otherwise (Windows), run the Linux `compactc` binary inside WSL,
 *      downloading it from the public GitHub release on first use.
 *
 * Usage (same args as you would pass after the `compile` subcommand):
 *   node scripts/compile.mjs [--skip-zk] <source.compact> <out-dir>
 *
 * Environment:
 *   COMPACTC_VERSION  Compiler toolchain version (default 0.31.1, which is
 *                     Compact language 0.23.0 / runtime 0.16.0 and matches
 *                     midnight-js 4.1.1).
 *   COMPACT_HOME      Path to a native Compact toolchain (skips WSL entirely).
 *   WSL_DISTRO        WSL distribution to use on Windows (default: Ubuntu).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';

const COMPACTC_VERSION = process.env.COMPACTC_VERSION?.trim() || '0.31.1';
const WSL_DISTRO = process.env.WSL_DISTRO?.trim() || 'Ubuntu';
const COMPACT_HOME = process.env.COMPACT_HOME?.trim();

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/compile.mjs [--skip-zk] <source.compact> <out-dir>');
  process.exit(2);
}

function hasCommand(cmd) {
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return !probe.error;
}

// ── 1. Native toolchain if present ─────────────────────────────────────────────
if (COMPACT_HOME) {
  const compactc = path.join(COMPACT_HOME, process.platform === 'win32' ? 'compactc.exe' : 'compactc');
  run(compactc, args);
} else if (process.platform !== 'win32' && hasCommand('compact')) {
  run('compact', ['compile', ...args]);
} else if (process.platform === 'win32') {
  compileViaWsl();
} else if (hasCommand('compactc')) {
  run('compactc', args);
} else {
  console.error('No Compact toolchain found. Install it, or set COMPACT_HOME.');
  process.exit(1);
}

function run(cmd, cmdArgs) {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}\n`);
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

// ── 2. Windows: delegate to the Linux compactc binary inside WSL ───────────────
function compileViaWsl() {
  const wslCwd = toWslPath(process.cwd());
  const remote = `compactc-${COMPACTC_VERSION}`;
  const compactc = `$HOME/${remote}/compactc`;
  const quotedArgs = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');

  const bash = [
    'set -e',
    // Verify WSL is usable
    `if ! command -v unzip >/dev/null 2>&1; then echo "unzip is required inside WSL (sudo apt install unzip)" >&2; exit 1; fi`,
    // Download the toolchain once
    `if [ ! -x ${compactc} ]; then`,
    `  echo 'Downloading Compact toolchain ${COMPACTC_VERSION} into WSL...' >&2`,
    `  mkdir -p $HOME/${remote}`,
    `  curl -sSL -o $HOME/${remote}/compactc.zip https://github.com/midnightntwrk/compact/releases/download/compactc-v${COMPACTC_VERSION}/compactc_v${COMPACTC_VERSION}_x86_64-unknown-linux-musl.zip`,
    `  unzip -o $HOME/${remote}/compactc.zip -d $HOME/${remote} >/dev/null`,
    `  chmod +x $HOME/${remote}/compactc $HOME/${remote}/compactc.bin $HOME/${remote}/zkir $HOME/${remote}/zkir-v3 2>/dev/null || true`,
    'fi',
    `cd '${wslCwd}'`,
    `${compactc} ${quotedArgs}`,
  ].join('\n');

  console.log(`> wsl -d ${WSL_DISTRO} -- compactc ${args.join(' ')}\n`);
  const res = spawnSync('wsl', ['-d', WSL_DISTRO, '--', 'bash', '-lc', bash], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

function toWslPath(winPath) {
  const m = /^([A-Za-z]):\\(.*)$/.exec(winPath);
  if (!m) throw new Error(`Cannot convert path to WSL form: ${winPath}`);
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}
