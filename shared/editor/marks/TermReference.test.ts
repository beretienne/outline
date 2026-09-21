import { inputRules } from "prosemirror-inputrules";
import { EditorState, TextSelection } from "prosemirror-state";
import { extensionManager, p, schema } from "@shared/test/editor";

/**
 * Types `text` one character at a time through the editor's real, full
 * input-rule list — in registration order, which is the point: `Code`'s own
 * backtick rule matches the same closing keystroke.
 */
function type(text: string) {
  const plugin = inputRules({ rules: extensionManager.inputRules({ schema }) });
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

  for (const char of text) {
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
  return state;
}

describe("TermReference input rule", () => {
  it("turns a typed {term}`text` into a reference, not inline code", () => {
    const state = type("See {term}`field of view` now");
    const found: { text: string; marks: string[] }[] = [];
    state.doc.descendants((node) => {
      if (node.isText) {
        found.push({
          text: node.text ?? "",
          marks: node.marks.map((mark) => mark.type.name),
        });
      }
    });

    expect(found).toEqual([
      { text: "See ", marks: [] },
      { text: "field of view", marks: ["term_reference"] },
      { text: " now", marks: [] },
    ]);
  });

  it("still leaves plain backticks to inline code", () => {
    const state = type("a `b` c");
    let codeText = "";
    state.doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === "code_inline")) {
        codeText += node.text;
      }
    });
    expect(codeText).toBe("b");
  });

  it("refuses formatting marks on a reference", () => {
    const { term_reference: term, strong } = schema.marks;
    const text = schema.text("x", [term.create()]);
    expect(
      strong
        .create()
        .addToSet(text.marks)
        .map((m) => m.type)
    ).toEqual([term]);
  });
});
