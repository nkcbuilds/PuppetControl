#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  rename,
  rmdir,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REV2D_REPO = 'https://github.com/RevStudio/Rev2D.git';
const REV2D_SLUG = 'github.com/revstudio/rev2d';
const REV2D_SHA = 'f144581cdf1f12d781379c4df90d262b8c2dfa3d';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const cacheDir = join(projectRoot, '.cache');
const targetDir = join(cacheDir, 'rev2d');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(argv) {
  const options = {
    install: false,
    statusOnly: false,
    json: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--install') options.install = true;
    else if (arg === '--status') options.statusOnly = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }

  if (options.install && options.statusOnly) {
    throw new Error('--install and --status cannot be used together');
  }

  return options;
}

function usage() {
  return `Usage: node scripts/setup-rev2d.mjs [--status] [--install] [--json]

Pins RevStudio/Rev2D at:
  ${REV2D_SHA}

Target:
  .cache/rev2d

Behavior:
  (no flags)   Clone or safely fetch/check out the pinned commit. Does NOT install dependencies.
  --status     Read-only status check. Does not clone, fetch, check out, or install anything.
  --install    Prepare the pinned checkout, then explicitly run npm ci in .cache/rev2d.
  --json       Print the final status as JSON.
  --help       Show this help.

Safety:
  Existing non-Rev2D data at .cache/rev2d is never deleted or overwritten.
  A dirty Rev2D checkout is never reset or switched to another commit.
  npm ci only runs when --install is explicitly supplied.
`;
}

function nodeMajor() {
  const match = /^v?(\d+)/.exec(process.version);
  return match ? Number(match[1]) : 0;
}

function run(command, args, { cwd = projectRoot, env = {} } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...env,
      },
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolveRun({
        code: code ?? 1,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function directoryIsEmpty(path) {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return false;
  }
}

function githubSlug(remote) {
  let value = remote.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');

  const scp = /^git@github\.com:(.+)$/i.exec(value);
  if (scp) return `github.com/${scp[1].toLowerCase()}`;

  const ssh = /^ssh:\/\/git@github\.com\/(.+)$/i.exec(value);
  if (ssh) return `github.com/${ssh[1].toLowerCase()}`;

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    return `github.com/${url.pathname.replace(/^\/+/, '').toLowerCase()}`;
  } catch {
    return null;
  }
}

async function git(args, cwd = targetDir) {
  return run('git', args, { cwd });
}

async function inspectCheckout(dir = targetDir) {
  const status = {
    exists: await pathExists(dir),
    isDirectory: false,
    isSymlink: false,
    isGitRepo: false,
    expectedRemote: false,
    origin: null,
    head: null,
    pinnedCommitAvailable: false,
    pinned: false,
    dirty: null,
    dependenciesInstalled: false,
    runtimeSmokeOk: false,
  };

  if (!status.exists) return status;

  const stat = await lstat(dir);
  status.isSymlink = stat.isSymbolicLink();
  status.isDirectory = stat.isDirectory();
  if (!status.isDirectory || status.isSymlink) return status;

  const inside = await git(['rev-parse', '--is-inside-work-tree'], dir);
  status.isGitRepo = inside.code === 0 && inside.stdout === 'true';
  if (!status.isGitRepo) return status;

  const origin = await git(['remote', 'get-url', 'origin'], dir);
  if (origin.code === 0) {
    status.origin = origin.stdout;
    status.expectedRemote = githubSlug(origin.stdout) === REV2D_SLUG;
  }

  const head = await git(['rev-parse', 'HEAD'], dir);
  if (head.code === 0) {
    status.head = head.stdout.toLowerCase();
    status.pinned = status.head === REV2D_SHA;
  }

  const pin = await git(['rev-parse', '--verify', `${REV2D_SHA}^{commit}`], dir);
  status.pinnedCommitAvailable =
    pin.code === 0 && pin.stdout.toLowerCase() === REV2D_SHA;

  const worktree = await git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    dir,
  );
  if (worktree.code === 0) status.dirty = worktree.stdout.length > 0;

  status.dependenciesInstalled =
    (await pathExists(join(dir, 'node_modules', 'tsx', 'package.json'))) &&
    (await pathExists(join(dir, 'node_modules', '.package-lock.json')));

  if (status.pinned && status.dirty === false && status.dependenciesInstalled) {
    const smoke = await run(
      process.execPath,
      ['bin/rev2d.js', 'help', 'render'],
      { cwd: dir },
    );
    status.runtimeSmokeOk = smoke.code === 0;
  }

  return status;
}

function assertSafeExistingTarget(status) {
  if (!status.exists) return;

  if (status.isSymlink) {
    throw new Error(
      `${targetDir} is a symbolic link; refusing to modify it`,
    );
  }

  if (!status.isDirectory) {
    throw new Error(
      `${targetDir} exists but is not a directory; refusing to overwrite it`,
    );
  }

  if (!status.isGitRepo) {
    throw new Error(
      `${targetDir} exists but is not a Git checkout; refusing to overwrite or delete existing data`,
    );
  }

  if (!status.expectedRemote) {
    throw new Error(
      `${targetDir} is a Git checkout whose origin is not ${REV2D_REPO}; refusing to modify it (origin: ${status.origin ?? 'missing'})`,
    );
  }
}

async function verifyPinnedCommit(dir) {
  const verified = await git(
    ['rev-parse', '--verify', `${REV2D_SHA}^{commit}`],
    dir,
  );
  if (verified.code !== 0 || verified.stdout.toLowerCase() !== REV2D_SHA) {
    throw new Error(
      `Rev2D commit ${REV2D_SHA} is not available in ${dir}`,
    );
  }
}

async function fetchPinnedCommit(dir) {
  let fetched = await git(
    ['fetch', '--no-tags', 'origin', REV2D_SHA],
    dir,
  );

  if (fetched.code !== 0) {
    fetched = await git(
      ['fetch', '--no-tags', 'origin', 'main'],
      dir,
    );
  }

  if (fetched.code !== 0) {
    const detail = fetched.stderr || fetched.stdout || 'git fetch failed';
    throw new Error(`could not fetch Rev2D from origin: ${detail}`);
  }

  await verifyPinnedCommit(dir);
}

async function checkoutPin(dir) {
  const before = await inspectCheckout(dir);
  assertSafeExistingTarget(before);

  if (before.dirty) {
    throw new Error(
      `${dir} has local changes; refusing to reset or switch commits. Preserve or move those changes, then run this script again.`,
    );
  }

  if (!before.pinnedCommitAvailable) {
    await fetchPinnedCommit(dir);
  }

  if (!before.pinned) {
    const checkout = await git(['checkout', '--detach', REV2D_SHA], dir);
    if (checkout.code !== 0) {
      const detail = checkout.stderr || checkout.stdout || 'git checkout failed';
      throw new Error(`could not check out pinned Rev2D commit: ${detail}`);
    }
  }

  const after = await inspectCheckout(dir);
  if (!after.pinned || after.dirty !== false) {
    throw new Error(
      'Rev2D checkout did not reach the expected clean pinned state',
    );
  }
}

async function clonePinnedCheckout() {
  await mkdir(cacheDir, { recursive: true });

  if (await pathExists(targetDir)) {
    if (await directoryIsEmpty(targetDir)) {
      const cloned = await git(
        ['clone', '--no-tags', REV2D_REPO, targetDir],
        projectRoot,
      );
      if (cloned.code !== 0) {
        const detail = cloned.stderr || cloned.stdout || 'git clone failed';
        throw new Error(
          `could not clone Rev2D into the existing empty directory ${targetDir}: ${detail}`,
        );
      }
      await checkoutPin(targetDir);
      return;
    }

    const existing = await inspectCheckout(targetDir);
    assertSafeExistingTarget(existing);
    await fetchPinnedCommit(targetDir);
    await checkoutPin(targetDir);
    return;
  }

  const tempRoot = await mkdtemp(join(cacheDir, 'rev2d-clone-'));
  const tempCheckout = join(tempRoot, 'checkout');

  const cloned = await git(
    ['clone', '--no-tags', REV2D_REPO, tempCheckout],
    projectRoot,
  );
  if (cloned.code !== 0) {
    const detail = cloned.stderr || cloned.stdout || 'git clone failed';
    throw new Error(
      `could not clone Rev2D. Partial clone, if any, was left untouched at ${tempCheckout}: ${detail}`,
    );
  }

  await checkoutPin(tempCheckout);

  if (await pathExists(targetDir)) {
    throw new Error(
      `${targetDir} appeared while cloning. The verified temporary checkout was left at ${tempCheckout}; refusing to overwrite the existing target.`,
    );
  }

  await rename(tempCheckout, targetDir);

  try {
    await rmdir(tempRoot);
  } catch {
    // The temporary parent should be empty after the atomic rename. If not, leave it untouched.
  }
}

async function prepareCheckout() {
  const existing = await inspectCheckout(targetDir);

  if (!existing.exists || (!existing.isGitRepo && existing.isDirectory && await directoryIsEmpty(targetDir))) {
    await clonePinnedCheckout();
    return;
  }

  assertSafeExistingTarget(existing);

  await fetchPinnedCommit(targetDir);

  const refreshed = await inspectCheckout(targetDir);
  if (refreshed.dirty) {
    throw new Error(
      `${targetDir} has local changes; fetched the pinned commit but did not reset or switch the working tree`,
    );
  }

  await checkoutPin(targetDir);
}

async function installDependencies() {
  if (nodeMajor() < 22) {
    throw new Error(
      `Rev2D requires Node >= 22; current runtime is ${process.version}`,
    );
  }

  const lockfile = join(targetDir, 'package-lock.json');
  if (!(await pathExists(lockfile))) {
    throw new Error(
      `pinned Rev2D checkout has no package-lock.json at ${lockfile}; refusing an unpinned dependency install`,
    );
  }

  const installed = await run(
    npmCommand,
    ['ci', '--no-audit', '--no-fund'],
    { cwd: targetDir },
  );

  if (installed.code !== 0) {
    const detail = installed.stderr || installed.stdout || 'npm ci failed';
    throw new Error(`npm ci failed in the Rev2D checkout: ${detail}`);
  }

  const smoke = await run(
    process.execPath,
    ['bin/rev2d.js', 'help', 'render'],
    { cwd: targetDir },
  );

  if (smoke.code !== 0) {
    const detail = smoke.stderr || smoke.stdout || 'Rev2D CLI smoke check failed';
    throw new Error(
      `dependencies installed, but the Rev2D CLI smoke check failed: ${detail}`,
    );
  }
}

function summarize(checkout, action, error = null) {
  const checkoutReady =
    checkout.exists &&
    checkout.isGitRepo &&
    checkout.expectedRemote &&
    checkout.pinned &&
    checkout.dirty === false;

  const runtimeReady =
    checkoutReady &&
    checkout.dependenciesInstalled &&
    checkout.runtimeSmokeOk;

  return {
    ok: error === null && checkoutReady,
    action,
    repo: REV2D_REPO,
    pin: REV2D_SHA,
    target: targetDir,
    node: {
      version: process.version,
      compatible: nodeMajor() >= 22,
    },
    checkout: {
      ...checkout,
      ready: checkoutReady,
    },
    runtimeReady,
    dependencyInstallOptIn: '--install',
    error: error ? String(error.message ?? error) : null,
  };
}

function printHuman(report) {
  const relTarget = '.cache/rev2d';

  console.log('Rev2D setup status');
  console.log(`  target:       ${relTarget}`);
  console.log(`  pinned SHA:   ${report.pin}`);
  console.log(`  exists:       ${report.checkout.exists ? 'yes' : 'no'}`);
  console.log(`  expected repo:${report.checkout.expectedRemote ? ' yes' : ' no'}`);
  console.log(`  HEAD pinned:  ${report.checkout.pinned ? 'yes' : 'no'}`);
  console.log(
    `  worktree:     ${report.checkout.dirty === null ? 'unknown' : report.checkout.dirty ? 'dirty (left untouched)' : 'clean'}`,
  );
  console.log(
    `  dependencies: ${report.checkout.dependenciesInstalled ? 'present' : 'not installed'}`,
  );
  console.log(
    `  CLI smoke:    ${report.checkout.runtimeSmokeOk ? 'ok' : 'not verified'}`,
  );
  console.log(
    `  Node:         ${report.node.version} (${report.node.compatible ? 'compatible' : 'Rev2D needs >=22'})`,
  );
  console.log(
    `  checkout:     ${report.checkout.ready ? 'ready' : 'not ready'}`,
  );
  console.log(
    `  runtime:      ${report.runtimeReady ? 'ready' : 'not ready'}`,
  );

  if (!report.checkout.dependenciesInstalled && report.checkout.ready) {
    console.log('  next:          node scripts/setup-rev2d.mjs --install');
  }

  if (report.error) {
    console.error(`error: ${report.error}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    console.error('run with --help for usage');
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  let error = null;
  const action = options.statusOnly
    ? 'status'
    : options.install
      ? 'prepare+install'
      : 'prepare';

  try {
    if (!options.statusOnly) {
      await prepareCheckout();
      if (options.install) await installDependencies();
    }
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught));
  }

  const checkout = await inspectCheckout(targetDir);
  const report = summarize(checkout, action, error);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }

  if (error || !report.checkout.ready || (options.install && !report.runtimeReady)) {
    process.exitCode = 1;
  }
}

await main();
