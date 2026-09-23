import type Token from "markdown-it/lib/token.mjs";
import { InputRule } from "prosemirror-inputrules";
import type {
  MarkSpec,
  MarkType,
  Mark as ProsemirrorMark,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { Command, EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Primitive } from "utility-types";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { getMarkRange } from "../queries/getMarkRange";
import mystRoleRule, { isValidRoleName } from "../rules/mystRole";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Mark from "./Mark";

/**
 * The text a role mark covers, read from one end of it: from `index`
 * forwards (`dir` 1) or backwards (`dir` -1) for as long as the siblings
 * carry the same mark. A comment mark can split a role's text into several
 * text nodes, and both ends of the role need to agree on its backticks.
 *
 * @param parent - the node holding the role's text.
 * @param index - the child to start from.
 * @param mark - the role mark.
 * @param dir - 1 to read forwards, -1 to read backwards.
 * @returns the text under the mark.
 */
function roleText(
  parent: ProsemirrorNode,
  index: number,
  mark: ProsemirrorMark,
  dir: 1 | -1
): string {
  let text = "";
  for (let i = index; i >= 0 && i < parent.childCount; i += dir) {
    const child = parent.child(i);
    if (!child.isText || !mark.isInSet(child.marks)) {
      break;
    }
    text = dir === 1 ? text + child.text : child.text + text;
  }
  return text;
}

/**
 * Backticks enough to fence the given content: one more than its longest
 * run of backticks, so the content can never close the role early.
 *
 * @param content - the role's content.
 * @returns the backtick run.
 */
function backticksFor(content: string): string {
  const longest = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map((run) => run.length)
  );
  return "`".repeat(longest + 1);
}

/**
 * The range a role command acts on: the selection, or — with only a cursor
 * — the whole role the cursor is in.
 *
 * @param state - the editor state.
 * @param type - the `myst_role` mark type.
 * @returns the range, or undefined when there is nothing to act on.
 */
function roleRange(
  state: EditorState,
  type: MarkType
): { from: number; to: number } | undefined {
  const { from, to, empty, $from } = state.selection;
  if (!empty) {
    return { from, to };
  }
  const range = getMarkRange($from, type);
  return range ? { from: range.from, to: range.to } : undefined;
}

/**
 * Make the selection (or the role at the cursor) a role with the given
 * name, replacing any role already there — this is also how a role is
 * renamed. `term` becomes a glossary term, which has its own mark.
 *
 * @param type - the `myst_role` mark type.
 * @param name - the role's name, without braces.
 * @returns the command.
 */
function setRole(type: MarkType, name: string): Command {
  return (state, dispatch) => {
    if (!isValidRoleName(name)) {
      return false;
    }
    const range = roleRange(state, type);
    if (!range || range.from === range.to) {
      return false;
    }
    const term = state.schema.marks.term_reference;
    const mark =
      name === "term" && term ? term.create() : type.create({ name });
    const tr = state.tr.removeMark(range.from, range.to, type);
    if (term) {
      tr.removeMark(range.from, range.to, term);
    }
    dispatch?.(tr.addMark(range.from, range.to, mark).scrollIntoView());
    return true;
  };
}

/**
 * Turn the role in the selection (or at the cursor) back into plain text.
 *
 * @param type - the `myst_role` mark type.
 * @returns the command.
 */
function removeRole(type: MarkType): Command {
  return (state, dispatch) => {
    const range = roleRange(state, type);
    if (!range) {
      return false;
    }
    dispatch?.(state.tr.removeMark(range.from, range.to, type));
    return true;
  };
}

/**
 * The role a deletion of exactly `from`–`to` would remove entirely — its
 * last character, or its whole text selected — if there is one.
 *
 * @param state - the editor state.
 * @param type - the `myst_role` mark type.
 * @param from - start of the deletion.
 * @param to - end of the deletion.
 * @returns the role mark, or undefined.
 */
function roleEmptiedBy(
  state: EditorState,
  type: MarkType,
  from: number,
  to: number
): ProsemirrorMark | undefined {
  if (from >= to) {
    return undefined;
  }
  const range = getMarkRange(state.doc.resolve(from), type);
  return range && range.from === from && range.to === to
    ? range.mark
    : undefined;
}

/** A role being edited: typed text at `pos`, its end, goes on into it. */
interface RoleEditing {
  /** The role mark. */
  mark: ProsemirrorMark;
  /** The role's end, where the caret is while editing it. */
  pos: number;
}

const editingKey = new PluginKey<RoleEditing | null>("mystRoleEditing");

/**
 * Keeps a role together while its content is being edited. A role is
 * non-inclusive, so that text typed after it in prose stays outside it —
 * but that alone would also push out text typed while *replacing* its
 * content, and a mark only exists on text, so emptying a role would delete
 * it outright.
 *
 * - Backspace/Delete that would empty a role leaves it pending at the
 *   cursor (a stored mark), drawn as an empty chip — its name, no content.
 * - Typing into a pending role, typing over a selection inside a role, or
 *   deleting back to a role's end starts *editing* it: while the caret
 *   stays at the role's end, typed text goes on into the role, and the role
 *   is outlined to show it. Moving the caret — a click, the arrow keys —
 *   ends it, and so does → at the role's end, without moving the caret, to
 *   carry on typing outside.
 *
 * The mark type is read from the state's schema, not captured, so the
 * plugin doesn't need a mounted editor to be built.
 *
 * @returns the plugin.
 */
function keepRoleWhileEditing(): Plugin {
  return new Plugin<RoleEditing | null>({
    key: editingKey,
    state: {
      init: () => null,
      apply(tr, editing, _oldState, newState) {
        const meta: RoleEditing | null | undefined = tr.getMeta(editingKey);
        if (meta !== undefined) {
          return meta;
        }
        if (!editing) {
          return null;
        }
        // Still editing only while the caret stays where the edit left it,
        // at the end of the same role.
        const pos = tr.mapping.map(editing.pos);
        const { selection } = newState;
        const before = selection.$from.nodeBefore;
        return selection.empty &&
          selection.from === pos &&
          editing.mark.isInSet(before?.marks ?? [])
          ? { mark: editing.mark, pos }
          : null;
      },
    },
    props: {
      handleKeyDown: (view, event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
          return false;
        }
        const { state } = view;
        const type = state.schema.marks.myst_role;
        const { selection } = state;
        if (!type || !(selection instanceof TextSelection)) {
          return false;
        }

        const editing = editingKey.getState(state);
        if (
          event.key === "ArrowRight" &&
          editing &&
          selection.empty &&
          selection.from === editing.pos
        ) {
          // Step out of the role without moving: what's typed next is
          // outside it.
          view.dispatch(state.tr.setMeta(editingKey, null));
          return true;
        }

        if (event.key !== "Backspace" && event.key !== "Delete") {
          return false;
        }
        let { from, to } = selection;
        if (selection.empty) {
          if (event.key === "Backspace") {
            from -= 1;
          } else {
            to += 1;
          }
          if (from < selection.$from.start() || to > selection.$from.end()) {
            return false;
          }
        }

        const emptied = roleEmptiedBy(state, type, from, to);
        if (emptied) {
          const around = state.doc
            .resolve(from)
            .marks()
            .filter((mark) => mark.type !== type);
          view.dispatch(
            state.tr
              .delete(from, to)
              .setStoredMarks(emptied.addToSet(around))
              .setMeta(editingKey, null)
          );
          return true;
        }

        // Deleting back to a role's end — its last characters — leaves the
        // caret there: carry on editing the role.
        const range = getMarkRange(state.doc.resolve(from), type);
        if (range && from >= range.from && to === range.to) {
          view.dispatch(
            state.tr
              .delete(from, to)
              .setMeta(editingKey, { mark: range.mark, pos: from })
          );
          return true;
        }
        return false;
      },

      handleTextInput: (view, from, to, text) => {
        const { state } = view;
        const type = state.schema.marks.myst_role;
        if (!type) {
          return false;
        }
        const $from = state.doc.resolve(from);
        let role: ProsemirrorMark | undefined;
        let atEnd = true;
        let around: readonly ProsemirrorMark[];

        if (from < to) {
          // Typing over a selection inside one role.
          const range = getMarkRange($from, type);
          if (!range || from < range.from || to > range.to) {
            return false;
          }
          role = range.mark;
          atEnd = to === range.to;
          around = $from.marksAcross(state.doc.resolve(to)) ?? $from.marks();
        } else {
          const pending = state.storedMarks?.find((mark) => mark.type === type);
          const editing = editingKey.getState(state);
          if (pending) {
            role = pending;
            around = state.storedMarks ?? [];
          } else if (
            editing &&
            from === editing.pos &&
            editing.mark.isInSet($from.nodeBefore?.marks ?? [])
          ) {
            role = editing.mark;
            around = $from.marks();
          } else {
            return false;
          }
        }

        const tr = state.tr
          .setStoredMarks(role.addToSet(around))
          .insertText(text, from, to)
          .setMeta(
            editingKey,
            atEnd ? { mark: role, pos: from + text.length } : null
          );
        view.dispatch(tr);
        return true;
      },

      decorations: (state) => {
        const type = state.schema.marks.myst_role;
        if (!type) {
          return null;
        }
        const { selection, storedMarks } = state;
        const decorations: Decoration[] = [];

        const pending = selection.empty
          ? storedMarks?.find((mark) => mark.type === type)
          : undefined;
        if (pending) {
          const name: string = pending.attrs.name;
          decorations.push(
            Decoration.widget(
              selection.from,
              () => {
                const chip = document.createElement("span");
                chip.className = EditorStyleHelper.mystRole;
                chip.dataset.role = name;
                return chip;
              },
              // Before the cursor, so the caret sits after the role's name.
              { side: -1, key: `pending-myst-role-${name}` }
            )
          );
        }

        const editing = editingKey.getState(state);
        if (editing && editing.pos > 0) {
          const range = getMarkRange(state.doc.resolve(editing.pos - 1), type);
          if (range) {
            decorations.push(
              Decoration.inline(range.from, range.to, {
                class: EditorStyleHelper.mystRoleEditing,
              })
            );
          }
        }

        return decorations.length
          ? DecorationSet.create(state.doc, decorations)
          : null;
      },
    },
  });
}

/**
 * A MyST role Outline has no dedicated mark for — `` {dot}`1` ``,
 * `` {ref}`text <label>` ``, `` {abbr}`…` ``, a project's own custom roles —
 * one mark for all of them, carrying the role's name. `{term}` keeps its
 * own mark (`TermReference`).
 *
 * Visual distinction only, like `TermReference`: nothing is resolved or
 * linked. It shows a writer that this span is a role, and which one, and
 * writes it back exactly as it arrived. Excludes every formatting mark for
 * the same reason as `TermReference` — a role's content is literal text to
 * Sphinx — and is written unescaped.
 */
export default class MystRole extends Mark {
  get name() {
    return "myst_role";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        name: { default: "", validate: "string" },
      },
      excludes:
        "myst_role term_reference strong em underline strikethrough highlight code_inline link placeholder",
      // Typing at the end of a role continues as ordinary text.
      inclusive: false,
      parseDOM: [
        {
          tag: `span.${EditorStyleHelper.mystRole}`,
          getAttrs: (dom: HTMLElement) => ({ name: dom.dataset.role ?? "" }),
        },
      ],
      toDOM: (mark) => [
        "span",
        {
          class: EditorStyleHelper.mystRole,
          "data-role": mark.attrs.name,
          title: `{${mark.attrs.name}}`,
        },
      ],
    };
  }

  get rulePlugins() {
    return [mystRoleRule];
  }

  get plugins() {
    return [keepRoleWhileEditing()];
  }

  commands({ type }: { type: MarkType }) {
    return {
      myst_role:
        (attrs?: Record<string, Primitive>): Command =>
        (state, dispatch) =>
          setRole(
            type,
            typeof attrs?.name === "string" ? attrs.name.trim() : ""
          )(state, dispatch),
      removeMystRole: (): Command => removeRole(type),
    };
  }

  /**
   * Typing the closing backtick of `` {name}`text` `` turns the span into a
   * role. Registered after `TermReference`, which claims `{term}` first,
   * and ahead of `Code`, whose own backtick rule matches the same keystroke
   * (see `nodes/index.ts`).
   */
  inputRules({ type }: { type: MarkType }) {
    return [
      new InputRule(
        /\{([a-zA-Z0-9_\-+:]+)\}`([^`\n]+)`$/,
        (state, match, start, end) => {
          const [, name, text] = match;
          if (name === "term") {
            return null;
          }
          return state.tr
            .replaceWith(
              start,
              end,
              state.schema.text(text, [type.create({ name })])
            )
            .removeStoredMark(type);
        }
      ),
    ];
  }

  toMarkdown() {
    return {
      open: (
        _state: MarkdownSerializerState,
        mark: ProsemirrorMark,
        parent: ProsemirrorNode,
        index: number
      ) =>
        `{${mark.attrs.name}}` + backticksFor(roleText(parent, index, mark, 1)),
      close: (
        _state: MarkdownSerializerState,
        mark: ProsemirrorMark,
        parent: ProsemirrorNode,
        index: number
      ) => backticksFor(roleText(parent, index - 1, mark, -1)),
      mixable: false,
      escape: false,
    };
  }

  parseMarkdown() {
    return {
      mark: "myst_role",
      getAttrs: (tok: Token) => {
        const meta: { name?: string } = tok.meta ?? {};
        return { name: meta.name ?? "" };
      },
    };
  }
}
