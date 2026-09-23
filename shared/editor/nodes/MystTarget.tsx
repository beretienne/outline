import { t } from "i18next";
import { setBlockType } from "prosemirror-commands";
import type {
  NodeSpec,
  NodeType,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { targets as targetsRule } from "../rules/comments";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Node from "./Node";

/**
 * A MyST `(label)=` cross-reference target — a standalone line assigning a
 * label to whatever block follows it, for `{ref}`/`{numref}` elsewhere in
 * the document to point at. Nothing is rendered for it in Sphinx.
 *
 * The label is the node's real, plain-text content — not a decorative
 * attribute — so ordinary typing, cursor movement and Backspace all work
 * for free, the same way `MystComment` holds its own line. The `(` and `)=`
 * either side are drawn by CSS around the content, never part of it, so
 * they can't be typed over or left partly deleted.
 *
 * A `code: true` textblock, like `CodeFence` and `MystComment`: plain text,
 * no marks, and ProseMirror's own input rules and the slash menu stay off
 * inside it.
 */
export default class MystTarget extends Node {
  get name() {
    return "myst_target";
  }

  get rulePlugins() {
    return [targetsRule];
  }

  get schema(): NodeSpec {
    return {
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      draggable: true,
      parseDOM: [
        {
          tag: `div.${EditorStyleHelper.mystTarget}`,
          preserveWhitespace: "full",
        },
      ],
      toDOM: () => [
        "div",
        {
          class: EditorStyleHelper.mystTarget,
          title: t("Cross-reference target (not shown in the published page)"),
        },
        0,
      ],
    };
  }

  commands({ type }: { type: NodeType }) {
    // The slash menu always leaves an empty paragraph at the insertion
    // point (see `Directive`'s own commands for the same convention);
    // converting its type in place, rather than inserting a fresh node,
    // keeps the cursor exactly where it already is — already inside the
    // new target, ready to type the label with no extra click needed.
    return (): Command => setBlockType(type);
  }

  get plugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // An empty target shows only CSS-generated text ("(label)="),
            // which the browser can't resolve a click to — it lands the
            // caret in the next block instead. Put it inside the target,
            // between the parentheses, explicitly. A filled target has
            // real text to click on and is left to the default handling.
            mousedown: (view, event) => {
              const { target } = event;
              if (
                !(target instanceof HTMLElement) ||
                !target.classList.contains(EditorStyleHelper.mystTarget)
              ) {
                return false;
              }
              const pos = view.posAtDOM(target, 0);
              const $pos = view.state.doc.resolve(pos);
              if (
                $pos.parent.type.name !== this.name ||
                $pos.parent.content.size > 0
              ) {
                return false;
              }
              event.preventDefault();
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, pos)
                )
              );
              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  }

  /**
   * A target is always exactly one source line — Enter starts a new
   * paragraph after it instead of splitting it into two target lines,
   * which `(part-one)=`/`(part-two)=` would round-trip as nonsense.
   *
   * @param type - the `myst_target` node type.
   * @returns the keymap.
   */
  keys({ type }: { type: NodeType }): Record<string, Command> {
    return {
      Enter: (state, dispatch) => {
        const { $from } = state.selection;
        if ($from.parent.type !== type) {
          return false;
        }
        const pos = $from.after();
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(pos, paragraph);
        dispatch?.(
          tr
            .setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
            .scrollIntoView()
        );
        return true;
      },
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    // An empty target — inserted and never filled in, or its label deleted
    // — would be written as "()=", which MyST doesn't read as a target, so
    // it would come back as a paragraph of literal text. Write nothing.
    if (!node.textContent) {
      return;
    }
    // `ensureNewLine` plus a separate `write` call, not a leading "\n"
    // packed into the same string — see the identical fix and comment on
    // `HorizontalRule.toMarkdown`.
    state.ensureNewLine();
    state.write(`(${node.textContent})=`);
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      block: "myst_target",
    };
  }
}
