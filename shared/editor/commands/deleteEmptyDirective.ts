import type { Node as ProsemirrorNode, Schema } from "prosemirror-model";
import type { Command } from "prosemirror-state";

function isMergeableWrapper(node: ProsemirrorNode, schema: Schema): boolean {
  return (
    node.type === schema.nodes.container_directive ||
    node.type === schema.nodes.container_notice
  );
}

/**
 * A wrapper with nothing in it worth protecting — exactly the shape a
 * directive/notice is left in once its content has been cleared out (see
 * the content-expression reordering fix elsewhere this session: deleting
 * all of one's content settles on a single empty paragraph, never nothing
 * at all).
 */
function isTriviallyEmpty(node: ProsemirrorNode, schema: Schema): boolean {
  if (node.childCount !== 1) {
    return false;
  }
  const child = node.firstChild!;
  return child.type === schema.nodes.paragraph && child.content.size === 0;
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
 * Scoped specifically to a wrapper with no real content left (a single
 * empty paragraph, its minimal state) — a wrapper that still holds
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
