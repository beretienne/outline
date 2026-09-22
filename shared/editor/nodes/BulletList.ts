import type Token from "markdown-it/lib/token.mjs";
import type {
  Schema,
  NodeType,
  NodeSpec,
  Node as ProsemirrorModel,
} from "prosemirror-model";
import toggleList from "../commands/toggleList";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { listWrappingInputRule } from "../lib/listInputRule";
import Node from "./Node";

/** The characters Markdown accepts as a bullet list marker. */
const BULLETS = ["*", "-", "+"];

/**
 * A marker character, or the default one when `value` is not a marker.
 *
 * @param value - the candidate marker.
 * @returns a valid marker.
 */
function toBullet(value: unknown): string {
  return typeof value === "string" && BULLETS.includes(value) ? value : "*";
}

export default class BulletList extends Node {
  get name() {
    return "bullet_list";
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        // The marker the list was written with — `-`, `*` or `+` — so a
        // list written with `-` in the source is written back with `-`. Not
        // just cosmetic: CommonMark starts a new list when the marker
        // changes, so two adjacent lists written with different markers
        // would merge if both were written back with the same one. The
        // spacing after the marker is: always written as one space.
        bullet: { default: "*", validate: "string" },
      },
      content: "list_item+",
      group: "block list",
      parseDOM: [
        {
          tag: "ul",
          getAttrs: (dom: HTMLElement) => ({
            bullet: toBullet(dom.dataset.bullet),
          }),
        },
      ],
      toDOM: (node) => [
        "ul",
        node.attrs.bullet !== "*" ? { "data-bullet": node.attrs.bullet } : {},
        0,
      ],
    };
  }

  commands({ type, schema }: { type: NodeType; schema: Schema }) {
    return () => toggleList(type, schema.nodes.list_item);
  }

  keys({ type, schema }: { type: NodeType; schema: Schema }) {
    return {
      "Shift-Ctrl-8": toggleList(type, schema.nodes.list_item),
    };
  }

  inputRules({ type }: { type: NodeType }) {
    return [
      listWrappingInputRule(/^\s*([-+*])\s$/, type, (match) => ({
        bullet: toBullet(match[1]),
      })),
    ];
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorModel) {
    const marker = `${toBullet(node.attrs.bullet)} `;
    state.renderList(node, "  ", () => marker);
  }

  parseMarkdown() {
    return {
      block: "bullet_list",
      getAttrs: (tok: Token) => ({ bullet: toBullet(tok.markup) }),
    };
  }
}
