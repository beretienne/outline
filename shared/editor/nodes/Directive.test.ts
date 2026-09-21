import type { Node as ProsemirrorNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  createEditorState,
  extensionManager,
  p,
  schema,
  serializer,
} from "@shared/test/editor";
import Directive from "./Directive";

/**
 * Deletes all of a node's own content and returns what ProseMirror leaves
 * behind in its place.
 *
 * Mirrors what happens live when a user selects an entire block's content
 * (e.g. a `{glossary}`'s only entry) and presses Delete/Backspace: the
 * containing node's content expression requires at least one child
 * ("(...)+"), so ProseMirror synthesizes a default one from scratch rather
 * than leaving the node empty.
 */
function deleteAllContentOf(container: ProsemirrorNode) {
  const testDoc = schema.nodes.doc.create(null, container);
  const state = createEditorState(testDoc);
  const containerPos = 1;
  const contentStart = containerPos;
  const contentEnd = containerPos + testDoc.firstChild!.content.size;
  return state.apply(state.tr.delete(contentStart, contentEnd)).doc.firstChild!;
}

/**
 * A real, previously-shipped bug: with `list` listed first in a broad
 * content expression, deleting all of a block's content left an empty
 * checkbox item (`- [ ]`) behind instead of an empty paragraph —
 * ProseMirror's default content-fill takes the first alternative in the
 * expression that is trivially createable, and `list` resolves to
 * `checkbox_list` > `checkbox_item` here. Reported live: deleting a
 * `{glossary}` entry left a checkbox where the entry used to be.
 */
describe("deleting all content leaves an empty paragraph, not a checkbox", () => {
  it("in a container_directive (e.g. {glossary}, {ifconfig}, {grid})", () => {
    const directive = schema.nodes.container_directive.create(
      null,
      p("content")
    );
    const result = deleteAllContentOf(directive);
    expect(result.childCount).toBe(1);
    expect(result.firstChild!.type.name).toBe("paragraph");
  });

  it("in a container_notice (e.g. {note}, {warning})", () => {
    const notice = schema.nodes.container_notice.create(null, p("content"));
    const result = deleteAllContentOf(notice);
    expect(result.childCount).toBe(1);
    expect(result.firstChild!.type.name).toBe("paragraph");
  });

  it("in a definition_body", () => {
    const body = schema.nodes.definition_body.create(null, p("content"));
    const result = deleteAllContentOf(body);
    expect(result.childCount).toBe(1);
    expect(result.firstChild!.type.name).toBe("paragraph");
  });
});

/**
 * Runs the slash menu's own `container_directive` command with the cursor
 * placed at `pos`.
 */
function insert(
  testDoc: ReturnType<typeof schema.nodes.doc.create>,
  pos: number,
  attrs: Record<string, string>
) {
  const directive = extensionManager.extensions.find(
    (extension) => extension instanceof Directive
  );
  if (!(directive instanceof Directive)) {
    throw new Error("Directive extension not registered");
  }
  const command = directive
    .commands({ type: schema.nodes.container_directive })
    .container_directive(attrs);

  let state = createEditorState(testDoc);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos))
  );
  const applied = command(state, (tr) => {
    state = state.apply(tr);
  });
  return { applied, doc: state.doc, selection: state.selection };
}

describe("Directive container_directive command", () => {
  it("wraps an empty paragraph, keeping the cursor inside", () => {
    const testDoc = schema.nodes.doc.create(null, [p("")]);
    const { applied, doc, selection } = insert(testDoc, 1, {
      directive: "grid",
      argument: "2",
    });

    expect(applied).toBe(true);
    expect(doc.firstChild?.type.name).toBe("container_directive");
    expect(doc.firstChild?.attrs.argument).toBe("2");
    expect(selection.$from.parent.type.name).toBe("paragraph");
    expect(selection.$from.depth).toBe(2);
  });

  it("nests inside an existing directive instead of unwrapping it", () => {
    const testDoc = schema.nodes.doc.create(null, [
      schema.nodes.container_directive.create(
        { directive: "grid", argument: "2" },
        [p("cell")]
      ),
    ]);
    const { applied, doc } = insert(testDoc, 3, { directive: "grid-item" });

    expect(applied).toBe(true);
    const grid = doc.firstChild;
    expect(grid?.attrs.directive).toBe("grid");
    expect(grid?.firstChild?.attrs.directive).toBe("grid-item");
    expect(serializer.serialize(doc).trim()).toBe(
      "::::{grid} 2\n:::{grid-item}\ncell\n\n:::\n\n::::"
    );
  });

  it("routes glossary to a real definition list", () => {
    const testDoc = schema.nodes.doc.create(null, [p("")]);
    const { applied, doc } = insert(testDoc, 1, { directive: "glossary" });

    expect(applied).toBe(true);
    expect(doc.firstChild?.firstChild?.type.name).toBe("definition_list");
  });
});
