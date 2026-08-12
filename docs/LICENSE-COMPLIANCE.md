# License compliance

This document records the open-source licenses this project relies on and how it
complies with them. Vibe Block Coding is a fork of Scratch's `scratch-gui`, so the
license situation is inherited from Scratch and extended by our own code.

## This project

- **Package:** `vibe-block-coding`
- **License:** `AGPL-3.0-only` (see [`LICENSE`](../LICENSE))
- **Source:** https://github.com/hcooch2ch3/vibe-block-coding (public)

Our own code lives in `src/lib/ai-harness/`, plus a small mount in
`src/components/gui/gui.jsx`, a dev hook in `src/reducers/vm.js`, and a free-mode
proxy in `api/chat.js`. All of it is a derivative work of the AGPL base and is
released under the same AGPL-3.0-only license.

## Upstream basis

The editor is a fork of [`scratch-gui`](https://github.com/scratchfoundation/scratch-gui)
by the Scratch Foundation, licensed under AGPL-3.0. The Scratch runtime packages
we depend on carry the same license:

`scratch-vm`, `scratch-render`, `scratch-audio`, `scratch-paint`,
`scratch-storage`, `scratch-svg-renderer`, `scratch-l10n`, `scratch-parser`,
`scratch-sb1-converter`.

Scratch is a project of the Scratch Foundation (https://scratch.mit.edu). Upstream
copyright and license notices in the source files are preserved.

## AGPL-3.0 obligations and how we meet them

| Obligation | Status |
|---|---|
| Distribute the complete corresponding source | Met. The repository is public and holds the full source. |
| Same license for derivative work | Met. The whole project is AGPL-3.0-only. |
| Preserve copyright and license notices | Met. Upstream notices and `LICENSE` are kept. |
| State the changes made | Met. Our additions are isolated under `src/lib/ai-harness/` and described in the [README](../README.md); the rest of the tree is stock scratch-gui. |
| Section 13: offer source to users who interact over a network | Addressed. The source link is in the README and the repository is public. Adding a visible "source" link in the deployed app is recommended as a further step. |

The free-mode proxy (`api/chat.js`) holds no secrets; it reads its API key from an
environment variable and only forwards requests. It is published so anyone can
self-host the free mode.

## Dependency licenses

Every dependency license is either permissive (MIT, ISC, BSD, Apache-2.0, CC0) or
AGPL-3.0 (the Scratch packages, same as this project). None conflicts with
distributing the project under AGPL-3.0. Counts from a full scan of 1939 packages
(`npx license-checker --summary`):

| License | Packages |
|---|---|
| MIT | 1535 |
| ISC | 190 |
| BSD-3-Clause | 59 |
| Apache-2.0 | 52 |
| BSD-2-Clause | 44 |
| AGPL-3.0-only | 11 (Scratch packages + this project) |
| CC0-1.0 | 6 |
| Other permissive (0BSD, Unlicense, WTFPL, Python-2.0, CC-BY, MPL/Apache, etc.) | ~40 across small transitive packages |

Notable entries, none of which pose a problem:

- **jszip** offers `MIT OR GPL-3.0-or-later`. We use it under MIT.
- **colors@0.6.2** declares an informal custom license (a link to an image). It is
  an old transitive build-time dependency, not shipped in the web bundle, and is
  permissive in practice.
- **tweetnacl** (Unlicense), **xml-name-validator** (WTFPL), **opener**
  (WTFPL OR MIT), **text-encoding** (Unlicense OR Apache-2.0): all permissive,
  mostly build-time.

Direct dependencies: 64 runtime, 42 dev (`package.json`).

## Third-party assets

Scratch ships media assets (costumes, sounds, block icons, sample projects) under
their own terms, typically Creative Commons for media. These come from the
upstream `scratch-gui` and its libraries unchanged; their licenses apply as
distributed by Scratch.

## Reproducing the scan

```bash
npx license-checker --summary          # counts by license
npx license-checker --json > lic.json  # full per-package detail
```
