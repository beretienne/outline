import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import {
  createEditorState,
  doc,
  p,
  schema,
  serializer,
} from "@shared/test/editor";
import { insertVerbatimDirective } from "./verbatimDirective";

function run(testDoc: ProsemirrorNode, pos: number, command: Command) {
  let state = createEditorState(testDoc);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos))
  );
  const applied = command(state, (tr) => {
    state = state.apply(tr);
  });
  return { applied, state };
}

describe("insertVerbatimDirective", () => {
  const type = schema.nodes.container_directive;

  it("replaces an empty paragraph with a directive holding an empty plain-text body", () => {
    const testDoc = doc([p("Before"), p("")]);
    const { applied, state } = run(
      testDoc,
      testDoc.content.size - 1,
      insertVerbatimDirective(type, { directive: "raw", argument: "latex" })
    );
    expect(applied).toBe(true);
    const directive = state.doc.child(1);
    expect(directive.type.name).toBe("container_directive");
    expect(directive.attrs.directive).toBe("raw");
    expect(directive.childCount).toBe(1);
    expect(directive.firstChild!.type.name).toBe("code_block");
    expect(state.selection.$from.parent.type.name).toBe("code_block");
  });

  it("writes back what is typed into it, verbatim", () => {
    const { state } = run(
      doc(p("")),
      1,
      insertVerbatimDirective(type, { directive: "raw", argument: "latex" })
    );
    const typed = state.apply(state.tr.insertText("\\newpage"));
    expect(serializer.serialize(typed.doc).trim()).toBe(
      ":::{raw} latex\n\\newpage\n:::"
    );
  });

  it("an empty one writes back as the directive line and its closer", () => {
    const { state } = run(
      doc(p("")),
      1,
      insertVerbatimDirective(type, {
        directive: "tabularcolumns",
        argument: "|l|l|",
      })
    );
    expect(serializer.serialize(state.doc).trim()).toBe(
      ":::{tabularcolumns} |l|l|\n:::"
    );
  });

  it("goes after a paragraph that has text, leaving it alone", () => {
    const { state } = run(
      doc(p("Keep me")),
      3,
      insertVerbatimDirective(type, { directive: "toctree" })
    );
    expect(state.doc.child(0).textContent).toBe("Keep me");
    expect(state.doc.child(1).attrs.directive).toBe("toctree");
  });
});
