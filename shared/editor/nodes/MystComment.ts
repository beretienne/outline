import { t } from "i18next";
import type Token from "markdown-it/lib/token.mjs";
import { exitCode } from "prosemirror-commands";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import type { NodeSpec, NodeType } from "prosemirror-model";
import { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import {
  commentOutSelection,
  type MarkdownRoundTrip,
  uncommentSelection,
} from "../commands/mystComment";
import { selectAll } from "../commands/selectAll";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import commentsRule, { type CommentLineMeta } from "../rules/comments";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Node from "./Node";

/**
 * Enter inside a MyST comment line starts the next comment line — one node
 * per line, as in the source, written back with no blank line between them.
 * Enter on an empty comment line leaves the comment: the line becomes an
 * ordinary paragraph.
 *
 * @param type - the `myst_comment` node type.
 * @returns the command.
 */
function commentEnter(type: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if ($from.parent.type !== type || !$from.sameParent($to)) {
      return false;
    }

    if ($from.parent.content.size === 0) {
      dispatch?.(
        state.tr
          .setBlockType($from.pos, $from.pos, state.schema.nodes.paragraph)
          .scrollIntoView()
      );
      return true;
    }

    const tr = state.tr.deleteSelection();
    tr.split(tr.mapping.map($from.pos), 1, [
      {
        type,
        attrs: {
          tight: true,
          spaced: $from.parent.attrs.spaced,
          indent: $from.parent.attrs.indent,
        },
      },
    ]);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * A MyST `%` line comment — nothing of it is published. Shown as a greyed-out
 * line rather than hidden, so it stays visible and editable; one node per
 * source line, so each line can be taken out of the comment on its own.
 *
 * Holds the line's content as it was before `%` was put in front of it —
 * indentation and Markdown included — which is exactly what comes back when
 * it is un-commented. `spaced` records whether the marker was `% ` rather
 * than `%`, and `tight` whether the line directly followed another comment
 * line; with both, an untouched comment writes back byte for byte.
 *
 * A `code: true` textblock, like `CodeFence`: plain text, no marks, and
 * ProseMirror's input rules and the slash menu stay off inside it.
 */
export default class MystComment extends Node {
  get name() {
    return "myst_comment";
  }

  get rulePlugins() {
    return [commentsRule];
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        tight: { default: false, validate: "boolean" },
        // Defaults to false: a node stored before this attribute existed
        // holds its text with the marker's space still in it, and writes
        // back exactly as it was read only with a bare `%` marker.
        spaced: { default: false, validate: "boolean" },
        // Spaces before the `%` itself — `  %text` is still a comment line.
        indent: { default: 0, validate: "number" },
      },
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      draggable: true,
      parseDOM: [
        {
          tag: `div.${EditorStyleHelper.mystComment}`,
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLDivElement) => ({
            tight: dom.dataset.tight === "true",
            spaced: dom.dataset.spaced === "true",
            indent: Number(dom.dataset.indent) || 0,
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: EditorStyleHelper.mystComment,
          "data-tight": String(node.attrs.tight),
          "data-spaced": String(node.attrs.spaced),
          "data-indent": String(node.attrs.indent),
          title: t("MyST comment (not published)"),
        },
        0,
      ],
    };
  }

  /**
   * The editor's own Markdown parser and serializer, which commenting and
   * un-commenting work through. Undefined outside a mounted editor.
   */
  get roundTrip(): MarkdownRoundTrip | undefined {
    const editor = this.editor;
    if (!editor?.parser || !editor.serializer) {
      return undefined;
    }
    return { parser: editor.parser, serializer: editor.serializer };
  }

  commands({ type }: { type: NodeType }) {
    return {
      myst_comment: (): Command => (state, dispatch) =>
        this.apply(this.commentOut(state, type), dispatch),
    };
  }

  inputRules({ type }: { type: NodeType }) {
    return [
      textblockTypeInputRule(/^%\s$/, type, { tight: false, spaced: true }),
    ];
  }

  keys({ type }: { type: NodeType }): Record<string, Command> {
    const enter = commentEnter(type);
    return {
      Enter: enter,
      "Shift-Enter": enter,
      "Mod-Enter": exitCode,
      Backspace: (state, dispatch) => {
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type !== type || $from.parentOffset > 0) {
          return false;
        }
        return this.apply(this.uncomment(state, type), dispatch);
      },
      "Mod-/": (state, dispatch) =>
        this.apply(
          state.selection.$from.parent.type === type
            ? this.uncomment(state, type)
            : this.commentOut(state, type),
          dispatch
        ),
      "Mod-a": selectAll(type),
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    // A line that directly followed another comment line in the source is
    // written back that way, without the blank line every other pair of
    // blocks gets — `renderList`'s own tight-list technique.
    const previous: unknown = state.closed;
    if (
      node.attrs.tight &&
      previous instanceof ProsemirrorNode &&
      previous.type === node.type
    ) {
      state.flushClose(1);
    }
    state.ensureNewLine();
    const indent = " ".repeat(Math.max(0, Math.min(3, node.attrs.indent)));
    const marker = node.attrs.spaced ? "% " : "%";
    const lines = node.textContent
      .split("\n")
      .map((line) =>
        line === "" ? `${indent}%` : `${indent}${marker}${line}`
      );
    state.text(lines.join("\n"), false);
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      block: "myst_comment",
      getAttrs: (tok: Token) => {
        const meta: Partial<CommentLineMeta> = tok.meta ?? {};
        return {
          tight: meta.tight ?? false,
          spaced: meta.spaced ?? false,
          indent: meta.indent ?? 0,
        };
      },
    };
  }

  /**
   * Take the comment out of the selected comment lines. An empty comment
   * line simply becomes an empty paragraph.
   *
   * @param state - the editor state.
   * @param type - the `myst_comment` node type.
   * @returns the transaction, or undefined.
   */
  private uncomment(
    state: EditorState,
    type: NodeType
  ): Transaction | undefined {
    const { $from, empty } = state.selection;
    if (
      empty &&
      $from.parent.type === type &&
      $from.parent.content.size === 0
    ) {
      return state.tr.setBlockType(
        $from.pos,
        $from.pos,
        state.schema.nodes.paragraph
      );
    }
    const roundTrip = this.roundTrip;
    return roundTrip ? uncommentSelection(state, type, roundTrip) : undefined;
  }

  /**
   * Comment out the selected lines. Without a mounted editor, only an empty
   * line can be turned into a comment line.
   *
   * @param state - the editor state.
   * @param type - the `myst_comment` node type.
   * @returns the transaction, or undefined.
   */
  private commentOut(
    state: EditorState,
    type: NodeType
  ): Transaction | undefined {
    const roundTrip = this.roundTrip;
    if (roundTrip) {
      return commentOutSelection(state, type, roundTrip);
    }
    const { $from, empty } = state.selection;
    if (empty && $from.parent.isTextblock && $from.parent.content.size === 0) {
      return state.tr.setBlockType($from.pos, $from.pos, type, {
        tight: false,
        spaced: true,
      });
    }
    return undefined;
  }

  /**
   * Dispatch a transaction if there is one.
   *
   * @param tr - the transaction, or undefined when the command declined.
   * @param dispatch - the command's dispatch function.
   * @returns whether the command applied.
   */
  private apply(
    tr: Transaction | undefined,
    dispatch?: (tr: Transaction) => void
  ): boolean {
    if (!tr) {
      return false;
    }
    dispatch?.(tr);
    return true;
  }
}
