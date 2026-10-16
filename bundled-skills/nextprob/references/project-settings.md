# File-backed project settings

The Project Settings UI discovers resources through definitions. Each target project file owns its values; definitions supply paths, labels, editor formats, optional schemas, and managed-section markers. No settings database mirrors those values.

## Editing a project's settings

Inspect the target file before editing. [The bundled catalog](../assets/project-settings/catalog.json) documents built-in paths and meaning. It is a reference snapshot, not the place to save user customizations. Preserve unrelated fields, comments, ordering, and omitted defaults. Create missing files only for a requested change.

For line-rule documents preserve sequence, comments, blank lines, and negation rules. For JSON use the definition's schema when supplied, while preserving unknown content for source repair. Schema validation does not replace the consuming tool's semantic validation. NextProb's sidebar runtime additionally validates its documented rule subset.

Definitions can identify marked sections that NextProb refreshes automatically. Preserve their delimiters and content and place personal settings outside them. NextProb maintains this installed skill folder; user settings belong in the project's actual files and presentation customizations belong in `nextprob.settings.json` at the project root.

Changes by an agent, a text editor, or the UI have the same effect. NextProb reloads supported files; another tool may require its own reload. Displaying a file in Project Settings does not cause NextProb to implement its external-tool behavior.

## Adding a setting or changing its presentation

Use the user's project-root `nextprob.settings.json` for requests to expose another file or customize its labels, group, schema, editor view, or progressive form layout. Start with `{"version": 1, "definitions": []}` if it is missing, then add the requested definition. Preserve existing definitions.

Local definitions extend built-ins. A local definition with an existing ID replaces that entire built-in definition; copy its required fields from the bundled catalog, then change only the requested presentation. Choose a unique ID when registering another resource. Relative target paths and local schema paths are relative to the project root. A copied built-in schema reference does not point into the installed skill: omit that optional field or copy the referenced schema asset into the project and update its path. Keep paths within the project, without symlinks or parent traversal.

The version 1 contract is [catalog.schema.json](../assets/project-settings/catalog.schema.json). Optional top-level `pages` group related definitions into task-based navigation; see [task-based settings pages](settings-pages.md). Each definition provides `id`, `title`, `group`, `description`, exact `match.paths` or bounded `match.directories`, `format`, `views`, and an explicit creation template. Optional `schema` points to a JSON schema within the project; optional `ui` defines navigation priority and form presentation (see [settings form layouts](settings-forms.md)); optional `managedSections` declares delimiters for content maintained by the application. Empty templates suit text and line rules; JSON templates must form a valid initial document. A template seeds a new file only, never mirrors current values.

Supported formats and views:

- `text`: `source`.
- `markdown`: `preview`, `source`.
- `json`: `structured`, `source`.
- `line-rules`: `rules`, `source`.
- `ini`: `structured`, `source`.

Directory matches browse text children; separate file definitions can specialize their interpretation. JSON schemas may supply field `title`, `description`, types, enum choices, and validation. Without a form layout, friendly JSON editing displays configured values; use Source to add or remove fields. Declarative forms can show omitted defaults, group controls, and edit lists and named collections. Preserve the original formatting when editing a value.

For example, to expose `tools/preferences.json`, add this definition to `nextprob.settings.json`:

```json
{
  "version": 1,
  "definitions": [
    {
      "id": "tool-preferences",
      "title": "Tool preferences",
      "group": "Developer Tools",
      "description": "Project preferences for our tool.",
      "match": { "paths": ["tools/preferences.json"] },
      "format": "json",
      "views": ["structured", "source"],
      "creation": { "mode": "explicit", "initialText": "{}\n" },
      "schema": "schemas/tool-preferences.schema.json"
    }
  ]
}
```

Create the referenced schema before registering the definition. An optional `schemas/tool-preferences.schema.json` can describe fields without storing their current values:

```json
{
  "type": "object",
  "properties": {
    "theme": {
      "title": "Appearance",
      "description": "Choose the tool's color theme.",
      "type": "string",
      "enum": ["system", "light", "dark"]
    }
  }
}
```

Omit the definition's `schema` field if a source and generic JSON view are sufficient. Preserve an existing `tools/preferences.json`; edit its values only as requested. Registration alone must not overwrite or create it.

NextProb validates and hot reloads local definitions. An invalid edit reports diagnostics and retains the last valid local definitions for the current project session. Deleting `nextprob.settings.json` removes local customizations and restores built-ins. Read validation messages before considering a presentation change complete.

Definitions are data, never executable JavaScript or shell commands. Existing editors support newly registered resources without application changes. New parser capabilities or runtime application behavior require engine support; do not invent unsupported options. User customization needs only project files and this skill, with no application checkout or content-repository maintenance commands.

## HTML settings interfaces

The application renders Project Settings in an HTML note using a dedicated `window.settings` bridge (API version 1). The host provides Choose HTML note, Create editable copy, Reload interface, and Use default controls outside the replaceable interface. Ordinary notes do not gain settings access; open a custom note through the Project Settings host.

Users can control all presentation in their own HTML, CSS, and JavaScript while keeping file loading, validation, saving, drafts, and conflicts in the application. `nextprob.settings.json` remains useful for registering resources and describing fields; custom HTML can consume that metadata or provide its own controls. Do not store application setting values in noteDB or an extra configuration mirror. Check `window.settings.apiVersion`, call `list()` to obtain the current workspace ID, then `read(workspaceId, path)` and `save(workspaceId, path, text, revision)`. Handle native errors by `error.code`, including `CONFLICT`, `STALE_WORKSPACE`, and `UNAUTHORIZED`. The draft methods `updateDraft`, `getDraft`, and `discardDraft` retain unsaved edits in the application session; `onChanged` subscribes to external changes.

Maintainers edit default presentation in the content repository's `settings/ui/`, never in app or installed skill snapshots. The asset reference at `../assets/project-settings/ui/` is generated for inspection; user interfaces belong in actual project HTML notes. New bridge capabilities or storage semantics still require application support.
