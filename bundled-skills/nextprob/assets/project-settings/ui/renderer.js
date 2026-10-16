/* Default settings note renderer. Maintained in hs-update-model-list/settings/ui; app copies are generated. */
(function (root) {
  'use strict';
  // Locate primitive JSON values so a field edit replaces only that token.
  function jsonFields(text, containers = false) {
    JSON.parse(text);
    const fields = [];
    let i = 0;
    const ws = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
    function string() {
      const start = i++;
      while (i < text.length) { if (text[i++] === '\\') i++; else if (text[i - 1] === '"') break; }
      return JSON.parse(text.slice(start, i));
    }
    function value(path) {
      ws();
      const start = i;
      if (text[i] === '{') {
        i++; ws();
        while (text[i] !== '}') {
          const key = string(); ws(); i++; value([...path, key]); ws();
          if (text[i] !== ',') break;
          i++; ws();
        }
        i++;
        if (containers) fields.push({ path, start, end: i, value: JSON.parse(text.slice(start, i)) });
      } else if (text[i] === '[') {
        i++; ws(); let index = 0;
        while (text[i] !== ']') {
          value([...path, index++]); ws();
          if (text[i] !== ',') break;
          i++; ws();
        }
        i++;
        if (containers) fields.push({ path, start, end: i, value: JSON.parse(text.slice(start, i)) });
      } else {
        if (text[i] === '"') string(); else while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
        fields.push({ path, start, end: i, value: JSON.parse(text.slice(start, i)) });
      }
    }
    value([]);
    return fields;
  }
  function fieldSchema(schema, path) {
    const resolve = node => {
      const seen = new Set();
      while (node?.$ref?.startsWith('#/') && !seen.has(node.$ref)) {
        seen.add(node.$ref);
        node = node.$ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], schema);
      }
      return node || {};
    };
    let node = resolve(schema);
    for (const key of path) node = resolve(typeof key === 'number' ? node.items : (node.properties?.[key] || node.additionalProperties));
    return node;
  }
  function replaceField(text, field, value) {
    return text.slice(0, field.start) + JSON.stringify(value) + text.slice(field.end);
  }
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const own = (value, key) => value != null && Object.hasOwn(value, key);
  const get = (value, path) => path.reduce((v, key) => own(v, key) ? v[key] : undefined, value);
  function assign(value, path, next) {
    if (path.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Unsafe field path');
    if (!path.length) return copy(next);
    let parent = value;
    path.slice(0, -1).forEach((key, i) => {
      if (!own(parent, key)) parent[key] = typeof path[i + 1] === 'number' ? [] : {};
      parent = parent[key];
    });
    if (next === undefined) delete parent[path.at(-1)];
    else parent[path.at(-1)] = copy(next);
    return value;
  }
  // User removals remain remembered when resources add or retire defaults.
  function resolveSectionExclusions(section, defaults = {}) {
    return Object.fromEntries(['Files', 'Folders'].map(kind => {
      const hidden = `hidden${kind}`, shown = new Set(section[`shown${kind}`] || []);
      return [hidden, [...new Set([...(defaults[hidden] || []), ...(section[hidden] || [])])].filter(value => !shown.has(value))];
    }));
  }
  // Defaults affect the view only. A write materializes the smallest missing branch.
  function formDocument(raw, layout, officialExclusions) {
    const doc = copy(raw);
    function visit(nodes, base = []) {
      for (const node of nodes) {
        const path = [...base, ...(node.path || [])];
        let value = get(doc, path);
        if (value === undefined && own(node, 'default')) { assign(doc, path, node.default); value = get(doc, path); }
        if (node.type === 'map' && node.mergeDefaults && value && typeof value === 'object') {
          value = { ...copy(node.default || {}), ...value }; assign(doc, path, value);
        }
        if (node.type === 'group') visit(node.children, base);
        if (node.type === 'list' && Array.isArray(value)) value.forEach((_, i) => visit(node.children, [...path, i]));
        if (node.type === 'map' && value && typeof value === 'object' && !Array.isArray(value)) Object.keys(value).forEach(key => visit(node.children, [...path, key]));
      }
    }
    visit(layout);
    if (officialExclusions) for (const surface of Object.values(doc.surfaces || {})) {
      const defaults = surface.hideOfficialFiles === false ? {} : officialExclusions;
      for (const section of surface.sections || []) if (section.view === 'tree') Object.assign(section, resolveSectionExclusions(section, defaults));
    }
    return doc;
  }
  function writeValue(text, path, value, effective = JSON.parse(text), atomicPaths = []) {
    const raw = JSON.parse(text);
    for (let length = 1; length < path.length; length++) {
      const ancestor = path.slice(0, length);
      if (get(raw, ancestor) === undefined && (Array.isArray(get(effective, ancestor)) || atomicPaths.some(p => JSON.stringify(p) === JSON.stringify(ancestor)))) {
        value = assign(copy(get(effective, ancestor)), path.slice(length), value); path = ancestor; break;
      }
    }
    const nodes = jsonFields(text, true);
    const find = p => nodes.find(n => JSON.stringify(n.path) === JSON.stringify(p));
    const existing = find(path);
    if (!existing && value === undefined) return text;
    if (existing && value !== undefined) return replaceField(text, existing, value);
    let parentPath = path.slice(0, -1);
    while (parentPath.length && !find(parentPath)) parentPath.pop();
    const parent = find(parentPath);
    if (!parent || !parent.value || typeof parent.value !== 'object') throw new Error('This value needs an object or array parent. Use Source to repair it.');
    const updated = copy(get(raw, parentPath));
    const relative = path.slice(parentPath.length);
    assign(updated, relative, value);
    return replaceField(text, parent, updated);
  }
  function writeFormValue(text, path, value, layout, officialExclusions, originalAdditions) {
    const effective = formDocument(JSON.parse(text), layout), atoms = [];
    function visit(nodes, base = []) {
      for (const node of nodes) {
        const path = [...base, ...(node.path || [])];
        if (node.type === 'group') visit(node.children, base);
        if (node.type === 'map') for (const key of Object.keys(get(effective, path) || {})) { atoms.push([...path, key]); visit(node.children, [...path, key]); }
        if (node.type === 'list') (get(effective, path) || []).forEach((_, i) => visit(node.children, [...path, i]));
      }
    }
    visit(layout);
    // Persist only user choices; never freeze resource defaults into a saved section.
    if (officialExclusions && path.length === 5 && path[0] === 'surfaces' && path[2] === 'sections' && ['hiddenFiles', 'hiddenFolders'].includes(path[4])) {
      const hidden = path[4], shown = hidden.replace('hidden', 'shown');
      const section = get(effective, path.slice(0, -1));
      const defaults = get(effective, ['surfaces', path[1], 'hideOfficialFiles']) === false ? [] : officialExclusions[hidden] || [];
      const desired = [...new Set((value || []).filter(Boolean))];
      const removed = [...new Set([...defaults, ...(originalAdditions || section[hidden] || []), ...(section[shown] || [])])].filter(entry => !desired.includes(entry));
      const additions = desired.filter(entry => !defaults.includes(entry));
      let next = writeValue(text, path, additions, effective, atoms);
      next = writeValue(next, [...path.slice(0, -1), shown], removed.length ? removed : undefined);
      return next;
    }
    return writeValue(text, path, value, effective, atoms);
  }
  // Keep protected text byte-for-byte while allowing surrounding user content to change.
  function documentParts(text, sections = []) {
    const ranges = sections.map(s=>{const start=text.indexOf(s.start), end=start<0 ? -1 : text.indexOf(s.end,start+s.start.length);return {start,end:end<0 ? text.length : end+s.end.length};}).filter(r=>r.start>=0).sort((a,b)=>a.start-b.start);
    const parts=[];let cursor=0;
    for(const range of ranges){if(range.start<cursor)continue;if(range.start>cursor)parts.push({text:text.slice(cursor,range.start),managed:false});parts.push({text:text.slice(range.start,range.end),managed:true});cursor=range.end;}
    if(cursor<text.length||!parts.length)parts.push({text:text.slice(cursor),managed:false});
    if(parts.every(p=>p.managed))parts.push({text:'',managed:false});
    return parts;
  }
  function iniSections(text) {
    const entries=lines(text),sections=[{name:null,start:0,end:entries.length,fields:[]}];let section=sections[0];
    entries.forEach((line,index)=>{const header=/^\s*\[([^\r\n]+)\]\s*$/.exec(line.text);if(header){section.end=index;section={name:header[1],start:index+1,end:entries.length,fields:[]};sections.push(section);return;}
      const field=/^(\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*)(.*?)(\s*)$/.exec(line.text);
      if(field)section.fields.push({key:field[2],value:field[3],prefix:field[1],suffix:field[4],index});});
    return {entries,sections};
  }
  function editIni(text, sectionIndex, key, value) {
    const {entries,sections}=iniSections(text), section=sections[sectionIndex]; if(!section)throw new Error('Configuration section no longer exists');
    const field=section.fields.filter(f=>f.key===key).at(-1);
    if(field){if(value===undefined)entries.splice(field.index,1);else entries[field.index].text=field.prefix+value+field.suffix;}
    else if(value!==undefined){const ending=entries.find(l=>l.ending)?.ending||'\n',index=section.end===entries.length && entries.at(-1)?.text==='' && !entries.at(-1).ending ? section.end-1 : section.end;if(index>0&&!entries[index-1].ending)entries[index-1].ending=ending;entries.splice(index,0,{text:`${key} = ${value}`,ending});}
    return entries.map(l=>l.text+l.ending).join('');
  }
  function lines(text) {
    return text.split(/(\r\n|\n|\r)/).reduce((result, part, index) => {
      if (index % 2) result[result.length - 1].ending = part;
      else result.push({ text: part, ending: '' });
      return result;
    }, []);
  }
  function revisionChanged(snapshot, incoming) {
    return snapshot.revision !== incoming.revision || snapshot.exists !== incoming.exists;
  }
  const agentCategories = ['instructions', 'skills', 'settings', 'resources'];
  function agentPaths(value) {
    const paths = [...new Set(String(value || '').split(/\r?\n/).map(p => p.trim()).filter(Boolean))];
    if (paths.some(p => !/^(?![A-Za-z]:)(?![/~])(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*[\x00-\x1f]).*[^/]$/.test(p))) throw new Error('Use project-relative paths without trailing slashes, backslashes, or .. segments.');
    return paths;
  }
  // Register paths only; the file service creates agent files through explicit saves.
  function registerAgent(registry, values, existingId, knownIds = [], knownDefinitions = []) {
    if (!registry || typeof registry !== 'object' || Array.isArray(registry) || !Array.isArray(registry.definitions) || (registry.agents !== undefined && !Array.isArray(registry.agents))) throw new Error('Repair nextprob.settings.json before changing agents.');
    const next = copy(registry), agents = next.agents || [];
    const previous = existingId && agents.find(a => a.id === existingId);
    if (existingId && !previous) throw new Error('This custom agent registration has changed. Reopen the form.');
    const title = String(values.title || '').trim();
    if (!title || title.length > 100) throw new Error('Enter an agent name of 1–100 characters.');
    const stem = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32).replace(/-$/, '') || 'agent';
    let id = existingId || `custom-${stem}`, suffix = 2;
    while (!existingId && [...knownIds, ...agents.map(a => a.id)].includes(id)) id = `custom-${stem}-${suffix++}`;
    const paths = Object.fromEntries(agentCategories.map(category => [category, agentPaths(values[category])]));
    if (!Object.values(paths).some(v => v.length)) throw new Error('Add at least one instruction file, skill directory, settings file, or resource directory.');
    const profile = { id, title }, generated = [];
    for (const category of agentCategories) {
      profile[category] = [];
      const matchKey = ['skills', 'resources'].includes(category) ? 'directories' : 'paths';
      let pending = [...paths[category]];
      const candidates = knownDefinitions.filter(d => !isGeneratedAgentDefinition(id, d.id) && (d.match?.[matchKey] || []).length && (!['skills', 'resources'].includes(category) || d.discovery?.mode === (category === 'skills' ? 'packages' : 'browser')));
      for (const candidate of candidates) {
        const registered = candidate.match[matchKey];
        if (registered.every(p => pending.includes(p))) { profile[category].push(candidate.id); pending = pending.filter(p => !registered.includes(p)); }
      }
      if (knownDefinitions.some(d => !isGeneratedAgentDefinition(id, d.id) && (d.match?.[matchKey] || []).some(p => pending.includes(p)))) throw new Error(`These ${category} paths overlap registered resources. Use the complete existing path group or choose different paths.`);
      const groups = category === 'settings' ? pending.map(p => [p]) : pending.length ? [pending] : [];
      groups.forEach((items, i) => {
        const definitionId = `${id}-${category}${category === 'settings' ? `-${i + 1}` : ''}`;
        const format = category === 'instructions' || category === 'skills' ? 'markdown' : category === 'resources' ? 'text' : /\.jsonc$/i.test(items[0]) ? 'jsonc' : /\.json$/i.test(items[0]) ? 'json' : /\.toml$/i.test(items[0]) ? 'toml' : 'text';
        const folder = ['skills', 'resources'].includes(category);
        const def = { id: definitionId, title: `${title} ${category}`, description: `Project ${category} for ${title}.`, group: 'AI assistance', match: { [folder ? 'directories' : 'paths']: items }, format, views: category === 'instructions' || category === 'skills' ? ['preview', 'source'] : ['source'], creation: { mode: 'explicit', initialText: format === 'json' || format === 'jsonc' ? '{}\n' : '' } };
        if (category === 'instructions' || category === 'skills') def.ui = { editor: 'document', defaultView: 'preview' };
        if (folder) def.discovery = { mode: category === 'skills' ? 'packages' : 'browser', ...(category === 'skills' ? { packageFile: 'SKILL.md' } : {}), exclude: [{ patterns: ['**/.env', '**/.env.*', '**/*credential*', '**/*secret*', '**/*token*', '**/auth.json', '**/*.pem', '**/*.key'], reason: 'Credentials are excluded from settings discovery.' }, { patterns: ['**/cache/', '**/logs/', '**/history/', '**/sessions/', '**/*.log', '**/*.db', '**/*.sqlite*', '**/node_modules/', '.git/'], reason: 'Caches, logs, and internal state are not settings.' }] };
        generated.push(def); profile[category].push(definitionId);
      });
    }
    const owned = new Set(previous ? agentCategories.flatMap(c => previous[c] || []).filter(ref => isGeneratedAgentDefinition(id, ref)) : []);
    const retained = new Set([...agents.filter(a => a.id !== id).flatMap(a => agentCategories.flatMap(c => a[c] || [])), ...(next.pages || []).flatMap(p => p.sections.flatMap(s => s.definitions))]);
    next.definitions = next.definitions.filter(d => !owned.has(d.id) || retained.has(d.id));
    if (generated.some(d => next.definitions.some(old => old.id === d.id) || (knownIds.includes(d.id) && !owned.has(d.id)))) throw new Error('A generated resource ID is already registered. Choose another agent name or repair the registry.');
    next.definitions.push(...generated); next.agents = [...agents.filter(a => a.id !== id), profile];
    return next;
  }
  function isGeneratedAgentDefinition(id, ref) { return ['instructions', 'skills', 'resources'].some(c => ref === `${id}-${c}`) || (ref.startsWith(`${id}-settings-`) && /^[1-9][0-9]*$/.test(ref.slice(`${id}-settings-`.length))); }
  function removeAgent(registry, id) {
    const next = copy(registry), profile = next.agents?.find(a => a.id === id);
    if (!profile || !Array.isArray(next.definitions)) throw new Error('This custom agent registration has changed. Reopen the form.');
    next.agents = next.agents.filter(a => a.id !== id);
    const referenced = new Set([...next.agents.flatMap(a => agentCategories.flatMap(c => a[c] || [])), ...(next.pages || []).flatMap(p => p.sections.flatMap(s => s.definitions))]);
    const owned = new Set(agentCategories.flatMap(c => profile[c] || []).filter(ref => isGeneratedAgentDefinition(id, ref)));
    next.definitions = next.definitions.filter(d => !owned.has(d.id) || referenced.has(d.id));
    return next;
  }
  if (typeof module !== 'undefined') module.exports = { jsonFields, fieldSchema, replaceField, lines, revisionChanged, formDocument, writeValue, writeFormValue, resolveSectionExclusions, documentParts, iniSections, editIni, agentPaths, registerAgent, removeAgent };
  if (!root || !root.document) return;
  const document = root.document;
  const drafts = new Map(); // View cache; drafts are persisted by the application session.
  let draftWrites = Promise.resolve();
  function persistDraft(d) {
    if (!d || d.snapshot.readOnly || d.persistedText === d.text || !catalog || !selected || (!dirty(d) && d.persistedText === undefined)) return;
    d.persistedText = d.text;
    const workspace = catalog.workspaceId, path = selected.path, text = d.text, revision = d.snapshot.revision;
    const write = root.settings.updateDraft(workspace, path, text, revision).catch(error => { if (d.persistedText === text) d.persistedText = undefined; message(error.message || 'Unable to retain draft.', true); });
    draftWrites = Promise.all([draftWrites.catch(() => {}), write]);
  }
  let catalog, selected, sequence = 0, view = 'source', busy = false, active = false;
  let body, list, editor, status, pageHost, activePage = null, deactivateEditor = null;
  const pageState = new Map();
  let selectedAgent = '', agentForm = null;
  const element = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const button = (label, action) => { const el = element('button', label, 'btn-secondary'); el.type = 'button'; el.addEventListener('click', action); return el; };
  const key = (workspace, path) => JSON.stringify([workspace, path]);
  const current = () => catalog && selected ? drafts.get(key(catalog.workspacePath || catalog.workspaceId, selected.path)) : null;
  const definition = (resource) => catalog.definitions.find(d => d.id === resource.definitionId) || {};
  const dirty = d => d && d.text !== (d.baseText ?? d.snapshot.text);
  function message(text, error = false) { status.textContent = text; status.classList.toggle('project-settings-error', error); }
  function updateStatus() {
    const d = current();
    if (!d) { message([...drafts.values()].some(dirty) ? 'Unsaved changes are kept while this app is open.' : 'No changes to save.'); return; }
    persistDraft(d);
    const ui = definition(selected).ui || {};
    message(d.conflict ? 'File changed externally. Your draft is kept. Copy it or reload the current file before saving.' : dirty(d) ? 'Unsaved changes · kept while this app is open.' : d.snapshot.readOnly ? 'Application-managed package · read-only.' : d.snapshot.exists ? 'Saved in project file.' : ui.emptyMessage || 'Not configured. Opening this view does not create a file.', !!d.conflict);
    const discard = editor.querySelector('[data-project-discard]');
    if (discard) discard.disabled = busy || !dirty(d);
    const save = editor.querySelector('[data-project-save]');
    if (save) { save.disabled = busy || !!d.conflict || !!d.snapshot.readOnly || (!dirty(d) && d.snapshot.exists); save.textContent = busy ? 'Saving…' : d.snapshot.exists ? ui.saveLabel || 'Save file' : ui.createLabel || 'Create file'; }
  }
  function renderList() {
    list.replaceChildren();
    if (catalog.pages?.length) { renderPageNavigation(); return; }
    const groups = new Map();
    let advanced;
    const resources = [...catalog.resources].sort((a, b) => Number(!!definition(a).ui?.advanced) - Number(!!definition(b).ui?.advanced) || (definition(a).ui?.order ?? 100) - (definition(b).ui?.order ?? 100));
    for (const resource of resources) {
      const def = definition(resource), group = def.group || 'Project files';
      const isAdvanced = def.ui?.advanced === true;
      if (isAdvanced && !advanced) {
        advanced = element('details', null, 'project-settings-advanced');
        advanced.open = resources.some(r => r.path === selected?.path && definition(r).ui?.advanced);
        advanced.append(element('summary', 'Advanced project files')); list.append(advanced);
      }
      const groupKey = JSON.stringify([isAdvanced, group]);
      if (!groups.has(groupKey)) {
        const section = element('div', null, 'project-settings-group'); section.append(element('h3', group));
        (isAdvanced ? advanced : list).append(section); groups.set(groupKey, section);
      }
      const exact = (def.match?.paths || []).includes(resource.path);
      const label = def.ui && exact ? def.title : resource.path;
      const row = button(label + (resource.exists ? '' : ' · not configured'), () => select(resource));
      row.classList.add('project-settings-resource');
      row.classList.toggle('selected', selected?.path === resource.path);
      row.title = resource.path;
      if (selected?.path === resource.path) row.setAttribute('aria-current', 'page');
      groups.get(groupKey).append(row);
    }
    if (!catalog.resources.length) list.append(element('p', 'No project settings files are defined.'));
  }
  function renderPageNavigation() {
    const claimed = new Set(catalog.pages.flatMap(p => p.sections.flatMap(s => s.definitions)));
    const groups = new Map(); let advanced;
    for (const page of [...catalog.pages].sort((a,b)=>Number(!!a.advanced)-Number(!!b.advanced) || (a.order||0)-(b.order||0))) {
      let parent = list;
      if (page.advanced) {
        if (!advanced) { advanced = element('details',null,'project-settings-advanced'); advanced.open = activePage?.advanced || pageState.get('advanced') || false;
          advanced.append(element('summary','Advanced')); advanced.addEventListener('toggle',()=>pageState.set('advanced',advanced.open)); list.append(advanced); }
        parent = advanced;
      }
      const key = JSON.stringify([!!page.advanced,page.group]);
      if (!groups.has(key)) { const group = element('div',null,'project-settings-group'); if (!page.advanced) group.append(element('h3',page.group)); parent.append(group); groups.set(key,group); }
      const row = button(page.title,()=>renderPage(page)); row.classList.add('project-settings-resource');
      row.classList.toggle('selected',activePage?.id === page.id); if (activePage?.id === page.id) row.setAttribute('aria-current','page'); groups.get(key).append(row);
    }
    // Unclaimed local definitions remain accessible without flattening their children.
    const extra = catalog.resources.filter(r=>!claimed.has(r.definitionId) && ((definition(r).match.paths||[]).includes(r.path) || (definition(r).match.directories||[]).includes(r.path)));
    if (extra.length) {
      const details = element('details',null,'project-settings-advanced'); details.append(element('summary','Additional settings'));
      extra.forEach(r=>details.append(button(definition(r).title,()=>{ activePage=null; editor=pageHost; deactivateEditor=null; select(r); }))); list.append(details);
    }
  }
  function pageDisclosure(parent,title,id,collapsed) {
    if (!collapsed) { const section=element('section',null,'project-settings-page-section'); section.append(element('h4',title)); parent.append(section); return section; }
    const details=element('details',null,'project-settings-card'); details.open=pageState.get(id)||false;
    details.append(element('summary',title)); details.addEventListener('toggle',()=>pageState.set(id,details.open)); parent.append(details); return details;
  }
  function renderAgentSelector(page) {
    if (!page.agentCategory) return;
    const toolbar = element('div', null, 'project-settings-agent-toolbar');
    const label = element('label', 'Agent '), picker = element('select'); picker.setAttribute('aria-label', 'Agent');
    const all = element('option', 'All agents'); all.value = ''; picker.append(all);
    for (const agent of catalog.agents || []) { const option = element('option', `${agent.title}${agent.custom ? ' · Custom' : ''}`); option.value = agent.id; picker.append(option); }
    if (!(catalog.agents || []).some(a => a.id === selectedAgent)) selectedAgent = '';
    picker.value = selectedAgent; picker.addEventListener('change', () => { selectedAgent = picker.value; renderPage(page); }); label.append(picker); toolbar.append(label);
    toolbar.append(button('Add custom agent', () => openAgentForm()));
    const profile = (catalog.agents || []).find(a => a.id === selectedAgent);
    if (profile?.custom) toolbar.append(button('Edit custom agent', () => openAgentForm(profile)));
    pageHost.append(toolbar);
    if (agentForm?.workspace === catalog.workspaceId) pageHost.append(button('Resume custom agent form', () => openAgentForm(agentForm.profile)));
  }
  async function openAgentForm(profile = null) {
    if (busy) return;
    const workspace = catalog.workspaceId, ticket = ++sequence;
    try {
      const path = 'nextprob.settings.json', identity = catalog.workspacePath || workspace;
      await draftWrites;
      const cached = drafts.get(key(identity, path)), retained = await root.settings.getDraft(workspace, path);
      if (dirty(cached) || cached?.conflict || (retained && retained.dirty !== false)) throw new Error('Save or discard the nextprob.settings.json draft in Customize settings panel before changing agents.');
      const snapshot = await root.settings.read(workspace, path);
      if (ticket !== sequence || catalog.workspaceId !== workspace) return;
      if ((snapshot.diagnostics || []).length || catalog.diagnostics?.some(d => d.source === path)) throw new Error('Repair nextprob.settings.json in Customize settings panel before changing agents.');
      const registry = snapshot.exists ? JSON.parse(snapshot.text) : { version: 1, definitions: [] };
      if (!Array.isArray(registry.definitions) || (registry.agents !== undefined && !Array.isArray(registry.agents))) throw new Error('Repair nextprob.settings.json before changing agents.');
      if (!agentForm || agentForm.workspace !== workspace || agentForm.profile?.id !== profile?.id) {
        const values = { title: profile?.title || '' };
        for (const category of agentCategories) values[category] = (profile?.[category] || []).flatMap(id => { const def = catalog.definitions.find(d => d.id === id); return [...(def?.match.paths || []), ...(def?.match.directories || [])]; }).join('\n');
        agentForm = { workspace, profile, values };
      }
      selected = null; deactivateEditor = null; editor = pageHost; pageHost.replaceChildren();
      pageHost.append(element('h3', profile ? 'Edit custom agent' : 'Add custom agent'), element('p', 'Register project-relative paths, one per line. Agent files are created only when you explicitly save them. Global home-directory files are outside this project.', 'project-settings-description'));
      const form = element('form', null, 'project-settings-agent-form');
      const fields = [['title', 'Agent name'], ['instructions', 'Instruction files'], ['skills', 'Skill directories (containing skill folders with SKILL.md)'], ['settings', 'Settings files'], ['resources', 'Other resource directories']];
      for (const [name, title] of fields) {
        const label = element('label', title), input = element(name === 'title' ? 'input' : 'textarea'); input.value = agentForm.values[name]; input.setAttribute('aria-label', title);
        if (name === 'title') { input.required = true; input.maxLength = 100; }
        input.addEventListener('input', () => { agentForm.values[name] = input.value; }); label.append(input); form.append(label);
      }
      const errorHost = element('p', '', 'project-settings-error'); errorHost.setAttribute('role', 'alert');
      const actions = element('div', null, 'project-settings-toolbar');
      const submit = button(profile ? 'Save agent' : 'Add agent', () => {}); submit.type = 'submit';
      actions.append(submit, button('Cancel', () => { agentForm = null; renderPage(activePage); }));
      form.append(errorHost, actions); pageHost.append(form); message('Custom agents are stored in nextprob.settings.json.');
      async function commit(remove = false) {
        if (busy) return;
        try {
          if (!remove && !form.reportValidity()) return;
          const next = remove ? removeAgent(registry, profile.id) : registerAgent(registry, agentForm.values, profile?.id, [...(catalog.agents || []).map(a => a.id), ...catalog.definitions.map(d => d.id)], catalog.definitions);
          busy = true; form.querySelectorAll('button').forEach(b => { b.disabled = true; });
          await draftWrites;
          const latestDraft = drafts.get(key(identity, path)), latestRetained = await root.settings.getDraft(workspace, path);
          if (dirty(latestDraft) || latestDraft?.conflict || (latestRetained && latestRetained.dirty !== false)) throw new Error('A registry draft exists. Save or discard it in Customize settings panel before changing agents.');
          await root.settings.save(workspace, path, JSON.stringify(next, null, 2) + '\n', snapshot.revision);
          drafts.delete(key(identity, path)); agentForm = null;
          selectedAgent = remove ? '' : next.agents.at(-1).id;
          busy = false; await refresh();
        } catch (error) { errorHost.textContent = error.message || String(error); }
        finally { busy = false; form.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
      }
      form.addEventListener('submit', event => { event.preventDefault(); commit(); });
      if (profile) {
        const removal = element('details', null, 'project-settings-card'); removal.append(element('summary', 'Remove custom agent'), element('p', 'Removes this registration and its generated definitions. Your agent files remain in the project.', 'project-settings-description'), button('Remove registration', () => commit(true))); form.append(removal);
      }
    } catch (error) { if (ticket === sequence) message(error.message || String(error), true); }
  }
  function renderPage(page) {
    if (!page || busy) return;
    sequence++; activePage=page; selected=null; deactivateEditor=null; editor=pageHost; pageHost.replaceChildren(); renderList();
    pageHost.append(element('h3',page.title)); const introduction=page.description || (page.sections.length===1 ? catalog.definitions.find(d=>d.id===page.sections[0].definitions[0])?.description : ''); if (introduction) pageHost.append(element('p',introduction,'project-settings-description'));
    renderAgentSelector(page);
    let initial; const shownPaths = new Set();
    for (const [index,section] of page.sections.entries()) {
      const agent = catalog.agents?.find(a => a.id === selectedAgent);
      const ids = section.definitions.filter(id => !page.agentCategory || !agent || (agent[page.agentCategory] || []).includes(id));
      if (page.agentCategory && !ids.length) continue;
      let parent; if(section.title===page.title&&!section.collapsed){parent=element('section',null,'project-settings-page-section');pageHost.append(parent);}else parent=pageDisclosure(pageHost,section.title,`${page.id}:${index}`,section.collapsed);
      if (section.description) parent.append(element('p',section.description,'project-settings-description'));
      const resources=catalog.resources.filter(r=>ids.includes(r.definitionId)).filter(r => { const identity = `${r.kind}:${r.path}`; if (shownPaths.has(identity)) return false; shownPaths.add(identity); return true; });
      if (section.view === 'packages') { renderPackages(parent,resources.filter(r=>r.kind==='package'),section.emptyMessage); continue; }
      if (section.view === 'browser') {
        const roots=resources.filter(r=>r.kind==='folder' && (definition(r).match.directories||[]).includes(r.path));
        for (const r of roots) renderFolder(parent,r,definition(r).title);
        const policies=section.definitions.flatMap(id=>catalog.definitions.find(d=>d.id===id)?.discovery?.exclude||[]);
        if (policies.length) { const info=element('details',null,'project-settings-policy'); info.append(element('summary','What is kept out of this browser?'));
          [...new Set(policies.map(p=>p.reason))].forEach(reason=>info.append(element('p',reason,'project-settings-description'))); parent.append(info); }
        continue;
      }
      const files=resources.filter(r=>r.kind==='file');
      if (!files.length) parent.append(element('p',section.emptyMessage||'No resources are registered for this section.','project-settings-description'));
      for (const r of files) {
        const def=definition(r), holder=element('div',null,'project-settings-document-slot'); parent.append(holder);
        holder.dataset.sectionTitle=section.title;
        const multiple=files.length>1;
        const location = multiple ? r.path.includes('/') ? 'Tool folder' : 'Project root' : def.title;
        const mount=()=>{
          holder.replaceChildren();
          const head=element('div',null,'project-settings-document-heading'); head.append(element('span',location));
          head.append(element('small',r.exists ? 'Configured' : def.ui?.emptyMessage||'No custom configuration.'));
          head.append(button(r.exists ? 'Open' : def.ui?.editor==='document' ? 'Add instructions' : 'Configure',()=>select(r,false,holder,mount)));
          holder.append(head); holder.append(element('code',r.path));
          if (page.agentCategory) { const owners=(catalog.agents||[]).filter(a=>(a[page.agentCategory]||[]).includes(r.definitionId)); if (owners.length) holder.append(element('small',`Used by: ${owners.map(a=>a.title).join(', ')}`,'project-settings-agent-origin')); }
        };
        mount();
        if (!initial && !section.collapsed && section.view==='resource') initial=()=>select(r,false,holder,mount);
      }
    }
    updateStatus(); initial?.();
  }
  function renderFolder(parent,resource,title,readOnly = false) {
    const details=element('details',null,'project-settings-folder'); details.append(element('summary',title)); parent.append(details);
    const content=element('div'); details.append(content); let loaded=false;
    details.addEventListener('toggle',()=>{ if (details.open && !loaded) { loaded=true; renderBrowser(content,resource,readOnly); } });
  }
  async function renderBrowser(parent,resource,readOnly=false) {
    if (!resource.exists) { parent.append(element('p','This folder has not been created.','project-settings-description')); return; }
    const workspace=catalog.workspaceId; parent.append(element('p','Loading…'));
    try {
      const result=root.settings.browse ? await root.settings.browse(workspace,resource.path) : {resources:catalog.resources.filter(r=>r.path.startsWith(resource.path+'/') && !r.path.slice(resource.path.length+1).includes('/'))};
      if (!parent.isConnected || workspace!==catalog.workspaceId) return;
      parent.replaceChildren();
      for (const r of result.resources) {
        if (r.kind==='folder') renderFolder(parent,r,r.path.split('/').at(-1),readOnly);
        else {
          const holder=element('div',null,'project-settings-browser-file'); parent.append(holder);
          const mount=()=>{ holder.replaceChildren(button(r.path.split('/').at(-1),()=>select({...r,browsed:true},false,holder,mount))); };
          mount();
        }
      }
      if (!result.resources.length) parent.append(element('p','No additional text configuration files.','project-settings-description'));
      for (const item of result.diagnostics||[]) parent.append(element('p',`${item.path ? item.path + ': ' : ''}${item.message}`,'project-settings-description'));
    } catch (error) { if (parent.isConnected) parent.replaceChildren(element('p',error.code==='ENOENT' || /ENOENT/.test(error.message) ? 'No files in this category.' : error.message,'project-settings-description')); }
  }
  function renderPackages(parent,packages,emptyMessage) {
    const grouped=new Map();
    for (const pkg of packages) { const key=JSON.stringify([pkg.name,pkg.fingerprint||pkg.path]); if (!grouped.has(key)) grouped.set(key,[]); grouped.get(key).push(pkg); }
    if (!grouped.size) parent.append(element('p',emptyMessage||'No packages are installed.','project-settings-description'));
    for (const copies of grouped.values()) {
      const pkg=copies[0],card=element('article',null,'project-settings-package');
      card.append(element('h4',pkg.name),element('p',pkg.description||'Project instruction package.','project-settings-description'));
      const origins=[...new Set(copies.map(c=>c.status))]; card.append(element('small',origins.length===1 ? ({managed:'App-managed',modified:'Modified copy',custom:'Custom'}[origins[0]]||'Custom') : 'Mixed origins'));
      const consumers = (catalog.agents || []).filter(agent => (agent.skills || []).some(id => copies.some(c => c.definitionId === id))).map(agent => agent.title);
      card.append(element('p',`Available to: ${[...new Set(consumers.length ? consumers : copies.map(c=>definition(c).title))].join(', ')}`,'project-settings-description'));
      const details=element('details');details.append(element('summary','View details'));card.append(details);
      const tabs=element('div',null,'project-settings-toolbar'), content=element('div');details.append(tabs,content);
      const openFile=(resource)=>{
        const mount=()=>{content.replaceChildren(button('View instructions',()=>select({...resource,path:resource.marker,kind:'file',browsed:true},false,content,mount)));};
        select({...resource,path:resource.marker,kind:'file',browsed:true},false,content,mount);
      };
      tabs.append(button('Instructions',()=>openFile(pkg)));
      for (const entry of definition(pkg).discovery?.packageViews||[]) tabs.append(button(entry.title,()=>{ if (content.contains(editor)) {deactivateEditor=null;selected=null;editor=pageHost;updateStatus();} content.replaceChildren();renderBrowser(content,{...pkg,path:`${pkg.path}/${entry.path}`},pkg.status==='managed'); }));
      const installation=element('details');installation.append(element('summary','Installation details'));
      copies.forEach(c=>{installation.append(element('p',`${definition(c).title} · ${c.status}${c.version ? ` · version ${c.version}` : ''}`,'project-settings-description'),element('code',c.path));});details.append(installation);
      copies.forEach(c=>renderFolder(details,{...c,kind:'folder'},copies.length>1 ? `Package files — ${definition(c).title}` : 'Package files',c.status==='managed'));
      let opened=false;details.addEventListener('toggle',()=>{if(details.open&&!opened){opened=true;openFile(pkg);}});
      parent.append(card);
    }
  }
  async function select(resource, refreshing = false, host = null, restore = null) {
    if (busy) return;
    if (host && host !== editor) { deactivateEditor?.(); editor = host; deactivateEditor = restore; }
    selected = resource; if (!refreshing) view = resource.browsed && resource.format === 'json' ? 'source' : resource.preview || (definition(resource).ui?.defaultView && definition(resource).ui.defaultView !== 'source') ? 'friendly' : 'source'; renderList();
    const ticket = ++sequence, workspace = catalog.workspaceId, identity = catalog.workspacePath || workspace;
    if (!refreshing) editor.replaceChildren(element('p', 'Reading file…'));
    if (resource.kind === 'folder') {
      editor.replaceChildren(element('h3', definition(resource).title || resource.path));
      renderBrowser(editor, resource); message(''); return;
    }
    try {
      let d = drafts.get(key(identity, resource.path));
      await draftWrites;
      const snapshot = await root.settings.read(workspace, resource.path);
      let retained = await root.settings.getDraft(workspace, resource.path);
      if (retained && retained.dirty === false && retained.revision !== snapshot.revision) { await root.settings.discardDraft(workspace, resource.path); retained = null; }
      if (ticket !== sequence || catalog.workspaceId !== workspace) return;
      if (!d && retained) { d = { snapshot: { ...snapshot, revision: retained.revision }, text: retained.text, baseText: retained.baseText ?? snapshot.text, persistedText: retained.text, conflict: retained.revision !== snapshot.revision }; drafts.set(key(identity, resource.path), d); }
      if (!d) { d = { snapshot, text: snapshot.exists ? snapshot.text : (definition(resource).creation?.initialText || snapshot.text), conflict: false }; d.baseText = d.text; drafts.set(key(identity, resource.path), d); }
      else if (revisionChanged(d.snapshot, snapshot)) {
        if (dirty(d)) { d.conflict = true; if (refreshing) { updateStatus(); return; } }
        else { await root.settings.discardDraft(workspace, resource.path); d.snapshot = snapshot; d.text = snapshot.text; d.baseText = snapshot.text; d.persistedText = undefined; d.conflict = false; }
      } else if (refreshing) { updateStatus(); return; }
      renderEditor();
    } catch (error) { if (ticket === sequence) { editor.replaceChildren(); message(error.message || String(error), true); } }
  }
  function renderEditor() {
    const d = current(); if (!d) return;
    const focusedPath = document.activeElement?.dataset?.formPath;
    const def = definition(selected), format = d.snapshot.format || def.format;
    editor.replaceChildren();
    const isForm = view !== 'source' && ((format === 'json' && def.ui?.layout) || def.ui?.editor);
    if(!activePage||selected.browsed) editor.append(element('h3', selected.browsed ? selected.path.split('/').at(-1) : def.title || selected.path));
    if (!isForm) editor.append(element('code', selected.path));
    if (['toml', 'jsonc'].includes(format)) editor.append(element('p', 'Source editor · comments and unknown options are preserved. Syntax is not validated here.', 'project-settings-notice'));
    if (def.description && !activePage) editor.append(element('p', def.description, 'project-settings-description'));
    const managed = d.snapshot.managedSections || def.managedSections || [];
    for (const section of (view !== 'source' && ['document','rules'].includes(def.ui?.editor) ? [] : managed)) editor.append(element('p', `${section.label || 'Managed section'} is maintained by the application. Changes to its protected content cannot be saved.`, 'project-settings-notice'));
    for (const item of d.snapshot.diagnostics || []) editor.append(element('p', typeof item === 'string' ? item : item.message, 'project-settings-error'));
    const toolbar = element('div', null, 'project-settings-toolbar');
    const fileActions = isForm ? element('details', null, 'project-settings-file-actions') : toolbar;
    if (isForm) fileActions.append(element('summary', 'File actions'), element('code', selected.path));
    fileActions.append(button('Source', () => { view = 'source'; renderEditor(); }));
    const supportedView = format === 'markdown' ? 'preview' : ['json','ini'].includes(format) ? 'structured' : 'rules';
    const friendlyAllowed = !def.views || def.views.includes(supportedView) || (format === 'json' && def.views.includes('fields')) || def.views.includes('friendly');
    if (!isForm && friendlyAllowed && ['markdown', 'json', 'ini', 'line-rules'].includes(format)) toolbar.append(button(format === 'markdown' ? 'Preview' : def.ui?.layout || format === 'ini' ? 'Settings' : format === 'line-rules' ? 'Rules' : 'Fields', () => { view = 'friendly'; renderEditor(); }));
    const save = button(d.snapshot.exists ? def.ui?.saveLabel || 'Save file' : def.ui?.createLabel || 'Create file', saveCurrent); save.dataset.projectSave = ''; toolbar.append(save);
    fileActions.append(button('Reload file', reloadCurrent), button('Copy draft', async () => {
      try { await root.navigator.clipboard.writeText(d.text); message('Draft copied.'); } catch (error) { message(error.message || 'Unable to copy draft.', true); }
    }));
    if (isForm) toolbar.append(fileActions);
    const discard = button('Discard changes', reloadCurrent); discard.dataset.projectDiscard = ''; toolbar.append(discard);
    editor.append(toolbar);
    if (view === 'source') {
      const input = element('textarea', null, 'project-settings-source'); input.value = d.text; input.spellcheck = false; input.readOnly = !!d.snapshot.readOnly;
      input.setAttribute('aria-label', `Source of ${selected.path}`);
      input.addEventListener('input', () => { d.text = input.value; updateStatus(); }); editor.append(input);
    } else if (def.ui?.editor === 'document' && ['markdown','text'].includes(format)) {
      renderDocument(d);
    } else if (format === 'ini') {
      renderIni(d, def.ui?.iniFields || []);
    } else if (format === 'line-rules') {
      renderRules(d);
    } else if (format === 'markdown') {
      const preview = element('div', null, 'project-settings-preview');
      preview.innerHTML = root.DOMPurify.sanitize(root.marked.parse(d.text), { FORBID_TAGS: ['img', 'iframe', 'form'], FORBID_ATTR: ['style'] });
      preview.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); a.removeAttribute('target'); }); editor.append(preview);
    } else if (format === 'json' && def.ui?.layout) {
      try { renderForm(d, def.ui.layout); }
      catch (error) { editor.append(element('p', `Cannot display settings: ${error.message}. Use Source to repair the file.`, 'project-settings-error')); }
    } else if (format === 'json') {
      try {
        const fields = jsonFields(d.text);
        if (!fields.length) editor.append(element('p', 'No values are configured. Add fields in Source.'));
        for (const field of fields) {
          const schema = fieldSchema(d.snapshot.schema, field.path);
          const label = schema.title || field.path.join(' › ') || 'Value';
          const row = element('label', null, 'project-settings-field'); row.append(element('span', label));
          const input = element(Array.isArray(schema.enum) ? 'select' : 'input');
          input.setAttribute('aria-label', schema.title || field.path.join('.') || 'Value');
          if (schema.description) row.title = schema.description;
          if (Array.isArray(schema.enum)) {
            schema.enum.forEach(value => { const option = element('option', String(value)); option.value = JSON.stringify(value); input.append(option); });
            input.value = JSON.stringify(field.value);
          } else if (typeof field.value === 'boolean') { input.type = 'checkbox'; input.checked = field.value; }
          else {
            if (typeof field.value === 'number') { input.type = 'number'; input.step = schema.type === 'integer' ? '1' : 'any'; if (schema.minimum != null) input.min = schema.minimum; if (schema.maximum != null) input.max = schema.maximum; }
            input.value = typeof field.value === 'string' ? field.value : JSON.stringify(field.value);
          }
          input.addEventListener('change', () => {
            try {
              const value = input.tagName === 'SELECT' ? JSON.parse(input.value) : input.type === 'checkbox' ? input.checked : typeof field.value === 'string' ? input.value : JSON.parse(input.value);
              if (value !== null && typeof value === 'object') throw new Error('Use Source to edit objects or arrays.');
              // Recompute offsets: prior edits may have changed token lengths.
              const latest = jsonFields(d.text).find(f => JSON.stringify(f.path) === JSON.stringify(field.path));
              d.text = replaceField(d.text, latest, value); updateStatus();
            } catch (error) { message(error.message, true); }
          }); row.append(input); editor.append(row);
        }
        editor.append(element('p', 'Only configured values are shown. Use Source to add or remove fields. Editing a value preserves surrounding formatting.', 'project-settings-notice'));
      } catch (error) { editor.append(element('p', `Cannot display fields: ${error.message}. Edit Source to repair the document.`, 'project-settings-error')); }
    } else {
      const entries = lines(d.text);
      entries.forEach((line, index) => {
        const row = element('label', null, 'project-settings-field'); row.append(element('span', `Line ${index + 1}`));
        const input = element('input'); input.value = line.text; input.setAttribute('aria-label', `Line ${index + 1}`);
        input.addEventListener('input', () => { line.text = input.value; d.text = entries.map(l => l.text + l.ending).join(''); updateStatus(); }); row.append(input); editor.append(row);
      });
      editor.append(element('p', 'Line order, comments and blank lines are preserved. Use Source to add, remove or reorder lines.', 'project-settings-notice'));
    }
    editor.append(toolbar); // Keep save/discard together at the bottom of the active editor.
    if (d.snapshot.readOnly) editor.querySelectorAll('input, select, textarea, .project-settings-form button, .project-settings-rules button').forEach(el => { if (el.tagName === 'TEXTAREA') el.readOnly = true; else el.disabled = true; });
    updateStatus();
    if (focusedPath) [...editor.querySelectorAll('[data-form-path]')].find(input => input.dataset.formPath === focusedPath)?.focus();
  }
  function safePreview(text) {
    const preview=element('div',null,'project-settings-preview');
    preview.innerHTML=root.DOMPurify && root.marked ? root.DOMPurify.sanitize(root.marked.parse(text),{FORBID_TAGS:['img','iframe','form'],FORBID_ATTR:['style']}) : '';
    if(!root.DOMPurify||!root.marked)preview.textContent=text;
    preview.querySelectorAll('a').forEach(a=>{a.removeAttribute('href');a.removeAttribute('target');});return preview;
  }
  function renderDocument(d) {
    const parts=documentParts(d.text,d.snapshot.managedSections), area=element('div',null,'project-settings-document');editor.append(area);
    let userIndex=0;
    for(const part of parts){
      if(part.managed){const details=element('details',null,'project-settings-card');details.append(element('summary','Application instructions · managed'),safePreview(part.text));area.append(details);continue;}
      const block=element('section'),toolbar=element('div',null,'project-settings-toolbar'),content=element('div');block.append(toolbar,content);area.append(block);
      const label=++userIndex===1 ? 'Instructions' : `Additional instructions ${userIndex}`;
      const edit=()=>{const input=element('textarea',null,'project-settings-source');input.value=part.text;input.placeholder='Write guidance for assistants working in this project…';input.setAttribute('aria-label',label);input.readOnly=!!d.snapshot.readOnly;
        input.addEventListener('input',()=>{part.text=input.value;d.text=parts.map(p=>p.text).join('');updateStatus();});content.replaceChildren(input);};
      toolbar.append(button('Edit',edit),button('Preview',()=>content.replaceChildren(safePreview(part.text))));
      if(d.snapshot.readOnly)content.append(safePreview(part.text));else edit();
    }
  }
  function renderRules(d) {
    const parts=documentParts(d.text,d.snapshot.managedSections), panel=element('div',null,'project-settings-rules');editor.append(panel);
    const entries=[];parts.forEach((part,partIndex)=>{if(!part.managed)lines(part.text).forEach((line,lineIndex)=>entries.push({...line,partIndex,lineIndex}));});
    const save=()=>{for(const [i,part] of parts.entries())if(!part.managed)part.text=entries.filter(l=>l.partIndex===i).map(l=>l.text+l.ending).join('');d.text=parts.map(p=>p.text).join('');updateStatus();};
    const advanced=element('details',null,'project-settings-card');advanced.append(element('summary','Advanced patterns, comments & exceptions'));
    const simple=entries.filter(l=>l.text.trim()&&!/^\s*[#!]/.test(l.text));
    const makeRow=(line,parent,advancedLine=false)=>{const row=element('div',null,'project-settings-rule-row'),input=element('input');input.value=line.text;input.setAttribute('aria-label',advancedLine ? 'Advanced pattern or comment' : 'Excluded folder or pattern');
      input.dataset.ruleId=String(entries.indexOf(line));input.addEventListener('input',()=>{line.text=input.value;panel.querySelectorAll('[data-rule-id]').forEach(other=>{if(other!==input&&other.dataset.ruleId===input.dataset.ruleId)other.value=input.value;});save();});row.append(input);
      const baseline = d.snapshot.semantics?.baselineRules?.find(rule => rule.pattern === line.text.trim());
      const remove = button(baseline ? 'Remove duplicate' : 'Remove',()=>{const i=entries.indexOf(line);entries.splice(i,1);save();renderEditor();});
      if (baseline) { input.title = 'Also excluded by an application default or managed package'; remove.title = 'Removes this file entry; the underlying exclusion still applies.'; row.append(element('small',baseline.origin === 'application-default' ? 'Also a default' : 'Also managed','project-settings-rule-origin')); }
      row.append(remove);
      if(advancedLine){for(const [label,delta] of [['Move up',-1],['Move down',1]]){const move=button(label,()=>{const i=entries.indexOf(line);[entries[i].text,entries[i+delta].text]=[entries[i+delta].text,entries[i].text];save();renderEditor();});const i=entries.indexOf(line);move.disabled=i+delta<0||i+delta>=entries.length||entries[i+delta]?.partIndex!==line.partIndex;row.append(move);}}
      parent.append(row);};
    const ruleList=element('div',null,'project-settings-rule-list');
    simple.forEach(l=>makeRow(l,ruleList));if(!simple.length)ruleList.append(element('p','No custom exclusions.','project-settings-description'));
    const addRow=element('div',null,'project-settings-add-entry'),input=element('input');input.placeholder='Folder or pattern, e.g. build/';input.setAttribute('aria-label','New exclusion');
    addRow.append(input,button('+ Add exclusion',()=>{const text=input.value;if(!text.trim()||/[\r\n]/.test(text))return;let partIndex=parts.findIndex(p=>!p.managed);if(partIndex<0){parts.push({managed:false,text:''});partIndex=parts.length-1;}
      const segment=entries.filter(l=>l.partIndex===partIndex),last=segment.at(-1),ending=entries.find(l=>l.ending)?.ending||'\n';
      const tail=last&&last.text===''&&!last.ending ? entries.indexOf(last) : last ? entries.indexOf(last)+1 : entries.length;
      if(last&&last.text!==''&&!last.ending)last.ending=ending;
      entries.splice(tail,0,{text,ending,partIndex});save();renderEditor();}));panel.append(addRow,ruleList);
    // The full ordered list remains available; ordinary rows are repeated here for context.
    entries.filter(l=>l.text.trim()).forEach(l=>makeRow(l,advanced,true));panel.append(advanced);
    const baseline = d.snapshot.semantics?.baselineRules || [];
    if (baseline.length || parts.some(p=>p.managed)) {
      const managed=element('details',null,'project-settings-card');managed.append(element('summary','Default and managed exclusions'));
      if (d.snapshot.semantics?.baselineDescription) managed.append(element('p',d.snapshot.semantics.baselineDescription,'project-settings-description'));
      const rules=element('div',null,'project-settings-baseline');
      baseline.forEach(rule=>{const row=element('div');row.append(element('code',rule.pattern),element('small',rule.origin==='application-default'?'Application default':'Managed package'));rules.append(row);});managed.append(rules);
      parts.filter(p=>p.managed).forEach(p=>managed.append(element('pre',p.text)));panel.append(managed);
    }
  }
  function renderIni(d,fields) {
    const parsed=iniSections(d.text),panel=element('div',null,'project-settings-form');editor.append(panel);
    parsed.sections.forEach((section,index)=>{
      const parent=index===0 ? element('section',null,'project-settings-section') : element('details',null,'project-settings-card');
      parent.append(element(index===0?'h4':'summary',index===0?'General':section.name));if(index===1)parent.open=true;panel.append(parent);
      for(const field of fields.filter(f=>f.scope===(index===0?'root':'section'))){
        const value=section.fields.filter(f=>f.key===field.key).at(-1)?.value;
        const row=element('label',null,'project-settings-control');row.append(element('span',field.title));
        const input=element(field.options?'select':'input');input.setAttribute('aria-label',`${field.title}${section.name?' — '+section.name:''}`);
        if(field.options){const options=[{value:'',label:'Not set'},...field.options];if(value!==undefined&&!options.some(o=>o.value===value))options.push({value,label:value});options.forEach(o=>{const option=element('option',o.label);option.value=o.value;input.append(option);});}
        if(field.type==='number')input.type='number';input.value=value||'';input.addEventListener('change',()=>{d.text=editIni(d.text,index,field.key,input.value||undefined);updateStatus();});row.append(input);parent.append(row);
      }
      const known=new Set(fields.map(f=>f.key)),unknown=section.fields.filter(f=>!known.has(f.key));
      if(unknown.length){const details=element('details');details.append(element('summary','Additional properties'));unknown.forEach(f=>details.append(element('p',`${f.key} = ${f.value}`,'project-settings-description')));parent.append(details);}
    });
    const add=element('div',null,'project-settings-add-entry'),pattern=element('input');pattern.placeholder='File pattern, e.g. *.js';pattern.setAttribute('aria-label','New file pattern');
    add.append(pattern,button('+ Add file pattern',()=>{const value=pattern.value.trim();if(!value||/[\r\n\[\]]/.test(value)){message('Enter a file pattern without brackets or newlines.',true);return;}const ending=parsed.entries.find(l=>l.ending)?.ending||'\n';d.text+=(d.text&&!/[\r\n]$/.test(d.text)?ending:'')+ending+'['+value+']'+ending;renderEditor();}));panel.append(add);
  }
  function renderForm(d, layout) {
    const exclusions = d.snapshot.path === 'nextprob.config.json' ? catalog.officialExclusions : undefined;
    const effective = formDocument(JSON.parse(d.text), layout, exclusions);
    const form = element('div', null, 'project-settings-form');
    editor.append(form);
    const conditions = [];
    const refreshConditions = () => {
      const doc = formDocument(JSON.parse(d.text), layout);
      for (const {el, when, base} of conditions) el.hidden = JSON.stringify(get(doc, [...base, ...when.path])) !== JSON.stringify(when.equals);
    };
    const state = d.expanded || (d.expanded = new Map());
    function commit(path, value, rerender = false) {
      try {
        // Read current text, never the closure's older token offsets or defaults.
        d.text = writeFormValue(d.text, path, value, layout, exclusions);
        if (rerender) renderEditor(); else updateStatus();
      } catch (error) { message(error.message, true); }
    }
    function disclosure(parent, title, identity, collapsed = true) {
      const details = element('details', null, 'project-settings-card');
      details.open = state.has(identity) ? state.get(identity) : !collapsed;
      details.addEventListener('toggle', () => { state.set(identity, details.open); });
      const summary = element('summary'); summary.append(element('span', title, 'project-settings-item-title'));
      details.append(summary); parent.append(details);
      return details;
    }
    function visit(nodes, parent, base = []) {
      for (const node of nodes) {
        const path = [...base, ...(node.path || [])];
        let target = parent;
        if (node.visibleWhen) {
          target = element('div'); parent.append(target);
          target.hidden = JSON.stringify(get(effective, [...base, ...node.visibleWhen.path])) !== JSON.stringify(node.visibleWhen.equals);
          conditions.push({el:target,when:node.visibleWhen,base});
        }
        const identity = JSON.stringify([base, node]);
        if (node.type === 'group') {
          let group;
          if (node.collapsed !== undefined) group = disclosure(target, node.title, identity, node.collapsed);
          else { group = element('section', null, 'project-settings-section'); group.append(element('h4', node.title)); target.append(group); }
          if (node.description) group.append(element('p', node.description, 'project-settings-description'));
          visit(node.children, group, base); continue;
        }
        const schema = fieldSchema(d.snapshot.schema, path);
        const value = get(effective, path);
        if (node.type === 'field') {
          const label = node.title || schema.title || path.at(-1) || 'Value';
          const row = element('label', null, 'project-settings-control');
          const caption = element('span', null, 'project-settings-caption'); caption.append(element('span', label));
          const description = node.description || schema.description;
          if (description) caption.append(element('small', description));
          row.append(caption);
          let options = node.options || (schema.enum || []).map(v => ({ value: v, label: String(v) }));
          if (node.optionsFrom) options = Object.keys(get(effective, node.optionsFrom) || {}).map(v => ({ value: v, label: v }));
          const control = node.control || (options.length ? 'select' : typeof value === 'boolean' || schema.type === 'boolean' ? 'toggle' : schema.type === 'integer' || schema.type === 'number' ? 'number' : 'text');
          const input = element(control === 'select' ? 'select' : ['json', 'lines'].includes(control) ? 'textarea' : 'input');
          input.setAttribute('aria-label', label); input.dataset.formPath = JSON.stringify(path);
          if (control === 'toggle') { input.type = 'checkbox'; input.checked = value === true; input.setAttribute('role', 'switch'); }
          else if (control === 'select') {
            if (!node.optional && value === undefined) { const placeholder = element('option', node.emptyLabel || 'Choose an option'); placeholder.value = ''; placeholder.disabled = true; input.append(placeholder); }
            if (node.optional) { const option = element('option', node.emptyLabel || 'Use default'); option.value = ''; input.append(option); }
            if (value !== undefined && !options.some(o => JSON.stringify(o.value) === JSON.stringify(value))) options = [...options, { value, label: String(value) }];
            options.forEach(o => { const option = element('option', o.label); option.value = JSON.stringify(o.value); input.append(option); });
            input.value = value === undefined ? '' : JSON.stringify(value);
          } else {
            input.value = control === 'json' ? value === undefined ? '' : JSON.stringify(value, null, 2) : control === 'lines' ? (value || []).join('\n') : value ?? '';
            if (control === 'number') { input.type = 'number'; input.step = schema.type === 'integer' ? '1' : 'any'; if (schema.minimum != null) input.min = schema.minimum; if (schema.maximum != null) input.max = schema.maximum; }
            if (control === 'json') input.spellcheck = false;
            if (control === 'text') { if (schema.minLength != null) { input.minLength = schema.minLength; input.required = schema.minLength > 0; } if (schema.maxLength != null) input.maxLength = schema.maxLength; if (schema.pattern) input.pattern = `.*(?:${schema.pattern}).*`; }
          }
          // Input events share the additions present when editing began, so temporary
          // prefixes typed between events do not become remembered removals.
          const originalAdditions = exclusions && path.length === 5 && path[0] === 'surfaces' && path[2] === 'sections' && ['hiddenFiles', 'hiddenFolders'].includes(path[4]) ? copy(get(JSON.parse(d.text), path) || []) : undefined;
          const change = event => {
            try {
              input.setCustomValidity('');
              if (!input.checkValidity()) { if (event.type === 'change') input.reportValidity(); return; }
              const next = node.optional && input.value === '' && control !== 'toggle' ? undefined : control === 'toggle' ? input.checked : control === 'select' ? input.value === '' ? undefined : JSON.parse(input.value) : control === 'json' ? input.value.trim() ? JSON.parse(input.value) : undefined : control === 'lines' ? input.value.split(/\r?\n/).filter(Boolean) : control === 'number' ? Number(input.value) : input.value;
              let text = writeFormValue(d.text, path, next, layout, exclusions, originalAdditions);
              if (next !== undefined) for (const sibling of node.clearOnChange || []) text = writeValue(text, [...base, ...sibling], undefined);
              d.text = text;
              if (control === 'toggle' || control === 'select') renderEditor();
              else {
                // Keep text controls and action buttons mounted while focus moves.
                const card = input.closest('.project-settings-card[data-title-path]');
                if (card && card.dataset.titlePath === JSON.stringify(path)) {
                  card.querySelector('.project-settings-item-title').textContent = String(next ?? '');
                  for (const action of card.querySelectorAll(':scope > .project-settings-item-actions > button')) {
                    if (action.dataset.moveLabel) action.setAttribute('aria-label', `${action.dataset.moveLabel}: ${next}`);
                    if (action.dataset.remove) action.textContent = `Remove ${next}`;
                  }
                }
                refreshConditions(); updateStatus();
              }
            } catch (error) { input.setCustomValidity(error.message); message(error.message, true); }
          };
          input.addEventListener('change', change);
          if (['text', 'number', 'lines'].includes(control)) input.addEventListener('input', change);
          if (node.summary) { row.classList.add('project-settings-summary-control'); row.addEventListener('click', event => event.stopPropagation()); }
          row.append(input); target.append(row); continue;
        }
        const section = element('section', null, 'project-settings-section'); section.append(element('h4', node.title));
        if (node.description) section.append(element('p', node.description, 'project-settings-description'));
        target.append(section);
        const isList = node.type === 'list';
        if (value !== undefined && (isList ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`${node.title} has an unexpected value`);
        const entries = isList ? (value || []).map((v, i) => [i, v]) : Object.entries(value || {});
        for (const [key, item] of entries) {
          const title = String(node.itemTitle ? get(item, node.itemTitle) ?? key : key);
          const card = disclosure(section, title, JSON.stringify([...path, node.keyField ? item[node.keyField] : key]), true);
          if (node.itemTitle) card.dataset.titlePath = JSON.stringify([...path, key, ...node.itemTitle]);
          const actions = element('div', null, 'project-settings-item-actions');
          if (isList && node.reorderable) {
            for (const [label, delta] of [['Move up', -1], ['Move down', 1]]) {
              const move = button(label, () => {
                const latest = get(formDocument(JSON.parse(d.text), layout), path).slice();
                [latest[key], latest[key + delta]] = [latest[key + delta], latest[key]]; commit(path, latest, true);
              });
              move.dataset.moveLabel = label;
              move.setAttribute('aria-label', `${label}: ${title}`); move.disabled = key + delta < 0 || key + delta >= entries.length; actions.append(move);
            }
          }
          if (node.removable) { const remove = button(`Remove ${title}`, () => {
            const currentItem = get(formDocument(JSON.parse(d.text), layout), [...path, key]);
            const currentTitle = node.itemTitle ? get(currentItem, node.itemTitle) : key;
            if (!root.confirm(`Remove “${currentTitle}”?`)) return;
            const latest = copy(get(formDocument(JSON.parse(d.text), layout), path));
            if (isList) latest.splice(key, 1); else delete latest[key]; commit(path, latest, true);
          }); remove.dataset.remove = 'true'; actions.append(remove); }
          const header = card.querySelector('summary');
          if (isList && node.reorderable) {
            header.draggable = true; header.title = 'Drag to reorder, or expand for Move up and Move down buttons';
            header.addEventListener('dragstart', event => { event.stopPropagation(); event.dataTransfer.setData('application/x-nextprob-setting', JSON.stringify({path, index:key})); event.dataTransfer.effectAllowed = 'move'; });
            header.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('application/x-nextprob-setting')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
            header.addEventListener('drop', event => {
              event.preventDefault(); event.stopPropagation();
              try {
                const from = JSON.parse(event.dataTransfer.getData('application/x-nextprob-setting'));
                const latest = copy(get(formDocument(JSON.parse(d.text), layout), path));
                if (JSON.stringify(from.path) !== JSON.stringify(path) || !Number.isInteger(from.index) || from.index < 0 || from.index >= latest.length || from.index === key) return;
                const [moved] = latest.splice(from.index, 1); latest.splice(key, 0, moved); commit(path, latest, true);
              } catch { /* Ignore unrelated or malformed drag data. */ }
            });
          }
          visit(node.children.filter(child => child.summary), header, [...path, key]);
          card.append(actions); visit(node.children.filter(child => !child.summary), card, [...path, key]);
        }
        if (!entries.length) section.append(element('p', node.emptyLabel || 'No entries yet.', 'project-settings-description'));
        if (node.itemTemplate !== undefined) {
          const addRow = element('div', null, 'project-settings-add-entry');
          const name = isList ? null : element('input');
          if (name) { name.placeholder = 'Name'; name.setAttribute('aria-label', `New entry name: ${node.title}`); addRow.append(name); }
          addRow.append(button(node.addLabel || 'Add entry', () => {
          const latest = copy(get(formDocument(JSON.parse(d.text), layout), path) || (isList ? [] : {}));
          const item = copy(node.itemTemplate);
          if (isList) {
            if (node.keyField) {
              const seed = item[node.keyField] || 'item'; let id = seed, n = 2;
              while (latest.some(v => v[node.keyField] === id)) id = `${seed}${n++}`;
              item[node.keyField] = id;
            }
            latest.push(item);
          } else {
            const key = name.value.trim();
            if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || own(latest, key)) { message('Choose a unique name starting with a letter, using letters, numbers, _ or -.', true); return; }
            latest[key] = item;
          }
          commit(path, latest, true);
          })); section.append(addRow);
        }
      }
    }
    visit(layout, form);
  }
  async function reloadCurrent() {
    const d = current(); if (!d || !catalog || !selected) return;
    const workspace = catalog.workspaceId, identity = catalog.workspacePath || workspace, resource = selected;
    if (dirty(d) && !root.confirm('Discard this unsaved draft and reload the file? Copy the draft first if you want to keep it.')) return;
    try {
      await draftWrites;
      await root.settings.discardDraft(workspace, resource.path);
      drafts.delete(key(identity, resource.path));
      if (catalog.workspaceId === workspace && selected === resource) await select(resource);
    } catch (error) {
      if (catalog.workspaceId === workspace && selected === resource) message(error.message || 'Unable to discard changes.', true);
    }
  }
  async function saveCurrent() {
    const d = current(); if (!d || busy || d.conflict || d.snapshot.readOnly) return;
    const invalid = [...editor.querySelectorAll('.project-settings-form input, .project-settings-form textarea, .project-settings-form select')].find(input => !input.closest('[hidden]') && !input.checkValidity());
    if (invalid) { invalid.closest('details')?.setAttribute('open', ''); invalid.reportValidity(); return; }
    const workspace = catalog.workspaceId, path = selected.path;
    const text = d.text;
    const originalDraft = d.text;
    busy = true; updateStatus();
    try {
      await draftWrites;
      const saved = await root.settings.save(workspace, path, text, d.snapshot.revision);
      d.snapshot = saved; d.baseText = saved.text; d.conflict = false; d.persistedText = undefined;
      if (d.text === originalDraft) d.text = saved.text;
      if (catalog.workspaceId === workspace && selected?.path === path) { selected.exists = saved.exists; renderList(); renderEditor(); }
    } catch (error) {
      if (catalog.workspaceId === workspace && selected?.path === path) message(error.message || String(error), true);
    } finally {
      busy = false;
      const discard = editor.querySelector('[data-project-discard]');
      if (discard) discard.disabled = !dirty(current());
      const save = editor.querySelector('[data-project-save]');
      if (save) {
        save.disabled = !!current()?.conflict || !!current()?.snapshot.readOnly || (!!current()?.snapshot.exists && !dirty(current()));
        save.textContent = current()?.snapshot.exists ? definition(selected).ui?.saveLabel || 'Save file' : definition(selected).ui?.createLabel || 'Create file';
      }
    }
  }
  async function refresh() {
    const ticket = ++sequence;
    try {
      const incoming = await root.settings.list(); if (ticket !== sequence) return;
      const workspaceChanged = catalog && catalog.workspaceId !== incoming.workspaceId;
      catalog = incoming;
      if (workspaceChanged) { selectedAgent = ''; agentForm = null; selected = null; activePage = null; deactivateEditor = null; editor = pageHost; }
      renderList();
      if (selected) { const resource = catalog.resources.find(r => r.path === selected.path) || (selected.browsed && catalog.definitions.some(d => d.id === selected.definitionId) ? selected : null); if (resource) await select(resource, true); else { selected = null; editor.replaceChildren(element('p', 'This file is no longer in the settings catalog. Its draft is retained.')); } }
      else if (catalog.pages?.length) {
        renderPage(catalog.pages.find(p => p.id === activePage?.id) || [...catalog.pages].sort((a,b)=>(a.order||0)-(b.order||0))[0]);
      } else {
        const first = catalog.resources.find(r => definition(r).ui?.defaultView === 'structured' && !definition(r).ui?.advanced);
        if (first) await select(first);
        else { editor.replaceChildren(element('p', 'Select a project file. Drafts are kept while this app is open.')); message(''); }
      }
      const diagnostics = catalog.diagnostics || [];
      if (diagnostics.length) message(diagnostics.map(d => typeof d === 'string' ? d : `${d.path ? d.path + ': ' : ''}${d.message}`).join('\n'), true);
    } catch (error) { if (ticket === sequence) message(error.message || String(error), true); }
  }
  function init() {
    body = document.getElementById('project-settings-body'); if (!body) return;
    list = element('nav', null, 'project-settings-list'); list.setAttribute('aria-label', 'Project settings');
    editor = element('section', null, 'project-settings-editor'); pageHost = editor; status = element('div', null, 'project-settings-status'); status.setAttribute('role', 'status');
    const layout = element('div', null, 'project-settings-layout'); layout.append(list, editor); body.append(layout, status);
    root.settings.onChanged?.(event => {
      if (!active || busy || (event?.workspaceId && catalog && event.workspaceId !== catalog.workspaceId)) return;
      refresh();
    });

  }
  root.ProjectSettings = { init, show() { active = true; refresh(); }, hide() { active = false; }, hasDrafts() { return [...drafts.values()].some(dirty); } };
})(typeof window === 'undefined' ? null : window);
