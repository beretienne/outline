import type { MarkSpec } from "prosemirror-model";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Mark from "./Mark";

/**
 * The mark MyST's `{term}` role used to get — `` {term}`display text` ``, a
 * reference to a `{glossary}` entry — before it became an ordinary
 * `myst_role` named `term` (see `MystRole`).
 *
 * Kept only so documents stored with it still load and write back the same
 * `{term}` role: nothing creates it any more. Parsing a document's Markdown
 * again (e.g. `outline-sync push --force-reparse`) turns each one into the
 * role, which also brings the role's editing behaviour.
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
      toDOM: () => ["span", { class: EditorStyleHelper.termReference }],
    };
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
