# Changelog

All notable changes to ToutKit will be documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-05-08

### Fixed

- "Create repo" in Settings → Sharing failed in packaged builds with `ENOENT, share-renderer/index.html`. The bundled fallback assets are now included in the app bundle.
- "Export as Standalone App" produced a broken `.app` because the prebuilt template's framework symlinks were mangled when packed inside `app.asar`. The template now ships as `extraResources` so symlinks survive.
- "Export Standalone App Source" silently produced an empty folder in packaged builds. The template source files now ship via `extraResources`, and the Electron version is read from `process.versions.electron` instead of a `node_modules` path that doesn't exist in packaged apps.

## [0.1.0] — TBD

Initial public release.
