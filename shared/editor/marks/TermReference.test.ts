import { EditorState, TextSelection } from "prosemirror-state";
import { parser, schema, serializer } from "@shared/test/editor";
import { toggleMark } from "../commands/toggleMark";

describe("TermReference (stored glossary terms)", () => {
  it("is no longer what {term} parses into", () => {
    const doc = parser.parse("See {term}`field of view` now.")!;
    const marks = doc.firstChild!.child(1).marks;
    expect(marks.map((m) => m.type.name)).toEqual(["myst_role"]);
    expect(marks[0].attrs.name).toBe("term");
  });

  it("still writes a stored term back as the {term} role", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("See "),
        schema.text("field of view", [schema.marks.term_reference.create()]),
        schema.text(" now."),
      ]),
    ]);
    expect(serializer.serialize(doc)).toBe("See {term}`field of view` now.");
  });

  it("refuses formatting marks on a stored term", () => {
    const { term_reference: term, strong } = schema.marks;
    const text = schema.text("x", [term.create()]);
    expect(
      strong
        .create()
        .addToSet(text.marks)
        .map((m) => m.type)
    ).toEqual([term]);
  });

  it("can still be removed the way the toolbar removes it", () => {
    const { term_reference: term } = schema.marks;
    let state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [
          schema.text("see "),
          schema.text("field of view", [term.create()]),
        ]),
      ]),
      schema,
    });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 5, 18))
    );

    toggleMark(term)(state, (tr: EditorState["tr"]) => {
      state = state.apply(tr);
    });
    expect(state.doc.firstChild!.textContent).toBe("see field of view");
    expect(state.doc.firstChild!.child(0).marks).toEqual([]);
  });
});
