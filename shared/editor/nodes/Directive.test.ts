import type { Node as ProsemirrorNode } from "prosemirror-model";
import { createEditorState, p, schema } from "@shared/test/editor";

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
