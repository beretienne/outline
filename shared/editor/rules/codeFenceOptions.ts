import type MarkdownIt from "markdown-it";
import { DIRECTIVE_INFO } from "../nodes/CodeFence";
import { OPTION_LINE } from "./notices";

/**
 * Lift a leading run of MyST option lines off the body of a directive
 * Outline has no node for, the same way `notices.ts`'s own `noticeOptions`
 * already does for a claimed admonition.
 *
 * Registered last in the core ruler (`push`), so this only ever sees a
 * `fence` token neither `notices.ts` nor `figures.ts` already claimed and
 * transformed away — a real admonition or a `{figure}`/`{figure-md}` never
 * reaches here. Anything still carrying a `{directive}`-shaped info string
 * at this point is one Outline preserves verbatim as an inert code block,
 * and its option lines — `:class: danger`, say — are metadata rather than
 * prose: left in the body they show up as a stray line of text, kept here
 * instead so a future editing surface has somewhere structured to read and
 * write them, without disturbing the body Outline still treats as opaque.
 *
 * Only a run of option lines forming a paragraph of its own, right after the
 * opening fence, is lifted — the same restraint `noticeOptions` applies, so
 * a paragraph that merely mixes in something `:like: this:` is left alone
 * rather than guessed at.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
export default function codeFenceOptions(md: MarkdownIt): void {
  md.core.ruler.push("code-fence-options", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "fence" || !DIRECTIVE_INFO.test(token.info.trim())) {
        continue;
      }

      const body = token.content;
      const blankLine = body.match(/\n[ \t]*\n/);
      const firstParagraph = blankLine
        ? body.slice(0, blankLine.index)
        : body.replace(/\n$/, "");
      const lines = firstParagraph.split("\n");

      if (
        firstParagraph.trim() === "" ||
        !lines.every((line) => OPTION_LINE.test(line))
      ) {
        continue;
      }

      token.meta = { ...token.meta, options: lines.join("\n") };
      token.content = blankLine
        ? body.slice(blankLine.index! + blankLine[0].length)
        : "";
    }

    return false;
  });
}
