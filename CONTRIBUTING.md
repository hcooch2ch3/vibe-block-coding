# Contributing to Vibe Block Coding

Thanks for your interest. Issues and pull requests are welcome.

Vibe Block Coding is a fork of Scratch's `scratch-gui`. The AI two-way-editing
work lives in a small, separable set of files; the rest of the tree is stock
scratch-gui. Keeping that boundary clean is the main thing we ask of contributors.

## Project layout

- `src/lib/ai-harness/` — the core: natural language ↔ block DSL, edit diff/apply, LLM calls
- `src/components/vibe-prompt/` — the prompt panel UI
- `api/chat.js` — the optional free-mode proxy (a serverless function)

Please keep new AI/editing code under `src/lib/ai-harness/` so it stays separable
from Scratch and easy to reason about, and so upstream scratch-gui changes stay
easy to merge. Avoid touching stock scratch-gui files unless a change genuinely
requires it.

## Development setup

Requires Node 18 (`.nvmrc` pins `18.20.8`).

```bash
nvm use
npm install
NODE_OPTIONS=--openssl-legacy-provider npm start
```

Open <http://localhost:8601>. The app starts in Free mode, so it works without a key.

## Tests and lint

```bash
npm run test:unit    # jest unit tests (test/unit)
npm run test:lint    # eslint . --ext .js,.jsx
npm run build        # webpack build smoke-check
```

For a fast loop on just the AI harness:

```bash
NODE_OPTIONS=--openssl-legacy-provider npx jest test/unit/ai-harness
```

CI runs lint + unit tests + a build smoke-check on every push
(`.github/workflows/vibe-ci.yml`).

## Pull requests

- Keep changes focused and the diff small.
- This project is test-driven: add or update tests for any behavior change.
- Make sure `test:unit`, `test:lint`, and `build` pass before opening a PR.
- Use clear commit messages (Conventional Commits: `feat:`, `fix:`, `docs:`, `ci:`, ...).

## License

By contributing, you agree that your contributions are licensed under the
project's GNU AGPL v3.0 (see [`LICENSE`](LICENSE)), the same license as
scratch-gui.
