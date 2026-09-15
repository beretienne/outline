import type { NodeSpec } from "prosemirror-model";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { splitDefinitionEntry } from "../commands/definitionList";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Node from "./Node";

/**
 * A single term's definition in a `definition_list` — the content indented
 * under a `definition_term`. The content model is as broad as `Directive`'s
 * own: real entries in the QCAM5 install manual's glossary nest a full
 * `{grid}` > `{grid-item}` > `{figure-md}` tree ("Detection field") and an
 * `{ifconfig}` wrapping a table ("Model approval parameter"), not just
 * prose — a narrower model would only make those specific entries fall back
 * to the opaque fence `shared/editor/rules/deflist.ts` uses when a body
 * doesn't fit, rather than that fallback firing only for genuinely
 * malformed content.
 *
 * Only ever produced by `deflist.ts`, as one half of a `(definition_term
 * definition_body)` pair — see the identical note on `DefinitionTerm`.
 */
export default class DefinitionBody extends Node {
  get name() {
    return "definition_body";
  }

  get schema(): NodeSpec {
    return {
      content:
        "(list | blockquote | hr | paragraph | heading | code_block | code_fence | attachment | figure | table | container_notice | container_directive)+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: `dd.${EditorStyleHelper.definitionBody}` }],
      toDOM: () => ["dd", { class: EditorStyleHelper.definitionBody }, 0],
    };
  }

  keys(): Record<string, Command> {
    return {
      Enter: splitDefinitionEntry,
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.renderContent(node);
  }

  parseMarkdown() {
    return { block: "definition_body" };
  }
}
