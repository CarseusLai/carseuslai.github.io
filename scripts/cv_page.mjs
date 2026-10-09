#!/usr/bin/env node
// Build the password-protected CV page: _private/cv/index.html (plaintext, gitignored)
// -> cv/index.html (staticrypt output, the only file that goes into the repo).
//
// Usage:
//   npm run decrypt:cv    cv/index.html -> _private/cv/index.html (recover the plaintext)
//   npm run build:cv      encrypt + verify (decrypt round-trip + leak scan)
//   npm run verify:cv     verify the existing cv/index.html only
//
// The password lives in _private/.cv_password (gitignored). cv/index.html uses a custom
// lock screen, so a build keeps that page as is and swaps in only the new ciphertext.
// The salt is read from the page itself and reused, so visitors' "remember me" survives.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...s) => path.join(ROOT, ...s);

const PLAIN = P('_private', 'cv', 'index.html');
const OUT = P('cv', 'index.html');
const PW_FILE = P('_private', '.cv_password');
const WORK_DIR = P('_private', 'cv_work');
const STATICRYPT_CLI = P('node_modules', 'staticrypt', 'cli', 'index.js');
const MSG_RE = /("staticryptEncryptedMsgUniqueVariableName":\s*")([^"]+)(")/;
const SALT_RE = /"staticryptSaltUniqueVariableName":\s*"([0-9a-f]+)"/;
const SAMPLE_LEN = 24;
const SAMPLE_COUNT = 60;

const mode = process.argv[2] || 'build';

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function loadPassword() {
  if (!existsSync(PW_FILE)) fail('missing _private/.cv_password');
  const pw = readFileSync(PW_FILE, 'utf8').trim();
  if (!pw) fail('_private/.cv_password is empty');
  return pw;
}

function pageSalt() {
  const m = readFileSync(OUT, 'utf8').match(SALT_RE);
  if (!m) fail('could not find the staticrypt salt in cv/index.html');
  return m[1];
}

function staticrypt(args, pw) {
  if (!existsSync(STATICRYPT_CLI)) fail('staticrypt is not installed; run `npm install` in the site root');
  // staticrypt joins some paths onto the cwd, which breaks absolute Windows paths.
  const relArgs = args.map(a => (path.isAbsolute(a) && a.startsWith(ROOT))
    ? path.relative(ROOT, a).split(path.sep).join('/')
    : a);
  const r = spawnSync(process.execPath, [STATICRYPT_CLI, ...relArgs], {
    cwd: ROOT,
    env: { ...process.env, STATICRYPT_PASSWORD: pw },
    encoding: 'utf8',
  });
  // staticrypt exits 0 even when decryption fails, so also check its output.
  if (r.status !== 0 || /ERROR/.test(r.stdout)) fail(`staticrypt failed:\n${r.stdout}${r.stderr}`);
}

// Decrypt `file` into `dir` with the page's own salt; returns the plaintext.
function decryptTo(file, dir, pw, salt) {
  rmSync(dir, { recursive: true, force: true });
  staticrypt([file, '--decrypt', '-d', dir, '-s', salt, '-c', 'false'], pw);
  const out = path.join(dir, path.basename(file));
  if (!existsSync(out)) fail(`decrypting ${path.relative(ROOT, file)} produced no file (wrong password?)`);
  return readFileSync(out, 'utf8');
}

function decrypt(pw, salt) {
  if (existsSync(PLAIN)) fail('_private/cv/index.html already exists; move it away first so edits are not lost');
  const plain = decryptTo(OUT, WORK_DIR, pw, salt);
  mkdirSync(path.dirname(PLAIN), { recursive: true });
  writeFileSync(PLAIN, plain);
  rmSync(WORK_DIR, { recursive: true, force: true });
  console.log(`✔ decrypted cv/index.html -> _private/cv/index.html (${plain.length} chars)`);
}

function build(pw, salt) {
  if (!existsSync(PLAIN)) fail('missing _private/cv/index.html (run `npm run decrypt:cv` first)');
  rmSync(WORK_DIR, { recursive: true, force: true });
  staticrypt([PLAIN, '-d', WORK_DIR, '-s', salt, '-c', 'false', '--short'], pw);
  const fresh = readFileSync(path.join(WORK_DIR, 'index.html'), 'utf8').match(MSG_RE);
  if (!fresh) fail('staticrypt output has no ciphertext');
  const page = readFileSync(OUT, 'utf8');
  if (!MSG_RE.test(page)) fail('cv/index.html has no ciphertext to replace');
  writeFileSync(OUT, page.replace(MSG_RE, (_, a, __, c) => a + fresh[2] + c));
  rmSync(WORK_DIR, { recursive: true, force: true });
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

// Lock screen of the last committed cv/index.html, without the ciphertext ('' if unavailable).
function committedShell() {
  const r = spawnSync('git', ['show', 'HEAD:cv/index.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.replace(MSG_RE, '') : '';
}

function verify(pw, salt) {
  const out = readFileSync(OUT, 'utf8');
  if (out.includes(pw)) fail('password found in cv/index.html');
  const decrypted = decryptTo(OUT, WORK_DIR, pw, salt);
  rmSync(WORK_DIR, { recursive: true, force: true });
  if (existsSync(PLAIN)) {
    const plain = readFileSync(PLAIN, 'utf8');
    if (decrypted !== plain) fail('decrypt round-trip does not match _private/cv/index.html');
    // The lock screen legitimately shares some markup with the plaintext (e.g. the favicon),
    // so only flag slices that are not already in the committed lock screen.
    const shell = out.replace(MSG_RE, '');
    const known = committedShell();
    const leaks = samples(plain).filter(s => shell.includes(s) && !known.includes(s));
    if (leaks.length) fail(`plaintext leak in cv/index.html: ${JSON.stringify(leaks[0])}`);
  }
}

if (!['decrypt', 'build', 'verify'].includes(mode)) fail(`unknown mode "${mode}" (decrypt | build | verify)`);
const pw = loadPassword();
const salt = pageSalt();
if (mode === 'decrypt') {
  decrypt(pw, salt);
} else {
  if (mode === 'build') build(pw, salt);
  verify(pw, salt);
  console.log(`✔ cv/index.html ${mode === 'build' ? 'built' : 'verified'}; decrypt round-trip and leak scan passed`);
}
