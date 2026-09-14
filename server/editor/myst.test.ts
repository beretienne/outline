import { parser, schema, serializer } from ".";

/**
 * Round-trips markdown through the parser and a `commonMark: true`
 * serializer — the shape an export or an outline-sync pull gets back, via
 * routes such as `documents.export` that pass that flag to
 * `DocumentHelper.toMarkdown`.
 *
 * `documents.info`, the general-purpose read every other API caller and the
 * realtime websocket feed go through, does not set the flag: `presentDocument`
 * calls `toMarkdown` without it, so a hard break there still serializes as a
 * literal backslash-n rather than a trailing double space. Whether that gap
 * matters depends on which endpoint a given sync tool actually pulls from.
 */
function roundTrip(text: string): string {
  const node = parser.parse(text);
  if (!node) {
    throw new Error("parser returned no node");
  }
  return serializer.serialize(node, { commonMark: true }).trim();
}

/**
 * Markdown that survives a round-trip byte for byte. A tool syncing a Sphinx
 * source tree can push and pull these without ever rewriting the file on disk.
 *
 * Every construct here is enabled by the `myst_enable_extensions` list the docs
 * projects use: amsmath, colon_fence, deflist, dollarmath, html_admonition,
 * html_image, linkify, replacements, smartquotes, substitution, tasklist
 * (plus attrs_inline for doc-metas).
 */
describe("preserved exactly", () => {
  test.each([
    ["heading", "# Title"],
    ["paragraph", "Some prose."],
    ["bold", "**bold**"],
    ["italic", "*italic*"],
    ["inline code", "`code`"],
    ["link", "[label](https://example.com)"],
    ["image", "![alt](media/photo.png)"],
    ["image with attrs_inline", '![alt](media/photo.png){width="50%"}'],
    ["bullet list (asterisk)", "* one\n* two"],
    ["ordered list", "1. one\n2. two"],
    ["tasklist", "- [ ] todo\n- [x] done"],
    ["blockquote", "> quoted"],
    ["fenced code", "```python\nprint(1)\n```"],
    ["thematic break", "---"],
    ["inline math (dollarmath)", "$x^2$"],
    ["block math (dollarmath)", "$$\nx^2\n$$"],
  ])("%s", (_name, source) => {
    expect(roundTrip(source)).toBe(source);
  });

  /**
   * Directives Outline has no node for are preserved because CodeFence stores
   * the fence info string as a `language` attribute. Ordinarily that attribute
   * is cut to its first word so it cannot break the fence line, but an info
   * string opening with a `{directive}` is kept whole, argument included, since
   * `{toctree} Contents` without its title is not the same directive.
   * They render as inert code blocks in Outline but come back as valid MyST.
   */
  test.each([
    ["toctree", "```{toctree} Contents\n:maxdepth: 2\n\ndoc1\ndoc2\n```"],
    ["margin", "```{margin}\nAside.\n```"],
    ["eval-rst", "```{eval-rst}\n.. index:: term\n```"],
    ["rubric", "```{rubric} Heading\n```"],
  ])("unsupported directive: %s", (_name, source) => {
    expect(roundTrip(source)).toBe(source);
  });

  /**
   * A backtick fence whose info string is a bare word stays a code block, even
   * when that word happens to name an admonition. MyST writes directives in
   * braces, and ```error is far more likely to open a block of error output.
   */
  test.each([
    ["error", "```error\nsome error output\n```"],
    ["note", "```note\nnot a directive\n```"],
  ])("bare info string stays a code block: %s", (_name, source) => {
    expect(roundTrip(source)).toBe(source);
  });

  /**
   * Inline MyST constructs are opaque to Outline and travel as literal text.
   */
  test.each([
    ["role", "See {term}`resolution` for details."],
    ["cross-reference target", "(my-label)="],
    ["substitution", "The {{ CAM }} unit."],
    ["comment", "% a MyST comment"],
  ])("inline construct: %s", (_name, source) => {
    expect(roundTrip(source)).toBe(source);
  });
});

/**
 * Markdown Outline rewrites into an equivalent canonical form. These are not
 * losses — the meaning is preserved and the result is still valid MyST — but a
 * sync tool must expect the file on disk to change on the first pull. Pinning
 * the canonical form here means any future drift shows up as a failing test
 * rather than as churn in a docs repository.
 */
describe("normalized to a canonical form", () => {
  test.each([
    ["dash bullets become asterisks", "- one\n- two", "* one\n* two"],
    [
      "table cells are padded to column width",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "| a   | b   |\n|-----|-----|\n| 1   | 2   |",
    ],
    [
      "admonition bodies gain a trailing blank line",
      "```{note}\nBody.\n```",
      "```{note}\nBody.\n\n```",
    ],
    [
      "colon-fence admonitions become directive fences",
      ":::note\nBody.\n:::",
      "```{note}\nBody.\n\n```",
    ],
    [
      "legacy Outline notice styles become MyST directives",
      ":::info\nBody.\n:::",
      "```{note}\nBody.\n\n```",
    ],
    [
      "warning notices map to caution",
      ":::warning\nBody.\n:::",
      "```{caution}\nBody.\n\n```",
    ],
    [
      "success notices map to seealso",
      ":::success\nBody.\n:::",
      "```{seealso}\nBody.\n\n```",
    ],
    [
      "tip bodies gain a trailing blank line",
      "```{tip}\nBody.\n```",
      "```{tip}\nBody.\n\n```",
    ],
    [
      "caution bodies gain a trailing blank line",
      "```{caution}\nBody.\n```",
      "```{caution}\nBody.\n\n```",
    ],
    [
      "seealso bodies gain a trailing blank line",
      "```{seealso}\nBody.\n```",
      "```{seealso}\nBody.\n\n```",
    ],
  ])("%s", (_name, source, canonical) => {
    expect(roundTrip(source)).toBe(canonical);
  });
});

/**
 * Every MyST admonition becomes a Notice node, so it is drawn as a callout
 * rather than as an inert code block — and comes back with its directive name,
 * title and option lines intact. The only change is the blank line the
 * serializer leaves before the closing fence, which is stable.
 *
 * The Notice node carries `directive`, `title` and `options` for exactly this
 * reason. Without them a callout could only be one of four things, and anything
 * else about the directive was lost the moment it was drawn.
 */
describe("admonitions become notices without losing anything", () => {
  test.each([
    ["generic admonition", "```{admonition}\nBody.\n```"],
    ["titled note", "```{note} Custom Title\nBody.\n```"],
    ["titled generic admonition", "```{admonition} Custom Title\nBody.\n```"],
    ["bold title", "```{admonition} **Important note**\nBody.\n```"],
    ["warning", "```{warning}\nBody.\n```"],
    ["danger", "```{danger}\nBody.\n```"],
    ["attention", "```{attention}\nBody.\n```"],
    ["hint", "```{hint}\nBody.\n```"],
    ["important", "```{important}\nBody.\n```"],
    ["error", "```{error}\nBody.\n```"],
    ["options", "```{note}\n:class: custom\n\nBody.\n```"],
    [
      "several options",
      "```{note}\n:class: custom\n:name: label\n\nBody.\n```",
    ],
    ["titled, with options", "```{note} Title\n:class: custom\n\nBody.\n```"],
    [
      "the real case from doc-metas",
      "```{admonition} Important\n:class: danger\n\nBody.\n```",
    ],
  ])("%s", (_name, source) => {
    const expected = source.replace(/\n```$/, "\n\n```");
    expect(roundTrip(source)).toBe(expected);
    expect(roundTrip(expected)).toBe(expected);
  });

  test("an admonition whose body is only options keeps an empty body", () => {
    // Lifting the options leaves nothing behind, and a notice with no content
    // is filled in by ProseMirror with a checkbox list. The rule leaves an
    // empty paragraph instead, which serializes as a blank line.
    const once = roundTrip("```{note}\n:class: custom\n```");
    expect(once).toBe("```{note}\n:class: custom\n\n\n```");
    expect(once).not.toContain("[ ]");
    expect(roundTrip(once)).toBe(once);
  });

  test("a colon-fenced admonition keeps its title and options", () => {
    // How doc-metas actually wrote it. The colon fence is Outline's own notice
    // syntax as well as MyST's, so this one is claimed on the way in and given
    // back on a backtick fence — the spelling MyST reads either way.
    expect(
      roundTrip(":::{admonition} Important\n:class: danger\n\nBody.\n:::")
    ).toBe("```{admonition} Important\n:class: danger\n\nBody.\n\n```");
  });
});

/**
 * A notice node can hold lists, blockquotes, rules, paragraphs, headings, code
 * and attachments — and nothing else. When a directive's body holds anything
 * further, making it a notice does not fail loudly: the node cannot be built and
 * the whole block vanishes from the document.
 *
 * So those fences are not claimed. They render as inert code blocks, the same
 * bargain every directive Outline has no node for already makes, and every byte
 * survives. The alternative is a callout that eats its own contents.
 */
describe("directives holding what a notice cannot", () => {
  test.each([
    ["a table", "```{note}\n| a | b |\n|---|---|\n| 1 | 2 |\n```"],
    ["a math block", "```{note}\nProse.\n\n$$\nx^2\n$$\n```"],
    [
      "a nested colon directive",
      "````{note}\nProse.\n\n:::{tip}\nInner.\n:::\n````",
    ],
    ["a toggle block", "````{note}\nProse.\n\n+++\nHidden.\n+++\n````"],
  ])("stays a code fence rather than being emptied: %s", (_name, source) => {
    const once = roundTrip(source);
    expect(once).not.toBe("");
    expect(once).toContain("{note}");
  });

  test("the real nested figure from doc-model-approval survives whole", () => {
    // `::::{admonition}` wrapping a `:::{figure-md}`. Claiming this dropped the
    // prose, the image and the caption in one go.
    const source = [
      "````{admonition} Important note",
      ":class: danger",
      "",
      "Ensure that the cables are routed to the rear of the camera mount.",
      "",
      ":::{figure-md} camera_wiring_11",
      "![](media/Connecting_the_camera.011.png){width=600}",
      "",
      "Camera wiring - 11",
      ":::",
      "````",
    ].join("\n");

    const once = roundTrip(source);
    expect(once).toContain("Connecting_the_camera.011.png");
    expect(once).toContain("Camera wiring - 11");
    expect(once).toContain("camera_wiring_11");
    expect(once).toContain("Ensure that the cables");
  });
});

/**
 * Known limits of the colon container, both predating the notice work. It
 * claims every `:::` fence on sight, before anything can look at what is inside.
 *
 * `outline-sync` keeps a source tree clear of both by moving admonitions onto
 * backtick fences before pushing.
 */
describe("known limits of the colon container", () => {
  test("a colon fence holding a table is emptied", () => {
    // `{note}` is a real admonition, so this one is still handed to
    // container_notice, which decides from the info string alone, before
    // there is anything to look at — the backtick path checks its contents
    // before claiming; this one cannot.
    expect(roundTrip(":::{note}\n| a | b |\n|---|---|\n| 1 | 2 |\n:::")).toBe(
      ""
    );
  });
});

/**
 * A colon fence whose info string names no admonition — `{glossary}`,
 * `{ifconfig}`, `{grid}`, `{margin}`, a custom Sphinx directive, or anything
 * markdown-it-container would otherwise have claimed on sight — round-trips
 * byte for byte, the same guarantee the backtick path already gives every
 * directive Outline has no node for. Recorded verbatim as a `code_fence`
 * carrying the original marker character and run length, rather than being
 * parsed as a notice and coming back mangled or, for a nested body,
 * dropped from the document entirely.
 *
 * Every row here previously round-tripped into `{note}` with its structure
 * collapsed, or into the empty string.
 */
describe("colon-fenced directives with no notice claim it", () => {
  test.each([
    [
      "a definition list under {glossary}",
      ":::::{glossary}\nTerm\n: Definition\n:::::",
    ],
    [
      "{ifconfig} wrapping a table",
      "::::{ifconfig} Class == 'A'\n| a | b |\n|---|---|\n| 1 | 2 |\n::::",
    ],
    [
      "{ifconfig} wrapping a nested {figure-md}",
      "::::{ifconfig} Class == 'A'\n:::{figure-md} label\n![](x.png)\n\nCaption\n:::\n::::",
    ],
    ["{margin}", ":::{margin}\nAside.\n:::"],
    [
      "{grid} wrapping two {grid-item} fences",
      "::::::{grid} 2\n:::{grid-item}\nOne\n:::\n:::{grid-item}\nTwo\n:::\n::::::",
    ],
    // Previously the plan's own "known limit": swallowed into a bare note.
    ["a dropdown", ":::{dropdown} More\nHidden.\n:::"],
    // A custom Sphinx admonition subclass, as the FM manual uses.
    ["a custom admonition subclass", ":::{vm}\nBody.\n:::"],
  ])("%s", (_name, source) => {
    expect(roundTrip(source)).toBe(source);
    expect(roundTrip(roundTrip(source))).toBe(source);
  });

  test("survives indented inside a list item", () => {
    const source = "1. Step\n\n   :::{margin}\n   Aside.\n   :::";
    expect(roundTrip(source)).toBe(source);
  });

  test("an admonition name is still claimed as a notice, unaffected", () => {
    expect(roundTrip(":::{note}\nBody.\n:::")).toBe("```{note}\nBody.\n\n```");
    expect(roundTrip(":::warning\nBody.\n:::")).toBe(
      "```{caution}\nBody.\n\n```"
    );
  });

  test("an unclosed fence auto-closes at end of document", () => {
    expect(roundTrip(":::{glossary}\nTerm\n: Def")).toBe(
      ":::{glossary}\nTerm\n: Def\n:::"
    );
  });

  test("a backtick code example inside does not collide, because the wrapper stays on colons", () => {
    // Flattening every fence to backticks on output — CodeFence's only option
    // before it could carry `fenceChar` — would end this block at the inner
    // ``` instead of the outer :::, truncating everything after it. Keeping
    // the wrapper on colons sidesteps the collision entirely, at any nesting
    // depth, without needing to know how deep the content goes.
    const source = ":::{margin}\n```python\nprint(1)\n```\n:::";
    expect(roundTrip(source)).toBe(source);
  });
});

/**
 * `{figure-md}` and `{figure}` become a real Figure node — an ordinary,
 * editable image with its caption in the same `alt` field every other
 * image already uses — instead of an inert code block, when the body is
 * exactly a lone image with, at most, a plain-text caption.
 *
 * The label MyST cross-references point at, and a recognized pixel width
 * written as `{width=…}` or `:width:`, both survive; anything this rule does
 * not understand about the body — a legend, more than one paragraph of
 * caption, a YAML option block, an alt text that disagrees with the caption —
 * declines the whole figure rather than guess, leaving it exactly as inert
 * and byte-exact as any other directive Outline has no node for.
 */
describe("figure and figure-md become native figures", () => {
  test("the real template from the QCAM5 install manual", () => {
    const source =
      ":::{figure-md} camera_wiring_11\n" +
      "![](media/Connecting_the_camera.011.png){width=600}\n" +
      "\n" +
      "Camera wiring - 11\n" +
      ":::";

    const once = roundTrip(source);
    expect(once).toBe(
      "```{figure-md} camera_wiring_11\n" +
        "![](media/Connecting_the_camera.011.png){width=600}\n" +
        "\n" +
        "Camera wiring - 11\n\n" +
        "```"
    );
    expect(roundTrip(once)).toBe(once);
  });

  test("a backtick figure-md round-trips the same way a colon one does", () => {
    const source =
      "```{figure-md} label\n![](pic.png){width=600}\n\nCaption\n```";
    const once = roundTrip(source);
    expect(once).toBe(source.replace(/\n```$/, "\n\n```"));
    expect(roundTrip(once)).toBe(once);
  });

  test("figure-md with no caption", () => {
    const source = ":::{figure-md} label\n![](pic.png){width=600}\n:::";
    expect(roundTrip(source)).toBe(
      "```{figure-md} label\n![](pic.png){width=600}\n\n```"
    );
  });

  test("figure-md with no width", () => {
    const source = ":::{figure-md} label\n![](pic.png)\n\nCaption\n:::";
    expect(roundTrip(source)).toBe(
      "```{figure-md} label\n![](pic.png)\n\nCaption\n\n```"
    );
  });

  test("a caption with emphasis flattens to plain text rather than being lost", () => {
    const source =
      ":::{figure-md} label\n![](pic.png)\n\nCamera wiring - *front view*\n:::";
    expect(roundTrip(source)).toBe(
      "```{figure-md} label\n![](pic.png)\n\nCamera wiring - front view\n\n```"
    );
  });

  test("figure, target as the directive's own argument", () => {
    const source = "```{figure} images/pic.png\nCaption text\n```";
    expect(roundTrip(source)).toBe(
      "```{figure} images/pic.png\nCaption text\n\n```"
    );
  });

  test("figure with a :width: option", () => {
    const source =
      "```{figure} images/pic.png\n:width: 400\n\nCaption text\n```";
    const once = roundTrip(source);
    expect(once).toBe(source.replace(/\n```$/, "\n\n```"));
    expect(roundTrip(once)).toBe(once);
  });

  test("figure with a non-width option keeps it verbatim", () => {
    const source =
      "```{figure} images/pic.png\n:align: center\n\nCaption text\n```";
    const once = roundTrip(source);
    expect(once).toBe(source.replace(/\n```$/, "\n\n```"));
    expect(roundTrip(once)).toBe(once);
  });

  test("figure with no body at all", () => {
    expect(roundTrip("```{figure} images/pic.png\n```")).toBe(
      "```{figure} images/pic.png\n```"
    );
  });

  test("the real nested figure from doc-model-approval is now a native figure too, and settles", () => {
    // The admonition wrapping it needs a longer fence than three backticks to
    // clear the figure's own — see Notice's `requiredFenceLength`.
    const source =
      "````{admonition} Important note\n" +
      ":class: danger\n\n" +
      "Ensure that the cables are routed to the rear of the camera mount.\n\n" +
      ":::{figure-md} camera_wiring_11\n" +
      "![](media/Connecting_the_camera.011.png){width=600}\n\n" +
      "Camera wiring - 11\n" +
      ":::\n" +
      "````";

    const once = roundTrip(source);
    expect(once).toContain("```{figure-md} camera_wiring_11");
    expect(once).toContain("Connecting_the_camera.011.png");
    expect(once).toContain("Camera wiring - 11");
    expect(once).toContain("Ensure that the cables");
    expect(roundTrip(once)).toBe(once);
  });

  describe("declines rather than guesses, and stays an inert fence", () => {
    test("a legend paragraph after the caption", () => {
      const source =
        ":::{figure-md} label\n![](pic.png)\n\nCaption\n\nA legend paragraph.\n:::";
      expect(roundTrip(source)).toBe(source);
    });

    test("a table in place of an image", () => {
      const source =
        ":::{figure-md} label\n| a | b |\n|---|---|\n| 1 | 2 |\n:::";
      expect(roundTrip(source)).toBe(source);
    });

    test("a YAML option block on figure — not the line-style options this rule understands", () => {
      const source =
        "```{figure} images/pic.png\n---\nscale: 50%\n---\nCaption text\n```";
      expect(roundTrip(source)).toBe(source);
    });

    test("an image line's own alt text disagreeing with the caption", () => {
      const source =
        ":::{figure-md} label\n![Different text](pic.png)\n\nCaption\n:::";
      expect(roundTrip(source)).toBe(source);
    });

    test("figure with no target", () => {
      expect(roundTrip("```{figure}\nCaption\n```")).toBe(
        "```{figure}\nCaption\n```"
      );
    });
  });
});

/**
 * Notices stored before the node gained `directive`, `title` and `options` have
 * none of them in their ProseMirror JSON. Every document already in the
 * database is in that shape, so they have to keep serializing as they did.
 */
describe("notices stored before the new attributes", () => {
  test.each([
    ["info", "```{note}\nBody.\n\n```"],
    ["tip", "```{tip}\nBody.\n\n```"],
    ["warning", "```{caution}\nBody.\n\n```"],
    ["success", "```{seealso}\nBody.\n\n```"],
  ])("a %s notice carrying only a style", (style, expected) => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "container_notice",
          attrs: { style },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Body." }] },
          ],
        },
      ],
    });

    expect(serializer.serialize(doc, { commonMark: true }).trim()).toBe(
      expected
    );
  });
});

/**
 * The property that actually governs sync churn: normalization must settle
 * after one pass. If `f(f(x)) !== f(x)` for any construct, every sync would
 * rewrite the file forever and no content comparison could ever report "no
 * change".
 */
describe("normalization is stable after one pass", () => {
  test.each([
    ["dash bullets", "- one\n- two"],
    ["compact table", "| a | b |\n|---|---|\n| 1 | 2 |"],
    ["admonition", "```{note}\nBody.\n```"],
    ["colon-fence admonition", ":::note\nBody.\n:::"],
    ["legacy notice", ":::info\nBody.\n:::"],
    ["nested list", "- one\n  - nested\n- two"],
    ["toggle block", "+++\nHidden body.\n+++"],
    [
      "figure directive",
      "```{figure} media/photo.png\n:width: 50%\n\nCaption.\n```",
    ],
    ["mixed document", "# Title\n\n- one\n- two\n\n```{note}\nBody.\n```"],
  ])("%s", (_name, source) => {
    const once = roundTrip(source);
    expect(roundTrip(once)).toBe(once);
  });
});

/**
 * Editor features whose markdown output is NOT valid under the projects'
 * `myst_enable_extensions`. They round-trip through Outline faithfully, so the
 * risk is downstream: a Sphinx build renders them as literal text or, worse,
 * silently changes their meaning. `outline-sync`'s profile linter reports them.
 *
 * Pinning the output here makes any change to it a deliberate decision.
 */
describe("outside the MyST-safe profile", () => {
  test("highlight emits ==, for which MyST has no extension", () => {
    expect(roundTrip("==marked==")).toBe("==marked==");
  });

  /**
   * `==` has no room for a color, so a colored highlight is written as a
   * `<mark>` tag with the color as an inline style. MyST passes inline HTML
   * through to the built manual, where the browser paints it in that color.
   */
  test("a colored highlight emits a mark tag carrying its color", () => {
    const source =
      'Some <mark style="background-color: #C8AFF0">marked</mark> prose.';
    expect(roundTrip(source)).toBe(source);
  });

  /**
   * A pipe table has nowhere to put cell styling, so a shaded cell opens with
   * an HTML comment naming its color. MyST passes the comment through as raw
   * HTML, so it is invisible in the built manual and the cell reads as plain.
   */
  test("a shaded table cell emits a background comment", () => {
    const source =
      "| <!-- bg:#fdea9bb3 -->a | b   |\n|-----|-----|\n| 1   | <!-- bg:#c8aff0b3 -->2 |";
    expect(roundTrip(source)).toBe(source);
  });

  test("strikethrough emits ~~, which needs the strikethrough extension", () => {
    expect(roundTrip("~~struck~~")).toBe("~~struck~~");
  });

  test("underline emits __, which CommonMark reads as bold", () => {
    // Round-trips through Outline, but Sphinx renders it <strong>, silently
    // losing the underline. MyST has no equivalent.
    expect(roundTrip("__underlined__")).toBe("__underlined__");
  });

  test("toggle block emits +++ fences, which MyST does not recognize", () => {
    // The fence length encodes nesting depth, so the opening fence also grows.
    expect(roundTrip("+++\nHidden body.\n+++")).toBe(
      "+++++\nHidden body.\n\n+++++"
    );
  });
});

/**
 * Known limits, pinned so they are not mistaken for supported behaviour.
 */
describe("known limits", () => {
  test("a directive containing a nested fence cannot round-trip", () => {
    // CodeFence writes a hardcoded three-backtick fence, so a directive whose
    // body contains its own fence is truncated at the inner fence. Content like
    // this must not be wrapped in a directive fence.
    const source = "```{margin}\n```python\nprint(1)\n```\n```";
    expect(roundTrip(source)).not.toBe(source);
  });

  test("a code block inside a callout now settles: the notice's own fence grows to clear it", () => {
    // A callout built in the editor — a writer drops a code block into a
    // notice — starts life as a real ProseMirror doc, not parsed markdown, so
    // this constructs one directly rather than through a source string.
    //
    // Both a callout and a code block fence with ```, so a callout that
    // always wrote exactly three backticks ended at the code block's own
    // closing fence rather than its own, and grew another stray fence around
    // the wreckage on every subsequent save. The callout now scans its own
    // content first and writes a fence one longer than anything nested
    // inside it needs, so this settles on the first save.
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "container_notice",
          attrs: { style: "info" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Before." }] },
            {
              type: "code_fence",
              attrs: { language: "python" },
              content: [{ type: "text", text: "print(1)" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "After." }] },
          ],
        },
      ],
    });

    const once = serializer.serialize(doc, { commonMark: true }).trim();
    expect(once).toBe(
      "````{note}\nBefore.\n\n```python\nprint(1)\n```\n\nAfter.\n\n````"
    );
    expect(roundTrip(once)).toBe(once);
  });

  test("a hand-written same-length nesting still cannot parse — the general fence limit, not this one", () => {
    // Unlike the editor-created case above, a source string typed with the
    // callout and its nested code block at the very same fence length is the
    // general "a directive containing a nested fence cannot round-trip" limit
    // pinned elsewhere in this file: the closing fence search cannot tell
    // which fence a same-length line belongs to, so it matches the code
    // block's own closer first no matter how the outer block is written back.
    // It no longer degrades further on repeated saves, though — the content
    // it does capture stays exactly where a second pass leaves it.
    const source =
      "```{note}\nBefore.\n\n```python\nprint(1)\n```\n\nAfter.\n```";
    const once = roundTrip(source);
    expect(once).not.toBe(source);
    expect(roundTrip(once)).toBe(once);
  });

  test("an admonition grows past a backtick run hiding inside an unclaimed colon-fenced child", () => {
    // {ifconfig} isn't a directive Outline claims, so it stays a code_fence on
    // its own colon wrapper — no collision with the admonition's own
    // backticks there. But its raw, opaque body can itself hold a genuine
    // backtick code example, and that run still ends up nested inside the
    // admonition once everything is one markdown string. The admonition has
    // to clear it too, not just whatever wraps it directly.
    const source =
      ":::{admonition} Title\n:::{ifconfig} Class == 'A'\n```python\nprint(1)\n```\n:::\n:::";
    const once = roundTrip(source);
    expect(once).toContain("print(1)");
    expect(once).toContain("Class == 'A'");
    expect(roundTrip(once)).toBe(once);
  });

  test("raw HTML survives as literal text, not as markup", () => {
    // The parser runs with html: false, so raw HTML is never turned into nodes
    // and simply passes through as text. That makes the html_image and
    // html_admonition extensions safe to use in a synced source tree, at the
    // cost of the block rendering as plain text inside Outline.
    const source = '<img src="media/photo.png" width="50%">';
    expect(roundTrip(source)).toBe(source);
  });
});
