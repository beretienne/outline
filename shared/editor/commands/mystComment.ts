import type { MarkdownParser } from "prosemirror-markdown";
import type {
  Node as ProsemirrorNode,
  NodeType,
  ResolvedPos,
} from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { MarkdownSerializer } from "../lib/markdown/serializer";
import { DIRECTIVE_INFO } from "../nodes/CodeFence";

/** Private-use characters marking lines inside serialized Markdown. None
 * of them is ever escaped by the serializer, and none occurs in content. */
const UNCOMMENT = "\uE000";
const RANGE_START = "\uE001";
const RANGE_END = "\uE002";
/** The start of a glossary entry commented out whole. */
const ENTRY = "\uE004";
/** Where the cursor goes once the region has been re-read. */
const CARET = "\uE003";

/** Nodes written as a fence around their content. Commenting out one of
 * their fence lines — which a selection that starts outside one and ends
 * inside it would — unbalances the fence. */
const FENCED_CONTAINERS = [
  "container_directive",
  "container_notice",
  "container_toggle",
];

/** What the region round trip needs from the live editor. */
export interface MarkdownRoundTrip {
  /** Reads Markdown into the editor's own schema. */
  parser: Pick<MarkdownParser, "parse">;
  /** Writes the editor's own schema out as Markdown. */
  serializer: Pick<MarkdownSerializer, "serialize">;
}

/**
 * Count the code blocks holding a MyST directive — the inert form a
 * directive falls back to when its body no longer parses.
 *
 * @param node - the node to search.
 * @returns how many there are at any depth.
 */
function countDirectiveFallbacks(node: ProsemirrorNode): number {
  let count = 0;
  node.descendants((child) => {
    if (
      child.type.spec.code &&
      DIRECTIVE_INFO.test(String(child.attrs.language ?? ""))
    ) {
      count++;
    }
    return true;
  });
  return count;
}

/**
 * The absolute range covered by top-level nodes `fromIndex` to `toIndex`,
 * both included.
 *
 * @param doc - the document.
 * @param fromIndex - index of the first top-level node.
 * @param toIndex - index of the last top-level node.
 * @returns the range.
 */
function topLevelRange(
  doc: ProsemirrorNode,
  fromIndex: number,
  toIndex: number
): { from: number; to: number } {
  let from = 0;
  for (let index = 0; index < fromIndex; index++) {
    from += doc.child(index).nodeSize;
  }
  let to = from;
  for (let index = fromIndex; index <= toIndex; index++) {
    to += doc.child(index).nodeSize;
  }
  return { from, to };
}

/**
 * Serialize top-level nodes `fromIndex`–`toIndex` of `markedDoc`, let
 * `edit` change the Markdown, parse the result, and replace the same nodes
 * of `state.doc` with it.
 *
 * This is how a comment is taken out or put in: as an edit to the
 * Markdown itself — removing or adding `%` — so the result is exactly what
 * the same edit to the source file gives. A line's indentation decides
 * whether it nests in the list before it, a glossary entry is only an entry
 * inside its `{glossary}`: re-reading the Markdown gets all of that right
 * without any of it being modelled here.
 *
 * The cursor goes where `edit` left a `CARET` character, if anywhere.
 *
 * Refuses (returns undefined) rather than degrade anything: when the edit
 * leaves a directive whose body no longer parses — it would fall back to an
 * inert code block — or when the result is empty.
 *
 * @param state - the editor state to change.
 * @param markedDoc - `state.doc` with marker characters added; its
 * top-level node count and order are the same.
 * @param fromIndex - index of the first top-level node of the region.
 * @param toIndex - index of the last top-level node of the region.
 * @param roundTrip - the editor's parser and serializer.
 * @param edit - rewrites the region's Markdown; undefined to give up.
 * @returns the transaction, or undefined.
 */
function rewriteRegion(
  state: EditorState,
  markedDoc: ProsemirrorNode,
  fromIndex: number,
  toIndex: number,
  roundTrip: MarkdownRoundTrip,
  edit: (markdown: string) => string | undefined
): Transaction | undefined {
  const marked = topLevelRange(markedDoc, fromIndex, toIndex);
  const region = markedDoc.type.create(
    null,
    markedDoc.content.cut(marked.from, marked.to)
  );
  const markdown = edit(
    roundTrip.serializer.serialize(region, { commonMark: true })
  );
  if (markdown === undefined) {
    return undefined;
  }

  const parsed = roundTrip.parser.parse(markdown);
  if (!parsed || parsed.childCount === 0) {
    return undefined;
  }

  const original = topLevelRange(state.doc, fromIndex, toIndex);
  const before = state.doc.type.create(
    null,
    state.doc.content.cut(original.from, original.to)
  );
  if (countDirectiveFallbacks(parsed) > countDirectiveFallbacks(before)) {
    return undefined;
  }

  const tr = state.tr.replaceWith(original.from, original.to, parsed.content);
  let caret: number | undefined;
  tr.doc.nodesBetween(
    original.from,
    original.from + parsed.content.size,
    (node, pos) => {
      if (caret === undefined && node.isText && node.text?.includes(CARET)) {
        caret = pos + node.text.indexOf(CARET);
      }
      return caret === undefined;
    }
  );
  if (caret !== undefined) {
    tr.delete(caret, caret + CARET.length);
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret ?? original.from)));
  return tr.scrollIntoView();
}

/**
 * Widen a region to take in the comment lines around its ends at the top
 * level, and one ordinary block beyond them — the list a restored item may
 * belong to.
 *
 * @param doc - the document.
 * @param type - the `myst_comment` node type.
 * @param fromIndex - index of the region's first top-level node.
 * @param toIndex - index of the region's last top-level node.
 * @returns the widened indices.
 */
function widenOverComments(
  doc: ProsemirrorNode,
  type: NodeType,
  fromIndex: number,
  toIndex: number
): { fromIndex: number; toIndex: number } {
  let from = fromIndex;
  let to = toIndex;
  if (doc.child(from).type === type) {
    while (from > 0 && doc.child(from - 1).type === type) {
      from--;
    }
    from = Math.max(0, from - 1);
  }
  if (doc.child(to).type === type) {
    while (to < doc.childCount - 1 && doc.child(to + 1).type === type) {
      to++;
    }
    to = Math.min(doc.childCount - 1, to + 1);
  }
  return { fromIndex: from, toIndex: to };
}

/**
 * Whether `node` is a `{glossary}` directive.
 *
 * @param node - the node.
 * @returns true for a glossary.
 */
function isGlossary(node: ProsemirrorNode): boolean {
  return (
    node.type.name === "container_directive" &&
    node.attrs.directive === "glossary"
  );
}

/**
 * The term of the glossary entry `$pos` is in, when commenting from `$pos`
 * has to take that whole entry: a term with no definition under it, or a
 * definition with no term above it, is not a glossary entry any more, and
 * the glossary would stop being one.
 *
 * @param $pos - a position in a textblock.
 * @param headOnly - only when `$pos` is in the term itself or in the first
 * block of its definition (a later paragraph of a definition can go on its
 * own).
 * @returns the term's position (before it) and node, or undefined.
 */
function entryTermAt(
  $pos: ResolvedPos,
  headOnly: boolean
): { pos: number; node: ProsemirrorNode } | undefined {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "definition_term") {
      return { pos: $pos.before(depth), node };
    }
    if (node.type.name === "definition_body") {
      if (headOnly && $pos.index(depth) !== 0) {
        return undefined;
      }
      const term = $pos.node(depth - 1).child($pos.index(depth - 1) - 1);
      return { pos: $pos.before(depth) - term.nodeSize, node: term };
    }
  }
  return undefined;
}

/**
 * Widen a set of comment lines to whole commented-out glossary entries: a
 * term's line brings the indented definition lines under it, a definition
 * line brings its term. A commented definition line whose term is not
 * commented stays on its own — it rejoins that term's definition.
 *
 * @param doc - the document.
 * @param type - the `myst_comment` node type.
 * @param targets - the comment lines, by position.
 * @returns the widened set, in document order.
 */
function widenGlossaryEntries(
  doc: ProsemirrorNode,
  type: NodeType,
  targets: { pos: number; node: ProsemirrorNode }[]
): { pos: number; node: ProsemirrorNode }[] {
  const indented = (node: ProsemirrorNode) =>
    node.type === type && /^\s/.test(node.textContent);
  const byPos = new Map(targets.map((target) => [target.pos, target]));

  for (const target of targets) {
    const $pos = doc.resolve(target.pos);
    const parent = $pos.parent;
    if (!isGlossary(parent)) {
      continue;
    }
    let first = $pos.index();
    while (first > 0 && indented(parent.child(first))) {
      first--;
    }
    if (parent.child(first).type !== type || indented(parent.child(first))) {
      continue;
    }
    let last = first;
    while (last + 1 < parent.childCount && indented(parent.child(last + 1))) {
      last++;
    }
    let pos = $pos.start();
    parent.forEach((child, offset, index) => {
      if (index >= first && index <= last) {
        pos = $pos.start() + offset;
        byPos.set(pos, { pos, node: child });
      }
    });
  }

  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

/**
 * Take the comment out of every `myst_comment` line the selection touches:
 * each comes back exactly as the source line it was before `%` was put in
 * front of it — a list item at its own indentation, a glossary entry inside
 * its glossary, formatting and all.
 *
 * @param state - the editor state.
 * @param type - the `myst_comment` node type.
 * @param roundTrip - the editor's parser and serializer.
 * @returns the transaction, or undefined when the selection holds no
 * comment or the result would degrade the document.
 */
export function uncommentSelection(
  state: EditorState,
  type: NodeType,
  roundTrip: MarkdownRoundTrip
): Transaction | undefined {
  const { from, to, $from, $to } = state.selection;
  const targets: { pos: number; node: ProsemirrorNode }[] = [];
  state.doc.nodesBetween(from, Math.max(to, from + 1), (node, pos) => {
    if (node.type === type) {
      targets.push({ pos, node });
      return false;
    }
    return true;
  });
  if (targets.length === 0) {
    return undefined;
  }
  const commentLines = widenGlossaryEntries(state.doc, type, targets);

  // Put the marker at the start of each of their lines. Last first, so the
  // earlier positions stay valid.
  const markTr = state.tr;
  for (let index = commentLines.length - 1; index >= 0; index--) {
    const { pos, node } = commentLines[index];
    const text = node.textContent
      .split("\n")
      .map((line) => UNCOMMENT + line)
      .join("\n");
    markTr.replaceWith(
      pos + 1,
      pos + node.nodeSize - 1,
      state.schema.text(text)
    );
  }

  const { fromIndex, toIndex } = widenOverComments(
    state.doc,
    type,
    Math.min($from.index(0), state.doc.resolve(commentLines[0].pos).index(0)),
    Math.max(
      $to.index(0),
      state.doc.resolve(commentLines[commentLines.length - 1].pos).index(0)
    )
  );

  // `%`, the marker's own space when the line was written `% text`, and the
  // character added above: what is left is the line as it was.
  // The cursor goes at the end of the first restored line: anywhere
  // before its content, it could land inside a list marker or indentation
  // and change what the line is. It goes before any trailing spaces, which
  // may be a hard break and only are one at the very end of the line.
  const pattern = new RegExp(`% ?${UNCOMMENT}`, "g");
  const restore = (markdown: string, withCaret: boolean) => {
    if (!markdown.includes(UNCOMMENT)) {
      return undefined;
    }
    const lines = markdown.split("\n");
    const first = lines.findIndex((line) => line.includes(UNCOMMENT));
    return lines
      .map((line, index) => {
        const restored = line.replace(pattern, "");
        return withCaret && index === first
          ? restored.replace(/\s*$/, (spaces) => `${CARET}${spaces}`)
          : restored;
      })
      .join("\n");
  };
  // A caret after a fence line (```, :::) would change the fence; when that
  // degrades the region, restore without it.
  return (
    rewriteRegion(state, markTr.doc, fromIndex, toIndex, roundTrip, (md) =>
      restore(md, true)
    ) ??
    rewriteRegion(state, markTr.doc, fromIndex, toIndex, roundTrip, (md) =>
      restore(md, false)
    )
  );
}

/**
 * Comment out every line of the blocks the selection touches — whole
 * lines, list markers and indentation included, the way `% ` goes in front
 * of them in a source file. A list item comes out of its list as a comment
 * line (the list continues around it), and its bold, italics and links stay
 * in the comment as their Markdown, ready to come back with it.
 *
 * @param state - the editor state.
 * @param type - the `myst_comment` node type.
 * @param roundTrip - the editor's parser and serializer.
 * @returns the transaction, or undefined when the selection cannot be
 * commented out as whole lines (inside a table or a code block, or
 * crossing a fence), or the result would degrade the document.
 */
export function commentOutSelection(
  state: EditorState,
  type: NodeType,
  roundTrip: MarkdownRoundTrip
): Transaction | undefined {
  const { $from, $to } = state.selection;
  const first = $from.parent;
  const last = $to.parent;
  if (!first.isTextblock || !last.isTextblock) {
    return undefined;
  }
  if (first.type.spec.code || last.type.spec.code) {
    return undefined;
  }

  for (const $pos of [$from, $to]) {
    for (let depth = 1; depth < $pos.depth; depth++) {
      if ($pos.node(depth).type.spec.tableRole) {
        return undefined;
      }
    }
  }

  // In a glossary, a term — or the first line of its definition — is
  // commented out together with its whole entry.
  const startTerm = entryTermAt($from, true);
  const startPos = startTerm ? startTerm.pos + 1 : $from.start();
  const endTerm = entryTermAt($to, false);
  const wholeEntryAtEnd = endTerm !== undefined && endTerm.pos + 1 >= startPos;

  const $start = state.doc.resolve(startPos);
  const $end = wholeEntryAtEnd ? state.doc.resolve(endTerm.pos + 1) : $to;
  const shared = $start.sharedDepth($end.pos);
  for (const $pos of [$start, $end]) {
    for (let depth = shared + 1; depth < $pos.depth; depth++) {
      if (FENCED_CONTAINERS.includes($pos.node(depth).type.name)) {
        return undefined;
      }
    }
  }

  // An empty line becomes an empty comment line, ready to type into.
  if (state.selection.empty && first.content.size === 0) {
    return state.tr.setBlockType($from.pos, $from.pos, type, {
      tight: false,
      spaced: true,
    });
  }

  // Mark where the selected lines start and end. End first, so the start
  // position stays valid.
  // Marks go in from the last position to the first, so the earlier
  // positions stay valid.
  const marks: [number, string][] = [
    [$to.end(), RANGE_END],
    [startPos, RANGE_START],
  ];
  if (wholeEntryAtEnd) {
    marks.push([endTerm.pos + 1, ENTRY]);
  }
  const markTr = state.tr;
  marks
    .sort((a, b) => b[0] - a[0])
    .forEach(([pos, mark]) => markTr.insertText(mark, pos));

  return rewriteRegion(
    state,
    markTr.doc,
    $start.index(0),
    $to.index(0),
    roundTrip,
    (markdown) => {
      const lines = markdown.split("\n");
      const start = lines.findIndex((line) => line.includes(RANGE_START));
      let end = lines.findIndex((line) => line.includes(RANGE_END));
      if (start === -1 || end === -1 || end < start) {
        return undefined;
      }
      // A whole entry runs from its term's line through every line indented
      // deeper than it — its definition, as the glossary reads it.
      const entry = lines.findIndex((line) => line.includes(ENTRY));
      if (entry !== -1) {
        const indentOf = (line: string) => /^\s*/.exec(line)?.[0].length ?? 0;
        const termIndent = indentOf(lines[entry]);
        let next = Math.max(end, entry) + 1;
        while (
          next < lines.length &&
          (lines[next].trim() === "" || indentOf(lines[next]) > termIndent)
        ) {
          next++;
        }
        end = next - 1;
        while (end > start && lines[end].trim() === "") {
          end--;
        }
      }
      return lines
        .map((line, index) => {
          const clean = line
            .replace(RANGE_START, "")
            .replace(RANGE_END, "")
            .replace(ENTRY, "");
          if (index < start || index > end || clean.trim() === "") {
            return clean;
          }
          return index === start ? `% ${CARET}${clean}` : `% ${clean}`;
        })
        .join("\n");
    }
  );
}
