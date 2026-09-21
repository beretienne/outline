import type { Node as ProsemirrorNode, Schema } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Selection } from "prosemirror-state";

function isMergeableWrapper(node: ProsemirrorNode, schema: Schema): boolean {
  return (
    node.type === schema.nodes.container_directive ||
    node.type === schema.nodes.container_notice
  );
}

function isEmptyParagraphOnly(node: ProsemirrorNode, schema: Schema): boolean {
  if (node.childCount !== 1) {
    return false;
  }
  const child = node.firstChild!;
  return child.type === schema.nodes.paragraph && child.content.size === 0;
}

/**
 * A `definition_list` entry nobody has typed anything into yet — an empty
 * term over a definition holding a single empty paragraph. Exactly what
 * `insertGlossary` and `splitDefinitionEntry` create.
 */
function isBlankEntry(
  term: ProsemirrorNode,
  body: ProsemirrorNode,
  schema: Schema
): boolean {
  return term.content.size === 0 && isEmptyParagraphOnly(body, schema);
}

/**
 * A wrapper with nothing in it worth protecting — exactly the shape a
 * directive/notice is left in once its content has been cleared out (see
 * the content-expression reordering fix elsewhere this session: deleting
 * all of one's content settles on a single empty paragraph, never nothing
 * at all), or a `{glossary}` still in the blank one-entry state the block
 * menu inserts it in, which never holds a bare paragraph at all.
 */
function isTriviallyEmpty(node: ProsemirrorNode, schema: Schema): boolean {
  if (isEmptyParagraphOnly(node, schema)) {
    return true;
  }
  const list = node.childCount === 1 ? node.firstChild! : undefined;
  return (
    list?.type === schema.nodes.definition_list &&
    list.childCount === 2 &&
    isBlankEntry(list.child(0), list.child(1), schema)
  );
}

/**
 * Deletes an already-emptied `container_directive`/`container_notice`
 * outright when Backspace or Delete is pressed inside it.
 *
 * `Directive`/`Notice` are both `isolating: true` (see their own schemas),
 * which is what stops ProseMirror's default Backspace/Delete handling from
 * silently merging two adjacent directives/notices into one — but the same
 * flag also means the default handling can no longer reach in and remove a
 * directive/notice that has already been fully emptied out, since that
 * would mean crossing the very boundary `isolating` protects. Found live:
 * with only the schema flag in place, there was no way left to delete a
 * directive/notice via the keyboard at all, not even an empty one.
 *
 * Also removes a single blank `definition_list` entry (empty term, empty
 * definition) from a list that has other entries — otherwise an entry made
 * by a stray double-Enter could never be taken back.
 *
 * Scoped specifically to a wrapper with no real content left (a single
 * empty paragraph, its minimal state, or a `{glossary}` whose only entry
 * is blank) — a wrapper that still holds
 * anything else is left to `isolating`'s own protection; deleting it is
 * still possible by selecting the whole node (its drag handle) instead.
 *
 * @returns A prosemirror command.
 */
export const deleteEmptyDirectiveOrNotice: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) {
    return false;
  }

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);

    // A blank entry in a list that has others: remove just that entry. The
    // last remaining one is left to the wrapper check below, which takes
    // the whole `{glossary}` with it.
    if (node.type === state.schema.nodes.definition_list) {
      const index = $from.index(depth);
      const termIndex = index - (index % 2);
      if (
        node.childCount > 2 &&
        isBlankEntry(
          node.child(termIndex),
          node.child(termIndex + 1),
          state.schema
        )
      ) {
        let from = $from.start(depth);
        for (let i = 0; i < termIndex; i++) {
          from += node.child(i).nodeSize;
        }
        const to =
          from +
          node.child(termIndex).nodeSize +
          node.child(termIndex + 1).nodeSize;
        const tr = state.tr.delete(from, to);
        tr.setSelection(Selection.near(tr.doc.resolve(from), -1));
        dispatch?.(tr.scrollIntoView());
        return true;
      }
    }

    if (
      isMergeableWrapper(node, state.schema) &&
      isTriviallyEmpty(node, state.schema)
    ) {
      const from = $from.before(depth);
      const to = $from.after(depth);
      dispatch?.(state.tr.delete(from, to).scrollIntoView());
      return true;
    }
  }
  return false;
};
