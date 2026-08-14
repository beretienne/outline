import type MarkdownIt from "markdown-it";
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

      const openToken = new state.Token("container_notice_open", "div", 1);
      openToken.info = token.info;
      openToken.block = true;
      openToken.map = token.map;

      const closeToken = new state.Token("container_notice_close", "div", -1);
      closeToken.block = true;

      const contentTokens: Token[] = [];
      state.md.block.parse(token.content, state.md, state.env, contentTokens);

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

  mystNoticeFences(md);
  noticeOptions(md);
}
