import { parser, schema, serializer } from ".";

/**
 * Round-trips markdown through the same path the API uses: `documents.update`
 * parses the incoming text, and `presentDocument` renders it back through
 * `DocumentHelper.toMarkdown`, which serializes with `commonMark: true`.
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
   * the fence info string as a free-form `language` attribute. They render as
   * inert code blocks in Outline but come back as valid MyST.
   */
  test.each([
    ["figure", "```{figure} media/photo.png\n:width: 50%\n\nCaption.\n```"],
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
    ["several options", "```{note}\n:class: custom\n:name: label\n\nBody.\n```"],
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
 * Known limit, unchanged by the above: the colon container claims every `:::`
 * fence, so a directive that is not an admonition is flattened into a plain
 * note. `outline-sync` sidesteps this by moving directives onto backtick fences
 * before pushing, which is the only spelling that survives for the ones Outline
 * has no node for.
 */
describe("colon fences that are not admonitions", () => {
  test("a dropdown is swallowed and becomes a note", () => {
    expect(roundTrip(":::{dropdown} More\nHidden.\n:::")).toBe(
      "```{note}\nHidden.\n\n```"
    );
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
    ["figure directive", "```{figure} media/photo.png\n:width: 50%\n\nCaption.\n```"],
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

  test("a code block inside a callout never settles", () => {
    // Both are fenced with ```, so the callout ends at the code block rather
    // than wrapping it. Unlike the case above this one is reachable from the
    // editor — a writer can drop a code block into a notice — and it degrades
    // on every save rather than failing once, which is why MARKDOWN_README.md
    // tells writers to put the code block after the callout instead.
    const source = "```{note}\nBefore.\n\n```python\nprint(1)\n```\n\nAfter.\n```";
    const once = roundTrip(source);
    expect(once).not.toBe(source);
    expect(roundTrip(once)).not.toBe(once);
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
