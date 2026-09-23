import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { commentRunTokens } from "./comments";
import {
  DIRECTIVE_UNCONTAINABLE_BLOCKS,
  parseDirectiveInfo,
} from "./directives";

/** A line that is only dashes or only equals signs — CommonMark's setext
 * heading underline shape, once any leading indent has already been
 * stripped. */
const SETEXT_UNDERLINE = /^(-+|=+)\s*$/;

/** A line that looks like it opens some other block construct, so is
 * declined as a term rather than guessed at — see `parseEntries`'s own
 * comment for why this exists at all. */
const OTHER_BLOCK_STARTER =
  /^(#{1,6}\s|`{3,}|:{3,}|~{3,}|\||[-*+]\s|\d+[.)]\s)/;

type DeflistEntry =
  | {
      kind: "term";
      /** The term line, verbatim (inline-parsed later). */
      term: string;
      /** The definition's own lines, already dedented to that entry's own
       * indent width. */
      bodyLines: string[];
    }
  | {
      kind: "comment";
      /** A run of column-0 comment lines — commented-out entries — each
       * with its marker already stripped (matching the `myst_comment` rule's
       * own token content shape) — see `parseEntries`'s own comment for why
       * these get their own entry kind rather than being declined. */
      lines: string[];
    };

/**
 * Split a `{glossary}` fence's raw body into term/definition entries, or
 * decline (return undefined) if any part of it does not cleanly fit the
 * shape docutils' own definition-list syntax requires: an unindented term
 * line immediately followed — no blank line permitted between them — by one
 * or more lines indented relative to it. All or nothing, the same bar every
 * other directive-body parser in this codebase holds itself to: a `{grid}`
 * or `{ifconfig}` this same file's sibling rules already handle correctly
 * on their own is deliberately not re-validated at the line level here — it
 * is opaque text from this function's point of view, dedented and hindsight
 * validated for real once `state.md.parse` gets to it in
 * `buildDefinitionBodyTokens`.
 *
 * Each entry's own indent width comes from its *first* definition line —
 * the same "first content line sets the width" convention
 * `unclaimedColonFence` (`notices.ts`) already uses for a fence's own body,
 * and markdown-it's native `list` rule uses for a list item's own content.
 *
 * A column-0 comment run — whole entries commented out, written `.. ` (see
 * `entryCommentMarker`) — is its own entry kind rather than being declined
 * outright (what a `%` line used to do here: it passed
 * `OTHER_BLOCK_STARTER`, was taken as a term, then failed the "next line
 * must be indented" check) or being folded into a definition's own body
 * (Sphinx itself splits the `<dl>` at a comment between entries; see
 * `tryBuildDefinitionList`, which does the same). A comment on a line of a
 * definition sits indented, inside that definition, and is its business.
 *
 * @param body - the fence's raw, unindented body text.
 * @returns the parsed entries — possibly all of them comments — or
 * undefined if the body is not cleanly a sequence of them, or is empty.
 */
function parseEntries(body: string): DeflistEntry[] | undefined {
  const lines = body.split("\n");
  const entries: DeflistEntry[] = [];

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") {
    i++;
  }

  while (i < lines.length) {
    // A term's own body-scanning loop below always leaves `i` on a genuinely
    // non-blank line (it consumes trailing blanks itself, as part of
    // scanning how far the body extends) — but the comment branch just
    // below does not have an equivalent scan, since a comment run stops at
    // the first line not carrying its marker, blank or not. Skipping blank
    // lines here once
    // per iteration keeps both branches landing on the same footing before
    // deciding what the next entry is.
    while (i < lines.length && lines[i].trim() === "") {
      i++;
    }
    if (i >= lines.length) {
      break;
    }

    const marker = entryCommentMarker(lines[i]);
    if (marker) {
      const commentLines: string[] = [];
      while (i < lines.length && entryCommentMarker(lines[i]) === marker) {
        // A `.. ` line is handed on the way a `% text` line is — its text
        // after one space — so both read into the same node shape.
        commentLines.push(
          marker === "%" ? lines[i].slice(1) : ` ${lines[i].slice(3)}`
        );
        i++;
      }
      entries.push({ kind: "comment", lines: commentLines });
      continue;
    }

    const term = lines[i];

    // A term line indented relative to the body's own base (0, since this
    // is already the fence's dedented body) means the previous entry's own
    // scan ended somewhere it should not have — a bug in this function, not
    // malformed input, since the loop below only ever stops at a line with
    // no leading whitespace at all.
    if (/^\s/.test(term)) {
      return undefined;
    }
    // A term is a single, plain line — something that looks like it opens a
    // table, a fence, a heading, or a list instead is not a definition
    // list at all, and guessing it is one regardless has already dropped
    // real content before (the exact class of bug the colon-fence and
    // directive-guard work earlier in this file's sibling rules exists to
    // avoid) — decline rather than risk it.
    if (OTHER_BLOCK_STARTER.test(term)) {
      return undefined;
    }

    i++;
    if (i >= lines.length || !/^\s/.test(lines[i]) || lines[i].trim() === "") {
      // No indented line immediately follows — a blank line, a new
      // unindented line, or the end of the body. Docutils requires the
      // definition to start on the very next line, no gap.
      return undefined;
    }

    const width = /^(\s+)/.exec(lines[i])![1].length;
    const bodyLines: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        bodyLines.push("");
        i++;
        continue;
      }
      const lineIndent = /^(\s*)/.exec(line)![1].length;
      if (lineIndent < width) {
        break;
      }
      bodyLines.push(line.slice(width));
      i++;
    }
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === "") {
      bodyLines.pop();
    }

    entries.push({ kind: "term", term, bodyLines });
  }

  // Every entry commented out is still a glossary: Sphinx builds it without
  // a warning, as an empty one. A body with nothing in it at all is left to
  // the opaque fence, as before.
  return entries.length > 0 ? entries : undefined;
}

/**
 * Which comment marker a glossary body line starts with at column 0 — the
 * entry level, where Sphinx's own glossary parser reads it.
 *
 * `.. ` is the form Sphinx skips there, together with the definition lines
 * under it. `%` is not a comment at that level in Sphinx (it is published as
 * a term), but is still read as one, so a glossary written that way — by an
 * earlier version of the editor — opens as what was meant and is written
 * back with `..`.
 *
 * @param line - a line of the fence's body.
 * @returns the marker, or undefined for any other line.
 */
function entryCommentMarker(line: string): "%" | ".." | undefined {
  if (line.startsWith("%")) {
    return "%";
  }
  if (line.startsWith(".. ")) {
    return "..";
  }
  return undefined;
}

/**
 * Disambiguate a definition's own dedented lines before they are handed to
 * `state.md.parse` as an independent document.
 *
 * A real, verified hazard: `In {{PR}} cameras:` immediately followed by a
 * bare `---` is meant as prose then an RST transition (a thematic break,
 * unrelated to the term's own indent level) — but with no blank line
 * between them, CommonMark's own setext rule reads the same two lines as an
 * `<h2>` instead, a genuine semantic misparse rather than a formatting
 * quirk. Inserting a blank line before an underline-shaped line that
 * immediately follows non-blank text forces the unambiguous reading —
 * exactly the gap a real, blank-line-separated thematic break already has,
 * and exactly what this construct means in the source it came from.
 *
 * @param lines - one entry's own dedented body lines.
 * @returns the same lines, with a blank line inserted before any line this
 * would otherwise misparse as a setext heading underline.
 */
function disambiguateSetextUnderlines(lines: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const previous = result[result.length - 1];
    if (
      SETEXT_UNDERLINE.test(line) &&
      previous !== undefined &&
      previous.trim() !== ""
    ) {
      result.push("");
    }
    result.push(line);
  }
  return result;
}

/**
 * Build the token stream for one entry's definition body by running its own
 * dedented text through the *full* markdown-it pipeline —
 * `state.md.parse`, not `state.md.block.parse` — rather than just the block
 * ruler. Deliberate: a definition can itself nest a colon-fenced directive
 * (the real "Detection field" entry nests a `{grid}` > `{grid-item}` >
 * `{figure-md}` tree; "Model approval parameter" nests an `{ifconfig}`
 * wrapping a table), and while the colon-native path handles its own
 * recursion natively either way, a backtick-fenced one needs
 * `mystDirectiveFences`/`guardDirectiveContent`/`directiveOptions` — all
 * core-ruler passes, which only run once per top-level `md.parse()` call
 * and never fire again for a plain `block.parse()` sub-call. Reusing the
 * full pipeline here means a definition's own nested content gets exactly
 * the same treatment top-level content already does, including this same
 * file's own core rule for a nested `{glossary}` should one ever occur, and
 * `figures.ts`'s for a nested `{figure-md}` not already inside a `{grid}`.
 *
 * @param state - the core ruler state, used to reach the markdown-it instance and its `env`.
 * @param lines - one entry's own dedented body lines.
 * @returns the body's tokens, or undefined if any of them are on
 * `DIRECTIVE_UNCONTAINABLE_BLOCKS` — the same content model `Directive`
 * itself holds `definition_body` to, since it is the identical content
 * expression.
 */
function buildDefinitionBodyTokens(
  state: StateCore,
  lines: string[]
): Token[] | undefined {
  const text = disambiguateSetextUnderlines(lines).join("\n");
  const tokens = state.md.parse(text, state.env);
  if (tokens.some((t) => DIRECTIVE_UNCONTAINABLE_BLOCKS.includes(t.type))) {
    return undefined;
  }
  return tokens;
}

/**
 * Try to read a `{glossary}` fence's body as a native definition list —
 * see `parseEntries` and `buildDefinitionBodyTokens` for the two halves of
 * this. All or nothing: if any entry does not fit, or any entry's own
 * definition holds something `definition_body` cannot, none of it becomes a
 * `definition_list` and the whole fence is left exactly as it already is —
 * the byte-exact opaque `CodeFence` every other unclaimed directive falls
 * back to too.
 *
 * A commented-out entry between two others splits the `definition_list` in
 * two around a `myst_comment` node, sitting as its sibling — what Sphinx
 * itself does to the `<dl>` — rather than teaching `definition_list` to
 * hold a comment as one of its own children (which would touch its own
 * strict `(definition_term definition_body)+` content expression and the
 * term/body pair arithmetic `DefinitionList.toMarkdown` and
 * `deleteEmptyDirective.ts` both rely on). The split lists still write back
 * inside the one `{glossary}` fence either way — `Directive.toMarkdown`
 * renders this node's whole content in one pass regardless of how many
 * top-level children it has.
 *
 * @param state - the core ruler state, used to construct new tokens.
 * @param body - the fence's raw body text.
 * @returns the `container_directive`-ready inner tokens, or undefined.
 */
function tryBuildDefinitionList(
  state: StateCore,
  body: string
): Token[] | undefined {
  const entries = parseEntries(body);
  if (!entries) {
    return undefined;
  }

  const tokens: Token[] = [];
  let listOpen = false;

  for (const entry of entries) {
    if (entry.kind === "comment") {
      if (listOpen) {
        tokens.push(new state.Token("definition_list_close", "dl", -1));
        listOpen = false;
      }

      tokens.push(
        ...commentRunTokens(
          (type, tag, nesting) => new state.Token(type, tag, nesting),
          entry.lines
        )
      );
      continue;
    }

    const bodyTokens = buildDefinitionBodyTokens(state, entry.bodyLines);
    if (!bodyTokens) {
      return undefined;
    }

    if (!listOpen) {
      const listOpenToken = new state.Token("definition_list_open", "dl", 1);
      listOpenToken.block = true;
      tokens.push(listOpenToken);
      listOpen = true;
    }

    const termOpen = new state.Token("definition_term_open", "dt", 1);
    termOpen.block = true;
    const termInline = new state.Token("inline", "", 0);
    termInline.content = entry.term.trim();
    termInline.children = [];
    state.md.inline.parse(
      termInline.content,
      state.md,
      state.env,
      termInline.children
    );
    const termClose = new state.Token("definition_term_close", "dt", -1);
    termClose.block = true;

    const bodyOpen = new state.Token("definition_body_open", "dd", 1);
    bodyOpen.block = true;
    const bodyClose = new state.Token("definition_body_close", "dd", -1);
    bodyClose.block = true;

    tokens.push(
      termOpen,
      termInline,
      termClose,
      bodyOpen,
      ...bodyTokens,
      bodyClose
    );
  }

  if (listOpen) {
    tokens.push(new state.Token("definition_list_close", "dl", -1));
  }
  return tokens;
}

/**
 * Claim a `{glossary}` fence Outline can represent as a real, editable
 * definition list, instead of leaving it as an inert code fence.
 *
 * Mirrors `figures.ts`'s own architecture closely: operates on raw,
 * already-captured `fence` tokens (both colon-origin, from
 * `unclaimedColonFence` in `notices.ts`, and native backtick ones),
 * registered last (`push`, not `after("block")`) so a `{glossary}` nested
 * one level inside an admonition has already been spliced out of that
 * admonition's own raw text by `notices.ts`'s rules first — the same
 * reasoning `figures.ts` documents for itself.
 *
 * `directiveContainer`'s own `validate` in `directives.ts` excludes
 * `"glossary"` even though it is on `DIRECTIVE_ALLOWLIST`, specifically so a
 * colon-fenced `:::{glossary}` still reaches this rule as a plain `fence`
 * token rather than being claimed by the generic native recursive
 * container parse first, which would merge every term into its
 * definition's own first line before this ever got a look at it.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
export default function deflist(md: MarkdownIt): void {
  md.core.ruler.push("glossary-definition-list", (state) => {
    const tokens = state.tokens;

    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      if (token.type !== "fence") {
        continue;
      }

      const parsed = parseDirectiveInfo(token.info, { allowBare: true });
      if (parsed?.directive !== "glossary") {
        continue;
      }

      const listTokens = tryBuildDefinitionList(state, token.content);
      if (!listTokens) {
        continue;
      }

      const openToken = new state.Token("container_directive_open", "div", 1);
      openToken.info = token.info;
      openToken.markup = token.markup;
      openToken.block = true;
      openToken.map = token.map;

      const closeToken = new state.Token(
        "container_directive_close",
        "div",
        -1
      );
      closeToken.block = true;

      tokens.splice(i, 1, openToken, ...listTokens, closeToken);
    }

    return false;
  });
}
