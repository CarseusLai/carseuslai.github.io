# Private job tracker (`/jobs/`)

A password-protected page for my own job search. Only the encrypted output is committed.

| Path | In git? | Purpose |
|------|---------|---------|
| `_private/jobs.json` | no | The data (jobs, salary benchmarks, change log) |
| `_private/.jobs_password` | no | Unlock password; generated on first build if missing |
| `_private/.staticrypt.json` | no | staticrypt salt so "remember me" survives rebuilds |
| `scripts/jobs/template.html` | yes | Page template, no data inside |
| `scripts/build_jobs.mjs` | yes | Validate JSON, render, encrypt, decrypt round-trip, leak scan |
| `scripts/git-hooks/pre-commit` | yes | Refuses `_private/`, plaintext markers and the password in any commit |
| `jobs/index.html` | yes | staticrypt output served by GitHub Pages |

```sh
npm install           # once
npm run build:jobs    # render + encrypt + verify  -> jobs/index.html
npm run verify:jobs   # check the committed page decrypts and leaks nothing
git config core.hooksPath scripts/git-hooks   # once per clone
```

Day to day the page is maintained through the `/g-jobs` command in the ai-agent repo
(`.agent/commands/g-jobs.md`), which edits `_private/jobs.json`, runs the build and
commits only `jobs/index.html` with a fixed message.

Threat model: the repo is public, so the ciphertext can be downloaded and brute-forced
offline. staticrypt uses PBKDF2 (600k iterations) + AES-256-CBC; keep the password long
and random, and do not tick "remember me" on shared devices.
