const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ignore = require('ignore');
const { inspectSkillPackages } = require('../workspace/official-skills');
const { resourceMetadata } = require('./resource-metadata');
const chokidar = require('chokidar');
const { readOfficialExclusions } = require('../project-model/official-exclusions');
const LOCAL_CATALOG_FILE = 'nextprob.settings.json';
const MAX_BYTES = 1024 * 1024;
const MAX_RESOURCES = 1000;
const FORMATS = ['text', 'markdown', 'json', 'line-rules', 'ini', 'toml', 'jsonc'];
const clone = value => JSON.parse(JSON.stringify(value));
const validPath = value => typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.includes('\0') && !path.isAbsolute(value) && !/^[a-z]:/i.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..');
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validateCatalog(catalog, availableDefinitions = catalog?.definitions) {
  const diagnostics = [];
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.definitions)) return [{ path: '', message: 'Expected catalog version 1 and definitions array' }];
  for (const key of Object.keys(catalog)) if (!['version', 'definitions', 'pages', 'revision', 'minAppVersion', 'agents'].includes(key)) diagnostics.push({ path: key, message: 'Unknown catalog field' });
  if (catalog.revision !== undefined && (!Number.isSafeInteger(catalog.revision) || catalog.revision < 1)) diagnostics.push({path:'revision',message:'Expected a positive publication revision'});
  if (catalog.minAppVersion !== undefined && (typeof catalog.minAppVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(catalog.minAppVersion))) diagnostics.push({path:'minAppVersion',message:'Expected a minimum app version in x.y.z format'});
  const ids = new Set();
  catalog.definitions.forEach((d, i) => {
    const at = `definitions[${i}]`;
    if (d && typeof d === 'object') for (const key of Object.keys(d)) if (!['id', 'title', 'group', 'description', 'match', 'format', 'views', 'creation', 'managedSections', 'schema', 'ui', 'discovery'].includes(key)) diagnostics.push({ path: `${at}.${key}`, message: 'Unknown definition field' });
    if (!d || typeof d !== 'object' || Array.isArray(d)) { diagnostics.push({ path: at, message: 'Expected definition object' }); return; }
    if (d?.match && typeof d.match === 'object') for (const key of Object.keys(d.match)) if (!['paths', 'directories'].includes(key)) diagnostics.push({ path: `${at}.match.${key}`, message: 'Unknown match field' });
    if (d?.group !== undefined && typeof d.group !== 'string') diagnostics.push({ path: `${at}.group`, message: 'Expected group string' });
    if (d?.description !== undefined && typeof d.description !== 'string') diagnostics.push({ path: `${at}.description`, message: 'Expected description string' });
    if (d?.creation !== undefined && (!d.creation || typeof d.creation !== 'object' || d.creation.mode !== 'explicit' || typeof d.creation.initialText !== 'string' || Object.keys(d.creation).some(k => !['mode', 'initialText'].includes(k)))) diagnostics.push({ path: `${at}.creation`, message: 'Expected explicit creation and initialText' });
    if (d?.views && (!Array.isArray(d.views) || d.views.some(v => !['source', 'preview', 'structured', 'rules'].includes(v)))) diagnostics.push({ path: `${at}.views`, message: 'Unsupported view' });
    if (!d || typeof d.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(d.id) || ids.has(d.id)) diagnostics.push({ path: at, message: 'Invalid or duplicate definition ID' });
    if (d?.ui !== undefined) {
      const contract = require('./catalog.schema.json');
      diagnostics.push(...validateSchema(d.ui, contract.$defs.ui, `${at}.ui`, contract));
      if (d.ui?.layout && d.format !== 'json') diagnostics.push({ path: `${at}.ui.layout`, message: 'Form layouts require JSON format' });
      if (d.ui?.defaultView && d.ui.defaultView !== 'source' && !d.views?.includes(d.ui.defaultView)) diagnostics.push({ path: `${at}.ui.defaultView`, message: 'Default view must be enabled in views' });
    }
    if (d?.discovery !== undefined) { const contract = require('./catalog.schema.json'); diagnostics.push(...validateSchema(d.discovery, contract.$defs.discovery, `${at}.discovery`, contract)); }
    ids.add(d?.id);
    if (!d || typeof d.title !== 'string' || !d.title.trim() || d.title.length > 200 || !FORMATS.includes(d.format) || !d.match || !['paths', 'directories'].some(k => Array.isArray(d.match[k]) && d.match[k].length)) diagnostics.push({ path: at, message: 'Expected title, supported format and match paths or directories' });
    for (const key of ['paths', 'directories']) if (d?.match?.[key] !== undefined && (!Array.isArray(d.match[key]) || d.match[key].some(p => !validPath(p)))) diagnostics.push({ path: `${at}.match.${key}`, message: 'Expected project-relative paths' });
    if (d?.schema !== undefined && !validPath(d.schema)) diagnostics.push({ path: `${at}.schema`, message: 'Expected catalog-relative schema path' });
    if (d?.managedSections !== undefined && (!Array.isArray(d.managedSections) || d.managedSections.some(s => !s || typeof s.start !== 'string' || !s.start || typeof s.end !== 'string' || !s.end || Object.keys(s).some(k => !['start', 'end', 'label'].includes(k)) || (s.label !== undefined && typeof s.label !== 'string')))) diagnostics.push({ path: `${at}.managedSections`, message: 'Expected nonempty start and end markers' });
  });
  if (catalog.pages !== undefined) {
    const contract = require('./catalog.schema.json');
    diagnostics.push(...validateSchema(catalog.pages, contract.properties.pages, 'pages', contract));
    const pageIds = new Set();
    for (const page of Array.isArray(catalog.pages) ? catalog.pages : []) {
      if (pageIds.has(page?.id)) diagnostics.push({path:'pages',message:'Duplicate page ID'});
      pageIds.add(page?.id);
    }
  }
  if (catalog.agents !== undefined) {
    const contract = require('./catalog.schema.json');
    diagnostics.push(...validateSchema(catalog.agents, contract.properties.agents, 'agents', contract));
    const agentIds = new Set(), definitionIds = new Set((availableDefinitions || []).map(d => d?.id));
    for (const [index, agent] of (Array.isArray(catalog.agents) ? catalog.agents : []).entries()) {
      if (!agent || typeof agent !== 'object') continue;
      if (agentIds.has(agent.id)) diagnostics.push({ path: `agents[${index}].id`, message: 'Duplicate agent ID' });
      agentIds.add(agent.id);
      for (const category of ['instructions', 'skills', 'settings', 'resources']) {
        for (const id of Array.isArray(agent[category]) ? agent[category] : []) {
          if (!definitionIds.has(id)) diagnostics.push({ path: `agents[${index}].${category}`, message: `Unknown definition: ${id}` });
        }
      }
    }
  }
  return diagnostics;
}
// A deliberately bounded declarative schema vocabulary; unsupported keywords are diagnostics.
function validateSchema(value, schema, at = '', rootSchema = schema, depth = 0) {
  if (depth > 60) return [{ path: at, message: 'Schema validation depth exceeded' }];
  const diagnostics = [];
  const add = message => diagnostics.push({ path: at, message });
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [{ path: at, message: 'Invalid schema' }];
  const supported = ['$schema', '$id', 'title', 'description', 'default', 'examples', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', '$defs', '$ref', 'const', 'pattern', 'not', 'oneOf', 'anyOf', 'allOf', 'maxProperties', 'minProperties', 'propertyNames', 'if', 'then', 'else', 'uniqueItems'];
  for (const key of Object.keys(schema)) if (!supported.includes(key)) add(`Unsupported schema keyword: ${key}`);
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) return [{ path: at, message: 'Only local schema references are supported' }];
    let referenced = rootSchema;
    for (const segment of schema.$ref.slice(2).split('/')) referenced = referenced?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    return validateSchema(value, referenced, at, rootSchema, depth + 1);
  }
  if (schema.if) { const branch = !validateSchema(value, schema.if, at, rootSchema, depth + 1).length ? schema.then : schema.else; if (branch) diagnostics.push(...validateSchema(value, branch, at, rootSchema, depth + 1)); }
  if (schema.uniqueItems && Array.isArray(value) && new Set(value.map(v => JSON.stringify(v))).size !== value.length) add('Array items must be unique');
  for (const keyword of ['oneOf', 'anyOf', 'allOf']) if (schema[keyword]) {
    const passed = schema[keyword].filter(branch => !validateSchema(value, branch, at, rootSchema, depth + 1).length).length;
    if ((keyword === 'oneOf' && passed !== 1) || (keyword === 'anyOf' && passed === 0) || (keyword === 'allOf' && passed !== schema[keyword].length)) add(`Value does not satisfy ${keyword}`);
  }
  if (schema.not && !validateSchema(value, schema.not, at, rootSchema, depth + 1).length) add('Value matches a forbidden schema');
  if (Object.hasOwn(schema, 'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) add('Unexpected constant value');
  if (schema.pattern && typeof value === 'string') { try { if (!new RegExp(schema.pattern).test(value)) add('Value does not match the required pattern'); } catch { add('Invalid schema pattern'); } }
  const types = { object: v => v !== null && typeof v === 'object' && !Array.isArray(v), array: Array.isArray, string: v => typeof v === 'string', boolean: v => typeof v === 'boolean', number: v => typeof v === 'number', integer: Number.isInteger, null: v => v === null };
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(t => types[t]?.(value))) { add(`Expected ${schema.type}`); return diagnostics; }
  if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) add('Value is not in the allowed values');
  if (typeof value === 'number') { if (schema.minimum !== undefined && value < schema.minimum) add(`Minimum is ${schema.minimum}`); if (schema.maximum !== undefined && value > schema.maximum) add(`Maximum is ${schema.maximum}`); }
  if (typeof value === 'string') { if (schema.minLength !== undefined && value.length < schema.minLength) add(`Minimum length is ${schema.minLength}`); if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`Maximum length is ${schema.maxLength}`); }
  if (Array.isArray(value)) { if (schema.minItems !== undefined && value.length < schema.minItems) add(`Minimum items is ${schema.minItems}`); if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`Maximum items is ${schema.maxItems}`); if (schema.items) value.forEach((v, i) => diagnostics.push(...validateSchema(v, schema.items, `${at}[${i}]`, rootSchema, depth + 1))); }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) add('Too many properties');
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) add('Too few properties');
    if (schema.propertyNames) for (const key of Object.keys(value)) diagnostics.push(...validateSchema(key, schema.propertyNames, at, rootSchema, depth + 1));
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) diagnostics.push({ path: at ? `${at}.${key}` : key, message: 'Required field' });
    for (const [key, v] of Object.entries(value)) { const location = at ? `${at}.${key}` : key; if (Object.hasOwn(schema.properties || {}, key)) diagnostics.push(...validateSchema(v, schema.properties[key], location, rootSchema, depth + 1)); else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') diagnostics.push(...validateSchema(v, schema.additionalProperties, location, rootSchema, depth + 1)); else if (schema.additionalProperties === false) diagnostics.push({ path: location, message: 'Unknown field' }); }
  }
  return diagnostics;
}
function schemaFile(catalogPath, relative) {
  const base = fs.realpathSync(path.dirname(catalogPath));
  const resolved = fs.realpathSync(path.join(base, relative));
  if (!resolved.startsWith(`${base}${path.sep}`)) fail('UNSAFE_SCHEMA', 'Schema must remain inside its catalog directory');
  if (fs.statSync(resolved).size > MAX_BYTES) fail('TOO_LARGE', 'Schema exceeds 1 MiB');
  return resolved;
}
function createProjectSettingsService(workspacePath, options = {}) {
  const root = fs.realpathSync(workspacePath);
  const workspaceId = crypto.randomUUID();
  let catalogPath = options.catalogPath || path.join(__dirname, 'catalog.json');
  let officialExclusions = readOfficialExclusions();
  let definitions = [], shippedDefinitions = [], localDefinitions = [], shippedPages = [], localPages = [], shippedAgents = [], localAgents = [], candidateSchemas = [], localDiagnostics = [], catalogDiagnostics = [], watcher, stopped = false, writes = Promise.resolve();
  function loadCatalog() {
    try {
      if (fs.statSync(catalogPath).size > MAX_BYTES) throw new Error('Catalog exceeds 1 MiB');
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const nextExclusions = readOfficialExclusions(catalogPath);
      catalogDiagnostics = validateCatalog(catalog);
      if (!catalogDiagnostics.length) officialExclusions = nextExclusions;
      shippedDefinitions = catalogDiagnostics.length ? [] : catalog.definitions;
      shippedPages = catalogDiagnostics.length ? [] : catalog.pages || [];
      shippedAgents = catalogDiagnostics.length ? [] : catalog.agents || [];
      rebuildDefinitions();
    } catch (error) {
      shippedDefinitions = []; shippedPages = []; shippedAgents = []; rebuildDefinitions();
      catalogDiagnostics = [{ path: '', message: `Settings catalog: ${error.message}` }];
    }
  }
  function rebuildDefinitions() {
    const overridden = new Set(localDefinitions.map(d => d.id));
    definitions = [...localDefinitions, ...shippedDefinitions.filter(d => !overridden.has(d.id))];
  }
  loadCatalog();
  const localCatalogPath = path.join(root, LOCAL_CATALOG_FILE);
  function schemaOrigin(definition) { return localDefinitions.includes(definition) ? localCatalogPath : catalogPath; }
  function watchTargets() {
    return [catalogPath, localCatalogPath, ...definitions.flatMap(d => [...(d.match.paths || []), ...(d.match.directories || [])]).map(p => path.join(root, p)),
      ...candidateSchemas.map(p => path.join(root, p)), ...definitions.filter(d => d.schema).map(d => path.resolve(path.dirname(schemaOrigin(d)), d.schema))];
  }
  function reloadLocal(notifyChange = true) {
    try {
      const absolute = resolveSafe(LOCAL_CATALOG_FILE);
      const stat = fs.statSync(absolute); if (stat.size > MAX_BYTES) throw new Error('Catalog exceeds 1 MiB');
      const catalog = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      candidateSchemas = Array.isArray(catalog.definitions) ? catalog.definitions.map(d => d?.schema).filter(validPath) : [];
      const diagnostics = validateCatalog(catalog, [...(catalog.definitions || []), ...shippedDefinitions]);
      if (!diagnostics.length) for (const d of catalog.definitions) if (d.schema) {
        resolveSafe(d.schema);
        const schema = JSON.parse(fs.readFileSync(schemaFile(localCatalogPath, d.schema), 'utf8'));
        if (!schema || typeof schema !== 'object' || Array.isArray(schema)) diagnostics.push({ path: d.schema, message: 'Expected schema object' });
      }
      localDiagnostics = diagnostics.map(d => ({ ...d, source: LOCAL_CATALOG_FILE }));
      if (!diagnostics.length) { localDefinitions = catalog.definitions; localPages = catalog.pages || []; localAgents = catalog.agents || []; }
    } catch (e) {
      if (e.code === 'ENOENT' && !fs.existsSync(localCatalogPath)) { localDefinitions = []; localPages = []; localAgents = []; candidateSchemas = []; localDiagnostics = []; }
      else localDiagnostics = [{ path: LOCAL_CATALOG_FILE, source: LOCAL_CATALOG_FILE, message: e.message }];
    }
    rebuildDefinitions();
    if (watcher) watcher.add(watchTargets());
    if (notifyChange) notify(LOCAL_CATALOG_FILE);
    return !localDiagnostics.length;
  }

  function resolveSafe(relative) {
    if (!validPath(relative)) fail('UNSAFE_PATH', 'Expected a project-relative path');
    let current = root;
    for (const segment of relative.split('/')) {
      current = path.join(current, segment);
      try { const stat = fs.lstatSync(current); if (stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Symbolic links are not supported in project settings'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return current;
  }
  function definitionFor(relative) {
    const exact = ds => ds.find(d => (d.match.paths || []).includes(relative));
    const directory = ds => ds.filter(d => (d.match.directories || []).some(p => (relative === p || relative.startsWith(`${p}/`)))).sort((a, b) => Math.max(...b.match.directories.map(p => p.length)) - Math.max(...a.match.directories.map(p => p.length)))[0];
    const shipped = definitions.filter(d => !localDefinitions.includes(d));
    return exact(localDefinitions) || directory(localDefinitions) || exact(shipped) || directory(shipped);
  }
  function exclusion(definition, relative, directory = false) {
    const roots = definition.match.directories || [];
    const parent = roots.filter(p => relative.startsWith(p + '/')).sort((a,b) => b.length - a.length)[0];
    if (!parent) return null;
    const local = relative.slice(parent.length + 1) + (directory ? '/' : '');
    return (definition.discovery?.exclude || []).find(rule => ignore().add(rule.patterns).ignores(local))?.reason;
  }
  function ensure(workspace, relative) {
    if (stopped || workspace !== workspaceId) fail('STALE_WORKSPACE', 'The active project has changed');
    const definition = definitionFor(relative);
    if (definition && exclusion(definition, relative)) fail('EXCLUDED_PATH', 'This resource is excluded from settings discovery');
    if (!definition) fail('UNREGISTERED_PATH', 'This file is not registered in the settings catalog');
    return { definition, absolute: resolveSafe(relative) };
  }
  function formatFor(d, relative) { return (d.match.paths || []).includes(relative) ? d.format : /\.toml$/i.test(relative) ? 'toml' : /\.jsonc$/i.test(relative) ? 'jsonc' : /\.json$/i.test(relative) ? 'json' : /\.md$/i.test(relative) ? 'markdown' : 'text'; }
  function sections(text, definition, relative) {
    const matches = d => (d.match.paths || []).includes(relative) || (d.match.directories || []).some(p => relative.startsWith(`${p}/`));
    const unique = new Map();
    for (const section of [...(definition.managedSections || []), ...shippedDefinitions.filter(matches).flatMap(d => d.managedSections || [])]) unique.set(`${section.start}\0${section.end}`, section);
    return [...unique.values()].map(section => {
      const start = text.indexOf(section.start), end = start < 0 ? -1 : text.indexOf(section.end, start + section.start.length);
      return { ...section, present: start >= 0, startOffset: start, endOffset: end < 0 ? -1 : end + section.end.length };
    });
  }
  function read(workspace, relative) {
    const { definition, absolute } = ensure(workspace, relative);
    let text = '', exists = true;
    try { const stat = fs.lstatSync(absolute); if (!stat.isFile()) fail('NOT_FILE', 'Expected a regular file'); if (stat.size > MAX_BYTES) fail('TOO_LARGE', 'Settings files are limited to 1 MiB'); text = fs.readFileSync(absolute, 'utf8'); if (text.includes('\0') || text.includes('\uFFFD')) fail('NOT_TEXT', 'Expected a UTF-8 text file'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; exists = false; }
    const format = formatFor(definition, relative), diagnostics = [];
    let schema;
    if (format === 'json') {
      try {
        if (definition.schema && (definition.match.paths || []).includes(relative)) {
          if (localDefinitions.includes(definition)) resolveSafe(definition.schema);
          schema = JSON.parse(fs.readFileSync(schemaFile(schemaOrigin(definition), definition.schema), 'utf8'));
        }
        if (exists) { const value = JSON.parse(text); if (schema) diagnostics.push(...validateSchema(value, schema)); }
      } catch (e) { diagnostics.push({ path: '', message: e.message }); }
    }
    if (relative === LOCAL_CATALOG_FILE) diagnostics.push(...localDiagnostics);
    const managedSections = sections(text, definition, relative);
    for (const s of managedSections) if (s.present && s.endOffset < 0) diagnostics.push({ path: '', message: `Unclosed managed section: ${s.label || s.start}` });
    const readOnly = require('../workspace/official-skills').getManagedSkillPaths(root).some(p => relative.startsWith(p + '/'));
    const semantics = resourceMetadata(root, relative);
    return { readOnly, workspaceId, workspacePath: root, path: relative, text, revision: exists ? crypto.createHash('sha256').update(text).digest('hex') : null, exists, format, diagnostics, managedSections, ...(schema ? { schema } : {}), ...(semantics ? { semantics } : {}) };
  }
  function resource(d, relative, kind) {
    const absolute = resolveSafe(relative);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && ((kind !== 'file') !== stat.isDirectory())) throw new Error('Path has an unexpected file type');
    if (kind === 'file' && stat) {
      if (stat.size > MAX_BYTES) throw new Error('Settings file exceeds 1 MiB');
      const sample = fs.readFileSync(absolute);
      if (sample.includes(0) || sample.toString('utf8').includes('\uFFFD')) throw new Error('Not a UTF-8 text file');
    }
    return {id:`${d.id}:${relative}`,definitionId:d.id,path:relative,kind,exists:!!stat,format:kind === 'file' ? formatFor(d,relative) : undefined};
  }
  function browse(workspace, relative) {
    const {definition, absolute} = ensure(workspace, relative);
    if (exclusion(definition, relative, true)) fail('EXCLUDED_PATH', 'This folder is excluded from settings discovery');
    if (!fs.statSync(absolute).isDirectory()) fail('NOT_FOLDER', 'Expected a directory');
    const resources = [], diagnostics = [];
    for (const entry of fs.readdirSync(absolute, {withFileTypes:true}).sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (resources.length >= MAX_RESOURCES) { diagnostics.push({path:relative,message:'Settings discovery limit reached'}); break; }
      const child = `${relative}/${entry.name}`, d = definitionFor(child) || definition;
      if (entry.isSymbolicLink() || exclusion(definition, child, entry.isDirectory()) || exclusion(d, child, entry.isDirectory())) continue;
      try { if (entry.isFile() || entry.isDirectory()) resources.push(resource(d, child, entry.isDirectory() ? 'folder' : 'file')); }
      catch (error) { diagnostics.push({path:child,message:error.message}); }
    }
    return {workspaceId,resources,diagnostics};
  }
  function list() {
    const resources = [], diagnostics = [...catalogDiagnostics, ...localDiagnostics], seen = new Set();
    function add(d, relative, kind, depth = 0) {
      if (kind === 'file') d = definitionFor(relative) || d;
      if (seen.has(relative) || exclusion(d, relative, kind === 'folder')) return;
      seen.add(relative);
      if (resources.length >= MAX_RESOURCES || depth > 12) { diagnostics.push({path:relative,message:'Settings discovery limit reached'}); return; }
      try {
        const item = resource(d,relative,kind); resources.push(item);
        if (kind !== 'folder' || !item.exists || d.discovery?.mode === 'browser') return;
        if (d.discovery?.mode === 'packages') {
          const packages = inspectSkillPackages(root, relative, d.discovery.packageFile || 'SKILL.md');
          for (const pkg of packages.slice(0, MAX_RESOURCES - resources.length)) resources.push({...pkg,id:`${d.id}:${pkg.path}`,definitionId:d.id,kind:'package',exists:true});
          return;
        }
        // Legacy definitions retain recursive discovery; new browsers load one level at a time.
        const children = browse(workspaceId, relative); diagnostics.push(...children.diagnostics);
        for (const child of children.resources) add(d, child.path, child.kind, depth + 1);
      } catch (error) { diagnostics.push({path:relative,message:error.message}); }
    }
    for (const d of definitions) { for (const p of d.match.paths || []) add(d,p,'file'); for (const p of d.match.directories || []) add(d,p,'folder'); }
    const overrides = new Set(localPages.map(p => p.id));
    const agentOverrides = new Set(localAgents.map(a => a.id));
    const agents = [...localAgents.map(a => ({...clone(a),custom:true})), ...shippedAgents.filter(a => !agentOverrides.has(a.id)).map(a => clone(a))];
    const pages = clone([...localPages,...shippedPages.filter(p => !overrides.has(p.id))]).map(page => {
      if (!page.agentCategory) return page;
      const ids = [...new Set(agents.flatMap(a => a[page.agentCategory] || []))].filter(id => definitions.some(d => d.id === id));
      if (page.agentCategory === 'skills') {
        const presentation = page.sections.find(section => section.view === 'packages') || {};
        page.sections = ids.length ? [{title:'Available skills',emptyMessage:'No skill packages are installed in this project.',...presentation,definitions:ids,view:'packages'}] : [];
      } else page.sections = ids.map(id => {
        const d = definitions.find(d => d.id === id);
        const presentation = page.sections.find(section => section.definitions.length === 1 && section.definitions[0] === id) || {};
        return {title:d.title,...(d.description ? {description:d.description} : {}),...presentation,definitions:[id],view:d.discovery?.mode === 'browser' ? 'browser' : d.discovery?.mode === 'packages' ? 'packages' : 'documents'};
      });
      return page;
    });
    return {workspaceId,workspacePath:root,definitions:definitions.map(d => ({...clone(d),source:localDefinitions.includes(d) ? 'project' : 'default'})),
      agents,pages,resources,diagnostics,officialExclusions:clone(officialExclusions)};
  }
  function replaceCatalog(nextPath) {
    try {
      if (fs.statSync(nextPath).size > MAX_BYTES) throw new Error('Catalog exceeds 1 MiB');
      const catalog = JSON.parse(fs.readFileSync(nextPath, 'utf8'));
      const nextExclusions = readOfficialExclusions(nextPath);
      const diagnostics = validateCatalog(catalog);
      // An update must not strand references in an already accepted project profile.
      const localIds = new Set(localDefinitions.map(d => d.id));
      const effectiveDefinitions = [...localDefinitions, ...(catalog.definitions || []).filter(d => !localIds.has(d.id))];
      diagnostics.push(...validateCatalog({version:1,definitions:[],agents:localAgents}, effectiveDefinitions));
      for (const d of catalog.definitions || []) if (d.schema && validPath(d.schema)) {
        const schema = JSON.parse(fs.readFileSync(schemaFile(nextPath, d.schema), 'utf8'));
        if (!schema || typeof schema !== 'object') diagnostics.push({ path: d.schema, message: 'Expected schema object' });
      }
      if (diagnostics.length) { catalogDiagnostics = diagnostics; notify(null); return false; }
      officialExclusions = nextExclusions;
      catalogPath = nextPath; shippedDefinitions = catalog.definitions; shippedPages = catalog.pages || []; shippedAgents = catalog.agents || []; rebuildDefinitions(); catalogDiagnostics = [];
      if (watcher) watcher.add(watchTargets());
      notify(null); return true;
    } catch (e) { catalogDiagnostics = [{ path: '', message: `Settings catalog: ${e.message}` }]; notify(null); return false; }
  }
  function notify(relative) { if (!stopped) options.onChange?.({ workspaceId, path: relative }); }
  function save(workspace, relative, text, revision) {
    const perform = () => {
      const { definition, absolute } = ensure(workspace, relative);
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES || text.includes('\0') || text.includes('\uFFFD')) fail('INVALID_TEXT', 'Expected UTF-8 text of at most 1 MiB');
      const before = read(workspace, relative);
      if (before.readOnly) fail('READ_ONLY', 'Application-managed package files are read-only');
      if (before.revision !== revision) fail('CONFLICT', 'This file changed on disk. Reload it before saving.');
      if (!before.exists && (!(definition.match.paths || []).includes(relative) || definition.creation?.mode !== 'explicit')) fail('CREATION_DISABLED', 'File creation is not enabled for this definition');
      const nextSections = sections(text, definition, relative);
      for (let i = 0; i < before.managedSections.length; i++) {
        const old = before.managedSections[i], next = nextSections[i];
        if (old.present && (old.endOffset < 0 || !next.present || next.endOffset < 0 || before.text.slice(old.startOffset, old.endOffset) !== text.slice(next.startOffset, next.endOffset))) fail('MANAGED_SECTION', 'Managed sections cannot be modified');
      }
      fs.mkdirSync(path.dirname(absolute), { recursive: true }); resolveSafe(relative);
      const temp = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${crypto.randomUUID()}.tmp`);
      try {
        const mode = before.exists ? fs.statSync(absolute).mode & 0o777 : 0o600;
        fs.writeFileSync(temp, text, { flag: 'wx', mode });
        if (read(workspace, relative).revision !== revision) fail('CONFLICT', 'This file changed on disk. Reload it before saving.');
        fs.renameSync(temp, absolute);
      } finally { try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      if (relative === LOCAL_CATALOG_FILE || localDefinitions.some(d => d.schema === relative)) reloadLocal(false);
      notify(relative); return read(workspace, relative);
    };
    const result = writes.then(perform); writes = result.catch(() => {}); return result;
  }
  reloadLocal(false);
  return { list, read, save, browse, replaceCatalog, reloadLocal, workspaceId,
    getOfficialExclusions: () => clone(officialExclusions),
    start() {
      if (!watcher) {
        watcher = chokidar.watch([...watchTargets(), root], { ignored: absolute => {
          const relative = path.relative(root,absolute).replace(/\\/g,'/');
          const definition = definitionFor(relative);
          if (definition && exclusion(definition,relative,true)) return true;
          const targets = watchTargets();
          const folders = definitions.flatMap(d => d.match.directories || []).map(p => path.join(root, p));
          return !targets.some(target => absolute === target || target.startsWith(`${absolute}${path.sep}`)) && !folders.some(folder => absolute.startsWith(`${folder}${path.sep}`));
        }, ignoreInitial: true, followSymlinks: false, depth: 12, atomic: 150, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 } });
        watcher.on('all', (_event, absolute) => { if (absolute === catalogPath) replaceCatalog(catalogPath);
          if (absolute === localCatalogPath || candidateSchemas.some(p => absolute === path.join(root, p))) reloadLocal(false);
          notify(path.relative(root, absolute).replace(/\\/g, '/')); });
        watcher.on('error', e => { catalogDiagnostics.push({ path: '', message: `Settings watcher: ${e.message}` }); notify(null); });
      }
      return this;
    },
    async stop() { stopped = true; await writes; if (watcher) await watcher.close(); watcher = null; },
  };
}
module.exports = { createProjectSettingsService, validateCatalog, validateSchema, LOCAL_CATALOG_FILE };
