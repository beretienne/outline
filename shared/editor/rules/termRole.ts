import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

const OPEN = "{term}`";

/**
 * Markdown-it plugin for MyST's `{term}` role — `` {term}`display text` `` —
 * a reference to a `{glossary}` entry.
 *
 * Has to run before markdown-it's own "backticks" rule: left alone, that
 * rule claims the backtick span as inline code and leaves `{term}` behind
 * as literal text, which only *looks* preserved because the two happen to
 * reassemble into the same string on the way back out.
 *
 * Open and close are both found in one forward scan, so unlike `==mark==`
 * (`./mark.ts`) this needs no delimiter pass. Only the simple form is
 * recognised — a single-backtick span on one line. Sphinx's
 * `` {term}`Display <target>` `` split is kept as-is inside the text, not
 * interpreted; real content seen so far never uses it.
 *
 * @param md - the markdown-it instance to extend.
 */
export default function termRoleRule(md: MarkdownIt) {
  function tokenize(state: StateInline, silent: boolean) {
    const start = state.pos;
    if (!state.src.startsWith(OPEN, start)) {
      return false;
    }

    const contentStart = start + OPEN.length;
    const end = state.src.indexOf("`", contentStart);
    if (end === -1 || end === contentStart || end >= state.posMax) {
      return false;
    }

    const content = state.src.slice(contentStart, end);
    if (content.includes("\n")) {
      return false;
    }

    if (!silent) {
      state.push("term_reference_open", "span", 1);
      const text = state.push("text", "", 0);
      text.content = content;
      state.push("term_reference_close", "span", -1);
    }

    state.pos = end + 1;
    return true;
  }

  md.inline.ruler.before("backticks", "term_role", tokenize);
}
