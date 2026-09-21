import type { Node as ProsemirrorNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  bulletList,
  createEditorState,
  definitionBody,
  definitionList,
  definitionTerm,
  doc,
  p,
  parser,
  schema,
  serializer,
} from "@shared/test/editor";
import {
  insertGlossary,
  moveIntoDefinitionBody,
  splitDefinitionEntry,
} from "./definitionList";

/**
 * Runs a command with the selection placed at `pos` and returns the
 * resulting document plus the selection the command left behind.
 */
function run(
  testDoc: ProsemirrorNode,
  pos: number,
  command: typeof splitDefinitionEntry
) {
  let state = createEditorState(testDoc);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos))
  );

  const applied = command(state, (tr) => {
    state = state.apply(tr);
  });

  return { applied, doc: state.doc, selection: state.selection };
}

/**
 * Finds the position just inside the first empty paragraph in a document.
 */
function findEmptyParagraphPos(testDoc: ProsemirrorNode): number {
  let pos = -1;
  testDoc.descendants((node, nodePos) => {
    if (
      pos === -1 &&
      node.type.name === "paragraph" &&
      node.content.size === 0
    ) {
      pos = nodePos + 1;
    }
    return true;
  });
  if (pos === -1) {
    throw new Error("no empty paragraph found");
  }
  return pos;
}

describe("splitDefinitionEntry", () => {
  it("declines when the current paragraph still has content", () => {
    const testDoc = doc(
      definitionList(
        definitionTerm("Term"),
        definitionBody([p("Definition text")])
      )
    );
    // Position inside "Definition text", not on an empty trailing paragraph.
    const pos = testDoc.content.size - 3;
    const { applied } = run(testDoc, pos, splitDefinitionEntry);
    expect(applied).toBe(false);
  });

  it("splits a trailing empty paragraph into a new entry", () => {
    const testDoc = doc(
      definitionList(
        definitionTerm("Term"),
        definitionBody([p("Definition text"), p("")])
      )
    );
    const pos = findEmptyParagraphPos(testDoc);
    const {
      applied,
      doc: result,
      selection,
    } = run(testDoc, pos, splitDefinitionEntry);

    expect(applied).toBe(true);
    const list = result.firstChild!;
    expect(list.childCount).toBe(4);
    expect(list.child(0).type.name).toBe("definition_term");
    expect(list.child(0).textContent).toBe("Term");
    expect(list.child(1).type.name).toBe("definition_body");
    expect(list.child(1).textContent).toBe("Definition text");
    expect(list.child(2).type.name).toBe("definition_term");
    expect(list.child(2).textContent).toBe("");
    expect(list.child(3).type.name).toBe("definition_body");
    expect(list.child(3).textContent).toBe("");

    // The cursor lands inside the new, empty term, ready for typing.
    expect(selection.$from.parent.type.name).toBe("definition_term");
    expect(selection.$from.parent.textContent).toBe("");
  });

  it("moves content after the empty paragraph into the new entry's body", () => {
    const testDoc = doc(
      definitionList(
        definitionTerm("Term"),
        definitionBody([p("Paragraph one"), p(""), p("Paragraph two")])
      )
    );
    const pos = findEmptyParagraphPos(testDoc);
    const { applied, doc: result } = run(testDoc, pos, splitDefinitionEntry);

    expect(applied).toBe(true);
    const list = result.firstChild!;
    expect(list.childCount).toBe(4);
    expect(list.child(1).textContent).toBe("Paragraph one");
    expect(list.child(3).textContent).toBe("Paragraph two");
  });

  it("declines when the empty paragraph is the entry's only content", () => {
    const testDoc = doc(
      definitionList(definitionTerm("Term"), definitionBody([p("")]))
    );
    const pos = findEmptyParagraphPos(testDoc);
    const { applied } = run(testDoc, pos, splitDefinitionEntry);
    expect(applied).toBe(false);
  });

  it("declines when the empty paragraph is nested inside a list, not a direct child of the body", () => {
    const testDoc = doc(
      definitionList(
        definitionTerm("Term"),
        definitionBody([p("Intro"), bulletList([""])])
      )
    );
    const pos = findEmptyParagraphPos(testDoc);
    const { applied } = run(testDoc, pos, splitDefinitionEntry);
    expect(applied).toBe(false);
  });
});

describe("moveIntoDefinitionBody", () => {
  it("moves the cursor into the following body when Enter is pressed in a term", () => {
    const testDoc = doc(
      definitionList(definitionTerm("Term"), definitionBody([p("Definition")]))
    );
    const pos = 3; // inside "Term"
    const { applied, selection } = run(testDoc, pos, moveIntoDefinitionBody);

    expect(applied).toBe(true);
    expect(selection.$from.parent.type.name).toBe("paragraph");
    expect(selection.$from.node(selection.$from.depth - 1).type.name).toBe(
      "definition_body"
    );
  });

  it("declines when the selection isn't inside a term", () => {
    const testDoc = doc(
      definitionList(definitionTerm("Term"), definitionBody([p("Definition")]))
    );
    const pos = testDoc.content.size - 3; // inside "Definition"
    const { applied } = run(testDoc, pos, moveIntoDefinitionBody);
    expect(applied).toBe(false);
  });
});

describe("insertGlossary", () => {
  it("replaces an empty paragraph with a one-entry glossary", () => {
    const testDoc = doc([p("before"), p("")]);
    const pos = findEmptyParagraphPos(testDoc);
    const {
      applied,
      doc: result,
      selection,
    } = run(testDoc, pos, insertGlossary);

    expect(applied).toBe(true);
    expect(result.childCount).toBe(2);
    const glossary = result.child(1);
    expect(glossary.type.name).toBe("container_directive");
    expect(glossary.attrs.directive).toBe("glossary");
    expect(glossary.firstChild?.type.name).toBe("definition_list");
    expect(glossary.firstChild?.childCount).toBe(2);
    expect(selection.$from.parent.type.name).toBe("definition_term");
    expect(() => result.check()).not.toThrow();
  });

  it("keeps a paragraph that has content and inserts after it", () => {
    const testDoc = doc([p("keep me"), p("after")]);
    const { applied, doc: result, selection } = run(testDoc, 3, insertGlossary);

    expect(applied).toBe(true);
    expect(result.childCount).toBe(3);
    expect(result.child(0).textContent).toBe("keep me");
    expect(result.child(1).type.name).toBe("container_directive");
    expect(result.child(2).textContent).toBe("after");
    expect(selection.$from.parent.type.name).toBe("definition_term");
  });

  it("declines where a directive is not allowed", () => {
    const testDoc = doc(
      definitionList(definitionTerm("Term"), definitionBody([p("Text")]))
    );
    // Inside the term itself, not a paragraph.
    const { applied } = run(testDoc, 3, insertGlossary);
    expect(applied).toBe(false);
  });

  it("round-trips through markdown once filled in", () => {
    const testDoc = doc([p("")]);
    let state = createEditorState(testDoc);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1))
    );
    insertGlossary(state, (tr) => {
      state = state.apply(tr);
    });
    state = state.apply(state.tr.insertText("Term"));
    const bodyPos = state.selection.$from.after() + 2;
    state = state.apply(state.tr.insertText("Definition", bodyPos));

    const markdown = serializer.serialize(state.doc);
    expect(markdown.trim()).toBe(":::{glossary}\nTerm\n   Definition\n\n:::");
    const reparsed = parser.parse(markdown);
    expect(reparsed?.firstChild?.type).toBe(schema.nodes.container_directive);
    expect(reparsed?.firstChild?.firstChild?.type).toBe(
      schema.nodes.definition_list
    );
  });
});
