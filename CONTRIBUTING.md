# Contributing to NextProb

Thanks for considering a contribution. NextProb is an Electron app and a small
project — the bar to make a useful change is low.

## Before you start

- **Open an issue first** for anything bigger than a typo or one-line fix.
  A short discussion saves a wasted PR.
- **Agree to the CLA.** All contributions are governed by the
  [Contributor License Agreement](CLA.md). Opening a PR is your confirmation
  that you've read and agree.
- **Be kind.** This project follows the
  [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Requires Node.js v18+ and npm. See README "Run from source" for the full flow.
Short version:

```bash
git clone <this repo>
cd nextprob
npm ci
cp auth-config.example.json auth-config.json
npm start
```

There is no build step — all source is vanilla CommonJS JavaScript. Edits to
files under `renderer/` and the root `*.js` files take effect on app restart.

## Pull requests

1. Branch from `main`, make focused commits.
2. Describe how you verified the change in the PR body — what scenarios you
   tried, what you saw. The maintainers run an internal Playwright suite
   against accepted PRs before merging upstream; that suite is not part of
   this public repo.
3. Update `CHANGELOG.md` under `[Unreleased]` if your change is user-visible.
4. Open the PR.

## Reporting issues

- **Bugs:** open a GitHub issue with reproduction steps, OS, and NextProb version
  (see Help → About in the app).
- **Security:** please email **support@helicase.space** rather than filing a
  public issue.
