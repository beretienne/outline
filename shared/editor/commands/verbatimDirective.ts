import type { NodeType } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { Primitive } from "utility-types";

/**
 * Insert a directive whose body is kept verbatim — `{raw}`, `{eval-rst}`,
 * `{tabularcolumns}`, a custom one — as a directive block holding one empty
 * plain-text code block, with the cursor in it. It replaces the paragraph
 * the cursor is in when that paragraph is empty, the way the block menu
 * leaves it, and goes after it otherwise.
 *
 * @param type - the `container_directive` node type.
 * @param attrs - the directive's attributes: `directive` and `argument`.
 * @returns the command.
 */
export function insertVerbatimDirective(
  type: NodeType,
  attrs: Record<string, Primitive>
): Command {
  return (state, dispatch) => {
    const codeType = state.schema.nodes.code_block;
    const { $from } = state.selection;
    if (!codeType || $from.depth < 1 || !$from.parent.isTextblock) {
      return false;
    }

    const containerDepth = $from.depth - 1;
    const container = $from.node(containerDepth);
    const index = $from.index(containerDepth);
    const replace = $from.parent.content.size === 0;
    if (
      !container.canReplaceWith(replace ? index : index + 1, index + 1, type)
    ) {
      return false;
    }

    const directive = type.create(attrs, codeType.create({ language: "none" }));
    const tr = state.tr;
    const insertPos = replace ? $from.before() : $from.after();
    if (replace) {
      tr.replaceWith(insertPos, $from.after(), directive);
    } else {
      tr.insert(insertPos, directive);
    }
    // +1 enters the directive, +1 the code block.
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
