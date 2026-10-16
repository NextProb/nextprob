# Understand and customize settings interfaces

Read this reference when a user asks how settings work, what can be customized,
or how to adapt the interface to their project. Answer explanation-only requests
without creating or changing files. For implementation requests, inspect the
project’s existing settings definitions, configuration files, and relevant HTML
before deciding what to change.

## Choose the right change

| User intent | Where to work |
| --- | --- |
| Understand the architecture or available options | Explain the ownership below; inspect only as useful |
| Change what the project actually does | Edit the original configuration file used by that feature |
| Add an editable file or change labels, groups, page order, or form fields | Edit project-root `nextprob.settings.json`; see [file-backed settings](project-settings.md) |
| Change styling, navigation, density, controls, or a complete settings workflow | Create or edit a project-owned HTML settings note |
| Change defaults shipped to all users | Maintainer work in the content repository’s `settings/`; not required for a user’s project |

Catalog definitions and HTML are complementary. The default renderer consumes
catalog metadata; a custom HTML interface can reuse that renderer, consume the
same metadata with its own controls, or intentionally show a smaller set.
Do not replace an existing custom interface with the default layout merely
because the default renderer supports the requested settings.

## Explain ownership

The application owns loading, validation, saving, revisions, conflict detection,
session drafts, and access to registered project resources. Each configuration
file remains authoritative. The HTML note controls presentation and interactions
through `window.settings` API version 1. Registering a tool’s file does not make
NextProb implement that tool’s behavior.

The maintained default is an HTML note, too. Users select their interface through
the Project Settings host. Selection is stored by the application for that
project on that installation; placing HTML in a project does not activate it.
Opening the same file as an ordinary note does not grant settings access.
The dedicated settings preload has no noteDB form autosave or ordinary note APIs.

## Customize a user’s interface

For a visual adjustment, inspect the selected HTML first. Preserve existing
settings behavior, file locations, unrelated controls, and configuration values.
Use the host’s **Create editable copy** when starting from the default, or create
a project-local HTML note against the public bridge when a distinct interface is
needed. Creating a UI alone should not materialize configuration defaults.

The host provides:

- **Choose HTML note** to select project-local `.html` or `.htm` content.
- **Create editable copy** to create and select a user-owned default copy.
- **Reload interface** to load edited HTML while retaining application drafts.
- **Use default** to recover the maintained interface independently of custom HTML.

If you can edit files but cannot operate the application host, complete the
requested HTML changes and tell the user which note to select or reload. Do not
invent an automatic activation field in `nextprob.settings.json` or modify the
application’s private selection store.

The generated [default UI assets](../assets/project-settings/ui/) show the
maintained implementation. Inspect relevant files as references; do not edit
the installed skill package. The reference `index.html` uses relative packaged
assets, so copying that file alone is insufficient. The host’s copy operation
rewrites declared library links to `note://settings/default/` URLs. When creating
a copy yourself, preserve that behavior or copy the associated assets into the
user’s project and update their URLs. User-owned relative assets should continue
to resolve alongside the user’s HTML.

Copies using shared default assets receive compatible library updates. Users can
own their entire renderer when they need independent behavior. The bridge is the
supported compatibility boundary; internal renderer functions and CSS classes
are implementation details.

## Public bridge contract

Check `window.settings?.apiVersion === 1` and show a useful host-selection or
compatibility message otherwise. Use `list()` to obtain the current workspace ID
and registered resources. Do not hard-code a workspace ID or store settings
values in noteDB, localStorage, or a second configuration file.

| Method | Purpose |
| --- | --- |
| `getContext()` | API version, current workspace ID, and theme |
| `list()` | Resource catalog, definitions, pages, and diagnostics |
| `browse(workspaceId, path)` | Discover registered directory contents |
| `read(workspaceId, path)` | Current text, revision, format, schema, diagnostics, protected sections, and available semantic metadata |
| `save(workspaceId, path, text, revision)` | Validate and save against the revision read; returns the saved snapshot |
| `updateDraft(workspaceId, path, text, revision)` | Retain an unsaved draft in the application session |
| `getDraft(workspaceId, path)` | Retrieve a retained draft or `null` |
| `discardDraft(workspaceId, path)` | Clear a draft and return the current snapshot |
| `onChanged(callback)` | Subscribe to external changes; returns an unsubscribe function |
| `getTheme()` / `onThemeChanged(callback)` | Read and follow the application theme |

Paths must be registered and project-relative. A missing file has revision
`null`; reading it does not create it. Preserve unknown content, comments, rule
order, and protected sections when editing. Use semantic metadata for baseline
exclusions instead of guessing which rules the runtime adds.

For editable controls, read the current snapshot and any retained draft before
populating values. Retain edits through `updateDraft`, save with the original
revision, and update the snapshot after a successful save. On external changes,
refresh clean controls; retain dirty edits and expose the conflict. Native errors
carry `error.code`, including `CONFLICT`, `STALE_WORKSPACE`, and `UNAUTHORIZED`.
Never silently overwrite a newer file or retry using its revision without
resolving the user’s draft. Drafts survive UI and project switches during the
application session; they do not survive quitting the application.

Validate the relevant user flow: inspect without writing, edit and save the
intended file, reload the interface, and handle a conflicting external change.
For styling-only work, check that the existing edit/save flow still works.
Do not run app-repository build or content-sync commands for ordinary user
customization; those commands maintain distributed resources, not user notes.
