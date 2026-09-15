import { Fragment } from "prosemirror-model";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";

/**
 * Moves the cursor from a `definition_term` into its own `definition_body`.
 *
 * A term is a single line by definition — docutils requires its definition
 * to start on the very next line, no gap — so Enter here moves into that
 * body instead of trying to add a second line to a one-line field.
 *
 * @returns A prosemirror command.
 */
export const moveIntoDefinitionBody: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== state.schema.nodes.definition_term) {
    return false;
  }

  const $after = state.doc.resolve($from.after($from.depth));
  dispatch?.(
    state.tr.setSelection(TextSelection.near($after, 1)).scrollIntoView()
  );
  return true;
};

/**
 * Splits the current `definition_list` entry into two on a *second* Enter.
 *
 * A single Enter must stay able to add an ordinary paragraph to the current
 * definition — real entries (e.g. "Certified modules" in the QCAM5 manual's
 * glossary) are several paragraphs long. Only a second Enter, landing on the
 * now-empty paragraph the first one just made, means "I'm done with this
 * definition" — mirroring the double-Enter exit gesture the rest of this
 * editor already uses for lists and blockquotes, which this node otherwise
 * falls through to (splitting the whole `{glossary}` directive in two,
 * since that is the nearest schema-legal place to split once nothing more
 * specific claims the keystroke).
 *
 * Everything after the triggering empty paragraph, if any, moves into the
 * new entry's own body rather than being discarded, so pressing this in the
 * middle of a definition's content still keeps every word.
 *
 * @returns A prosemirror command.
 */
export const splitDefinitionEntry: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) {
    return false;
  }

  const {
    definition_body: bodyType,
    definition_term: termType,
    paragraph: paragraphType,
  } = state.schema.nodes;

  const paragraph = $from.parent;
  if (paragraph.type !== paragraphType || paragraph.content.size > 0) {
    return false;
  }

  const bodyDepth = $from.depth - 1;
  if (bodyDepth < 1 || $from.node(bodyDepth).type !== bodyType) {
    // The empty paragraph isn't this definition's own direct child (e.g.
    // it's inside a nested list or blockquote) — leave it to whatever node
    // owns it.
    return false;
  }

  const body = $from.node(bodyDepth);
  const paragraphIndex = $from.index(bodyDepth);
  const before: ProsemirrorNode[] = [];
  const after: ProsemirrorNode[] = [];
  body.forEach((child, _offset, index) => {
    if (index < paragraphIndex) {
      before.push(child);
    } else if (index > paragraphIndex) {
      after.push(child);
    }
  });

  if (before.length === 0) {
    // Nothing precedes the empty paragraph — this entry has no real content
    // of its own yet, so there is nothing to "finish".
    return false;
  }

  const tr = state.tr;
  tr.delete($from.before($from.depth), $from.end(bodyDepth));

  const newBodyContent =
    after.length > 0
      ? Fragment.from(after)
      : Fragment.from(paragraphType.create());
  const entry = Fragment.from([
    termType.create(),
    bodyType.create(null, newBodyContent),
  ]);

  const insertPos = tr.mapping.map($from.after(bodyDepth));
  tr.insert(insertPos, entry);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
  dispatch?.(tr.scrollIntoView());
  return true;
};
