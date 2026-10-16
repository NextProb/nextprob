# Changelog

All notable changes to NextProb will be documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-10-16

### Added

- Editable file and folder exclusions for sidebar trees, with updated defaults that preserve project customizations.
- Sidebar collections can filter notes by project-defined metadata, including publication status.

### Changed

- Renaming an HTML note updates its display title and open tabs while preserving its file or folder path.

## [0.3.5] — 2026-10-15

### Added

- Customizable HTML interfaces for Project Settings.
- AI assistance settings for Claude, Codex, Gemini CLI, OpenCode, and Pi, including custom project agents and formatting-preserving TOML and JSONC source editing.

### Fixed

- Gemini CLI project instructions use the root `GEMINI.md`, preserving existing guidance during migration.

## [0.3.4] — 2026-10-15

### Fixed

- Settings catalog upgrades and stale background downloads no longer revert newer settings interfaces.

## [0.3.3] — 2026-10-15

### Changed

- Organized Project Settings into task-based pages for appearance, exclusions, AI instructions, and skills, with resource browsers.

## [0.3.2] — 2026-10-15

### Added

- Configurable sidebar sections and collections.
- Project Settings for editing project configuration, instructions, and exclusion rules, with structured forms and source editing.
- Bundled NextProb guidance for coding agents working in a project.

## [0.3.1] — 2026-10-07

### Changed

- Shared and exported notes now follow the reader's OS color scheme (light/dark) instead of always rendering light, and match the in-app viewer styling. Archived web clips keep their original styling.

## [0.3.0] — 2026-09-14

### Added

- Collapsible sidebar — hide or show it with the toolbar button, `Cmd/Ctrl+B`, or View → Toggle Sidebar. The choice is remembered across sessions.
- Getting Started guide — shown on your first workspace and reopenable anytime from Help → Getting Started, with a one-click starter prompt and a short demo.

### Fixed

- Restored the app icon (the previous build shipped the wordmark as the app icon).

## [0.2.0] — 2026-06-15

First NextProb release (rebranded from ToutKit).

## [0.1.2] — 2026-05-09

### Fixed

- Shared and exported notes preserve UTF-8 text encoding.

## [0.1.1] — 2026-05-08

### Fixed

- "Create repo" in Settings → Sharing failed in packaged builds with `ENOENT, share-renderer/index.html`. The bundled fallback assets are now included in the app bundle.
- "Export as Standalone App" produced a broken `.app` because the prebuilt template's framework symlinks were mangled when packed inside `app.asar`. The template now ships as `extraResources` so symlinks survive.
- "Export Standalone App Source" silently produced an empty folder in packaged builds. The template source files now ship via `extraResources`, and the Electron version is read from `process.versions.electron` instead of a `node_modules` path that doesn't exist in packaged apps.

## [0.1.0] — TBD

Initial public release.
