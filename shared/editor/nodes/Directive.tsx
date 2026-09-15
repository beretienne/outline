import type Token from "markdown-it/lib/token.mjs";
import { SettingsIcon } from "outline-icons";
import type { NodeSpec, Node as ProsemirrorNode } from "prosemirror-model";
import type { FocusEvent, KeyboardEvent } from "react";
import { TextSelection } from "prosemirror-state";
import { DEFAULT_FENCE_LENGTH, requiredFenceLength } from "../lib/fenceLength";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import directivesRule, { parseDirectiveInfo } from "../rules/directives";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import type { ComponentProps } from "../types";
import Node from "./Node";

/**
 * The label text a directive's name and argument are shown and edited as,
 * e.g. `{grid} 2` or `{margin}` — always braced, regardless of whether the
 * directive itself arrived on a colon or backtick fence (that distinction
 * lives in `fenceChar`, not here).
 *
 * @param directive - the directive name, e.g. "grid".
 * @param argument - the directive's argument, e.g. "2". May be empty.
 * @returns the braced label text.
 */
function formatDirectiveLabel(directive: string, argument: string): string {
  return `{${directive}}${argument ? ` ${argument}` : ""}`;
}

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
 * The label (directive name + argument) is editable in place — the same
 * `contentEditable` isolation pattern `Notice`'s own title uses, reused
 * directly rather than `CodeFence`'s `Decoration.widget` mechanism, since
 * this node already has a React `component` `CodeFence` does not.
 *
 * Only the *shape* is validated on commit — braced, and naming a directive
 * still on `DIRECTIVE_ALLOWLIST` (anything else has nowhere left to be
 * written back to on the next save, silently downgrading to a plain
 * `CodeFence` the next time the document is parsed from markdown, not
 * visibly on the spot). The argument itself — `2` in `{grid} 2`, a
 * condition in `{ifconfig} Class == 'A'` — is free text: what it means, or
 * whether it makes sense for whatever consumes this directive outside
 * Outline, is left entirely to whoever is editing it.
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
      // `paragraph` is listed first deliberately: when an edit (e.g.
      // deleting all of a directive's content) leaves this node needing
      // ProseMirror to synthesize a default child from scratch, it walks
      // this expression's alternatives in order and takes the first one
      // that's trivially createable — with `list` first, that resolved to
      // an empty checkbox item (`- [ ]`) instead of an empty paragraph, a
      // real, user-visible bug found live (deleting a whole `{glossary}`
      // entry left one behind). Order here only affects that default;
      // every one of these types remains equally allowed as actual
      // content regardless of position.
      content:
        "(paragraph | list | blockquote | hr | heading | code_block | code_fence | attachment | figure | table | container_notice | container_directive | definition_list)+",
      group: "block",
      defining: true,
      // Stops Backspace/Delete from crossing this node's own boundary to
      // join it with a neighbour — found live: two adjacent directives
      // (e.g. two `{glossary}` blocks, or an `{ifconfig}` right after a
      // `{grid}`) merged into one the moment a blank line between them was
      // deleted, silently discarding the second one's own name and
      // argument. ProseMirror's default join/lift behaviour has no notion
      // of "this block is a self-contained unit" on its own; `isolating`
      // is exactly that. A directive/notice that has already been emptied
      // out is still deletable — see `deleteEmptyWrapper` in
      // `commands/preventDirectiveMerge.ts`, and selecting the whole node
      // (its drag handle) and deleting still removes it outright either
      // way, unaffected by this flag.
      isolating: true,
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
          formatDirectiveLabel(node.attrs.directive, node.attrs.argument),
        ],
        ["div", { class: EditorStyleHelper.directiveContent }, 0],
      ],
    };
  }

  /**
   * Parks ProseMirror's own selection inside this directive the moment the
   * label is about to receive focus — see the identical, live-debugged
   * reasoning on `Notice.handleTitleMouseDown`. There is no document
   * position inside the label itself for ProseMirror to land on, and this
   * never calls `view.focus()`, so native click handling still moves actual
   * DOM focus into the field right after.
   */
  handleLabelMouseDown =
    ({ getPos, view }: ComponentProps) =>
    () => {
      const $pos = view.state.doc.resolve(getPos() + 1);
      view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
    };

  /**
   * Every key is stopped here, the same way and for the same reason as
   * `Notice.handleTitleKeyDown`: the label sits inside ProseMirror's own
   * contentEditable region but is not part of its document model, so an
   * unstopped Backspace or similar bubbles up to ProseMirror's keymap and
   * acts on a stale selection instead of the field's own visible cursor.
   * Enter additionally moves the cursor into this directive's own body.
   */
  handleLabelKeyDown =
    ({ getPos, view }: ComponentProps) =>
    (event: KeyboardEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      const $pos = view.state.doc.resolve(getPos() + 1);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView()
      );
      view.focus();
    };

  /**
   * Commits an edited label on blur — but only a syntactically valid one.
   * `parseDirectiveInfo` requires braces and an allowlisted name; anything
   * else (a typo in the braces, a name this node can no longer represent)
   * is rejected outright and the field snaps back to the last good value,
   * rather than writing an attribute combination this node cannot itself
   * write back out to matching markdown on the next save. The argument
   * half of a valid edit is never second-guessed — see the class doc.
   */
  handleLabelBlur =
    ({ node, getPos, view }: ComponentProps) =>
    (event: FocusEvent<HTMLDivElement>) => {
      const typed = event.currentTarget.innerText.trim();
      const currentLabel = formatDirectiveLabel(
        node.attrs.directive,
        node.attrs.argument
      );
      if (typed === currentLabel) {
        return;
      }

      // Braces are required here, matching what's actually displayed
      // (`formatDirectiveLabel` always shows them) — unlike the parser's own
      // `allowBare: true`, which additionally accepts a bare directive name
      // because that is how a *source* colon fence is legitimately written,
      // not because that is what this field ever shows.
      const parsed = parseDirectiveInfo(typed, { allowBare: false });
      if (!parsed) {
        event.currentTarget.innerText = currentLabel;
        event.currentTarget.classList.add(
          EditorStyleHelper.directiveLabelInvalid
        );
        window.setTimeout(() => {
          event.currentTarget?.classList.remove(
            EditorStyleHelper.directiveLabelInvalid
          );
        }, 600);
        return;
      }

      const newLabel = formatDirectiveLabel(parsed.directive, parsed.argument);
      if (newLabel !== typed) {
        event.currentTarget.innerText = newLabel;
      }
      view.dispatch(
        view.state.tr.setNodeMarkup(getPos(), undefined, {
          ...node.attrs,
          directive: parsed.directive,
          argument: parsed.argument,
        })
      );
    };

  component = (props: ComponentProps) => {
    const { node } = props;
    const label = formatDirectiveLabel(
      node.attrs.directive,
      node.attrs.argument
    );

    return (
      <div className={EditorStyleHelper.directiveBlock}>
        <div
          className={EditorStyleHelper.directiveLabelRow}
          contentEditable={false}
        >
          <SettingsIcon size={14} />
          {/* See the identical structure and reasoning on `Notice`'s own
              title: the outer `contentEditable={false}` — this whole row —
              is what actually isolates the label from ProseMirror's
              editable root; nesting `true` directly inside it, with nothing
              else, is not an event boundary on its own. The icon stays a
              plain sibling outside the editable field itself, the same way
              Notice keeps its own icon out of the title field. */}
          <div
            className={EditorStyleHelper.directiveLabel}
            contentEditable={props.isEditable}
            suppressContentEditableWarning
            onMouseDown={this.handleLabelMouseDown(props)}
            onBlur={this.handleLabelBlur(props)}
            onKeyDown={this.handleLabelKeyDown(props)}
          >
            {label}
          </div>
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

    // See the identical comment in `Notice.toMarkdown`: `write` only applies
    // the current list-item indentation once, at the start of the string
    // it's given, so the fence line has to start its own fresh `write` call
    // rather than share one with a leading "\n" — otherwise a directive
    // nested in a list item silently loses its indentation, and its place in
    // the list, on save.
    state.ensureNewLine();
    state.write(
      `${fence}${formatDirectiveLabel(node.attrs.directive, node.attrs.argument)}\n`
    );
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
