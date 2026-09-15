import type { NodeSpec } from "prosemirror-model";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import deflistRule from "../rules/deflist";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Node from "./Node";

/** Every definition's body is indented by this many spaces under its term —
 * fixed, not computed, matching the convention every real file already
 * uses. There is no fence-length-style collision to avoid here (a
 * definition list has no fence at all), just a term/body split to keep
 * legible on the page. */
const BODY_INDENT = "   ";

/**
 * A `{glossary}`'s own content — an RST/docutils-style definition list:
 * `Term\n   Definition text`, an unindented term line immediately followed
 * (no blank line permitted between them) by one or more indented lines. Not
 * MyST's own top-level `deflist` extension, which uses a `:`/`~` marker
 * instead — verified against the real content, and against docutils' own
 * spec, that a Sphinx `glossary` directive's body is this indentation-only
 * form.
 *
 * Content is a flat, interleaved `(definition_term definition_body)+`
 * sequence — siblings, not each pair wrapped in its own "entry" node —
 * matching how HTML's own `<dl><dt>…</dt><dd>…</dd></dl>` already shapes
 * this, which `toDOM` mirrors directly.
 *
 * Only ever produced by `shared/editor/rules/deflist.ts`'s
 * `tryBuildDefinitionList`, all-or-nothing per `{glossary}` block — the same
 * bar every other directive-body parser in this codebase holds itself to
 * (`Figure`, `Directive`'s own `guardDirectiveContent`): if any entry
 * doesn't fit, none of it becomes a `definition_list`, and the whole block
 * stays the opaque, byte-exact `CodeFence` it already is today.
 */
export default class DefinitionList extends Node {
  get name() {
    return "definition_list";
  }

  get rulePlugins() {
    return [deflistRule];
  }

  get schema(): NodeSpec {
    return {
      content: "(definition_term definition_body)+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: `dl.${EditorStyleHelper.definitionList}` }],
      toDOM: () => ["dl", { class: EditorStyleHelper.definitionList }, 0],
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    const children: ProsemirrorNode[] = [];
    node.forEach((child) => children.push(child));

    for (let i = 0; i < children.length; i += 2) {
      const term = children[i];
      const body = children[i + 1];

      // A plain `write()` (no content) flushes whatever the *previous*
      // entry's body left pending — the standard blank-line separation
      // between sibling blocks, exactly the gap real files put between
      // entries. Nothing is pending before the very first entry, so this
      // is a no-op there.
      state.write("");
      state.renderInline(term);
      // Deliberately not `state.closeBlock(term)` here: closing would mark
      // a pending gap that the very next `write()` — the body's own, inside
      // `wrapBlock` below — would flush as a blank line, which is exactly
      // what docutils' own rule forbids between a term and its definition.
      state.write("\n");
      state.wrapBlock(BODY_INDENT, null, body, () => state.renderContent(body));
    }

    state.closeBlock(node);
  }

  parseMarkdown() {
    return { block: "definition_list" };
  }
}
