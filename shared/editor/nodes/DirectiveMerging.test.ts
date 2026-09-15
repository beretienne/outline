import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { EditorState, TextSelection } from "prosemirror-state";
import DeleteEmptyDirective from "../extensions/DeleteEmptyDirective";
import { p, schema } from "@shared/test/editor";

/**
 * Builds an editor state wired up with the *actual* production keymap
 * pipeline for this specific behaviour — `DeleteEmptyDirective`'s own key
 * bindings, then the base keymap fallback (`joinBackward`/`joinForward`,
 * which is what `isolating: true` on `Directive`/`Notice`'s schemas
 * actually blocks) — rather than calling one command directly. This is
 * what determines whether pressing Backspace/Delete in the real editor
 * merges two directives: `Directive`/`Notice`'s own `isolating: true` stops
 * the default join from crossing their boundary, and
 * `DeleteEmptyDirective`'s own keymap entry is what still lets an already
 * emptied one be deleted outright — no single unit test in either commands
 * file exercises both layers together. (The editor's full extension list
 * isn't used here — most other extensions' `keys()` assume a bound
 * `this.editor`, which only a real, mounted `Editor` provides.)
 */
function createFullState(doc: ProsemirrorNode) {
  return EditorState.create({
    doc,
    schema,
    plugins: [keymap(new DeleteEmptyDirective().keys()), keymap(baseKeymap)],
  });
}

/**
 * Dispatches a key through every plugin's `handleKeyDown` in order, exactly
 * as a real `EditorView` would, and returns the resulting state.
 */
function dispatchKey(
  state: EditorState,
  key: string
): { applied: boolean; state: EditorState } {
  let next = state;
  const fakeView = {
    state: next,
    dispatch: (tr: Transaction) => {
      next = next.apply(tr);
    },
    // `joinBackward`/`joinForward` (from prosemirror-commands, used by the
    // base keymap) ask the view whether the cursor is visually at the
    // start/end of its textblock when one is provided. There's no real
    // layout here, so this approximates it structurally — true for every
    // selection this test ever creates (a lone cursor, never mid-line).
    endOfTextblock: (dir: string) => {
      const sel = next.selection;
      if (!(sel instanceof TextSelection) || !sel.$cursor) {
        return false;
      }
      return dir === "backward" || dir === "left"
        ? sel.$cursor.parentOffset === 0
        : sel.$cursor.parentOffset === sel.$cursor.parent.content.size;
    },
  };
  for (const plugin of state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler?.call(plugin, fakeView as never, { key } as KeyboardEvent)) {
      return { applied: true, state: next };
    }
  }
  return { applied: false, state: next };
}

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

describe("directive/notice merging, through the real keymap pipeline", () => {
  it("removing a blank line between two substantive directives leaves both intact, and further Backspace does nothing more", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("glossary"),
      p(""),
      directive("glossary"),
    ]);
    let state = createFullState(testDoc);
    const pos = testDoc.firstChild!.nodeSize + 1;
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos))
    );

    let result = dispatchKey(state, "Backspace");
    expect(result.applied).toBe(true);
    expect(result.state.doc.childCount).toBe(2);
    expect(result.state.doc.child(0).type.name).toBe("container_directive");
    expect(result.state.doc.child(1).type.name).toBe("container_directive");

    // Nothing left to remove at the boundary now — further Backspace
    // presses must not merge the two directives into one.
    result = dispatchKey(result.state, "Backspace");
    expect(result.state.doc.childCount).toBe(2);
    expect(result.state.doc.child(0).type.name).toBe("container_directive");
    expect(result.state.doc.child(1).type.name).toBe("container_directive");
  });

  it("an ifconfig immediately followed by a grid never merges, even with no blank line", () => {
    const testDoc = schema.nodes.doc.create(null, [
      directive("ifconfig", "Class == 'A'"),
      directive("grid", "2"),
    ]);
    const state = createFullState(testDoc);
    const pos = testDoc.firstChild!.nodeSize + 2;
    const withSelection = state.apply(
      state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)))
    );

    const result = dispatchKey(withSelection, "Backspace");
    expect(result.state.doc.childCount).toBe(2);
    expect(result.state.doc.child(0).attrs.directive).toBe("ifconfig");
    expect(result.state.doc.child(1).attrs.directive).toBe("grid");
    expect(result.state.doc.child(1).textContent).toBe("grid body");
  });

  it("an already-emptied directive is still deletable via Backspace", () => {
    const testDoc = schema.nodes.doc.create(null, [
      p("before"),
      directive("ifconfig", "", [p("")]),
    ]);
    const state = createFullState(testDoc);
    const pos = testDoc.firstChild!.nodeSize + 2;
    const withSelection = state.apply(
      state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)))
    );

    const result = dispatchKey(withSelection, "Backspace");
    expect(result.applied).toBe(true);
    let hasDirective = false;
    result.state.doc.descendants((node) => {
      if (node.type.name === "container_directive") {
        hasDirective = true;
      }
      return true;
    });
    expect(hasDirective).toBe(false);
    expect(result.state.doc.textContent).toBe("before");
  });
});
