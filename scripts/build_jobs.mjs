#!/usr/bin/env node
// Build the private job-tracker page: _private/jobs.json + scripts/jobs/template.html
// -> _private/build/index.html (plaintext, never committed)
// -> jobs/index.html (staticrypt-encrypted, the only artifact that goes into the repo)
//
// Usage:
//   npm run build:jobs            render + encrypt + verify (decrypt round-trip + leak scan)
//   npm run verify:jobs           verify the committed jobs/index.html only
//
// The password lives in _private/.jobs_password (gitignored). A random one is
// generated on first run; replace the file content to use your own password and rebuild.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...s) => path.join(ROOT, ...s);

const DATA = P('_private', 'jobs.json');
const TEMPLATE = P('scripts', 'jobs', 'template.html');
const PLAIN_DIR = P('_private', 'build');
const PLAIN = path.join(PLAIN_DIR, 'index.html');
const OUT_DIR = P('jobs');
const OUT = path.join(OUT_DIR, 'index.html');
const PW_FILE = P('_private', '.jobs_password');
const CFG = P('_private', '.staticrypt.json');
const VERIFY_DIR = P('_private', 'verify');
const STATICRYPT_CLI = P('node_modules', 'staticrypt', 'cli', 'index.js');

const VALID_TIERS = new Set(['A', 'B', 'C']);
const REQUIRED_JOB_FIELDS = ['id', 'company', 'country', 'title', 'location', 'url', 'tier', 'status', 'posted', 'added'];

const verifyOnly = process.argv.includes('--verify-only');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function loadPassword() {
  if (existsSync(PW_FILE)) {
    const pw = readFileSync(PW_FILE, 'utf8').trim();
    if (pw.length < 12) fail('password in _private/.jobs_password is shorter than 12 characters');
    return pw;
  }
  if (verifyOnly) fail('no _private/.jobs_password to verify with');
  const pw = randomBytes(15).toString('base64url'); // 20 chars, URL-safe
  mkdirSync(path.dirname(PW_FILE), { recursive: true });
  writeFileSync(PW_FILE, `${pw}\n`, { mode: 0o600 });
  console.log('• generated a new password and saved it to _private/.jobs_password (gitignored)');
  return pw;
}

function loadData() {
  if (!existsSync(DATA)) fail('missing _private/jobs.json');
  let data;
  try {
    data = JSON.parse(readFileSync(DATA, 'utf8'));
  } catch (e) {
    fail(`jobs.json is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(data.jobs)) fail('jobs.json: "jobs" must be an array');
  const statuses = data.statuses || {};
  const ids = new Set();
  data.jobs.forEach((j, i) => {
    for (const f of REQUIRED_JOB_FIELDS) {
      if (j[f] === undefined || j[f] === null || j[f] === '') fail(`jobs[${i}] (${j.id || '?'}): missing field "${f}"`);
    }
    if (ids.has(j.id)) fail(`duplicate job id "${j.id}"`);
    ids.add(j.id);
    if (!VALID_TIERS.has(j.tier)) fail(`jobs[${i}] (${j.id}): tier must be A, B or C`);
    if (!statuses[j.status]) fail(`jobs[${i}] (${j.id}): unknown status "${j.status}"`);
    if (!/^https?:\/\//.test(j.url)) fail(`jobs[${i}] (${j.id}): url must start with http(s)://`);
  });
  if (!data.updated) fail('jobs.json: missing "updated"');

  // Region / skill filters: every job must land in a known bucket, defaults must be valid.
  const f = data.filters;
  if (!f || !Array.isArray(f.regions) || !Array.isArray(f.skills)) fail('jobs.json: "filters.regions" and "filters.skills" must be arrays');
  const regions = new Set(f.regions);
  const skills = new Set(f.skills);
  data.jobs.forEach((j, i) => {
    if (!regions.has(j.region)) fail(`jobs[${i}] (${j.id}): region "${j.region}" is not in filters.regions`);
    if (!skills.has(j.skill)) fail(`jobs[${i}] (${j.id}): skill "${j.skill}" is not in filters.skills`);
  });
  const d = f.defaults || {};
  for (const t of d.tiers || []) if (!VALID_TIERS.has(t)) fail(`filters.defaults.tiers: unknown tier "${t}"`);
  for (const r of d.regions || []) if (!regions.has(r)) fail(`filters.defaults.regions: unknown region "${r}"`);
  for (const s of d.skills || []) if (!skills.has(s)) fail(`filters.defaults.skills: unknown skill "${s}"`);
  return data;
}

function render(data) {
  const tpl = readFileSync(TEMPLATE, 'utf8');
  for (const ph of ['__JOBS_JSON__', '__UPDATED__', '__BUILT_AT__']) {
    if (!tpl.includes(ph)) fail(`template missing placeholder ${ph}`);
  }
  // Keep the JSON safe inside a <script type="application/json"> block: escaping "<"
  // means no "</script>" in the data can end the block early.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return tpl
    .replace('__JOBS_JSON__', () => json)
    .replace('__UPDATED__', () => data.updated)
    .replace('__BUILT_AT__', () => new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
}

function staticrypt(args, pw) {
  if (!existsSync(STATICRYPT_CLI)) fail('staticrypt is not installed; run `npm install` in the site root');
  // staticrypt resolves some paths (e.g. -c) by joining them onto the cwd, which breaks
  // absolute Windows paths. Pass everything under ROOT as a relative, forward-slash path.
  const relArgs = args.map(a => (path.isAbsolute(a) && a.startsWith(ROOT))
    ? path.relative(ROOT, a).split(path.sep).join('/')
    : a);
  const r = spawnSync(process.execPath, [STATICRYPT_CLI, ...relArgs], {
    cwd: ROOT,
    env: { ...process.env, STATICRYPT_PASSWORD: pw },
    encoding: 'utf8',
  });
  if (r.status !== 0) fail(`staticrypt failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

function encrypt(pw) {
  mkdirSync(OUT_DIR, { recursive: true });
  staticrypt([
    PLAIN,
    '-d', OUT_DIR,
    '-c', CFG,
    '--remember', '30',
    '--short',
    '--template-title', 'Carseus Lai - Job Tracker',
    '--template-instructions', 'Private page. Enter the password to unlock the job tracker.',
    '--template-button', 'Unlock',
    '--template-placeholder', 'Password',
    '--template-color-primary', '#2563eb',
    '--template-color-secondary', '#0f1115',
  ], pw);
  if (!existsSync(OUT)) fail(`expected ${path.relative(ROOT, OUT)} after encryption but it was not produced`);
}

function verify(pw, data) {
  if (!existsSync(OUT)) fail('jobs/index.html does not exist');
  const out = readFileSync(OUT, 'utf8');

  // 1. It must be staticrypt output, not a leaked plaintext render.
  if (!out.includes('staticrypt')) fail('jobs/index.html is not staticrypt output');
  if (out.includes('__JOBS_JSON__') || out.includes('"jobs":[')) fail('jobs/index.html contains plaintext markers');

  // 2. Nothing from the data or the password may appear in clear.
  if (out.includes(pw)) fail('password found in jobs/index.html');
  if (data) {
    for (const j of data.jobs) {
      for (const v of [j.company, j.title, j.url]) {
        if (v && out.includes(v)) fail(`plaintext leak in jobs/index.html: ${j.id} (${v.slice(0, 40)})`);
      }
    }
  }

  // 3. Decrypt round-trip with the password must reproduce the rendered page.
  rmSync(VERIFY_DIR, { recursive: true, force: true });
  staticrypt([OUT, '--decrypt', '-d', VERIFY_DIR, '-c', CFG], pw);
  const decrypted = path.join(VERIFY_DIR, 'index.html');
  if (!existsSync(decrypted)) fail('decrypt round-trip produced no file');
  if (existsSync(PLAIN)) {
    const a = readFileSync(decrypted, 'utf8');
    const b = readFileSync(PLAIN, 'utf8');
    if (a !== b) fail('decrypt round-trip does not match the rendered plaintext');
  }
  rmSync(VERIFY_DIR, { recursive: true, force: true });
}

const pw = loadPassword();
if (verifyOnly) {
  const data = existsSync(DATA) ? loadData() : null;
  verify(pw, data);
  console.log(`✔ jobs/index.html verified (decrypts with the stored password, no plaintext leak)`);
} else {
  const data = loadData();
  mkdirSync(PLAIN_DIR, { recursive: true });
  writeFileSync(PLAIN, render(data));
  encrypt(pw);
  verify(pw, data);
  const bytes = readFileSync(OUT).length;
  console.log(`✔ built jobs/index.html (${bytes} bytes, ${data.jobs.length} jobs, updated ${data.updated}); round-trip verified`);
}
