import type { NodeSpec } from "prosemirror-model";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { moveIntoDefinitionBody } from "../commands/definitionList";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Node from "./Node";

/**
 * A single term in a `definition_list` — the unindented line a
 * `definition_body` is written under. Single line, inline content only, the
 * same content model a heading uses.
 *
 * Only ever produced by `shared/editor/rules/deflist.ts`, as one half of a
 * `(definition_term definition_body)` pair — never on its own, so this has
 * no `parseDOM`/import path of its own beyond what `DefinitionList` already
 * wires up. `toMarkdown` here exists for structural completeness (e.g.
 * copying just a term); `DefinitionList.toMarkdown` does not call it, since
 * the blank-line-free transition into the term's own body needs finer
 * control than one node calling another through the generic renderer gives.
 */
export default class DefinitionTerm extends Node {
  get name() {
    return "definition_term";
  }

  get schema(): NodeSpec {
    return {
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [{ tag: `dt.${EditorStyleHelper.definitionTerm}` }],
      toDOM: () => ["dt", { class: EditorStyleHelper.definitionTerm }, 0],
    };
  }

  keys(): Record<string, Command> {
    return {
      Enter: moveIntoDefinitionBody,
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.renderInline(node);
    state.closeBlock(node);
  }

  parseMarkdown() {
    return { block: "definition_term" };
  }
}
