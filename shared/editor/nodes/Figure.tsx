import type Token from "markdown-it/lib/token.mjs";
import type { NodeSpec, Node as ProsemirrorNode } from "prosemirror-model";
import figuresRule from "../rules/figures";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import Node from "./Node";

/** The two MyST figure directives this node round-trips. */
type FigureDirective = "figure" | "figure-md";

/**
 * A captioned image that arrived as a MyST `{figure}` or `{figure-md}`
 * directive.
 *
 * Only a lone image with, at most, a plain-text caption is represented this
 * way — see `shared/editor/rules/figures.ts` for exactly which bodies are
 * claimed. Anything else keeps rendering as the inert code fence it always
 * has; nothing about this node changes that fallback.
 *
 * The image itself is an ordinary `image` node and keeps every feature that
 * comes with — resizing, alignment, the caption field already used to edit
 * `alt` on any other image. This node only remembers which directive it
 * arrived as, its cross-reference label, and any option lines it did not
 * otherwise understand, so a save writes the same directive back out.
 */
export default class Figure extends Node {
  get name() {
    return "figure";
  }

  get rulePlugins() {
    return [figuresRule];
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        // Which directive this arrived as. A Figure node is only ever
        // produced by parsing one of the two, so this is never null in
        // practice — the default exists only to satisfy the attr spec.
        directive: {
          default: "figure-md",
        },
        // figure-md's argument: a Sphinx cross-reference label. Empty for
        // figure, whose argument is the image target — already the child
        // image's own `src`.
        label: {
          default: "",
        },
        // figure's own option lines this rule does not otherwise understand
        // (anything but `:width:`), kept verbatim. Metadata rather than
        // prose, so not shown.
        options: {
          default: "",
        },
      },
      content: "image",
      group: "block",
      defining: true,
      draggable: true,
      parseDOM: [
        {
          tag: "figure[data-directive]",
          getAttrs: (dom: HTMLElement) => ({
            directive: dom.dataset.directive || "figure-md",
            label: dom.dataset.label || "",
            options: dom.dataset.options || "",
          }),
        },
      ],
      toDOM: (node) => [
        "figure",
        {
          "data-directive": node.attrs.directive,
          ...(node.attrs.label ? { "data-label": node.attrs.label } : {}),
          ...(node.attrs.options ? { "data-options": node.attrs.options } : {}),
        },
        0,
      ],
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    const image = node.firstChild;
    const directive: FigureDirective = node.attrs.directive;
    const argument: string =
      directive === "figure-md" ? node.attrs.label : image?.attrs.src || "";

    state.write(`\n\`\`\`{${directive}}${argument ? ` ${argument}` : ""}\n`);

    if (directive === "figure-md") {
      const attrParts: string[] = [];
      if (image?.attrs.width) {
        attrParts.push(`width=${image.attrs.width}`);
      }
      // Only a real left/right override round-trips as `align=`; Outline's
      // own default (no `layoutClass` override) is already what a MyST
      // reader sees for `align=center` too, so there is nothing to write
      // back for it — see `ALIGN_TO_LAYOUT_CLASS` in `rules/figures.ts` for
      // the read side of this same asymmetry. `full-width`, an Outline-only
      // layout with no `align` equivalent, is likewise left unwritten.
      if (image?.attrs.layoutClass === "left-50") {
        attrParts.push("align=left");
      } else if (image?.attrs.layoutClass === "right-50") {
        attrParts.push("align=right");
      }
      const attrs = attrParts.length ? `{${attrParts.join(" ")}}` : "";
      state.write(`![](${state.esc(image?.attrs.src || "", false)})${attrs}`);
      state.closeBlock(node);
    } else {
      const optionLines: string[] = [];
      if (image?.attrs.width) {
        optionLines.push(`:width: ${image.attrs.width}`);
      }
      if (node.attrs.options) {
        optionLines.push(node.attrs.options);
      }
      if (optionLines.length > 0) {
        state.write(optionLines.join("\n"));
        state.closeBlock(node);
      }
    }

    if (image?.attrs.alt) {
      state.text(image.attrs.alt, true);
      state.closeBlock(node);
    }

    state.ensureNewLine();
    state.write("```");
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      block: "figure",
      getAttrs: (tok: Token) => ({
        directive: tok.meta?.directive || "figure-md",
        label: tok.meta?.directive === "figure-md" ? tok.meta.argument : "",
        options: tok.meta?.options || "",
      }),
    };
  }
}
