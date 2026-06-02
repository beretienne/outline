import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import customFence from "markdown-it-container";

const MYST_DIRECTIVES = ["note", "tip", "caution", "seealso"];

/**
 * Recognize a MyST directive fence's info string, e.g. "{note}" or "note", as
 * produced by Notice's markdown serializer.
 *
 * @param info - the fence token's info string.
 * @returns the bare directive name, or undefined if it does not name a
 * recognized notice directive.
 */
export function mystDirectiveName(info: string): string | undefined {
  const name = info.trim().replace(/^\{(.+)\}$/, "$1");
  return MYST_DIRECTIVES.includes(name) ? name : undefined;
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
      const directive = token.type === "fence" && mystDirectiveName(token.info);
      if (!directive) {
        continue;
      }

      const openToken = new state.Token("container_notice_open", "div", 1);
      openToken.info = directive;
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
}
