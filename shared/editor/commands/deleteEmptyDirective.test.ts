import type { Node as ProsemirrorNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  createEditorState,
  definitionBody,
  definitionList,
  definitionTerm,
  p,
  schema,
} from "@shared/test/editor";
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

  it("removes a {glossary} whose only entry is still blank, from the term", () => {
    const testDoc = schema.nodes.doc.create(null, [
      p("before"),
      directive("glossary", "", [
        definitionList(definitionTerm(""), definitionBody([p("")])),
      ]),
    ]);
    // +1 directive, +1 list, +1 term.
    const pos = testDoc.firstChild!.nodeSize + 3;
    const { applied, doc } = run(testDoc, pos);

    expect(applied).toBe(true);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).textContent).toBe("before");
  });

  it("removes a blank {glossary} nested in another glossary's definition", () => {
    const inner = directive("glossary", "", [
      definitionList(definitionTerm(""), definitionBody([p("")])),
    ]);
    const testDoc = schema.nodes.doc.create(null, [
      directive("glossary", "", [
        definitionList(
          definitionTerm("Term"),
          definitionBody([p("Definition"), inner])
        ),
      ]),
    ]);
    let pos = -1;
    testDoc.descendants((node, nodePos) => {
      if (node.type.name === "definition_term" && node.content.size === 0) {
        pos = nodePos + 1;
      }
    });
    const { applied, doc } = run(testDoc, pos);

    expect(applied).toBe(true);
    expect(doc.textContent).toBe("TermDefinition");
    let glossaries = 0;
    doc.descendants((node) => {
      if (node.type.name === "container_directive") {
        glossaries++;
      }
    });
    expect(glossaries).toBe(1);
  });

  it("removes only a blank entry when the list has others", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("glossary", "", [
        definitionList(
          definitionTerm("Term"),
          definitionBody([p("Definition")]),
          definitionTerm(""),
          definitionBody([p("")])
        ),
      ]),
    ]);
    // Inside the blank entry's own empty definition paragraph.
    const pos = testDoc.content.size - 4;
    const { applied, doc } = run(testDoc, pos);

    expect(applied).toBe(true);
    const list = doc.firstChild!.firstChild!;
    expect(list.type.name).toBe("definition_list");
    expect(list.childCount).toBe(2);
    expect(list.textContent).toBe("TermDefinition");
  });

  it("declines in a glossary entry that has a term", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("glossary", "", [
        definitionList(definitionTerm("Term"), definitionBody([p("")])),
      ]),
    ]);
    const { applied } = run(testDoc, testDoc.content.size - 4);
    expect(applied).toBe(false);
  });
});
