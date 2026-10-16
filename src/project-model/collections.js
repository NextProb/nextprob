'use strict';

const { compileRule } = require('../project-config/rules');
const { readOfficialExclusions, resolveSectionExclusions } = require('./official-exclusions');

function compareText(a, b) { return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true }); }

function comparator(sort) {
  return (a, b) => {
    let compared = 0;
    switch (sort) {
      case 'favoriteOrder':
        compared = (a.favoriteOrder ?? Infinity) - (b.favoriteOrder ?? Infinity);
        break;
      case 'modifiedAt':
      case 'mtime': compared = b.modifiedAt - a.modifiedAt; break;
      case 'path': compared = compareText(a.relativePath, b.relativePath); break;
      case 'title': compared = compareText(a.title, b.title); break;
      case 'type': compared = compareText(a.kind, b.kind); break;
      case 'name': compared = compareText(a.name, b.name); break;
      default:
        compared = Number(b.kind === 'folder') - Number(a.kind === 'folder') || compareText(a.name, b.name);
    }
    return (Number.isNaN(compared) ? 0 : compared) || compareText(a.relativePath, b.relativePath);
  };
}

function cloneItem(item) {
  return { ...item, ancestorPaths: [...item.ancestorPaths], capabilities: { ...item.capabilities },
    ...(item.metadata ? { metadata: structuredClone(item.metadata) } : {}) };
}

function cloneTree(node) {
  const copy = { ...node };
  if (node.children) copy.children = node.children.map(cloneTree);
  return copy;
}

function belongsToSource(item, source) { return source !== 'notes' || item.isNote; }

/** Resolve reusable collections into a surface snapshot, without mutating inputs. */
function buildSurfaceModel(config, catalog, surface = 'sidebar', { officialExclusions = readOfficialExclusions() } = {}) {
  const settings = config.surfaces?.[surface] || {};
  const official = settings.hideOfficialFiles === false ? { hiddenFiles: [], hiddenFolders: [] } : officialExclusions;
  const byAbsolutePath = new Map(catalog.items.map(item => [item.path, item]));
  const treeNodes = new Map();
  function indexTree(node) {
    treeNodes.set(node.path, node);
    for (const child of node.children || []) indexTree(child);
  }
  if (catalog.tree) indexTree(catalog.tree);
  const sections = [];
  for (const section of settings.sections || []) {
    if (section.enabled === false) continue;
    const collection = section.collection ? config.collections?.[section.collection] : section;
    if (!collection) continue;
    const matches = collection.where === undefined ? () => true : compileRule(collection.where, config.metadataFields);
    const selected = catalog.items.filter(item => belongsToSource(item, collection.source)
      && matches(item));
    const sort = section.sort || collection.sort;
    const items = selected.map(item => {
      const copy = cloneItem(item);
      // A selected directory supplies a navigable subtree. Collection membership
      // chooses the list rows; tree visibility rules belong to tree sections.
      if (item.kind === 'folder') copy.children = (treeNodes.get(item.path)?.children || []).map(cloneTree);
      return copy;
    }).sort(comparator(sort));
    const selectedPaths = new Set(selected.map(item => item.path));
    const exclusions = resolveSectionExclusions(section, official);
    const hiddenFolders = exclusions.hiddenFolders;
    const hiddenFiles = new Set(exclusions.hiddenFiles);
    const directoryPaths = new Set(catalog.items.filter(item => item.isDirectory).map(item => item.relativePath));
    const hiddenPrefixes = hiddenFolders.map(value => String(value).replace(/\\/g, '/').replace(/\/$/, ''))
      .filter(value => directoryPaths.has(value));
    const hideDotFolders = section.hideDotFolders ?? settings.hideDotFolders ?? false;
    const shownFolders = new Set(section.shownFolders || []);
    const shownFiles = new Set(section.shownFiles || []);
    const treeCompare = comparator(sort);

    function hiddenDotPath(item) {
      const segments = item.relativePath.split('/');
      return segments.some((segment, index) => {
        if (!segment.startsWith('.')) return false;
        const relative = segments.slice(0, index + 1).join('/');
        if (index === segments.length - 1 && !item.isDirectory) return !shownFiles.has(item.name) && !shownFiles.has(relative);
        return !shownFolders.has(relative);
      });
    }

    function projectTree(node, isRoot = false) {
      const item = byAbsolutePath.get(node.path);
      if (!isRoot && item) {
        if (!item.isDirectory && (hiddenFiles.has(item.name) || hiddenFiles.has(item.relativePath))) return null;
        if (hideDotFolders && hiddenDotPath(item)) return null;
        if (hiddenPrefixes.some(prefix => item.relativePath === prefix || item.relativePath.startsWith(prefix + '/'))) return null;
      }
      const children = (node.children || []).map(child => projectTree(child)).filter(Boolean);
      children.sort((a, b) => treeCompare(byAbsolutePath.get(a.path), byAbsolutePath.get(b.path)));
      if (!isRoot && !selectedPaths.has(node.path) && !children.length) return null;
      const result = { ...node };
      if (node.children) result.children = children;
      return result;
    }

    const tree = catalog.tree ? projectTree(catalog.tree, true) : null;
    if (section.hideWhenEmpty && (section.view === 'tree' ? !tree?.children.length : !items.length)) continue;
    sections.push({ ...structuredClone(section), items, tree });
  }
  return { sections };
}

module.exports = { buildSurfaceModel };
