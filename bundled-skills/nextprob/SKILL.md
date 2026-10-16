---
name: nextprob
description: Explain or customize NextProb project settings, including user-owned HTML settings interfaces, sidebar configuration, ignore rules, agent instructions, and additional settings files.
---

# NextProb

NextProb reads settings directly from project files. Change those files for user requests; the UI is another editor over the same source of truth.

When users ask how settings work, what they can customize, or how to make an interface for their own project, read [HTML settings interfaces](references/settings-html.md). Distinguish changes to actual values, catalog metadata, and HTML presentation. Explanation-only requests do not require file changes. Custom HTML uses the application’s versioned settings bridge; ordinary notes do not receive settings access.

For catalog pages, read [task-based settings pages](references/settings-pages.md) for the default resource policy, page composition, package browsing, and exclusions. For individual forms, read [settings form layouts](references/settings-forms.md) for the declarative contract and sidebar demo. Metadata edits suit labels, groups, and form layouts; user-owned HTML suits custom navigation, styling, and interactions. Preserve the user’s chosen approach.

For ignore rules, agent instructions, or other project settings, read [file-backed settings](references/project-settings.md). It also explains how to register additional settings files or change their presentation in the user’s own project. For sidebar customization, use `nextprob.config.json` and the guidance below.

Read [project configuration](references/project-config.md) before changing sidebar configuration. It documents supported fields, filtering rules, defaults, and examples.

Inspect and preserve an existing config. When the user requests customization and the config is missing, start with `{"version": 1}` and add the requested overrides. Consult [the default configuration](assets/project-config.default.json) to understand omitted values without persisting every default. Do not create a config merely because this skill is installed or read.

Use [the version 1 schema](assets/project-config.schema.json) for structural validation. Runtime validation also restricts rule operators, metadata variables, section IDs, and collection references. Use the documented subset rather than adding arbitrary JavaScript or unsupported fields.

NextProb manages this installed skill folder. Put requested configuration changes in project files and custom interfaces in project HTML notes; keep personal instructions and custom skills separate from this package.
