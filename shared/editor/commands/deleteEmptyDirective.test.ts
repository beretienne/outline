import type { Node as ProsemirrorNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { createEditorState, p, schema } from "@shared/test/editor";
import { deleteEmptyDirectiveOrNotice } from "./deleteEmptyDirective";

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

function notice(content: ProsemirrorNode[] = [p("notice body")]) {
  return schema.nodes.container_notice.create(null, content);
}

function run(testDoc: ProsemirrorNode, pos: number) {
  let state = createEditorState(testDoc);
  state = state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)))
  );
  const applied = deleteEmptyDirectiveOrNotice(state, (tr) => {
    state = state.apply(tr);
  });
  return { applied, doc: state.doc };
}

describe("deleteEmptyDirectiveOrNotice", () => {
  it("removes an already-emptied directive outright", () => {
    const testDoc = schema.nodes.doc.create(null, [
      p("before"),
      directive("ifconfig", "", [p("")]),
    ]);
    const pos = testDoc.firstChild!.nodeSize + 2;
    const { applied, doc } = run(testDoc, pos);

    expect(applied).toBe(true);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).textContent).toBe("before");
  });

  it("removes an already-emptied notice outright", () => {
    const testDoc = schema.nodes.doc.create(null, [notice([p("")])]);
    const { applied, doc } = run(testDoc, 2);

    expect(applied).toBe(true);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe("paragraph");
  });

  it("declines when the directive still has real content", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("ifconfig", "", [p("still here")]),
    ]);
    const pos = 2;
    const { applied, doc } = run(testDoc, pos);

    expect(applied).toBe(false);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe("container_directive");
  });

  it("deletes only the innermost empty wrapper, not an outer non-empty one", () => {
    const nested = directive("grid", "2", [directive("ifconfig", "", [p("")])]);
    const testDoc = schema.nodes.doc.create(null, [nested]);
    // Position inside the innermost, empty ifconfig — should delete just
    // that one, not the outer grid (which then gets its own required
    // empty-paragraph refill, since removing ifconfig leaves it with
    // nothing).
    const pos = 4;
    const { applied, doc } = run(testDoc, pos);

    expect(applied).toBe(true);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe("container_directive");
    expect(doc.child(0).attrs.directive).toBe("grid");
    expect(doc.child(0).childCount).toBe(1);
    expect(doc.child(0).firstChild!.type.name).toBe("paragraph");
  });
});
