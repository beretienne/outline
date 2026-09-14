import copy from "copy-to-clipboard";
import { t } from "i18next";
import type Token from "markdown-it/lib/token.mjs";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import type {
  NodeSpec,
  NodeType,
  Schema,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Primitive } from "utility-types";
import type { UserPreferences } from "../../types";
import { isBrowser, isMac } from "../../utils/browser";
import backspaceToParagraph from "../commands/backspaceToParagraph";
import {
  newlineInCode,
  indentInCode,
  moveToNextNewline,
  moveToPreviousNewline,
  outdentInCode,
  enterInCode,
  splitCodeBlockOnTripleBackticks,
} from "../commands/codeFence";
import { selectAll } from "../commands/selectAll";
import toggleBlockType from "../commands/toggleBlockType";
import { CodeHighlighting } from "../plugins/CodeHighlightingPlugin";
import Mermaid, {
  pluginKey as mermaidPluginKey,
  type MermaidState,
} from "../extensions/Mermaid";
import {
  codeLanguages,
  getRecentlyUsedCodeLanguage,
  setRecentlyUsedCodeLanguage,
} from "../lib/code";
import { isCode, isMermaid } from "../lib/isCode";
import { isRemoteTransaction, mapDecorations } from "../lib/multiplayer";
import { findBlockNodes } from "../queries/findChildren";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { escapeRawTableCell } from "../lib/markdown/tableCell";
import { findNextNewline, findPreviousNewline } from "../queries/findNewlines";
import {
  findParentNode,
  findParentNodeClosestToPos,
} from "../queries/findParentNode";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import { getMarkRange } from "../queries/getMarkRange";
import { isInCode } from "../queries/isInCode";
import codeFenceOptionsRule from "../rules/codeFenceOptions";
import Node from "./Node";

const DEFAULT_LANGUAGE = "javascript";

/** Fraction of the viewport height above which a code block is collapsible. */
const COLLAPSE_HEIGHT_RATIO = 0.5;

/** Approximate rendered line height of a code block, in pixels. */
const CODE_LINE_HEIGHT = 20;

const collapseKey = new PluginKey<CollapseState>("collapse-code-block");

/** A MyST directive at the start of an info string, e.g. `{figure}`. */
export const DIRECTIVE_INFO = /^\{[A-Za-z0-9_-]+\}/;

/**
 * Reduce a language attribute or fence info string to a single safe token, so
 * it cannot break the fence line when written back to markdown.
 *
 * A MyST directive is the one info string whose argument matters: in
 * `{figure} media/photo.png` the path is the point, and cutting the string at
 * the first space would lose it on every round-trip. Such a string is kept
 * whole; only a newline could break the fence line, so whitespace runs are
 * collapsed to a single space instead.
 *
 * @param language - the language attribute or fence info string.
 * @returns the first whitespace-separated token with backticks removed, or the
 * whole string with whitespace collapsed when it opens a MyST directive.
 */
function sanitizeLanguage(language: string | null | undefined): string {
  const safe = String(language ?? "")
    .replace(/`/g, "")
    .trim();

  if (DIRECTIVE_INFO.test(safe)) {
    return safe.replace(/\s+/g, " ");
  }

  return safe.split(/\s/)[0];
}

/**
 * The longest run of a single character in a string.
 *
 * @param text - the text to scan.
 * @param char - the single character to count runs of.
 * @returns the length of the longest consecutive run of `char` in `text`, or
 * 0 if it does not occur.
 */
export function longestRun(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const ch of text) {
    current = ch === char ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * Build the editable field that shows a preserved directive's fence info
 * string, e.g. `{ifconfig} Class == 'A'`.
 *
 * A plain, uncontrolled `<input>`: its value is only read from the node on
 * creation and only written back to it on commit, never kept in sync on
 * every keystroke, so nothing re-renders — and nothing can steal focus —
 * while a person is still typing. This is a stable, module-level function
 * reference rather than a closure created fresh per render, which is what
 * lets ProseMirror recognize the same widget across unrelated document
 * changes elsewhere (a collaborator typing, say) and reuse its DOM node
 * instead of replacing it and losing focus.
 *
 * @param view - the editor view this widget is being rendered into.
 * @param getPos - resolves this widget's current document position; provided
 * by ProseMirror and kept accurate across transactions.
 * @returns the input element.
 */
function buildDirectiveLabelWidget(
  view: EditorView,
  getPos: () => number | undefined
): HTMLElement {
  const nodeAtPos = () => {
    const pos = getPos();
    return pos === undefined ? undefined : view.state.doc.nodeAt(pos);
  };

  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.className = EditorStyleHelper.codeBlockDirectiveLabel;
  input.value = nodeAtPos()?.attrs.language ?? "";
  input.readOnly = !view.editable;

  const commit = () => {
    const pos = getPos();
    const node = nodeAtPos();
    if (pos === undefined || !node || input.value === node.attrs.language) {
      return;
    }
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: input.value,
      })
    );
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = nodeAtPos()?.attrs.language ?? "";
      input.blur();
    }
  });

  return input;
}

/**
 * Shows the editable field built by `buildDirectiveLabelWidget` above every
 * code block whose language opens a MyST directive — `{ifconfig}`,
 * `{glossary}`, any name Outline has no node for — and none other. An
 * ordinary code block, its language picked from the toolbar, never gets
 * this decoration at all.
 *
 * Scoped to one schema node type name rather than `isCode()`'s "either
 * code_fence or code_block" on purpose: `CodeBlock extends CodeFence` and
 * inherits `get plugins()` unchanged, so this plugin is built once per
 * extension instance — once for "code_fence", once for "code_block" — and
 * an unscoped version would have both copies walk the whole document and
 * decorate the very same node twice over, one input stacked on another.
 * Matching only the caller's own node type keeps the two instances disjoint.
 *
 * @param nodeName - the schema node type name this instance owns —
 * `this.name` from whichever of CodeFence or CodeBlock is building it.
 * @returns the plugin.
 */
function directiveLabelPlugin(nodeName: string): Plugin {
  return new Plugin({
    key: new PluginKey(`code-fence-directive-label-${nodeName}`),
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== nodeName) {
            return true;
          }
          if (DIRECTIVE_INFO.test(node.attrs.language || "")) {
            decorations.push(
              Decoration.widget(pos, buildDirectiveLabelWidget, {
                side: -1,
                key: `directive-label-${pos}`,
                stopEvent: () => true,
              })
            );
          }
          return false;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

interface CollapseState {
  /** Positions of code blocks taller than COLLAPSE_HEIGHT_RATIO of the viewport. */
  tallBlocks: Set<number>;
  /** Positions of code blocks currently collapsed by the user or auto-collapse. */
  collapsedBlocks: Set<number>;
  /** Node decorations that add the `collapsed` CSS class. */
  decorations: DecorationSet;
}

/**
 * Expand the collapsed code block that contains a document position.
 *
 * @param pos - the document position inside the code block.
 * @returns a command that expands the code block when it is collapsed.
 */
export function expandCodeBlockAt(pos: number): Command {
  return (state, dispatch) => {
    const $pos = state.doc.resolve(pos);
    const codeBlock = findParentNodeClosestToPos($pos, isCode);
    if (!codeBlock) {
      return false;
    }

    const collapseState = collapseKey.getState(state);
    if (!collapseState?.collapsedBlocks.has(codeBlock.pos)) {
      return false;
    }

    dispatch?.(
      state.tr
        .setMeta(collapseKey, { expand: codeBlock.pos })
        .setMeta("addToHistory", false)
    );
    return true;
  };
}

/**
 * Find all code block positions whose estimated height exceeds
 * COLLAPSE_HEIGHT_RATIO of the viewport height.
 *
 * @param doc - the document to scan.
 * @returns set of positions of tall code blocks.
 */
function findTallBlocks(doc: ProsemirrorNode): Set<number> {
  const tall = new Set<number>();
  if (!isBrowser) {
    return tall;
  }
  const maxLines =
    (window.innerHeight * COLLAPSE_HEIGHT_RATIO) / CODE_LINE_HEIGHT;
  for (const block of findBlockNodes(doc, true)) {
    if (isCode(block.node)) {
      const lines = (block.node.textContent.match(/\n/g)?.length ?? 0) + 1;
      if (lines > maxLines) {
        tall.add(block.pos);
      }
    }
  }
  return tall;
}

/**
 * Build a CollapseState with node decorations for the collapsed class and
 * widget decorations for toggle buttons on all tall blocks.
 */
function buildCollapseState(
  doc: ProsemirrorNode,
  tallBlocks: Set<number>,
  collapsedBlocks: Set<number>,
  expandLabel: string,
  collapseLabel: string
): CollapseState {
  const decorations: Decoration[] = [];
  for (const pos of tallBlocks) {
    const node = doc.nodeAt(pos);
    if (!node || !isCode(node)) {
      continue;
    }

    const isCollapsed = collapsedBlocks.has(pos);

    if (isCollapsed) {
      const totalLines = (node.textContent.match(/\n/g)?.length ?? 0) + 1;
      const gutterWidth = String(totalLines).length;
      const lineNumberText = Array.from({ length: totalLines }, (_, i) =>
        String(i + 1).padStart(gutterWidth, " ")
      ).join("\n");

      decorations.push(
        Decoration.node(
          pos,
          pos + node.nodeSize,
          { class: "collapsed", "data-line-numbers": lineNumberText },
          { collapsed: true }
        )
      );
    }

    const label = isCollapsed ? expandLabel : collapseLabel;
    decorations.push(
      Decoration.widget(
        pos + node.nodeSize,
        () => {
          const button = document.createElement("button");
          button.className = EditorStyleHelper.codeBlockToggle;
          button.contentEditable = "false";
          button.type = "button";
          button.textContent = label;
          return button;
        },
        { side: 1, key: `toggle-${pos}-${isCollapsed}` }
      )
    );
  }
  return {
    tallBlocks,
    collapsedBlocks,
    decorations: DecorationSet.create(doc, decorations),
  };
}

/**
 * Options for the CodeFence node.
 */
type CodeFenceOptions = {
  /** Display preferences for the logged in user, if any. */
  userPreferences?: UserPreferences | null;
};

export default class CodeFence extends Node<CodeFenceOptions> {
  get showLineNumbers(): boolean {
    return this.options.userPreferences?.codeBlockLineNumbers ?? true;
  }

  get name() {
    return "code_fence";
  }

  get rulePlugins() {
    return [codeFenceOptionsRule];
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        language: {
          default: DEFAULT_LANGUAGE,
          // Null is permitted as existing documents can contain code blocks
          // written before a language was always recorded.
          validate: "string|null",
        },
        wrap: {
          default: false,
          validate: "boolean",
        },
        // The character the fence this block arrived on was written with.
        // Only ` (backtick), ~ (tilde) and : (colon, a MyST directive Outline
        // has no node for) are ever produced by the parser; anything typed in
        // the editor is always backtick. Kept so a colon-fenced directive
        // writes itself back out on colons instead of being flattened onto
        // backticks, which would collide with a code fence in its own body.
        fenceChar: {
          default: "`",
          validate: "string",
        },
        // The run length of that character. A directive wrapping its own
        // nested fence needs a longer outer marker to parse at all — MyST
        // authors already write it that way — so the original length is kept
        // as a floor rather than always recomputed from scratch.
        fenceLength: {
          default: 3,
          validate: "number",
        },
        // A directive Outline has no node for keeps its own MyST option
        // lines here, verbatim — `:class: danger`, say — lifted off the body
        // so they read as metadata rather than a stray line of prose.
        // Not shown yet; kept for a future editing surface to use.
        options: {
          default: "",
          validate: "string",
        },
      },
      content: "text*",
      marks: "comment",
      group: "block",
      code: true,
      defining: true,
      draggable: false,
      parseDOM: [
        {
          tag: `.${EditorStyleHelper.codeBlock}`,
          preserveWhitespace: "full",
          contentElement: (node: HTMLElement) =>
            node.querySelector("code") || node,
          getAttrs: (dom: HTMLDivElement) => ({
            language: dom.dataset.language,
            wrap: dom.classList.contains("with-line-wrap"),
            fenceChar: dom.dataset.fenceChar || "`",
            fenceLength: dom.dataset.fenceLength
              ? Number(dom.dataset.fenceLength)
              : 3,
          }),
        },
        {
          tag: "code",
          preserveWhitespace: "full",
          getAttrs: (dom) => {
            // Only parse code blocks that contain newlines for code fences,
            // otherwise the code mark rule will be applied.
            if (!dom.textContent?.includes("\n")) {
              return false;
            }
            return { language: dom.dataset.language };
          },
        },
      ],
      toDOM: (node) => {
        const classes = [
          EditorStyleHelper.codeBlock,
          node.attrs.wrap
            ? "with-line-wrap"
            : this.showLineNumbers
              ? "with-line-numbers"
              : "",
        ]
          .filter(Boolean)
          .join(" ");

        return [
          "div",
          {
            class: classes,
            "data-language": node.attrs.language,
            ...(node.attrs.fenceChar !== "`"
              ? { "data-fence-char": node.attrs.fenceChar }
              : {}),
            ...(node.attrs.fenceLength !== 3
              ? { "data-fence-length": String(node.attrs.fenceLength) }
              : {}),
          },
          ["pre", ["code", { spellCheck: "false" }, 0]],
        ];
      },
    };
  }

  commands({ type, schema }: { type: NodeType; schema: Schema }) {
    return {
      code_block: (attrs: Record<string, Primitive>) => {
        if (attrs?.language) {
          setRecentlyUsedCodeLanguage(attrs.language as string);
        }
        return toggleBlockType(type, schema.nodes.paragraph, {
          language: getRecentlyUsedCodeLanguage() ?? DEFAULT_LANGUAGE,
          ...attrs,
        });
      },
      expandCodeBlockAt: (pos: number) => expandCodeBlockAt(pos),
      toggleCodeBlockCollapse: (): Command => (state, dispatch) => {
        const codeBlock = findParentNode(isCode)(state.selection);
        if (!codeBlock) {
          return false;
        }

        if (dispatch) {
          dispatch(
            state.tr
              .setMeta(collapseKey, {
                toggle: codeBlock.pos,
              })
              .setMeta("addToHistory", false)
          );
        }
        return true;
      },
      toggleCodeBlockWrap: (): Command => (state, dispatch) => {
        const codeBlock = findParentNode(isCode)(state.selection);
        if (!codeBlock) {
          return false;
        }

        if (dispatch) {
          dispatch(
            state.tr.setNodeMarkup(codeBlock.pos, undefined, {
              ...codeBlock.node.attrs,
              wrap: !codeBlock.node.attrs.wrap,
            })
          );
        }
        return true;
      },
      edit_mermaid: (): Command => (state, dispatch) => {
        const codeBlock =
          state.selection instanceof NodeSelection &&
          isCode(state.selection.node)
            ? { pos: state.selection.from, node: state.selection.node }
            : findParentNode(isCode)(state.selection);
        if (!codeBlock || !isMermaid(codeBlock.node)) {
          return false;
        }

        const mermaidState = mermaidPluginKey.getState(state) as MermaidState;
        const decorations = mermaidState?.decorationSet.find(
          codeBlock.pos,
          codeBlock.pos + codeBlock.node.nodeSize
        );
        const nodeDecoration = decorations?.find(
          (d) => d.spec.diagramId && d.from === codeBlock.pos
        );
        const diagramId = nodeDecoration?.spec.diagramId;

        if (dispatch && diagramId) {
          dispatch(
            state.tr
              .setMeta(mermaidPluginKey, {
                editingId:
                  mermaidState?.editingId === diagramId ? undefined : diagramId,
              })
              .setSelection(TextSelection.create(state.doc, codeBlock.pos + 1))
              .scrollIntoView()
          );
        }
        return true;
      },
      copyToClipboard: (): Command => (state, dispatch) => {
        const codeBlock = findParentNode(isCode)(state.selection);

        if (codeBlock) {
          copy(codeBlock.node.textContent);
          this.editor.props.onNotice?.(t("Copied to clipboard"));
          return true;
        }

        const { doc, tr } = state;
        const range =
          getMarkRange(
            doc.resolve(state.selection.from),
            this.editor.schema.marks.code_inline
          ) ||
          getMarkRange(
            doc.resolve(state.selection.to),
            this.editor.schema.marks.code_inline
          );

        if (range) {
          const $end = doc.resolve(range.to);
          tr.setSelection(new TextSelection($end, $end));
          dispatch?.(tr);

          copy(tr.doc.textBetween(state.selection.from, state.selection.to));
          this.editor.props.onNotice?.(t("Copied to clipboard"));
          return true;
        }

        return false;
      },
    };
  }

  get allowInReadOnly() {
    return true;
  }

  keys({ type, schema }: { type: NodeType; schema: Schema }) {
    const output: Record<string, Command> = {
      // Both shortcuts work, but Shift-Ctrl-c matches the one in the menu
      "Shift-Ctrl-c": toggleBlockType(type, schema.nodes.paragraph),
      "Shift-Ctrl-\\": toggleBlockType(type, schema.nodes.paragraph),
      "Shift-Tab": outdentInCode,
      Tab: indentInCode,
      Enter: enterInCode,
      Backspace: backspaceToParagraph(type),
      "Shift-Enter": newlineInCode,
      "Mod-a": selectAll(type),
      "Mod-]": indentInCode,
      "Mod-[": outdentInCode,
    };

    if (isMac) {
      return {
        ...output,
        "Ctrl-a": moveToPreviousNewline,
        "Ctrl-e": moveToNextNewline,
      };
    }

    return output;
  }

  /** Plugins for collapsible code block behavior. */
  private collapsePlugins(): Plugin[] {
    const build = (
      doc: ProsemirrorNode,
      tall: Set<number>,
      collapsed: Set<number>
    ) => buildCollapseState(doc, tall, collapsed, t("Expand"), t("Collapse"));

    return [
      // Main collapse plugin: manages state and decorations
      new Plugin<CollapseState>({
        key: collapseKey,
        state: {
          init: (_config, state) => {
            const tallBlocks = findTallBlocks(state.doc);
            return build(state.doc, tallBlocks, new Set(tallBlocks));
          },
          apply: (tr, prev, oldState, newState) => {
            const meta = tr.getMeta(collapseKey);

            // Toggle collapsed state
            if (meta?.toggle !== undefined) {
              const next = new Set(prev.collapsedBlocks);
              if (next.has(meta.toggle)) {
                next.delete(meta.toggle);
              } else {
                next.add(meta.toggle);
              }
              return build(newState.doc, prev.tallBlocks, next);
            }

            // Expand a specific block (auto-expand on focus)
            if (meta?.expand !== undefined) {
              if (prev.collapsedBlocks.has(meta.expand)) {
                const next = new Set(prev.collapsedBlocks);
                next.delete(meta.expand);
                return build(newState.doc, prev.tallBlocks, next);
              }
              return prev;
            }

            // Recompute tall blocks on doc changes. Newly tall blocks are only
            // auto-collapsed when content arrives via load/remote sync — never
            // while the user is typing, which would collapse the block under
            // the cursor.
            if (tr.docChanged) {
              const tallBlocks = findTallBlocks(newState.doc);
              const collapsedBlocks = new Set<number>();
              const isRemote = isRemoteTransaction(tr, newState);
              const previousBlockDecorations: Decoration[] = [];
              for (const pos of prev.tallBlocks) {
                const node = oldState.doc.nodeAt(pos);
                if (!node || !isCode(node)) {
                  continue;
                }

                previousBlockDecorations.push(
                  Decoration.node(
                    pos,
                    pos + node.nodeSize,
                    {},
                    {
                      collapsed: prev.collapsedBlocks.has(pos),
                      trackedCodeBlock: true,
                    }
                  )
                );
              }

              const mappedTallBlocks = new Set<number>();
              const mappedCollapsedBlocks = new Set<number>();
              const previousBlocks = DecorationSet.create(
                oldState.doc,
                previousBlockDecorations
              );
              for (const decoration of mapDecorations(
                previousBlocks,
                tr,
                newState
              ).find()) {
                if (!decoration.spec.trackedCodeBlock) {
                  continue;
                }

                mappedTallBlocks.add(decoration.from);
                if (decoration.spec.collapsed) {
                  mappedCollapsedBlocks.add(decoration.from);
                }
              }

              for (const pos of tallBlocks) {
                if (isRemote && !mappedTallBlocks.has(pos)) {
                  // Newly tall blocks start collapsed on load
                  collapsedBlocks.add(pos);
                } else if (mappedCollapsedBlocks.has(pos)) {
                  // Preserve previous collapsed state
                  collapsedBlocks.add(pos);
                }
              }

              return build(newState.doc, tallBlocks, collapsedBlocks);
            }

            return prev;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
      // Click handler for toggle button + auto-expand on focus
      new Plugin({
        key: new PluginKey("collapse-toggle"),
        appendTransaction: (transactions, oldState, newState) => {
          const hasCollapseMeta = transactions.some((tr) =>
            tr.getMeta(collapseKey)
          );
          const hasSelectionSet = transactions.some((tr) => tr.selectionSet);
          if (hasCollapseMeta || !hasSelectionSet) {
            return null;
          }

          const codeBlock = findParentNode(isCode)(newState.selection);
          const collapseState = collapseKey.getState(newState);
          if (
            !codeBlock ||
            !collapseState?.collapsedBlocks.has(codeBlock.pos)
          ) {
            return null;
          }

          // Only auto-expand when the selection moved INTO the block. If the
          // selection was already inside this block (e.g. after the user just
          // clicked Collapse while the cursor was inside), don't re-expand.
          const oldCodeBlock = findParentNode(isCode)(oldState.selection);
          if (oldCodeBlock?.pos === codeBlock.pos) {
            return null;
          }

          return newState.tr
            .setMeta(collapseKey, { expand: codeBlock.pos })
            .setMeta("addToHistory", false);
        },
        props: {
          handleDOMEvents: {
            mousedown: (view: EditorView, event: MouseEvent) => {
              const target = event.target as HTMLElement;
              const button = target.closest(
                `.${EditorStyleHelper.codeBlockToggle}`
              );
              if (!button) {
                return false;
              }

              const codeBlockEl =
                button.previousElementSibling?.classList.contains(
                  EditorStyleHelper.codeBlock
                )
                  ? button.previousElementSibling
                  : null;
              if (!codeBlockEl) {
                return false;
              }

              const codeEl = codeBlockEl.querySelector("code");
              if (!codeEl) {
                return false;
              }

              const pos = view.posAtDOM(codeEl, 0);
              const $pos = view.state.doc.resolve(pos);
              const parent = findParentNodeClosestToPos($pos, isCode);
              if (!parent) {
                return false;
              }

              const collapseState = collapseKey.getState(view.state);
              const isCollapsing = !collapseState?.collapsedBlocks.has(
                parent.pos
              );

              view.dispatch(
                view.state.tr
                  .setMeta(collapseKey, { toggle: parent.pos })
                  .setMeta("addToHistory", false)
              );

              if (isCollapsing) {
                codeBlockEl.scrollIntoView({ block: "nearest" });
              }

              event.preventDefault();
              event.stopPropagation();
              return true;
            },
          },
        },
      }),
    ];
  }

  get plugins() {
    const createActiveCodeBlockDecoration = (state: EditorState) => {
      const codeBlock = findParentNode(isCode)(state.selection);
      if (!codeBlock) {
        return DecorationSet.empty;
      }

      if (isMermaid(codeBlock.node)) {
        const mermaidState = mermaidPluginKey.getState(state) as MermaidState;
        const decorations = mermaidState?.decorationSet.find(
          codeBlock.pos,
          codeBlock.pos + codeBlock.node.nodeSize
        );
        const nodeDecoration = decorations?.find(
          (d) => d.spec.diagramId && d.from === codeBlock.pos
        );
        const diagramId = nodeDecoration?.spec.diagramId;

        if (!diagramId || mermaidState?.editingId !== diagramId) {
          return DecorationSet.empty;
        }
      }

      const decoration = Decoration.node(
        codeBlock.pos,
        codeBlock.pos + codeBlock.node.nodeSize,
        { class: "code-active" }
      );
      return DecorationSet.create(state.doc, [decoration]);
    };

    return [
      CodeHighlighting({
        name: this.name,
        lineNumbers: this.showLineNumbers,
      }),
      this.name === "code_fence"
        ? Mermaid({
            isDark: this.editor.props.theme.isDark,
            editor: this.editor,
          })
        : undefined,
      new Plugin({
        key: new PluginKey("code-fence-split"),
        props: {
          handleTextInput: (view, _from, _to, text) => {
            if (text === "`") {
              const { state, dispatch } = view;
              return splitCodeBlockOnTripleBackticks(state, dispatch);
            }
            return false;
          },
        },
      }),
      new Plugin({
        key: new PluginKey("triple-click"),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const { dispatch, state } = view;
              const {
                selection: { $from, $to },
              } = state;
              if (
                $from.sameParent($to) &&
                event.detail === 3 &&
                isInCode(view.state, { onlyBlock: true })
              ) {
                dispatch?.(
                  state.tr
                    .setSelection(
                      TextSelection.create(
                        state.doc,
                        findPreviousNewline($from),
                        findNextNewline($from)
                      )
                    )
                    .scrollIntoView()
                );

                event.preventDefault();
                return true;
              }

              return false;
            },
          },
        },
      }),
      new Plugin({
        key: new PluginKey("code-fence-active"),
        state: {
          init: (_, state) => createActiveCodeBlockDecoration(state),
          apply: (tr, pluginState, oldState, newState) => {
            // Only recompute if selection or document changed
            if (
              !tr.selectionSet &&
              !tr.docChanged &&
              !tr.getMeta(mermaidPluginKey)
            ) {
              return pluginState;
            }

            return createActiveCodeBlockDecoration(newState);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
      // Collapse plugins - only on code_fence (not CodeBlock subclass)
      ...(this.name === "code_fence" ? this.collapsePlugins() : []),
      // Included for both node types, not just code_fence: parsed markdown
      // always builds a code_block node (CodeBlock's own markdownToken,
      // "code_block", is what a fence token actually maps to — see
      // CodeFence.parseMarkdown below), so a preserved directive imported
      // from markdown needs this decoration on that node type, not the one
      // created by typing in the editor. this.name scopes each instance to
      // its own node type — see directiveLabelPlugin's own doc comment.
      directiveLabelPlugin(this.name),
    ].filter(Boolean) as Plugin[];
  }

  inputRules({ type }: { type: NodeType }) {
    return [
      textblockTypeInputRule(/^```([a-zA-Z0-9+#-]*)\s$/, type, (match) => {
        const language = match[1].toLowerCase();
        return {
          language: Object.prototype.hasOwnProperty.call(
            codeLanguages,
            language
          )
            ? language
            : (getRecentlyUsedCodeLanguage() ?? DEFAULT_LANGUAGE),
        };
      }),
    ];
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    // Fence content bypasses esc(), so when inside a table cell escape it here
    // so it cannot break out of the column.
    const content = state.inTable
      ? escapeRawTableCell(node.textContent)
      : node.textContent;

    // The fence must be longer than any same-character run in the content, or
    // the content could terminate the fence early when reparsed. The stored
    // length is kept as a floor beneath that, so a directive originally
    // wrapped wider than it strictly needed to be — matching an inner fence's
    // nesting depth — round-trips at that same width instead of shrinking.
    const fenceChar: string = node.attrs.fenceChar || "`";
    const contentRun = longestRun(content, fenceChar);
    const fenceLength = Math.max(
      node.attrs.fenceLength || 3,
      contentRun >= 3 ? contentRun + 1 : 3
    );
    const fence = fenceChar.repeat(fenceLength);

    state.write(fence + sanitizeLanguage(node.attrs.language) + "\n");
    if (node.attrs.options) {
      // MyST wants a blank line between the option block and the body,
      // matching Notice's own convention for the same thing.
      state.write(`${node.attrs.options}\n\n`);
    }
    state.text(content, false);
    state.ensureNewLine();
    state.write(fence);
    state.closeBlock(node);
  }

  get markdownToken() {
    return "fence";
  }

  parseMarkdown() {
    return {
      block: "code_block",
      getAttrs: (tok: Token) => ({
        language: sanitizeLanguage(tok.info),
        fenceChar: tok.markup?.[0] || "`",
        fenceLength: tok.markup?.length || 3,
        options: tok.meta?.options || "",
      }),
      noCloseToken: true,
    };
  }
}
