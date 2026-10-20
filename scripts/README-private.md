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

# Full CV (`/cv/`)

Also password-protected, with its own password and a custom lock screen.

| Path | In git? | Purpose |
|------|---------|---------|
| `_private/cv/index.html` | no | Plaintext CV — edit this one |
| `_private/.cv_password` | no | Unlock password (one line) |
| `scripts/cv_page.mjs` | yes | Decrypt / encrypt + verify |
| `cv/index.html` | yes | staticrypt output served by GitHub Pages |

```sh
npm run decrypt:cv   # cv/index.html -> _private/cv/index.html (only when the plaintext is missing)
npm run build:cv     # encrypt + verify -> cv/index.html
npm run verify:cv    # check the committed page decrypts and leaks nothing
```

A build keeps the lock screen and salt of the current `cv/index.html` and swaps in only the
new ciphertext, so the page looks the same and visitors' "remember me" keeps working.

## CV images (watermarked, never public)

Put your own pictures in `_private/cv/cv-img/` (gitignored) and reference them as
`<img src="cv-img/NAME.png">`. `npm run build:cv` runs `scripts/cv_images.py`, which shrinks each
one to at most 1100 px, adds a "© Carseus Lai" watermark (faint diagonal repeats + a corner
label) and embeds it in the encrypted page; nothing goes to the public `images/` folder.
Add `class="zoomable"` for click-to-enlarge. Needs Python with Pillow (`PYTHON` overrides
the interpreter). Company or product images stay in `images/` without a watermark.

The originals in `cv-img/` and the plaintext CV live only on this machine. After each good
build, `build:cv` copies both to the folder named in `_private/.cv_backup_dir` (one line,
gitignored; e.g. a Google Drive folder). Files are added or overwritten, never deleted, and the
password is not copied. If the folder is unreachable the build still succeeds with a warning.

Both pages load `/assets/js/lang-toggle.js` for the zh / en switch: wrap text in
`.lang-zh` / `.lang-en`, and any `[data-lang-toggle]` element flips the language.
