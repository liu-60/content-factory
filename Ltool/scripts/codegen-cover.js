#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const url = args.url || args._[0];
const platform = args.platform || inferPlatform(url) || 'draft';
const output = resolve(args.output || `Ltool/recordings/${platform}-cover.codegen.js`);
const userDataDir = resolve(args['user-data-dir'] || process.env.LTOOL_CODEGEN_USER_DATA_DIR || '.playwright/ltool-codegen-profile');
const channel = args.channel || process.env.LTOOL_CODEGEN_CHANNEL || 'msedge';

if (!url) {
  console.error(`Usage:
  npm run codegen:cover -- --url <draft-url> [--platform toutiao|baijiahao] [--output <file>]

Examples:
  npm run codegen:cover -- --platform toutiao --url "https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=..."
  npm run codegen:cover -- --platform baijiahao --url "https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=..."
`);
  process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });
mkdirSync(userDataDir, { recursive: true });

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const childArgs = [
  'playwright',
  'codegen',
  '--target',
  'javascript',
  '--channel',
  channel,
  '--user-data-dir',
  userDataDir,
  '--output',
  output,
  url,
];

console.log(`Starting Playwright codegen for ${platform}`);
console.log(`Draft URL: ${url}`);
console.log(`Output: ${output}`);
console.log(`Profile: ${userDataDir}`);
console.log(`Browser channel: ${channel}`);
console.log('');
console.log('Record only the cover upload flow, then close the codegen window to save the file.');

if (process.env.LTOOL_CODEGEN_DRY_RUN === '1' || args['dry-run']) {
  console.log('');
  console.log(formatCommand(command, childArgs));
  process.exit(0);
}

const child = spawnCodegen(command, childArgs);

child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function inferPlatform(value = '') {
  if (value.includes('toutiao.com')) return 'toutiao';
  if (value.includes('baijiahao.baidu.com')) return 'baijiahao';
  return '';
}

function spawnCodegen(command, childArgs) {
  if (process.platform === 'win32') {
    return spawn(formatCommand(command, childArgs), {
      stdio: 'inherit',
      shell: true,
      windowsHide: false,
    });
  }
  return spawn(command, childArgs, {
    stdio: 'inherit',
    shell: false,
  });
}

function formatCommand(command, childArgs) {
  return [command, ...childArgs].map(quoteArg).join(' ');
}

function quoteArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^?=]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
