# Progressive settings forms

For declarative forms in the default renderer, put frequent choices first, use user-facing labels and help text, show visibility/order at the section level, and collapse uncommon choices under “More options” or “Advanced”. Internal version fields and raw rule syntax belong in Source or an advanced JSON editor. Do not automatically expose every JSON leaf. For user-owned HTML presentation, read [HTML settings interfaces](settings-html.md).

NextProb 0.3.2+ supports `ui` on any JSON settings definition. The built-in Sidebar page already uses this design, from the maintained catalog. Installing/reading this skill does not create or overwrite project files. To customize a layout, override the definition in the project's `nextprob.settings.json`, preserving unrelated definitions and values. See [file-backed settings](project-settings.md) for path/schema ownership rules.

## Reusable contract

The authoritative shape is [catalog.schema.json](../assets/project-settings/catalog.schema.json), `$defs.ui` and `$defs.formNode`. Layouts are data: no executable callbacks, HTML, scripts, or CSS.

`ui.defaultView: "structured"` opens the form first (include `structured` in the definition's `views`). `ui.order` sorts navigation, with smaller numbers first. `ui.advanced: true` places the resource under collapsed “Advanced project files”. Definition titles label exact file matches; folder children retain their paths.

`ui.layout` is an ordered array of nodes. Unlisted fields stay in the underlying file and remain accessible in Source; they are not automatically appended to the form.

- `group`: `title`, `description`, and `children`. Omit `collapsed` for a permanent section, or set it to `true`/`false` for an initially closed/open disclosure.
- `field`: a relative `path` array, optional readable `title` and `description`, and `control`: `text`, `toggle`, `select`, `number`, `lines`, or `json`. Omit `control` to infer a basic control from schema metadata/value. `lines` edits an array of strings; `json` edits one complete JSON value without exposing its internal leaves.
- `list`: `path`, `title`, `children` rendered relative to each item; optional `itemTitle` path, `keyField` for stable identities and unique IDs for added items, `reorderable`, `removable`, `itemTemplate`, and `addLabel`. Reordering supports dragging and accessible Move up/down buttons. All existing items and unknown properties are preserved.
- `map`: the same item controls for an object keyed by name. New keys must be unique safe identifiers. A field child with `summary: true` is visible beside the item title even while details are closed (for example an enabled switch). `summary` works for list children too.

Fields can provide `options: [{"value": "tree", "label": "Folder tree"}]`; option labels need not expose storage identifiers. `optionsFrom` reads object keys at an absolute document path for dynamic references. `optional: true` adds a reset/unset choice to selects; `emptyLabel` names it. Required selects use a disabled placeholder when no value is configured. `clearOnChange` lists sibling paths to remove when a value is selected, for mutually exclusive fields. Use this only where the consuming format requires it.

`visibleWhen: {"path": ["view"], "equals": "tree"}` shows a node only when a value at a path relative to the current item matches. Hiding a control does not remove its stored value. Declare `clearOnChange` explicitly when a mode switch must remove incompatible data.

A node's `default` supplies omitted display values only. A map's `mergeDefaults: true` shallowly includes missing default entries while treating supplied entries as complete replacements. Defaults must reflect the consuming runtime: the renderer does not change runtime behavior. Merely opening a form never writes defaults. Editing a default list materializes that list; editing an inherited map entry materializes that entry. Other omitted branches remain omitted. Primitive edits retain surrounding source formatting; inserting/removing fields or replacing arrays/objects can reformat that changed container. Unknown data is retained, not reconstructed from the form.

## Example for another tool

The same renderer supports unrelated settings without app changes:

```json
{
  "defaultView": "structured",
  "order": 10,
  "layout": [
    {"type": "group", "title": "Notifications", "children": [
      {"type": "field", "path": ["notifications", "enabled"], "title": "Send notifications", "control": "toggle", "default": true},
      {"type": "field", "path": ["notifications", "frequency"], "title": "Send a summary", "control": "select", "options": [{"value": "daily", "label": "Every day"}, {"value": "weekly", "label": "Every week"}], "default": "daily", "visibleWhen": {"path": ["notifications", "enabled"], "equals": true}}
    ]},
    {"type": "group", "title": "Advanced", "collapsed": true, "children": [
      {"type": "field", "path": ["retryLimit"], "title": "Retry attempts", "control": "number", "default": 3}
    ]}
  ]
}
```

Use a schema for types, numeric bounds, validation, and shared field metadata. A layout controls presentation; it does not implement the external tool's settings semantics.

## Complete settings demo

[The demo definition](../assets/settings-demo/nextprob.settings.json) is a standalone project override demonstrating every built-in page and resource policy, including the sidebar form. See [task-based settings pages](settings-pages.md) for the full resource mapping. [The demo configuration](../assets/settings-demo/nextprob.config.json) includes Favorites, All notes, Templates, and a disabled Files section. Its schema is [schemas/nextprob-config.schema.json](../assets/settings-demo/schemas/nextprob-config.schema.json).

For an explicitly requested demo in a new/scratch project, copy these files to that project's root, preserving the `schemas/` relative path. In an existing project, inspect its files, merge only the requested definition/settings, and preserve current sections and collections unless asked to replace them. Do not copy a full demo over a user's configuration. The app renders this definition with no bespoke sidebar form code. To change only presentation, copy the definition/schema and keep the existing `nextprob.config.json`.

Source, reload, and copy utilities are available under “File actions” in the normal form.

Normal projects need no copied demo: the built-in Sidebar form is the default. The skill should use the same progressive disclosure choices for newly registered settings unless the user requests a different design.
