import { inputRules } from "prosemirror-inputrules";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import type { Editor } from "../../../app/editor";
import {
  createEditorState,
  extensionManager,
  p,
  parser,
  schema,
  serializer,
} from "@shared/test/editor";
import MystComment from "./MystComment";

/**
 * Types `text` one character at a time through the editor's real, full
 * input-rule list, matching `TermReference.test.ts`'s own helper.
 */
function type(text: string) {
  const plugin = inputRules({ rules: extensionManager.inputRules({ schema }) });
  let state = EditorState.create({
    doc: schema.nodes.doc.create(null, [p("")]),
    schema,
    plugins: [plugin],
  });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1))
  );

  const view = {
    get state() {
      return state;
    },
    composing: false,
    dispatch: (tr: EditorState["tr"]) => {
      state = state.apply(tr);
    },
  };

  for (const char of text) {
    const { from, to } = state.selection;
    const handled = plugin.props.handleTextInput?.call(
      plugin,
      view as never,
      from,
      to,
      char,
      () => state.tr.insertText(char, from, to)
    );
    if (!handled) {
      state = state.apply(state.tr.insertText(char, from, to));
    }
  }
  return state;
}

/** Keys of a `MystComment` bound to a fake editor carrying the real, shared
 * test parser and serializer — the round trip commenting works through. */
function keys() {
  const extension = new MystComment();
  extension.bindEditor({ parser, serializer } as unknown as Editor);
  return extension.keys({ type: schema.nodes.myst_comment });
}

function markdown(doc: ProsemirrorNode): string {
  return serializer.serialize(doc, { commonMark: true }).trim();
}

/** The position just before the first occurrence of `text` in `doc`. */
function posOf(doc: ProsemirrorNode, text: string): number {
  let found: number | undefined;
  doc.descendants((node, pos) => {
    if (found !== undefined) {
      return false;
    }
    if (node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
    }
    return true;
  });
  if (found === undefined) {
    throw new Error(`"${text}" not found`);
  }
  return found;
}

/** A place in a document: the first occurrence of `text`, plus `offset`
 * characters. */
type Anchor = [text: string, offset?: number];

/** Parse `source`, select from `from` to `to` (a cursor when `to` is
 * omitted), press `key`, and return what happened. */
function press(key: string, source: string, from: Anchor, to: Anchor = from) {
  const doc = parser.parse(source);
  if (!doc) {
    throw new Error("parse failed");
  }
  let state = createEditorState(doc);
  const head = posOf(state.doc, from[0]) + (from[1] ?? 0);
  const tail = posOf(state.doc, to[0]) + (to[1] ?? 0);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, head, tail))
  );
  const applied = keys()[key](state, (tr) => {
    state = state.apply(tr);
  });
  return { applied, doc: state.doc, state };
}

function types(doc: ProsemirrorNode): string[] {
  const found: string[] = [];
  doc.forEach((node) => found.push(node.type.name));
  return found;
}

/** How many hard breaks `doc` holds. */
function breaks(doc: ProsemirrorNode): number {
  let found = 0;
  doc.descendants((node) => {
    if (node.type.name === "br") {
      found++;
    }
    return true;
  });
  return found;
}

describe("MystComment input rule", () => {
  it("turns '% ' at the start of an empty paragraph into a comment line", () => {
    const state = type("% a MyST comment");
    expect(state.doc.firstChild?.type.name).toBe("myst_comment");
    expect(state.doc.firstChild?.textContent).toBe("a MyST comment");
    expect(markdown(state.doc)).toBe("% a MyST comment");
  });

  it("leaves '50% ' mid-word alone", () => {
    const state = type("50% of things");
    expect(state.doc.firstChild?.type.name).toBe("paragraph");
  });
});

describe("MystComment Enter", () => {
  it("starts the next comment line, written back without a blank line", () => {
    const { applied, doc } = press("Enter", "% line one", [
      "line one",
      "line one".length,
    ]);
    expect(applied).toBe(true);
    expect(types(doc)).toEqual(["myst_comment", "myst_comment"]);
    expect(doc.child(1).attrs.tight).toBe(true);
    expect(markdown(doc)).toBe("% line one\n%");
  });

  it("on an empty comment line, leaves the comment", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.myst_comment.create({ tight: false, spaced: true }),
    ]);
    let state = createEditorState(doc);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1))
    );
    keys().Enter(state, (tr) => {
      state = state.apply(tr);
    });
    expect(types(state.doc)).toEqual(["paragraph"]);
  });
});

describe("MystComment un-comment (Backspace at the start, Mod-/)", () => {
  it("restores a line exactly as it was, indentation deciding its nesting", () => {
    // The sub-item's indentation puts it inside "a" once it is no longer a
    // comment — exactly what removing its `%` in the source would do.
    const source = "* a\n\n%    * sub";
    const { applied, doc } = press("Backspace", source, ["   * sub"]);
    expect(applied).toBe(true);
    expect(types(doc)).toEqual(["bullet_list"]);
    expect(markdown(doc)).toBe("* a\n  * sub");
  });

  it("restores a commented-out list with its marker and its nesting", () => {
    const source = "% -  one\n%    -  nested\n% -  two";
    const { applied, doc } = press("Mod-/", source, ["-  one"], ["-  two"]);
    expect(applied).toBe(true);
    expect(types(doc)).toEqual(["bullet_list"]);
    // The marker is kept; the spacing after it becomes one space.
    expect(markdown(doc)).toBe("- one\n  - nested\n- two");
  });

  it("restores only the line it is on, leaving the lines around it commented", () => {
    const source = "% one\n% two\n% three";
    const { doc, state } = press("Backspace", source, ["two"]);
    expect(types(doc)).toEqual(["myst_comment", "paragraph", "myst_comment"]);
    expect(doc.child(1).textContent).toBe("two");
    // The cursor stays on the restored line, at its end.
    expect(state.selection.$from.parent.textContent).toBe("two");
    expect(state.selection.$from.parentOffset).toBe("two".length);
  });

  it("brings formatting back from its Markdown", () => {
    const { doc } = press("Backspace", "% Some **bold** text", ["Some"]);
    expect(doc.firstChild?.type.name).toBe("paragraph");
    const marks: string[] = [];
    doc.descendants((node) => {
      node.marks.forEach((mark) => marks.push(mark.type.name));
    });
    expect(marks).toEqual(["strong"]);
  });

  it("puts a glossary entry back into its glossary", () => {
    const source = [
      ":::{glossary}",
      "Term one",
      "   Definition one.",
      "",
      "% Term two",
      "%    Definition two.",
      "",
      "Term three",
      "   Definition three.",
      ":::",
    ].join("\n");
    const { applied, doc } = press(
      "Mod-/",
      source,
      ["Term two"],
      ["Definition two."]
    );
    expect(applied).toBe(true);
    const glossary = doc.firstChild!;
    expect(glossary.childCount).toBe(1);
    const terms: string[] = [];
    glossary.firstChild!.forEach((child) => {
      if (child.type.name === "definition_term") {
        terms.push(child.textContent);
      }
    });
    expect(terms).toEqual(["Term one", "Term two", "Term three"]);
  });

  it("turns an empty comment line into an empty paragraph", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.myst_comment.create({ tight: false, spaced: true }),
    ]);
    let state = createEditorState(doc);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1))
    );
    const applied = keys().Backspace(state, (tr) => {
      state = state.apply(tr);
    });
    expect(applied).toBe(true);
    expect(types(state.doc)).toEqual(["paragraph"]);
  });

  it("Backspace anywhere but the start of the line does nothing special", () => {
    const { applied } = press("Backspace", "% one", ["ne"]);
    expect(applied).toBe(false);
  });
});

describe("MystComment comment out (Mod-/, the Comment menu entry)", () => {
  it("comments out a list item as a whole line; the list continues around it", () => {
    const { applied, doc, state } = press("Mod-/", "* a\n* b\n* c", ["b"]);
    expect(applied).toBe(true);
    expect(types(doc)).toEqual(["bullet_list", "myst_comment", "bullet_list"]);
    expect(doc.child(1).textContent).toBe("* b");
    // The cursor stays on the line just commented out.
    expect(state.selection.$from.parent.type.name).toBe("myst_comment");
  });

  it("keeps formatting in the comment as Markdown", () => {
    const { doc } = press("Mod-/", "Some **bold** text", ["Some"]);
    expect(doc.firstChild?.type.name).toBe("myst_comment");
    expect(doc.firstChild?.textContent).toBe("Some **bold** text");
  });

  it("comments every selected line, one comment line each", () => {
    const { doc } = press("Mod-/", "* a\n* b\n* c", ["a"], ["c"]);
    expect(types(doc)).toEqual([
      "myst_comment",
      "myst_comment",
      "myst_comment",
    ]);
    expect(markdown(doc)).toBe("% * a\n% * b\n% * c");
  });

  it("round-trips: commented out, then back, gives the same list", () => {
    const commented = press("Mod-/", "* a\n* b\n* c", ["b"]);
    let state = createEditorState(commented.doc);
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, posOf(state.doc, "* b"))
      )
    );
    keys()["Mod-/"](state, (tr) => {
      state = state.apply(tr);
    });
    expect(types(state.doc)).toEqual(["bullet_list"]);
    const items: string[] = [];
    state.doc.firstChild!.forEach((item) => items.push(item.textContent));
    expect(items).toEqual(["a", "b", "c"]);
  });

  describe("in a glossary", () => {
    const glossary = [
      ":::{glossary}",
      "Term one",
      "   Definition one.",
      "",
      "Term two",
      "   Definition two.",
      "",
      "   Second paragraph of two.",
      "",
      "Term three",
      "   Definition three.",
      ":::",
    ].join("\n");

    function children(doc: ProsemirrorNode) {
      const found: string[] = [];
      doc.firstChild!.forEach((child) =>
        found.push(
          child.type.name === "myst_comment"
            ? `% ${child.textContent}`
            : child.type.name
        )
      );
      return found;
    }

    function terms(doc: ProsemirrorNode) {
      const found: string[] = [];
      doc.descendants((node) => {
        if (node.type.name === "definition_term") {
          found.push(node.textContent);
        }
        return true;
      });
      return found;
    }

    it("a term comments out its whole entry", () => {
      const { applied, doc } = press("Mod-/", glossary, ["Term two"]);
      expect(applied).toBe(true);
      expect(children(doc)).toEqual([
        "definition_list",
        "% Term two",
        "%    Definition two.",
        "%    Second paragraph of two.",
        "definition_list",
      ]);
      expect(terms(doc)).toEqual(["Term one", "Term three"]);
    });

    it("writes a commented-out entry with .., the comment Sphinx's glossary reads", () => {
      const { doc } = press("Mod-/", glossary, ["Term two"]);
      expect(markdown(doc)).toContain(
        "\n\n.. Term two\n..    Definition two.\n\n..    Second paragraph of two.\n\n"
      );
    });

    // A definition is MyST of its own to Sphinx: a comment in it stays in
    // it, at its indentation, and the term keeps its entry.
    it("the first line of a definition comments out on its own", () => {
      const { applied, doc } = press("Mod-/", glossary, ["Definition two."]);
      expect(applied).toBe(true);
      expect(terms(doc)).toEqual(["Term one", "Term two", "Term three"]);
      expect(children(doc)).toEqual(["definition_list"]);
      expect(markdown(doc)).toContain(
        "Term two\n   % Definition two.\n\n   Second paragraph of two."
      );
    });

    it("a later paragraph of a definition comments out on its own", () => {
      const { doc } = press("Mod-/", glossary, ["Second paragraph"]);
      expect(terms(doc)).toEqual(["Term one", "Term two", "Term three"]);
      expect(children(doc)).toEqual(["definition_list"]);
      expect(markdown(doc)).toContain(
        "   Definition two.\n\n   % Second paragraph of two."
      );
    });

    it("a glossary's only entry comments out, leaving it empty", () => {
      const single = ":::{glossary}\nOnly term\n   Its definition.\n:::";
      const commented = press("Mod-/", single, ["Only term"]);
      expect(commented.applied).toBe(true);
      expect(types(commented.doc)).toEqual(["container_directive"]);
      expect(terms(commented.doc)).toEqual([]);
      expect(children(commented.doc)).toEqual([
        "% Only term",
        "%    Its definition.",
      ]);

      const restored = press("Mod-/", markdown(commented.doc), ["Only term"]);
      expect(restored.applied).toBe(true);
      expect(markdown(restored.doc)).toBe(markdown(parser.parse(single)!));
    });

    describe("a list in a definition", () => {
      const entry = [
        ":::{glossary}",
        "Size error",
        "   The error in size, including:",
        "",
        "   - Measurement error",
        "   - Configuration error",
        ":::",
      ].join("\n");

      it.each([
        ["The error in size", "   % The error in size, including:"],
        ["Measurement error", "   % - Measurement error"],
        ["Configuration error", "   % - Configuration error"],
      ])("comments out %s alone, and back", (line, written) => {
        const commented = press("Mod-/", entry, [line]);
        expect(commented.applied).toBe(true);
        expect(terms(commented.doc)).toEqual(["Size error"]);
        expect(markdown(commented.doc)).toContain(`\n${written}\n`);

        const restored = press("Mod-/", markdown(commented.doc), [line]);
        expect(restored.applied).toBe(true);
        expect(markdown(restored.doc)).toBe(markdown(parser.parse(entry)!));
      });
    });

    it("commented out and back gives the same glossary", () => {
      const commented = press("Mod-/", glossary, ["Term two"]);
      let state = createEditorState(commented.doc);
      state = state.apply(
        state.tr.setSelection(
          TextSelection.create(
            state.doc,
            posOf(state.doc, "Term two"),
            posOf(state.doc, "Second paragraph")
          )
        )
      );
      keys()["Mod-/"](state, (tr) => {
        state = state.apply(tr);
      });
      expect(children(state.doc)).toEqual(["definition_list"]);
      expect(terms(state.doc)).toEqual(["Term one", "Term two", "Term three"]);
    });

    it("keeps a hard break in the definition through comment and back", () => {
      const withBreak = glossary.replace(
        "   Definition two.",
        "   Definition two.  \n   Its second line."
      );
      const commented = press("Mod-/", withBreak, ["Term two"]);
      expect(children(commented.doc)).toContain("%    Definition two.  ");

      let state = createEditorState(commented.doc);
      state = state.apply(
        state.tr.setSelection(
          TextSelection.create(
            state.doc,
            posOf(state.doc, "Term two"),
            posOf(state.doc, "Second paragraph")
          )
        )
      );
      keys()["Mod-/"](state, (tr) => {
        state = state.apply(tr);
      });
      expect(children(state.doc)).toEqual(["definition_list"]);
      expect(breaks(state.doc)).toBe(1);
      expect(markdown(state.doc)).toBe(markdown(parser.parse(withBreak)!));
    });

    it("un-comments a definition whose body is a single comment line", () => {
      // Was silently declined: writing the region back out put a blank
      // line between "Term two" and its body — MyST's own rule for ending
      // a definition list there — so the round trip that reads the result
      // back would have dropped the term. See the serializer test with the
      // same shape for the root cause.
      const source = [
        ":::{glossary}",
        "Term one",
        "   Definition one.",
        "",
        "Term two",
        "   % Commented definition.",
        ":::",
      ].join("\n");
      const { applied, doc } = press("Backspace", source, [
        "Commented definition.",
      ]);
      expect(applied).toBe(true);
      expect(terms(doc)).toEqual(["Term one", "Term two"]);
      expect(children(doc)).toEqual(["definition_list"]);
    });
  });

  it("keeps a hard break through comment and back", () => {
    const source = "Line one.  \nLine two.\n\nAfter.";
    const commented = press("Mod-/", source, ["Line one."]);
    expect(types(commented.doc)).toEqual([
      "myst_comment",
      "myst_comment",
      "paragraph",
    ]);
    expect(commented.doc.firstChild?.textContent).toBe("Line one.  ");

    let state = createEditorState(commented.doc);
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(
          state.doc,
          posOf(state.doc, "Line one."),
          posOf(state.doc, "Line two.")
        )
      )
    );
    keys()["Mod-/"](state, (tr) => {
      state = state.apply(tr);
    });
    expect(types(state.doc)).toEqual(["paragraph", "paragraph"]);
    expect(breaks(state.doc)).toBe(1);
    expect(markdown(state.doc)).toBe(markdown(parser.parse(source)!));
  });

  it("refuses a selection that crosses into a directive's fence", () => {
    const source = "Before.\n\n:::{ifconfig} Class == 'A'\nInside.\n:::";
    const { applied } = press("Mod-/", source, ["Before."], ["Inside."]);
    expect(applied).toBe(false);
  });
});

describe("MystComment and hard breaks", () => {
  // A paragraph cannot end in a hard break: a line put back on its own,
  // before the line its break joined it to, would lose it for good.
  it.each([
    [
      "a paragraph",
      "Line one.  \nLine two.\n\nAfter.",
      ["Line one", "Line two"],
    ],
    [
      "a list item",
      "- Item one.  \n  Its second line.\n- Item two.",
      ["Item one", "second line"],
    ],
    [
      "a glossary definition",
      ":::{glossary}\nTerm\n   Line one.  \n   Line two.\n:::",
      ["Line one", "Line two"],
    ],
    [
      "a backslash break",
      "Line one.\\\nLine two.\n\nAfter.",
      ["Line one", "Line two"],
    ],
  ])(
    "putting back either line of %s brings the other, break included",
    (_name, source, lines) => {
      const original = markdown(parser.parse(source)!);
      const commented = markdown(press("Mod-/", source, [lines[0], 1]).doc);
      for (const line of lines) {
        const restored = press("Mod-/", commented, [line]);
        expect(restored.applied).toBe(true);
        expect(markdown(restored.doc)).toBe(original);
      }
    }
  );

  it("still puts back lines no break joins one at a time", () => {
    const { doc } = press("Backspace", "% one\n% two  \n% three", ["one"]);
    expect(types(doc)).toEqual(["paragraph", "myst_comment", "myst_comment"]);
  });
});

describe("MystComment and dividers", () => {
  /** Select the `n`th divider of `source` and press Mod-/. */
  function commentDivider(source: string) {
    const doc = parser.parse(source)!;
    let pos: number | undefined;
    doc.descendants((node, p) => {
      if (pos === undefined && node.type.name === "hr") {
        pos = p;
      }
      return pos === undefined;
    });
    let state = createEditorState(doc);
    state = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, pos!))
    );
    const applied = keys()["Mod-/"](state, (tr) => {
      state = state.apply(tr);
    });
    return { applied, doc: state.doc };
  }

  it.each([
    ["---", "Before.\n\n---\n\nAfter."],
    ["*** (Outline's page break)", "Before.\n\n***\n\nAfter."],
    [
      "--- in a glossary definition",
      ":::{glossary}\nTerm\n   Before.\n\n   ---\n\n   After.\n:::",
    ],
  ])("comments out a selected %s, and puts it back", (_name, source) => {
    const commented = commentDivider(source);
    expect(commented.applied).toBe(true);
    const written = markdown(commented.doc);
    expect(written).toMatch(/^ *% (---|\*\*\*)$/m);

    const marker = /% (---|\*\*\*)/.exec(written)![1];
    const restored = press("Backspace", written, [marker]);
    expect(restored.applied).toBe(true);
    expect(markdown(restored.doc)).toBe(markdown(parser.parse(source)!));
  });
});

describe("MystComment toMarkdown", () => {
  it("writes every line with its marker, even nested in a list item", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, [
          p("item"),
          schema.nodes.myst_comment.create(
            { tight: false, spaced: true },
            schema.text("a")
          ),
          schema.nodes.myst_comment.create(
            { tight: true, spaced: true },
            schema.text("b")
          ),
        ]),
      ]),
    ]);
    expect(serializer.serialize(doc).trim()).toBe("* item\n\n  % a\n  % b");
  });
});
