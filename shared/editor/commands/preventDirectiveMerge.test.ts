import type { Node as ProsemirrorNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { createEditorState, p, schema } from "@shared/test/editor";
import {
  preventDirectiveMergeBackward,
  preventDirectiveMergeForward,
} from "./preventDirectiveMerge";

function directive(
  name: string,
  argument = "",
  content: ProsemirrorNode[] = [p(`${name} body`)]
) {
  return schema.nodes.container_directive.create(
    { directive: name, argument },
    content
  );
}

/**
 * Runs a command at `pos` and returns whether it applied plus the resulting
 * document.
 */
function run(
  testDoc: ProsemirrorNode,
  pos: number,
  command: typeof preventDirectiveMergeBackward
) {
  let state = createEditorState(testDoc);
  state = state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)))
  );
  const applied = command(state, (tr) => {
    state = state.apply(tr);
  });
  return { applied, doc: state.doc };
}

describe("preventDirectiveMergeBackward", () => {
  it("removes a blank line between two directives without touching either", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("glossary"),
      p(""),
      directive("glossary"),
    ]);
    const emptyParaPos = testDoc.firstChild!.nodeSize + 1;
    const { applied, doc } = run(
      testDoc,
      emptyParaPos,
      preventDirectiveMergeBackward
    );

    expect(applied).toBe(true);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe("container_directive");
    expect(doc.child(1).type.name).toBe("container_directive");
    expect(doc.child(0).attrs.directive).toBe("glossary");
    expect(doc.child(1).attrs.directive).toBe("glossary");
  });

  it("does not merge two adjacent directives once nothing separates them", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("ifconfig", "Class == 'A'"),
      directive("grid", "2"),
    ]);
    // Start of the second directive's own content.
    const pos = testDoc.firstChild!.nodeSize + 2;
    const { applied, doc } = run(testDoc, pos, preventDirectiveMergeBackward);

    // Consumed (blocked), not merged: the default joinBackward would have
    // dissolved the second directive's wrapper into the first one.
    expect(applied).toBe(true);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).attrs.directive).toBe("ifconfig");
    expect(doc.child(1).attrs.directive).toBe("grid");
  });

  it("leaves ordinary paragraphs alone (no directive nearby)", () => {
    const testDoc = schema.nodes.doc.create(null, [p("one"), p(""), p("two")]);
    const emptyParaPos = testDoc.firstChild!.nodeSize + 1;
    const { applied } = run(
      testDoc,
      emptyParaPos,
      preventDirectiveMergeBackward
    );
    expect(applied).toBe(false);
  });
});

describe("preventDirectiveMergeForward", () => {
  it("removes a blank line between two directives without touching either", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("ifconfig", "Class == 'A'"),
      p(""),
      directive("grid", "2"),
    ]);
    const emptyParaPos = testDoc.firstChild!.nodeSize + 1;
    const { applied, doc } = run(
      testDoc,
      emptyParaPos,
      preventDirectiveMergeForward
    );

    expect(applied).toBe(true);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).attrs.directive).toBe("ifconfig");
    expect(doc.child(1).attrs.directive).toBe("grid");
  });

  it("does not merge two adjacent directives once nothing separates them", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("ifconfig", "Class == 'A'"),
      directive("grid", "2"),
    ]);
    // End of the first directive's own content (inside its paragraph, not
    // the shared boundary after it — the latter would resolve inside the
    // directive itself, not a textblock).
    const pos = testDoc.firstChild!.nodeSize - 2;
    const { applied, doc } = run(testDoc, pos, preventDirectiveMergeForward);

    // Consumed (blocked), not merged: the default joinForward would have
    // dissolved the second directive's wrapper into the first one.
    expect(applied).toBe(true);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).attrs.directive).toBe("ifconfig");
    expect(doc.child(1).attrs.directive).toBe("grid");
  });
});
