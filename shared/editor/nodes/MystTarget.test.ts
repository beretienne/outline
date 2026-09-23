import { baseKeymap } from "prosemirror-commands";
import { TextSelection } from "prosemirror-state";
import { createEditorState, p, schema, serializer } from "@shared/test/editor";

/**
 * Builds a MyST `(label)=` target node holding the given label.
 *
 * @param label - the label; empty for an empty target.
 * @returns the node.
 */
function target(label: string) {
  return schema.nodes.myst_target.create(
    null,
    label ? schema.text(label) : undefined
  );
}

describe("MystTarget", () => {
  test("a filled target writes back as (label)=", () => {
    const doc = schema.nodes.doc.create(null, [
      p("Before."),
      target("my-label"),
      p("After."),
    ]);
    expect(serializer.serialize(doc, { commonMark: true }).trim()).toBe(
      "Before.\n\n(my-label)=\n\nAfter."
    );
  });

  test("an empty target writes nothing rather than ()=", () => {
    const doc = schema.nodes.doc.create(null, [
      p("Before."),
      target(""),
      p("After."),
    ]);
    expect(serializer.serialize(doc, { commonMark: true }).trim()).toBe(
      "Before.\n\nAfter."
    );
  });

  test("Backspace at the start of an empty target removes it", () => {
    const doc = schema.nodes.doc.create(null, [
      p("Before."),
      target(""),
      p("After."),
    ]);
    let state = createEditorState(doc);
    // Inside the empty target: after "Before." paragraph (size 9) + open.
    const pos = doc.firstChild!.nodeSize + 1;
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos))
    );
    expect(state.selection.$from.parent.type.name).toBe("myst_target");

    baseKeymap.Backspace(state, (tr) => {
      state = state.apply(tr);
    });

    const types: string[] = [];
    state.doc.forEach((node) => types.push(node.type.name));
    expect(types).toEqual(["paragraph", "paragraph"]);
  });
});
