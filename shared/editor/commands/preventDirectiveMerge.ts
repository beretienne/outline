import { chainCommands, joinBackward, joinForward } from "prosemirror-commands";
import type { Node as ProsemirrorNode, Schema } from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";

function isMergeableWrapper(
  node: ProsemirrorNode | null | undefined,
  schema: Schema
): boolean {
  if (!node) {
    return false;
  }
  return (
    node.type === schema.nodes.container_directive ||
    node.type === schema.nodes.container_notice
  );
}

/**
 * Cheap check for whether a `container_directive` or `container_notice` sits
 * close enough to the cursor for the default Backspace/Delete handling to
 * put it at risk — either the cursor is directly inside one, or one of its
 * ancestors, at any depth, has one as an immediate sibling (covering the
 * real case: an empty paragraph sitting between two directives).
 *
 * Almost always false for ordinary editing, so the more expensive
 * simulate-and-check in `guard` below only ever runs near an actual
 * directive or notice.
 */
function directiveOrNoticeNearby(state: EditorState): boolean {
  const { $from } = state.selection;
  const { schema } = state;

  for (let depth = $from.depth; depth >= 0; depth--) {
    if (isMergeableWrapper($from.node(depth), schema)) {
      return true;
    }
    if (depth === 0) {
      break;
    }
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const prev = index > 0 ? parent.child(index - 1) : undefined;
    const next =
      index < parent.childCount - 1 ? parent.child(index + 1) : undefined;
    if (isMergeableWrapper(prev, schema) || isMergeableWrapper(next, schema)) {
      return true;
    }
  }
  return false;
}

/**
 * Removes a blank paragraph sitting directly beside a `container_directive`
 * or `container_notice` — without touching either wrapper — instead of
 * letting the default Backspace/Delete handling reach for its riskier
 * cross-boundary join. This is the common, legitimate case (tidying up
 * extra blank lines between two directives) that the veto in `guard` below
 * would otherwise also block, since the underlying join command has no
 * "just delete this line, leave the wrappers alone" option of its own.
 *
 * @param bias - which side the cursor should land on afterward: -1 (toward
 * the preceding content, for Backspace) or 1 (toward the following
 * content, for Delete).
 * @returns a Command.
 */
function removeAdjacentBlankLine(bias: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) {
      return false;
    }
    if (
      $from.parent.type !== state.schema.nodes.paragraph ||
      $from.parent.content.size > 0
    ) {
      return false;
    }

    const depth = $from.depth;
    if (depth === 0) {
      return false;
    }
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const prev = index > 0 ? parent.child(index - 1) : undefined;
    const next =
      index < parent.childCount - 1 ? parent.child(index + 1) : undefined;
    if (
      !isMergeableWrapper(prev, state.schema) &&
      !isMergeableWrapper(next, state.schema)
    ) {
      return false;
    }

    const from = $from.before(depth);
    const to = $from.after(depth);
    const tr = state.tr.delete(from, to);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from), bias));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

function countWrappers(doc: ProsemirrorNode, schema: Schema): number {
  let count = 0;
  doc.descendants((node) => {
    if (isMergeableWrapper(node, schema)) {
      count++;
    }
    return true;
  });
  return count;
}

/**
 * Wraps a join command (`joinBackward` for Backspace, `joinForward` for
 * Delete) so it can no longer silently dissolve a `container_directive` or
 * `container_notice`'s own wrapper — its directive name, argument, and
 * option lines — into whatever sits beside it.
 *
 * Found live: two adjacent `{glossary}` blocks, separated only by a blank
 * line, merge into one the moment that blank line is deleted — and the
 * same happens for any two directives regardless of name, e.g. an
 * `{ifconfig}` immediately followed by a `{grid}` collapses into a single
 * `{ifconfig}`, silently discarding the second block's own name and
 * argument. Confirmed directly against `prosemirror-commands`' own
 * `joinBackward`/`joinForward` before writing this guard: the default
 * "cut and fit" algorithm, when the two sides aren't directly joinable as
 * matching content, falls back to *lifting* the far side's content out of
 * its own wrapper to make the join possible — exactly the same class of
 * silent-content-loss bug this whole feature set has been fixing in other
 * shapes all session, just triggered through editing instead of parsing.
 *
 * Rather than hand-enumerate every cursor position this can happen from,
 * this simulates the underlying command first and only vetoes the result
 * if it would reduce the number of directive/notice wrappers in the
 * document — any edit that doesn't touch one is let through unchanged.
 *
 * @param base - the underlying join command to guard (`joinBackward` or `joinForward`).
 * @returns a Command with the same effect, except for this one case.
 */
function guard(base: Command): Command {
  return (state, dispatch, view) => {
    if (!directiveOrNoticeNearby(state)) {
      return false;
    }

    let trial: Transaction | undefined;
    const applied = base(
      state,
      (tr) => {
        trial = tr;
      },
      view
    );
    if (!applied || !trial) {
      return applied;
    }

    const before = countWrappers(state.doc, state.schema);
    const after = countWrappers(trial.doc, state.schema);
    if (after < before) {
      // The default behaviour would have dissolved a directive/notice's
      // own wrapper. Consume the keystroke and do nothing instead of
      // losing it silently.
      return true;
    }

    dispatch?.(trial);
    return true;
  };
}

export const preventDirectiveMergeBackward: Command = chainCommands(
  removeAdjacentBlankLine(-1),
  guard(joinBackward)
);
export const preventDirectiveMergeForward: Command = chainCommands(
  removeAdjacentBlankLine(1),
  guard(joinForward)
);
