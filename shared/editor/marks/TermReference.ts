import { InputRule } from "prosemirror-inputrules";
import type { MarkSpec, MarkType } from "prosemirror-model";
import termRoleRule from "../rules/termRole";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Mark from "./Mark";

/**
 * MyST's `{term}` role — `` {term}`display text` `` — a reference to a
 * `{glossary}` entry.
 *
 * Visual distinction only, deliberately: no click handler, no `href`, no
 * resolving the text against the document's own definition lists. Its job
 * is to show a writer that this span is a glossary reference, and to write
 * it back exactly as it arrived.
 *
 * Excludes every formatting mark: a role's content is literal text to
 * Sphinx, so bold or a link inside it would serialize to markup the role
 * swallows whole. Comments stay allowed. Written unescaped (`escape: false`
 * below), the same bargain `Code` makes.
 */
export default class TermReference extends Mark {
  get name() {
    return "term_reference";
  }

  get schema(): MarkSpec {
    return {
      excludes:
        "term_reference strong em underline strikethrough highlight code_inline link placeholder",
      // Typing at the end of a reference continues as ordinary text.
      inclusive: false,
      parseDOM: [{ tag: `span.${EditorStyleHelper.termReference}` }],
      toDOM: () => ["span", { class: EditorStyleHelper.termReference }],
    };
  }

  get rulePlugins() {
    return [termRoleRule];
  }

  /**
   * Typing the closing backtick of `` {term}`text` `` turns the span into a
   * reference. Registered ahead of `Code` (see `nodes/index.ts`), whose own
   * backtick rule matches the same keystroke and would otherwise win.
   */
  inputRules({ type }: { type: MarkType }) {
    return [
      new InputRule(/\{term\}`([^`\n]+)`$/, (state, match, start, end) => {
        const text = match[1];
        return state.tr
          .replaceWith(start, end, state.schema.text(text, [type.create()]))
          .removeStoredMark(type);
      }),
    ];
  }

  toMarkdown() {
    return {
      open: "{term}`",
      close: "`",
      mixable: false,
      escape: false,
    };
  }

  parseMarkdown() {
    return { mark: "term_reference" };
  }
}
