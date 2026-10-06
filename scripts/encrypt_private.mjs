#!/usr/bin/env node
// Encrypt the private page: _private/build/index.html (plaintext, gitignored, rendered
// elsewhere) -> p/index.html (staticrypt output, the only file that goes into the repo).
//
// Usage:
//   npm run build:private     encrypt + verify (decrypt round-trip + leak scan)
//   npm run verify:private    verify the existing p/index.html only
//
// The password lives in _private/.password (gitignored). A random one is generated on
// first run; replace the file content to use your own password and rebuild.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...s) => path.join(ROOT, ...s);

const PLAIN = P('_private', 'build', 'index.html');
const OUT_DIR = P('p');
const OUT = path.join(OUT_DIR, 'index.html');
const PW_FILE = P('_private', '.password');
const CFG = P('_private', '.staticrypt.json');
const VERIFY_DIR = P('_private', 'verify');
const STATICRYPT_CLI = P('node_modules', 'staticrypt', 'cli', 'index.js');
// The plaintext page keeps its data in <script id="page-data">; that must never be public.
const PLAIN_MARKER = 'id="page-data"';
const SAMPLE_LEN = 24;
const SAMPLE_COUNT = 60;

const verifyOnly = process.argv.includes('--verify-only');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function loadPassword() {
  if (existsSync(PW_FILE)) {
    const pw = readFileSync(PW_FILE, 'utf8').trim();
    if (pw.length < 12) fail('password in _private/.password is shorter than 12 characters');
    return pw;
  }
  if (verifyOnly) fail('no _private/.password to verify with');
  const pw = randomBytes(15).toString('base64url'); // 20 chars, URL-safe
  mkdirSync(path.dirname(PW_FILE), { recursive: true });
  writeFileSync(PW_FILE, `${pw}\n`, { mode: 0o600 });
  console.log('• generated a new password and saved it to _private/.password (gitignored)');
  return pw;
}

function staticrypt(args, pw) {
  if (!existsSync(STATICRYPT_CLI)) fail('staticrypt is not installed; run `npm install` in the site root');
  // staticrypt joins some paths (e.g. -c) onto the cwd, which breaks absolute Windows
  // paths. Pass everything under ROOT as a relative, forward-slash path.
  const relArgs = args.map(a => (path.isAbsolute(a) && a.startsWith(ROOT))
    ? path.relative(ROOT, a).split(path.sep).join('/')
    : a);
  const r = spawnSync(process.execPath, [STATICRYPT_CLI, ...relArgs], {
    cwd: ROOT,
    env: { ...process.env, STATICRYPT_PASSWORD: pw },
    encoding: 'utf8',
  });
  if (r.status !== 0) fail(`staticrypt failed:\n${r.stdout}${r.stderr}`);
}

function encrypt(pw) {
  mkdirSync(OUT_DIR, { recursive: true });
  staticrypt([
    PLAIN,
    '-d', OUT_DIR,
    '-c', CFG,
    '--remember', '30',
    '--short',
    '--template-title', 'Private',
    '--template-instructions', 'Enter the password to continue.',
    '--template-button', 'Unlock',
    '--template-placeholder', 'Password',
    '--template-color-primary', '#2563eb',
    '--template-color-secondary', '#0f1115',
  ], pw);
  if (!existsSync(OUT)) fail('expected p/index.html after encryption but it was not produced');
}

// Evenly spaced slices of the plaintext page; none of them may survive into the output.
function samples(plain) {
  const out = [];
  const step = Math.max(SAMPLE_LEN, Math.floor(plain.length / SAMPLE_COUNT));
  for (let i = 0; i + SAMPLE_LEN <= plain.length; i += step) {
    const s = plain.slice(i, i + SAMPLE_LEN);
    if (s.trim().length === SAMPLE_LEN && !/^\s*[<{}\[\];,]/.test(s)) out.push(s);
  }
  return out;
}

function verify(pw) {
  if (!existsSync(OUT)) fail('p/index.html does not exist');
  const out = readFileSync(OUT, 'utf8');
  if (!out.includes('staticrypt')) fail('p/index.html is not staticrypt output');
  if (out.includes(PLAIN_MARKER)) fail('p/index.html contains the plaintext data block');
  if (out.includes(pw)) fail('password found in p/index.html');

  rmSync(VERIFY_DIR, { recursive: true, force: true });
  staticrypt([OUT, '--decrypt', '-d', VERIFY_DIR, '-c', CFG], pw);
  const decrypted = path.join(VERIFY_DIR, 'index.html');
  if (!existsSync(decrypted)) fail('decrypt round-trip produced no file');
  if (existsSync(PLAIN)) {
    const plain = readFileSync(PLAIN, 'utf8');
    if (readFileSync(decrypted, 'utf8') !== plain) fail('decrypt round-trip does not match the plaintext');
    // staticrypt's own lock page shares some markup with any HTML page; only flag slices
    // that are not part of that lock page.
    const leaks = samples(plain).filter(s => out.includes(s));
    const lockPage = readFileSync(P('node_modules', 'staticrypt', 'lib', 'password_template.html'), 'utf8');
    const real = leaks.filter(s => !lockPage.includes(s));
    if (real.length) fail(`plaintext leak in p/index.html: ${JSON.stringify(real[0])}`);
  }
  rmSync(VERIFY_DIR, { recursive: true, force: true });
}

const pw = loadPassword();
if (!verifyOnly) {
  if (!existsSync(PLAIN)) fail('missing _private/build/index.html (render the page first)');
  encrypt(pw);
}
verify(pw);
console.log(`✔ p/index.html ${verifyOnly ? 'verified' : `built (${readFileSync(OUT).length} bytes)`}; decrypt round-trip and leak scan passed`);
