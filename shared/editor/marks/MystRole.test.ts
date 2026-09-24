import { inputRules } from "prosemirror-inputrules";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";
import { extensionManager, p, schema, serializer } from "@shared/test/editor";
import MystRole from "./MystRole";

const commands = new MystRole().commands({ type: schema.marks.myst_role });

/**
 * Runs a command against a one-paragraph document with the given range
 * selected (a cursor when `to` is omitted).
 *
 * @param paragraph - the paragraph.
 * @param from - selection start.
 * @param to - selection end; defaults to `from`.
 * @param run - the command to run.
 * @returns whether it applied, and the resulting state.
 */
function apply(
  paragraph: ProsemirrorNode,
  from: number,
  to: number | undefined,
  run: (
    state: EditorState,
    dispatch: (tr: EditorState["tr"]) => void
  ) => boolean
) {
  let state = EditorState.create({
    doc: schema.nodes.doc.create(null, [paragraph]),
    schema,
  });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, to ?? from))
  );
  const applied = run(state, (tr) => {
    state = state.apply(tr);
  });
  return { applied, state };
}

/**
 * Lists a document's text runs with their mark names and role names.
 *
 * @param state - the editor state.
 * @returns the runs.
 */
function runs(state: EditorState) {
  const found: { text: string; marks: string[]; role?: string }[] = [];
  state.doc.descendants((node) => {
    if (node.isText) {
      const role = node.marks.find((m) => m.type.name === "myst_role");
      found.push({
        text: node.text ?? "",
        marks: node.marks.map((m) => m.type.name),
        ...(role ? { role: role.attrs.name } : {}),
      });
    }
  });
  return found;
}

describe("MystRole commands (the Role toolbar button)", () => {
  const { myst_role: role, strong } = schema.marks;

  it("makes the selection a role with the given name", () => {
    // "see " is positions 1–5; "values" is 5–11.
    const { applied, state } = apply(p("see values"), 5, 11, (s, d) =>
      commands.myst_role({ name: "ref" })(s, d)
    );
    expect(applied).toBe(true);
    expect(runs(state)).toEqual([
      { text: "see ", marks: [] },
      { text: "values", marks: ["myst_role"], role: "ref" },
    ]);
    expect(serializer.serialize(state.doc).trim()).toBe("see {ref}`values`");
  });

  it("drops formatting inside the new role", () => {
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("see "),
      schema.text("values", [strong.create()]),
    ]);
    const { state } = apply(paragraph, 5, 11, (s, d) =>
      commands.myst_role({ name: "ref" })(s, d)
    );
    expect(runs(state)[1]).toEqual({
      text: "values",
      marks: ["myst_role"],
      role: "ref",
    });
  });

  it("renames the role the cursor is in", () => {
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("a "),
      schema.text("HTTP", [role.create({ name: "abbr" })]),
      schema.text(" b"),
    ]);
    // Cursor inside "HTTP" (positions 3–7).
    const { applied, state } = apply(paragraph, 5, undefined, (s, d) =>
      commands.myst_role({ name: "dot" })(s, d)
    );
    expect(applied).toBe(true);
    expect(runs(state)[1]).toEqual({
      text: "HTTP",
      marks: ["myst_role"],
      role: "dot",
    });
  });

  it("makes a glossary term the role named 'term'", () => {
    const { state } = apply(p("see CAM"), 5, 8, (s, d) =>
      commands.myst_role({ name: "term" })(s, d)
    );
    expect(runs(state)[1]).toEqual({
      text: "CAM",
      marks: ["myst_role"],
      role: "term",
    });
  });

  it("replaces a term stored with the older mark", () => {
    const { term_reference: legacy } = schema.marks;
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("see "),
        schema.text("CAM", [legacy.create()]),
      ]),
    ]);
    const { state } = apply(doc.firstChild!, 5, 8, (s, d) =>
      commands.myst_role({ name: "term" })(s, d)
    );
    expect(runs(state)[1]).toEqual({
      text: "CAM",
      marks: ["myst_role"],
      role: "term",
    });
  });

  it.each([
    ["an empty name", ""],
    ["braces", "{ref}"],
    ["a space", "my role"],
  ])("refuses %s", (_label, name) => {
    const { applied, state } = apply(p("see values"), 5, 11, (s, d) =>
      commands.myst_role({ name })(s, d)
    );
    expect(applied).toBe(false);
    expect(runs(state)).toEqual([{ text: "see values", marks: [] }]);
  });

  it("does nothing with a bare cursor outside any role", () => {
    const { applied } = apply(p("see values"), 3, undefined, (s, d) =>
      commands.myst_role({ name: "ref" })(s, d)
    );
    expect(applied).toBe(false);
  });

  it("removes the role the cursor is in, keeping its text", () => {
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("a "),
      schema.text("HTTP", [role.create({ name: "abbr" })]),
    ]);
    const { applied, state } = apply(paragraph, 5, undefined, (s, d) =>
      commands.removeMystRole()(s, d)
    );
    expect(applied).toBe(true);
    expect(runs(state)).toEqual([{ text: "a HTTP", marks: [] }]);
  });
});

describe("MystRole input rule", () => {
  it("turns a typed {name}`text` into a role, {term} included", () => {
    const plugin = inputRules({
      rules: extensionManager.inputRules({ schema }),
    });
    let state = EditorState.create({
      doc: schema.nodes.doc.create(null, [p("")]),
      schema,
      plugins: [plugin],
    });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1))
    );
    const view = {
      get state() {
        return state;
      },
      composing: false,
      dispatch: (tr: EditorState["tr"]) => {
        state = state.apply(tr);
      },
    };
    for (const char of "{abbr}`HTTP` and {term}`CAM` ok") {
      const { from, to } = state.selection;
      const handled = plugin.props.handleTextInput?.call(
        plugin,
        view as never,
        from,
        to,
        char,
        () => state.tr.insertText(char, from, to)
      );
      if (!handled) {
        state = state.apply(state.tr.insertText(char, from, to));
      }
    }
    expect(runs(state)).toEqual([
      { text: "HTTP", marks: ["myst_role"], role: "abbr" },
      { text: " and ", marks: [] },
      { text: "CAM", marks: ["myst_role"], role: "term" },
      { text: " ok", marks: [] },
    ]);
  });
});

describe("keeping a role while its content is replaced", () => {
  const { myst_role: role } = schema.marks;
  const [plugin] = new MystRole().plugins;

  /**
   * An editor-like object around a one-paragraph document, the selection
   * set from `from` to `to`, that plugin props can be called against.
   */
  function editor(paragraph: ProsemirrorNode, from: number, to = from) {
    let state = EditorState.create({
      doc: schema.nodes.doc.create(null, [paragraph]),
      schema,
      plugins: [plugin],
    });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, from, to))
    );
    const view = {
      get state() {
        return state;
      },
      dispatch: (tr: EditorState["tr"]) => {
        state = state.apply(tr);
      },
    };
    const press = (key: string) =>
      plugin.props.handleKeyDown?.call(
        plugin,
        view as never,
        {
          key,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as never
      );
    const type = (text: string) => {
      const { from: a, to: b } = state.selection;
      const handled = plugin.props.handleTextInput?.call(
        plugin,
        view as never,
        a,
        b,
        text,
        () => state.tr.insertText(text, a, b)
      );
      if (!handled) {
        state = state.apply(state.tr.insertText(text, a, b));
      }
    };
    return {
      view,
      press,
      type,
      get state() {
        return state;
      },
    };
  }

  // "a " is 1–3, the role's text follows, then " b".
  const withRole = (content: string) =>
    schema.nodes.paragraph.create(null, [
      schema.text("a "),
      schema.text(content, [role.create({ name: "dot" })]),
      schema.text(" b"),
    ]);

  it("Backspace on a role's last character leaves the role pending, and typing refills it", () => {
    const e = editor(withRole("1"), 4);
    expect(e.press("Backspace")).toBe(true);
    expect(e.state.doc.textContent).toBe("a  b");
    expect(role.isInSet(e.state.storedMarks ?? [])).toBeTruthy();
    e.type("2");
    expect(runs(e.state)).toEqual([
      { text: "a ", marks: [] },
      { text: "2", marks: ["myst_role"], role: "dot" },
      { text: " b", marks: [] },
    ]);
  });

  it("Delete on a role's only character does the same", () => {
    const e = editor(withRole("1"), 3);
    expect(e.press("Delete")).toBe(true);
    e.type("7");
    expect(runs(e.state)[1]).toEqual({
      text: "7",
      marks: ["myst_role"],
      role: "dot",
    });
  });

  it("deleting the role's whole text selected does the same", () => {
    const e = editor(withRole("12"), 3, 5);
    expect(e.press("Backspace")).toBe(true);
    e.type("9");
    expect(runs(e.state)[1]).toEqual({
      text: "9",
      marks: ["myst_role"],
      role: "dot",
    });
  });

  it("leaves ordinary deletions inside a longer role alone", () => {
    // Cursor between "1" and "2": deleting the "1" isn't at the role's end.
    const e = editor(withRole("12"), 4);
    expect(e.press("Backspace")).toBe(false);
  });

  it("keeps every character typed into an emptied role, not just the first", () => {
    const e = editor(withRole("1"), 4);
    e.press("Backspace");
    e.type("2");
    e.type("3");
    e.type("4");
    expect(runs(e.state)).toEqual([
      { text: "a ", marks: [] },
      { text: "234", marks: ["myst_role"], role: "dot" },
      { text: " b", marks: [] },
    ]);
  });

  it("after deleting a role's last characters, typing goes on into it", () => {
    const e = editor(withRole("12"), 5);
    expect(e.press("Backspace")).toBe(true);
    e.type("3");
    e.type("4");
    expect(runs(e.state)[1]).toEqual({
      text: "134",
      marks: ["myst_role"],
      role: "dot",
    });
  });

  it("typing over a selected role character by character keeps it all", () => {
    const e = editor(withRole("12"), 3, 5);
    e.type("x");
    e.type("y");
    expect(runs(e.state)[1]).toEqual({
      text: "xy",
      marks: ["myst_role"],
      role: "dot",
    });
  });

  it("→ at the role's end steps out: what's typed next is outside", () => {
    const e = editor(withRole("1"), 4);
    e.press("Backspace");
    e.type("2");
    expect(e.press("ArrowRight")).toBe(true);
    expect(e.state.selection.from).toBe(4);
    e.type("!");
    expect(runs(e.state)).toEqual([
      { text: "a ", marks: [] },
      { text: "2", marks: ["myst_role"], role: "dot" },
      { text: "! b", marks: [] },
    ]);
  });

  it("moving the caret away and back ends the editing", () => {
    const e = editor(withRole("1"), 4);
    e.press("Backspace");
    e.type("2");
    e.view.dispatch(
      e.state.tr.setSelection(TextSelection.create(e.state.doc, 1))
    );
    e.view.dispatch(
      e.state.tr.setSelection(TextSelection.create(e.state.doc, 4))
    );
    e.type("!");
    expect(runs(e.state)[2]).toEqual({ text: "! b", marks: [] });
  });

  it("outlines the role while it is being edited", () => {
    const e = editor(withRole("1"), 4);
    e.press("Backspace");
    e.type("2");
    const shown = plugin.props.decorations?.call(plugin, e.state);
    const found = shown instanceof DecorationSet ? shown.find(3, 4) : [];
    expect(found).toHaveLength(1);
  });

  it("typing over the role's whole text selected keeps the role", () => {
    const e = editor(withRole("12"), 3, 5);
    e.type("x");
    expect(runs(e.state)[1]).toEqual({
      text: "x",
      marks: ["myst_role"],
      role: "dot",
    });
  });

  it("shows a pending role as an empty chip, and not once the cursor moves", () => {
    const e = editor(withRole("1"), 4);
    e.press("Backspace");
    const shown = plugin.props.decorations?.call(plugin, e.state);
    expect(shown instanceof DecorationSet ? shown.find().length : 0).toBe(1);
    e.view.dispatch(
      e.state.tr.setSelection(TextSelection.create(e.state.doc, 1))
    );
    const after = plugin.props.decorations?.call(plugin, e.state);
    expect(after instanceof DecorationSet ? after.find().length : 0).toBe(0);
  });
});
