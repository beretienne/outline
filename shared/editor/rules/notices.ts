import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type Token from "markdown-it/lib/token.mjs";
import customFence from "markdown-it-container";

/**
 * Every MyST admonition directive. Sphinx gives them each their own colour, but
 * they all describe the same thing — a block set apart from the prose — so they
 * map onto the four notice styles Outline has.
 */
export const MYST_ADMONITIONS = [
  "admonition",
  "attention",
  "caution",
  "danger",
  "error",
  "hint",
  "important",
  "note",
  "seealso",
  "tip",
  "warning",
];

/** Outline's own notice names, as written by the `:::style` syntax. */
const OUTLINE_NOTICE_STYLES = ["info", "success", "tip", "warning"];

/** A MyST option line, e.g. `:class: danger`. */
const OPTION_LINE = /^:[A-Za-z0-9_-]+:(?:\s|$)/;

/**
 * Block tokens a notice node has nowhere to put.
 *
 * `container_notice`'s content expression allows lists, blockquotes, rules,
 * paragraphs, headings, code and attachments — and nothing else. Turning a fence
 * into a notice when the body holds one of these does not fail loudly: the node
 * cannot be built, and the entire block is dropped from the document. A real
 * `::::{admonition}` wrapping a `:::{figure-md}` lost its prose, its image and
 * its caption that way.
 *
 * So a fence carrying any of them is left alone. It renders as an inert code
 * block rather than a callout, which is the same bargain every directive Outline
 * has no node for already makes, and nothing is lost.
 */
const UNCONTAINABLE_BLOCKS = [
  "table_open",
  "math_block",
  "container_notice_open",
  "container_toggle_open",
];

export type NoticeDirective = {
  /** The directive name, without braces, e.g. "important". */
  directive: string;
  /** The directive's argument, which MyST renders as the block's title. */
  title: string;
  /**
   * Whether the name was written in braces. `:::{warning}` is the MyST
   * directive and must be given back under that name; `:::warning` is Outline's
   * own style name, which happens to collide with one, and is written back as
   * whatever MyST directive that style maps to.
   */
  braced: boolean;
};

/**
 * Read a fence's info string as a notice directive.
 *
 * @param info - the fence token's info string.
 * @param options.allowBare - accept `note` as well as `{note}`. Colon fences
 * are written both ways, but a backtick fence whose info string is `error` is
 * far more likely to open a code block of error output than an admonition, so
 * there the braces are required.
 * @returns the directive and its title, or undefined if it names no notice.
 */
export function parseNoticeInfo(
  info: string,
  { allowBare }: { allowBare: boolean }
): NoticeDirective | undefined {
  const trimmed = info.trim();
  const braced = /^\{([A-Za-z0-9_-]+)\}\s*(.*)$/.exec(trimmed);
  const match =
    braced ?? (allowBare ? /^([A-Za-z0-9_-]+)\s*(.*)$/.exec(trimmed) : null);
  if (!match) {
    return undefined;
  }

  const directive = match[1].toLowerCase();
  if (
    !MYST_ADMONITIONS.includes(directive) &&
    !OUTLINE_NOTICE_STYLES.includes(directive)
  ) {
    return undefined;
  }

  return { directive, title: match[2].trim(), braced: braced !== null };
}

/**
 * Rewrite MyST-style directive fences (```{note} ... ```) into the same
 * container_notice tokens the `:::style` container syntax produces below, so
 * notices round-trip through markdown import even though they are now
 * serialized with backtick fences.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
function mystNoticeFences(md: MarkdownIt): void {
  md.core.ruler.after("block", "notice-myst-fence", (state) => {
    const tokens = state.tokens;

    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      if (
        token.type !== "fence" ||
        !parseNoticeInfo(token.info, { allowBare: false })
      ) {
        continue;
      }

      const contentTokens: Token[] = [];
      state.md.block.parse(token.content, state.md, state.env, contentTokens);

      if (contentTokens.some((t) => UNCONTAINABLE_BLOCKS.includes(t.type))) {
        continue;
      }

      const openToken = new state.Token("container_notice_open", "div", 1);
      openToken.info = token.info;
      openToken.block = true;
      openToken.map = token.map;

      const closeToken = new state.Token("container_notice_close", "div", -1);
      closeToken.block = true;

      tokens.splice(i, 1, openToken, ...contentTokens, closeToken);
    }

    return false;
  });
}

/**
 * Lift a notice's MyST option lines off its body and onto the opening token.
 *
 * `:class: danger` is directive metadata, not prose. Left in the body it shows
 * up as a stray line of text and, worse, comes back escaped as `\:class:` once
 * the body has been through the editor — the serializer has to escape a leading
 * colon so it is not read back as a fence. Carrying the options as an attribute
 * keeps them out of sight and gives them back unchanged.
 *
 * Only a run of option lines forming a paragraph of its own is lifted, which is
 * how MyST is written in practice. A paragraph mixing options into prose is
 * left alone rather than guessed at.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
function noticeOptions(md: MarkdownIt): void {
  md.core.ruler.after("notice-myst-fence", "notice-options", (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "container_notice_open") {
        continue;
      }
      if (
        tokens[i + 1]?.type !== "paragraph_open" ||
        tokens[i + 2]?.type !== "inline" ||
        tokens[i + 3]?.type !== "paragraph_close"
      ) {
        continue;
      }

      const lines = tokens[i + 2].content.split("\n");
      if (!lines.every((line) => OPTION_LINE.test(line))) {
        continue;
      }

      tokens[i].meta = { ...tokens[i].meta, options: lines.join("\n") };
      tokens.splice(i + 1, 3);

      // A notice must hold at least one block. When the options were the whole
      // body, leave an empty paragraph behind rather than nothing: an empty
      // notice is filled in by ProseMirror with the first node its content
      // expression allows, which is a checkbox list, and the document grows a
      // phantom `- [ ]` on every save.
      if (tokens[i + 1]?.type === "container_notice_close") {
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

// A `:::` run shorter than this is not a fence at all, matching both
// markdown-it-container's own threshold and MyST's backtick fences.
const MIN_COLON_MARKERS = 3;
const COLON_MARKER_CODE = ":".charCodeAt(0);

/**
 * Give a colon-fenced directive Outline has no node for the same byte-exact
 * survival a backtick fence already gets, instead of letting
 * `markdown-it-container` claim it as a notice.
 *
 * `markdown-it-container` (registered as `container_notice` below) decides
 * from the info string alone, before there is any content to look at — every
 * `:::` fence becomes a notice attempt regardless of directive name. For a
 * real admonition that is exactly right. For anything else — `:::{glossary}`,
 * `::::{ifconfig} Class == 'A'` wrapping a table, `:::{grid} 2` — the body is
 * something a notice cannot hold, so the block comes back mangled into a
 * stray `{note}` or, worse, is dropped from the document entirely.
 *
 * Registered immediately before `container_notice`, this rule reads the same
 * info string first. A recognized admonition is left alone — returning
 * `false` hands the line straight to `container_notice`, unchanged from
 * today. Anything else is read as one opaque block, the same bargain the
 * backtick path already makes for a directive Outline has no node for: the
 * fence survives as an inert `code_fence`, complete with the original marker
 * character and run length, so it renders as a grey code block and writes
 * itself back out exactly as written.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
function unclaimedColonFence(md: MarkdownIt): void {
  md.block.ruler.before(
    "container_notice",
    "colon-fence-passthrough",
    (
      state: StateBlock,
      startLine: number,
      endLine: number,
      silent: boolean
    ): boolean => {
      let pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];

      if (state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      if (state.src.charCodeAt(pos) !== COLON_MARKER_CODE) {
        return false;
      }

      const openStart = pos;
      pos = state.skipChars(pos, COLON_MARKER_CODE);
      const markerLength = pos - openStart;
      if (markerLength < MIN_COLON_MARKERS) {
        return false;
      }

      const markup = state.src.slice(openStart, pos);
      const params = state.src.slice(pos, max);
      if (parseNoticeInfo(params, { allowBare: true })) {
        return false;
      }

      if (silent) {
        return true;
      }

      let nextLine = startLine;
      let haveEndMarker = false;
      for (;;) {
        nextLine++;
        if (nextLine >= endLine) {
          // Unclosed at end of document or of the enclosing block; auto-close.
          break;
        }

        let closePos = state.bMarks[nextLine] + state.tShift[nextLine];
        const closeMax = state.eMarks[nextLine];

        if (closePos < closeMax && state.sCount[nextLine] < state.blkIndent) {
          break;
        }
        if (state.src.charCodeAt(closePos) !== COLON_MARKER_CODE) {
          continue;
        }
        if (state.sCount[nextLine] - state.blkIndent >= 4) {
          continue;
        }

        const closeStart = closePos;
        closePos = state.skipChars(closePos, COLON_MARKER_CODE);
        // A closing fence must be at least as long as the one that opened it.
        if (closePos - closeStart < markerLength) {
          continue;
        }
        closePos = state.skipSpaces(closePos);
        if (closePos < closeMax) {
          continue;
        }

        haveEndMarker = true;
        break;
      }

      const indent = state.sCount[startLine];
      state.line = nextLine + (haveEndMarker ? 1 : 0);

      // Reuses the "fence" token type CodeFence already parses backtick and
      // tilde fences from, so it needs no separate wiring into the parser.
      const token = state.push("fence", "code", 0);
      token.info = params;
      token.content = state.getLines(startLine + 1, nextLine, indent, true);
      token.markup = markup;
      token.map = [startLine, state.line];

      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] }
  );
}

export default function notice(md: MarkdownIt): void {
  customFence(md, "notice", {
    marker: ":",
    validate: () => true,
    render(tokens: Token[], idx: number) {
      const { info } = tokens[idx];

      if (tokens[idx].nesting === 1) {
        // opening tag
        return `<div class="notice notice-${md.utils.escapeHtml(info)}">\n`;
      } else {
        // closing tag
        return "</div>\n";
      }
    },
  });

  // Must run after customFence above: it inserts itself immediately before
  // the "container_notice" rule that call registers.
  unclaimedColonFence(md);

  mystNoticeFences(md);
  noticeOptions(md);
}
