import type Token from "markdown-it/lib/token.mjs";
import { SettingsIcon } from "outline-icons";
import type { NodeSpec, Node as ProsemirrorNode } from "prosemirror-model";
import { DEFAULT_FENCE_LENGTH, requiredFenceLength } from "../lib/fenceLength";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import directivesRule, { parseDirectiveInfo } from "../rules/directives";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import type { ComponentProps } from "../types";
import Node from "./Node";

/**
 * A MyST directive Outline gives a real, structured node to instead of the
 * inert `CodeFence` every other directive falls back to — `{ifconfig}`,
 * `{grid}`, `{grid-item}` and `{margin}` today (see `DIRECTIVE_ALLOWLIST` in
 * `shared/editor/rules/directives.ts`).
 *
 * Unlike `Notice`, which always writes itself back with a backtick fence
 * regardless of how it arrived, this preserves whichever character it
 * arrived with (`fenceChar`) — matching the byte-exact promise the inert
 * `CodeFence` fallback already makes for these same directive names, since
 * real content uses both forms (`{margin}` is backtick-fenced throughout
 * `Functional_architecture.md`; `{ifconfig}`/`{grid}` are colon-fenced
 * everywhere else seen).
 *
 * The label (directive name + argument) is read-only in this first pass —
 * `CodeFence` already has a `Decoration.widget` mechanism for editing a
 * preserved directive's own info string in place; wiring the same mechanism
 * onto this node is a natural, separate follow-up rather than part of this
 * node's initial landing.
 */
export default class Directive extends Node {
  get name() {
    return "container_directive";
  }

  get rulePlugins() {
    return [directivesRule];
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        // Which directive this arrived as, e.g. "ifconfig". Never empty in
        // practice — this node is only ever produced by parsing one of the
        // allowlisted names — the default exists only to satisfy the attr
        // spec.
        directive: {
          default: "",
        },
        // The directive's argument, e.g. "Class == 'A'" or "2". Empty for
        // grid-item and most margins.
        argument: {
          default: "",
        },
        // The character this directive was fenced with — ":" or "`" — kept
        // so it round-trips as written rather than being normalized.
        fenceChar: {
          default: ":",
        },
        fenceLength: {
          default: 3,
        },
        // Option lines this rule does not otherwise understand (e.g.
        // ":gutter: 0"), kept verbatim. Metadata rather than prose, so not
        // shown.
        options: {
          default: "",
        },
      },
      content:
        "(list | blockquote | hr | paragraph | heading | code_block | code_fence | attachment | figure | table | container_notice | container_directive)+",
      group: "block",
      defining: true,
      draggable: true,
      parseDOM: [
        {
          tag: `div.${EditorStyleHelper.directiveBlock}`,
          preserveWhitespace: "full",
          contentElement: (node: HTMLDivElement) =>
            node.querySelector(`div.${EditorStyleHelper.directiveContent}`) ||
            node,
          getAttrs: (dom: HTMLDivElement) => ({
            directive: dom.dataset.directive || "",
            argument: dom.dataset.argument || "",
            fenceChar: dom.dataset.fenceChar || ":",
            fenceLength: dom.dataset.fenceLength
              ? Number(dom.dataset.fenceLength)
              : 3,
            options: dom.dataset.options || "",
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: EditorStyleHelper.directiveBlock,
          "data-directive": node.attrs.directive,
          ...(node.attrs.argument
            ? { "data-argument": node.attrs.argument }
            : {}),
          ...(node.attrs.fenceChar !== ":"
            ? { "data-fence-char": node.attrs.fenceChar }
            : {}),
          ...(node.attrs.fenceLength !== 3
            ? { "data-fence-length": String(node.attrs.fenceLength) }
            : {}),
          ...(node.attrs.options ? { "data-options": node.attrs.options } : {}),
        },
        [
          "div",
          { class: EditorStyleHelper.directiveLabel, contentEditable: "false" },
          `${node.attrs.directive}${node.attrs.argument ? ` ${node.attrs.argument}` : ""}`,
        ],
        ["div", { class: EditorStyleHelper.directiveContent }, 0],
      ],
    };
  }

  component = (props: ComponentProps) => {
    const { node } = props;
    const label = `${node.attrs.directive}${
      node.attrs.argument ? ` ${node.attrs.argument}` : ""
    }`;

    return (
      <div className={EditorStyleHelper.directiveBlock}>
        <div
          className={EditorStyleHelper.directiveLabel}
          contentEditable={false}
        >
          <SettingsIcon size={14} />
          <span>{label}</span>
        </div>
        <div
          className={EditorStyleHelper.directiveContent}
          ref={props.contentRef}
        />
      </div>
    );
  };

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    const fenceChar: string = node.attrs.fenceChar || ":";
    // The stored length is a floor, not the answer on its own: a directive
    // originally wrapped wider than it strictly needed to be (matching an
    // inner fence's nesting depth, say) round-trips at that same width
    // instead of shrinking — the same convention `CodeFence` already uses.
    const fenceLength = Math.max(
      node.attrs.fenceLength || DEFAULT_FENCE_LENGTH,
      requiredFenceLength(node, fenceChar)
    );
    const fence = fenceChar.repeat(fenceLength);
    const argument = node.attrs.argument ? ` ${node.attrs.argument}` : "";

    // See the identical comment in `Notice.toMarkdown`: `write` only applies
    // the current list-item indentation once, at the start of the string
    // it's given, so the fence line has to start its own fresh `write` call
    // rather than share one with a leading "\n" — otherwise a directive
    // nested in a list item silently loses its indentation, and its place in
    // the list, on save.
    state.ensureNewLine();
    state.write(`${fence}{${node.attrs.directive}}${argument}\n`);
    if (node.attrs.options) {
      // MyST wants a blank line between the option block and the body,
      // matching Notice's own convention for the same thing.
      state.write(`${node.attrs.options}\n\n`);
    }
    state.renderContent(node);
    state.ensureNewLine();
    state.write(fence);
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      block: "container_directive",
      getAttrs: (tok: Token) => {
        const parsed = parseDirectiveInfo(tok.info ?? "", { allowBare: true });
        return {
          directive: parsed?.directive ?? "",
          argument: parsed?.argument ?? "",
          fenceChar: tok.markup?.[0] || ":",
          fenceLength: tok.markup?.length || 3,
          options: tok.meta?.options ?? "",
        };
      },
    };
  }
}
