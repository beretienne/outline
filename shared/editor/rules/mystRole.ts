import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/** A role name, as MyST reads it: `{name}` directly before the backticks. */
const ROLE_NAME = /^\{([a-zA-Z0-9_\-+:]+)\}/;

/**
 * Whether a string is a role name MyST would read — letters, digits and
 * `_ - + :` only, at least one character.
 *
 * @param name - the candidate name, without braces.
 * @returns true if MyST would read it as a role name.
 */
export function isValidRoleName(name: string): boolean {
  return /^[a-zA-Z0-9_\-+:]+$/.test(name);
}

/** Roles with a dedicated mark and rule of their own, left to those. */
const DEDICATED_ROLES = new Set(["term"]);

const BACKSLASH = 0x5c;
const BACKTICK = 0x60;

/**
 * Markdown-it plugin for MyST roles Outline has no dedicated mark for —
 * `` {dot}`1` ``, `` {ref}`text <label>` ``, `` {abbr}`…` `` and so on —
 * a port of `mdit_py_plugins.myst_role`: a role name in braces, then a run
 * of backticks, then the content up to the next run of the same length.
 *
 * Runs before markdown-it's own "backticks" rule for the same reason as
 * `./termRole.ts`: left to it, the backtick span becomes inline code with
 * `{name}` stranded in front of it as literal text. It only ever looks at
 * a `{` in running text: braces inside an inline code span
 * (`` `GET /items/{id}` ``) are already consumed by then and never reach
 * this rule.
 *
 * One deliberate deviation: a role whose content spans a line break is
 * left alone. MyST joins the lines with a space, which could not be written
 * back as it was read; left as text, the source survives untouched.
 *
 * @param md - the markdown-it instance to extend.
 */
export default function mystRoleRule(md: MarkdownIt) {
  function tokenize(state: StateInline, silent: boolean) {
    const start = state.pos;
    const match = ROLE_NAME.exec(state.src.slice(start, state.posMax));
    if (!match) {
      return false;
    }

    const name = match[1];
    if (DEDICATED_ROLES.has(name)) {
      return false;
    }
    if (start > 0 && state.src.charCodeAt(start - 1) === BACKSLASH) {
      return false;
    }

    let pos = start + match[0].length;
    const ticksStart = pos;
    while (pos < state.posMax && state.src.charCodeAt(pos) === BACKTICK) {
      pos++;
    }
    const ticks = pos - ticksStart;
    if (!ticks) {
      return false;
    }

    // As in MyST: the content is at least one character, so the search for
    // the closing run starts one past the opening one.
    const end = state.src.indexOf("`".repeat(ticks), pos + 1);
    if (end === -1 || end + ticks > state.posMax) {
      return false;
    }

    const content = state.src.slice(pos, end);
    if (content.includes("\n")) {
      return false;
    }

    if (!silent) {
      const open = state.push("myst_role_open", "span", 1);
      open.meta = { name };
      const text = state.push("text", "", 0);
      text.content = content;
      state.push("myst_role_close", "span", -1);
    }

    state.pos = end + ticks;
    return true;
  }

  md.inline.ruler.before("backticks", "myst_role", tokenize);
}
