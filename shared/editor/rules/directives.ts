import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import customFence from "markdown-it-container";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { codeLanguages } from "../lib/code";

// A MyST option line, e.g. `:gutter: 0`. Duplicated from `notices.ts` rather
// than imported — `notices.ts` itself imports from this file (to defer to
// `container_directive` for an allowlisted directive), and importing this
// single-line regex back would make that a circular module dependency for
// no real benefit.
const OPTION_LINE = /^:[A-Za-z0-9_-]+:(?:\s|$)/;

/**
 * MyST directive names Outline gives a real, structured node to instead of
 * the inert `CodeFence` every other directive falls back to. Deliberately
 * narrow: each of these has a body that is ordinary block content (prose,
 * lists, tables, figures, nested directives).
 *
 * `"glossary"` is on this list too, but does **not** go through the generic
 * body parsing every other entry here does — see
 * `DIRECTIVES_WITH_CUSTOM_BODY_PARSING` right below. It needs to be on this
 * list regardless: `Directive.parseMarkdown`'s `getAttrs` derives
 * `directive`/`argument` from `parseDirectiveInfo`, which checks this same
 * list, on every parse — including the one after `deflist.ts`'s own rule has
 * already built the node once.
 */
export const DIRECTIVE_ALLOWLIST = [
  "ifconfig",
  "grid",
  "grid-item",
  "margin",
  "glossary",
];

/**
 * Directives on `DIRECTIVE_ALLOWLIST` whose body is not ordinary block
 * content, and so must not be claimed by `container_directive`'s own
 * generic native recursive parse below — `"glossary"`'s body is an
 * indentation-significant definition list (`shared/editor/rules/deflist.ts`
 * owns it instead); merging every term into its own definition's first
 * paragraph, which the generic parse would do, is exactly the loss keeping
 * `{glossary}` off `DIRECTIVE_ALLOWLIST` entirely used to prevent.
 */
export const DIRECTIVES_WITH_CUSTOM_BODY_PARSING = ["glossary"];

export type ParsedDirective = {
  /** The directive name, without braces, e.g. "ifconfig". */
  directive: string;
  /** The directive's argument, e.g. "Class == 'A'" or "2". */
  argument: string;
  /** Whether the name was written in braces (`:::{ifconfig}` vs `:::ifconfig`). */
  braced: boolean;
};

/**
 * Read a fence's info string as one of the allowlisted directives.
 *
 * @param info - the fence token's info string.
 * @param options.allowBare - accept `ifconfig` as well as `{ifconfig}`. Colon
 * fences are written both ways; a backtick fence requires braces, matching
 * `parseNoticeInfo`'s own reasoning (a bare word is far more likely to be a
 * code language than a directive name).
 * @returns the directive and its argument, or undefined if it names no
 * allowlisted directive.
 */
export function parseDirectiveInfo(
  info: string,
  { allowBare }: { allowBare: boolean }
): ParsedDirective | undefined {
  const parsed = readDirectiveInfo(info, { allowBare });
  if (!parsed || !DIRECTIVE_ALLOWLIST.includes(parsed.directive)) {
    return undefined;
  }
  return parsed;
}

/**
 * Read a fence's info string as any MyST directive, allowlisted or not —
 * `{raw} latex`, `{tabularcolumns} |l|l|`, a project's own custom directive.
 *
 * @param info - the fence token's info string.
 * @param options.allowBare - accept `ifconfig` as well as `{ifconfig}`, see
 * `parseDirectiveInfo`.
 * @returns the directive and its argument, or undefined if the info string
 * does not open a directive.
 */
export function readDirectiveInfo(
  info: string,
  { allowBare }: { allowBare: boolean }
): ParsedDirective | undefined {
  const trimmed = info.trim();
  const braced = /^\{([A-Za-z0-9_-]+)\}\s*(.*)$/.exec(trimmed);
  const match =
    braced ?? (allowBare ? /^([A-Za-z0-9_-]+)\s*(.*)$/.exec(trimmed) : null);
  if (!match) {
    return undefined;
  }

  return {
    directive: match[1].toLowerCase(),
    argument: match[2].trim(),
    braced: braced !== null,
  };
}

/**
 * Whether a `container_directive` node holds its body verbatim rather than
 * as Markdown: a directive off `DIRECTIVE_ALLOWLIST` (`{raw}`, `{eval-rst}`,
 * `{tabularcolumns}`, a custom one…) whose content is only code blocks. Its
 * body is then written back exactly as stored — LaTeX, reStructuredText or
 * anything else MyST hands to the directive untouched — instead of as nested
 * code fences.
 *
 * @param node - the node to check.
 * @returns true when the node's body is written back verbatim.
 */
export function isVerbatimDirective(node: ProsemirrorNode): boolean {
  if (
    node.type.name !== "container_directive" ||
    DIRECTIVE_ALLOWLIST.includes(node.attrs.directive) ||
    node.childCount === 0
  ) {
    return false;
  }
  let allCode = true;
  node.forEach((child) => {
    if (child.type.name !== "code_block" && child.type.name !== "code_fence") {
      allCode = false;
    }
  });
  return allCode;
}

/** Block tokens a directive node has nowhere to put — see `Directive`'s
 * content expression in `shared/editor/nodes/Directive.tsx`. Same bargain
 * `notices.ts`'s `UNCONTAINABLE_BLOCKS` makes: a fence carrying one of these
 * is left as the inert `CodeFence` it already is, rather than built into a
 * node that cannot hold it and silently dropping content. */
export const DIRECTIVE_UNCONTAINABLE_BLOCKS = [
  "math_block",
  "container_toggle_open",
];

/**
 * Undo a colon-fenced directive whose body holds something `Directive`'s
 * content expression has nowhere to put, converting it back into the same
 * raw, opaque `fence` token an entirely unclaimed directive already gets.
 *
 * `customFence`'s own `validate` (below) only ever sees the opening line —
 * there is no body yet to check when it decides whether to claim a `:::`
 * fence — so unlike the backtick path (`mystDirectiveFences`, which parses
 * the body *before* deciding whether to build a container), an unsuitable
 * body already exists as real `container_directive_open/close` tokens by the
 * time anything could object. Left alone, `Directive`'s content expression
 * can't hold it, ProseMirror's own content-fitting silently drops whatever
 * doesn't fit when the document is built, and the whole directive — prose
 * included — disappears without a trace, the exact failure `notices.ts`
 * documents as a still-open, pre-existing gap in `container_notice`'s own
 * native colon parsing.
 *
 * This closes that gap for `Directive` by finding every *outermost*
 * `container_directive_open`/`close` span (tracking nesting depth so an inner
 * span already covered by an outer undo is not double-handled) and, if
 * anything inside it at any depth is on `DIRECTIVE_UNCONTAINABLE_BLOCKS`,
 * replacing the entire span with a reconstructed opaque fence token instead —
 * not a scalpel (an offending grandchild takes its whole ancestor chain down
 * to plain text with it, not just itself), but nothing is ever silently
 * dropped, which every other path in this file already promises.
 *
 * Not needed for `Notice` — happens not to matter for the one real gap
 * (`{note}` around a table) already fixed by `Directive`'s own content
 * expression picking up `table`, and no real content nests anything
 * uncontainable inside a colon-fenced admonition — but the underlying
 * `container_notice` gap this mirrors is still open in principle.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
function guardDirectiveContent(md: MarkdownIt): void {
  md.core.ruler.after("block", "directive-guard", (state) => {
    const tokens = state.tokens;
    const lines = state.src.split("\n");

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "container_directive_open") {
        continue;
      }

      let depth = 1;
      let close = i + 1;
      for (; close < tokens.length; close++) {
        if (tokens[close].type === "container_directive_open") {
          depth++;
        } else if (tokens[close].type === "container_directive_close") {
          depth--;
          if (depth === 0) {
            break;
          }
        }
      }

      const hasUncontainable = tokens
        .slice(i + 1, close)
        .some((t) => DIRECTIVE_UNCONTAINABLE_BLOCKS.includes(t.type));

      if (!hasUncontainable) {
        // This span is safe as-is; nested spans inside it were each already
        // independently checked when the outer loop reaches them below, so
        // skip straight past everything already covered.
        i = close;
        continue;
      }

      const openToken = tokens[i];
      // `map`'s second entry is the closing fence's own line (0-indexed),
      // exactly as `markdown-it-container` sets it — not one past the body,
      // one *is* the body's exclusive upper bound already.
      const [startLine, closeLine] = openToken.map ?? [0, 0];
      const bodyLines = lines.slice(startLine + 1, closeLine);

      const fenceToken = new state.Token("fence", "code", 0);
      fenceToken.info = openToken.info;
      fenceToken.markup = openToken.markup || ":::";
      fenceToken.content = bodyLines.length ? `${bodyLines.join("\n")}\n` : "";
      fenceToken.map = openToken.map;
      fenceToken.block = true;

      tokens.splice(i, close - i + 1, fenceToken);
      // The whole span, nested directives and all, is now one leaf fence
      // token — nothing left inside it for the loop to separately visit.
    }

    return false;
  });
}

/**
 * Rewrite MyST-style directive fences (```{ifconfig} ... ```) into the same
 * container_directive tokens the `:::{ifconfig}` colon syntax produces below,
 * so a backtick-fenced allowlisted directive round-trips too — real content
 * uses both forms (`{margin}` in particular is backtick-fenced throughout
 * `Functional_architecture.md`).
 *
 * @param md - the markdown-it instance to register the rule on.
 */
function mystDirectiveFences(md: MarkdownIt): void {
  md.core.ruler.after("block", "directive-myst-fence", (state) => {
    const tokens = state.tokens;

    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      if (token.type !== "fence") {
        continue;
      }
      const parsed = parseDirectiveInfo(token.info, { allowBare: false });
      if (
        !parsed ||
        DIRECTIVES_WITH_CUSTOM_BODY_PARSING.includes(parsed.directive)
      ) {
        // A directive with its own body parser (`deflist.ts`, for
        // "glossary") needs this token left as plain `fence` — this rule's
        // own generic parse below would merge every term into its
        // definition's first paragraph, and that dedicated rule (registered
        // later, via `push`) needs the untouched token to still find.
        continue;
      }

      const contentTokens: Token[] = [];
      state.md.block.parse(token.content, state.md, state.env, contentTokens);

      if (
        contentTokens.some((t) =>
          DIRECTIVE_UNCONTAINABLE_BLOCKS.includes(t.type)
        )
      ) {
        continue;
      }

      const openToken = new state.Token("container_directive_open", "div", 1);
      openToken.info = token.info;
      // `Directive` reads this to preserve the arrival fence character
      // (unlike `container_notice_open`, which never needs it — `Notice`
      // always writes back a backtick fence regardless of how it arrived).
      openToken.markup = token.markup;
      openToken.block = true;
      openToken.map = token.map;

      const closeToken = new state.Token(
        "container_directive_close",
        "div",
        -1
      );
      closeToken.block = true;

      tokens.splice(i, 1, openToken, ...contentTokens, closeToken);
    }

    return false;
  });
}

/**
 * Lift a directive's MyST option lines off its body and onto the opening
 * token, the same way `noticeOptions` does for notices — see that function
 * for why (escaping on re-parse, and keeping metadata out of the visible
 * body).
 *
 * @param md - the markdown-it instance to register the rule on.
 */
function directiveOptions(md: MarkdownIt): void {
  md.core.ruler.after("directive-myst-fence", "directive-options", (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "container_directive_open") {
        continue;
      }

      if (
        tokens[i + 1]?.type === "paragraph_open" &&
        tokens[i + 2]?.type === "inline" &&
        tokens[i + 3]?.type === "paragraph_close"
      ) {
        const lines = tokens[i + 2].content.split("\n");
        if (lines.every((line) => OPTION_LINE.test(line))) {
          tokens[i].meta = { ...tokens[i].meta, options: lines.join("\n") };
          tokens.splice(i + 1, 3);
        }
      }

      // A directive must hold at least one block — whether the body was
      // genuinely empty to begin with (a real, live case: `{ifconfig}`'s
      // "else" branch with nothing in it yet) or the options above were
      // the whole of it. Left alone, ProseMirror fills an empty content
      // region with whichever of `Directive`'s own content alternatives it
      // can trivially create — `list`, the first one — landing a phantom
      // `- [ ]` in the document on every single save. An explicit empty
      // paragraph forecloses that, the same fix `noticeOptions` already
      // makes for the options-only case.
      if (tokens[i + 1]?.type === "container_directive_close") {
        const paragraphOpen = new state.Token("paragraph_open", "p", 1);
        paragraphOpen.block = true;
        const inline = new state.Token("inline", "", 0);
        inline.content = "";
        inline.children = [];
        const paragraphClose = new state.Token("paragraph_close", "p", -1);
        paragraphClose.block = true;
        tokens.splice(i + 1, 0, paragraphOpen, inline, paragraphClose);
      }
    }

    return false;
  });
}

/**
 * Turn every directive fence still left as a plain `fence` token into a
 * directive block holding its body verbatim, so `{raw} latex`,
 * `{tabularcolumns}`, `{eval-rst}` or a project's custom directive show as
 * the same directive block `{ifconfig}` does rather than as a code block
 * with the fence line for a label.
 *
 * MyST's syntax is the same for every directive, but whether the body is
 * Markdown is up to the directive: `{raw}` holds LaTeX, `{eval-rst}`
 * reStructuredText. Parsing an unknown body as Markdown would merge its lines
 * and escape its backslashes, so it stays one code block inside the
 * directive, written back byte for byte (see `isVerbatimDirective`).
 *
 * Registered with `push`, so it runs after every rule that claims a
 * directive fence for a dedicated node (notices, allowlisted directives,
 * figures) and after `code-fence-options` has lifted the option lines, which
 * move to the directive. Allowlisted names are skipped: see the loop.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
function verbatimDirectives(md: MarkdownIt): void {
  md.core.ruler.push("directive-verbatim", (state) => {
    const tokens = state.tokens;

    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      if (token.type !== "fence") {
        continue;
      }
      const parsed = readDirectiveInfo(token.info, { allowBare: false });
      if (!parsed || DIRECTIVE_ALLOWLIST.includes(parsed.directive)) {
        // An allowlisted directive still left as a fence here is one whose
        // body holds something a directive block cannot (see
        // `guardDirectiveContent`), or `{glossary}`, whose own rule runs
        // after this one — both stay as they are.
        continue;
      }

      const openToken = new state.Token("container_directive_open", "div", 1);
      openToken.info = token.info;
      openToken.markup = token.markup;
      openToken.block = true;
      openToken.map = token.map;
      openToken.meta = { options: token.meta?.options ?? "" };

      // The body keeps the argument's language for highlighting when Outline
      // knows it (`{code-block} python`), plain text otherwise.
      const language = parsed.argument.split(/\s/)[0].toLowerCase();
      const body = new state.Token("fence", "code", 0);
      body.info = Object.prototype.hasOwnProperty.call(codeLanguages, language)
        ? language
        : "none";
      body.markup = "```";
      body.content = token.content;
      body.block = true;
      body.map = token.map;

      const closeToken = new state.Token(
        "container_directive_close",
        "div",
        -1
      );
      closeToken.block = true;

      tokens.splice(i, 1, openToken, body, closeToken);
    }

    return false;
  });
}

export default function directives(md: MarkdownIt): void {
  customFence(md, "directive", {
    marker: ":",
    validate: (params: string) => {
      const parsed = parseDirectiveInfo(params, { allowBare: false });
      return (
        !!parsed &&
        !DIRECTIVES_WITH_CUSTOM_BODY_PARSING.includes(parsed.directive)
      );
    },
    render(tokens: Token[], idx: number) {
      const { info } = tokens[idx];

      if (tokens[idx].nesting === 1) {
        return `<div class="directive" data-directive-info="${md.utils.escapeHtml(info)}">\n`;
      } else {
        return "</div>\n";
      }
    },
  });

  // Registration order matters: both `mystDirectiveFences` and
  // `guardDirectiveContent` anchor `.after("block", ...)`, and markdown-it's
  // `Ruler.after` always inserts immediately after that anchor's own fixed
  // position — so the *second* call here ends up running *first*.
  // `guardDirectiveContent` has to see (and undo, if needed) the colon-native
  // path's containers before `mystDirectiveFences` adds any backtick-derived
  // ones alongside them, hence registered last.
  mystDirectiveFences(md);
  guardDirectiveContent(md);
  directiveOptions(md);
  verbatimDirectives(md);
}
