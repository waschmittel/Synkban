# Third-party notices

Synkban itself is MIT-licensed (see `LICENSE`). It bundles and depends on the
third-party components below, each under its own license.

## Fonts embedded in the binary (PDF export)

The fonts in `backend/fonts/` are compiled into the `synkban` binary. Their
full license texts are in `backend/fonts/licenses/`.

| Font | License | Text |
| --- | --- | --- |
| DejaVu Sans / Sans Mono (Bitstream Vera + Arev) | Bitstream Vera License (permissive) | `backend/fonts/licenses/DejaVu-LICENSE.txt` |
| Noto Emoji | SIL Open Font License 1.1 | `backend/fonts/licenses/NotoEmoji-OFL.txt` |
| Noto Sans Arabic | SIL Open Font License 1.1 | `backend/fonts/licenses/NotoSansArabic-OFL.txt` |
| Noto Sans Hebrew | SIL Open Font License 1.1 | `backend/fonts/licenses/NotoSansHebrew-OFL.txt` |
| Noto Sans Devanagari | SIL Open Font License 1.1 | `backend/fonts/licenses/NotoSansDevanagari-OFL.txt` |
| Noto Sans Thai | SIL Open Font License 1.1 | `backend/fonts/licenses/NotoSansThai-OFL.txt` |

The fonts are redistributed unmodified and bundled with this software, not
sold on their own. The OFL reserved font names are not used for any derived
font.

## Libraries

- **Backend (Rust crates)** — actix-web, actix-cors, serde, serde_json, uuid,
  tokio, include_dir, mime_guess, image, toml, krilla, rustybuzz and their
  transitive dependencies are licensed under MIT and/or Apache-2.0 (a few
  under other permissive licenses such as BSD or Unicode). List them with
  `cargo install cargo-license && cargo license` in `backend/`.
- **Frontend** — SolidJS, @solidjs/router, the ProseMirror packages, Vite and
  their dependencies are MIT-licensed (some dependencies use ISC, BSD or
  Apache-2.0). List them with `pnpm licenses list` in `frontend/`.
- **Desktop shell** — Electron (MIT) and the Chromium and Node.js components
  it bundles. electron-builder ships their license files with the packaged
  app (`LICENSE.electron.txt`, `LICENSES.chromium.html`).
