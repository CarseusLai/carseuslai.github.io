# Private page (`/p/`)

A password-protected page. Only the encrypted output is committed.

| Path | In git? | Purpose |
|------|---------|---------|
| `_private/build/index.html` | no | Plaintext page, rendered outside this repo |
| `_private/.password` | no | Unlock password; generated on first build if missing |
| `_private/.staticrypt.json` | no | staticrypt salt so "remember me" survives rebuilds |
| `scripts/encrypt_private.mjs` | yes | Encrypt, then check a decrypt round-trip and scan for plaintext |
| `scripts/git-hooks/pre-commit` | yes | Refuses `_private/`, plaintext and the password in any commit |
| `p/index.html` | yes | staticrypt output served by GitHub Pages |

```sh
npm install              # once
npm run build:private    # encrypt + verify  -> p/index.html
npm run verify:private   # check the committed page decrypts and leaks nothing
git config core.hooksPath scripts/git-hooks   # once per clone
```

The repo is public, so the ciphertext can be downloaded and brute-forced offline.
staticrypt uses PBKDF2 (600k iterations) + AES-256-CBC; keep the password long and random.
