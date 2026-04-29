// renderer/outline.js
// Pure data module — no DOM access.
// Exposes window.Outline with buildOutlineTree() for converting flat heading
// arrays into a nested OutlineEntry tree.

(function () {
  'use strict';

  // ─── buildOutlineTree ─────────────────────────────────────────────────────
  //
  // Converts a flat array of heading descriptors into a nested tree.
  //
  // Input (flat entry):
  //   { level: number, text: string, id: string|null }
  //
  // Output (OutlineEntry):
  //   { level: number, text: string, id: string|null, children: OutlineEntry[] }
  //
  // Algorithm: stack-based nesting. O(n) time, O(d) space (d = max depth ≤ 6).
  // Hierarchy gaps are handled naturally — H1 followed by H3 makes H3 a direct
  // child of H1 with no phantom H2 inserted.

  function buildOutlineTree(flatEntries) {
    if (!flatEntries || flatEntries.length === 0) return [];

    const roots = [];
    // stack holds the current chain of ancestor OutlineEntry nodes
    const stack = [];

    for (const entry of flatEntries) {
      const node = {
        level: entry.level,
        text: entry.text,
        id: entry.id,
        children: [],
      };

      // Pop ancestors whose level is >= current entry's level.
      // After popping, stack.top (if any) is the nearest ancestor with
      // a strictly smaller level — i.e., the parent.
      while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        // No ancestor: current node is a root-level entry
        roots.push(node);
      } else {
        // Attach as child of the current top-of-stack ancestor
        stack[stack.length - 1].children.push(node);
      }

      // Push current node so it can become a parent for subsequent entries
      stack.push(node);
    }

    return roots;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.Outline = {
    buildOutlineTree,
  };
}());
