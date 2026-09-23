import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type Token from "markdown-it/lib/token.mjs";

/** The character MyST reads as the start of a line comment. */
const PERCENT_CODE = 0x25;

/** Attributes carried from a `%` line to its `myst_comment` node. */
export interface CommentLineMeta {
  /** The line directly follows another `%` line, with no blank line
   * between them — written back the same way. */
  tight: boolean;
  /** The run this line belongs to uses the `% text` convention: the one
   * space after `%` belongs to the marker, not to the line's content. */
  spaced: boolean;
  /** Spaces before the `%` itself, beyond the enclosing block's own
   * indentation (MyST reads up to 3 as a comment line all the same). */
  indent: number;
}

/**
 * Split a run of consecutive `%` lines into each line's own content and the
 * marker convention the run was written with.
 *
 * Commenting a block out by hand usually means putting `% ` in front of
 * every line of it. That space is part of the marker: the line's own
 * content — its indentation in particular, which decides whether a list
 * item is nested — starts after it. But `%text` with no space is valid MyST
 * too, and there any leading whitespace is the content's own. A single line
 * cannot tell the two apart, so the run decides: when every non-empty line
 * starts with a space, the run is taken to use `% `, and one space is
 * removed from each line; otherwise every line is kept as written.
 *
 * @param lines - each line's text after its `%`, trailing spaces included.
 * @returns whether the run uses `% `, and each line's own content.
 */
export function splitCommentMarker(lines: string[]): {
  spaced: boolean;
  texts: string[];
} {
  const nonEmpty = lines.filter((line) => line !== "");
  const spaced =
    nonEmpty.length > 0 && nonEmpty.every((line) => line.startsWith(" "));
  return {
    spaced,
    texts: spaced
      ? lines.map((line) => (line === "" ? line : line.slice(1)))
      : lines,
  };
}

/**
 * Build the tokens for a run of consecutive `%` lines: one `myst_comment`
 * per line, so each can be un-commented on its own, each carrying the
 * attributes that let it write back exactly as it was read.
 *
 * `_open` / `text` / `_close` rather than one self-closing token: a
 * self-closing block token has its trailing "\n" stripped by
 * prosemirror-markdown (`withoutTrailingNewline`), and this shape reuses the
 * parser's generic `text` handler instead.
 *
 * @param createToken - builds a token of the given type, tag and nesting.
 * @param lines - each line's text after its `%`, trailing spaces included.
 * @param indents - each line's spaces before its `%`; none when omitted.
 * @returns the tokens, in order.
 */
export function commentRunTokens(
  createToken: (type: string, tag: string, nesting: 1 | 0 | -1) => Token,
  lines: string[],
  indents: number[] = []
): Token[] {
  const { spaced, texts } = splitCommentMarker(lines);
  const tokens: Token[] = [];

  texts.forEach((text, index) => {
    const open = createToken("myst_comment_open", "div", 1);
    open.block = true;
    const meta: CommentLineMeta = {
      tight: index > 0,
      spaced,
      indent: indents[index] ?? 0,
    };
    open.meta = meta;
    const textToken = createToken("text", "", 0);
    textToken.content = text;
    const close = createToken("myst_comment_close", "div", -1);
    close.block = true;
    tokens.push(open, textToken, close);
  });

  return tokens;
}

/**
 * Parse MyST `%` line comments, mirroring
 * `mdit_py_plugins.myst_blocks.line_comment`: the first non-blank character
 * of the line is `%` (not inside a code block — 4+ leading spaces means the
 * line is code, not a comment).
 *
 * MyST merges consecutive `%` lines into one token. Nothing is rendered for
 * a comment either way, so this keeps one node per line instead — the unit
 * someone comments out and back in — and records which lines were
 * consecutive (`tight`) so they are written back without blank lines
 * between them.
 *
 * One deliberate deviation from the Python rule: the run also stops when
 * the next line's indent falls below the enclosing block's own indent
 * (`state.blkIndent`), rather than swallowing a column-0 `%` line into an
 * enclosing list item. Sphinx renders either shape identically (nothing);
 * this one round-trips better.
 *
 * Another: a line keeps its trailing spaces, where MyST strips them. Sphinx
 * renders nothing for a comment either way, but a line commented out with a
 * hard break at its end (two trailing spaces) needs them to get the break
 * back when it is un-commented.
 *
 * Registered as a paragraph terminator (see `comments` below), matching
 * MyST's own registration — a `%` line ends a paragraph without a blank
 * line first, rather than becoming a lazy continuation of it.
 *
 * @param state - the block parser state.
 * @param startLine - the line this rule is being tried at.
 * @param endLine - the last line available to the parser.
 * @param silent - true when the parser is only checking whether this rule
 * would match, not building tokens.
 * @returns whether a `%` comment was found (and, unless `silent`, tokenized).
 */
function lineComment(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];

  if (state.src.charCodeAt(pos) !== PERCENT_CODE) {
    return false;
  }

  if (silent) {
    return true;
  }

  const lines = [state.src.slice(pos + 1, max)];
  const indents = [state.sCount[startLine] - state.blkIndent];

  let nextLine = startLine + 1;
  for (; nextLine < endLine; nextLine++) {
    if (state.sCount[nextLine] < state.blkIndent) {
      break;
    }
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    max = state.eMarks[nextLine];
    if (state.src.charCodeAt(pos) !== PERCENT_CODE) {
      break;
    }
    lines.push(state.src.slice(pos + 1, max));
    indents.push(Math.min(3, state.sCount[nextLine] - state.blkIndent));
  }

  const tokens = commentRunTokens(
    (type, tag, nesting) => state.push(type, tag, nesting),
    lines,
    indents
  );
  tokens.forEach((token, index) => {
    if (token.type === "myst_comment_open") {
      const line = startLine + index / 3;
      token.map = [line, line + 1];
    }
  });

  state.line = nextLine;
  return true;
}

/**
 * Registers the MyST `%` line comment block rule.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
export default function comments(md: MarkdownIt): void {
  md.block.ruler.before("blockquote", "myst_line_comment", lineComment, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}

/**
 * Parse a MyST `(label)=` cross-reference target line, mirroring
 * `mdit_py_plugins.myst_blocks.target`: the whole line, trimmed, must open
 * with `(`, close with `)=`, and hold at least one character of label in
 * between (`(deployment_configuration_values)=`). Unlike a `%` comment run,
 * a target is always exactly one line — MyST does not merge consecutive
 * target lines the way it does comment lines.
 *
 * The label is what `{ref}`/`{numref}` elsewhere in the document point the
 * following block at. Outline does not resolve or validate that link —
 * this rule only keeps the target line itself readable and round-trippable
 * instead of it reading as a stray paragraph of parenthesised text.
 *
 * Registered `before("hr")`, matching MyST's own registration order and
 * `alt` list — a `(label)=` line, like an `hr`, ends a paragraph, list item
 * or blockquote without needing a blank line first.
 *
 * @param state - the block parser state.
 * @param startLine - the line this rule is being tried at.
 * @param _endLine - the last line available to the parser (unused: a
 * target is always exactly one line).
 * @param silent - true when the parser is only checking whether this rule
 * would match, not building a token.
 * @returns whether a `(label)=` target was found (and, unless `silent`,
 * tokenized).
 */
function target(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const text = state.src.slice(pos, max).trim();

  if (!text.startsWith("(") || !text.endsWith(")=") || text.length <= 3) {
    return false;
  }

  if (silent) {
    return true;
  }

  // `_open`/`text`/`_close`, not one self-closing token — the same reason
  // `commentRunTokens` above gives: it lets the label come back as the
  // node's own real, editable text content (`prosemirror-markdown`'s
  // generic block-token handling copies an inline `text` token into a
  // block node's content automatically), rather than an attribute that
  // would need its own decorative, non-editable rendering.
  const open = state.push("myst_target_open", "div", 1);
  open.block = true;
  open.map = [startLine, startLine + 1];
  const label = state.push("text", "", 0);
  label.content = text.slice(1, -2);
  state.push("myst_target_close", "div", -1).block = true;

  state.line = startLine + 1;
  return true;
}

/**
 * Registers the MyST `(label)=` cross-reference target block rule.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
export function targets(md: MarkdownIt): void {
  md.block.ruler.before("hr", "myst_target", target, {
    alt: ["paragraph", "reference", "blockquote", "list", "footnote_def"],
  });
}
