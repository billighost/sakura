# Contributing to Sakura

Sakura uses Next.js, React, TypeScript and PostgreSQL. Read [AGENTS.md](AGENTS.md) and the relevant installed Next.js guide in `node_modules/next/dist/docs/` before changing application code; this repository uses Next.js APIs that may differ from older versions.

## Local setup

```sh
npm install
npm run migrate
npm run dev
```

Use `.env.example` and the [README configuration](README.md#configuration) to configure a local environment. The migration command is for your local database. Environment files, private credentials, Telegram sessions and `.local/` stay outside source control.

The application lives in `src/rebuild/app`, the player in `src/rebuild/player`, and the data/API implementation in `src/rebuild`. Reuse existing UI controls, account-scoped storage and error handling. Keep offline playback, exact recording identity, lyric timing, keyboard access and reduced-motion behavior intact.

## Validate changes

```sh
npm test
npm run lint
npm run build
```

Run the relevant existing browser checks for changes to playback, downloads, lyrics, gestures or visuals. Browser scripts use `SAKURA_TEST_URL` to select a running local server. Performance checks and their scope are described in [the performance report](docs/rebuild/PERFORMANCE-OPTIMIZATION.md).

Use a separate branch or worktree when another contributor is working in the repository. Explain the problem, resulting behavior and validation in your pull request. Keep generated builds, logs, screenshots and temporary verification scripts out of commits.

## Issues

For a bug, include the route, steps to reproduce, device/browser, and expected versus actual behavior. For a feature, describe the listening experience it improves and any offline or accessibility requirements. Use synthetic examples instead of including account credentials or private listening data.
