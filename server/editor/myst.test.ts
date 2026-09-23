import fs from "fs";
import path from "path";
import type { Node as ProsemirrorNode } from "prosemirror-model";
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
    ["bullet list (dash)", "- one\n- two"],
    ["bullet list (plus)", "+ one\n+ two"],
    ["a dash list next to a plus list", "- one\n- two\n\n+ three\n+ four"],
    ["ordered list", "1. one\n2. two"],
    ["bullet list (dash)", "- one\n- two"],
    ["bullet list (plus)", "+ one\n+ two"],
    ["a dash list next to a plus list", "- one\n- two\n\n+ three\n+ four"],
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
    ["role Outline has no mark for", "Press {kbd}`Ctrl` to continue."],
    ["substitution", "The {{ CAM }} unit."],
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
    [
      "spaces after a bullet marker become one",
      "-  one\n-  two",
      "- one\n- two",
    ],
    [
      "nested bullet lists are indented to that one space",
      "-  one\n   -  nested\n-  two",
      "- one\n  - nested\n- two",
    ],
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

describe("a table inside a notice no longer empties the block", () => {
  test("a colon fence holding a table round-trips", () => {
    // Used to be a known limit: `{note}` is a real admonition, so this is
    // handed to container_notice, which decides from the info string alone,
    // before there is anything to look at — a table used to be one of the
    // block types `container_notice`'s own content expression had nowhere to
    // put, so the whole node failed to build and the block was dropped. Fixed
    // by adding `table` to that content expression as part of the generic
    // directive work (`{ifconfig}` wrapping a table nested inside an
    // admonition is real content, in `Detection_field_calibration.md`).
    const once = roundTrip(":::{note}\n| a | b |\n|---|---|\n| 1 | 2 |\n:::");
    expect(once).not.toBe("");
    expect(once).toContain("{note}");
    expect(once).toContain("| a");
    // Takes one extra save to settle a trailing blank line before the
    // closing fence — content is unaffected either way.
    expect(roundTrip(roundTrip(once))).toBe(roundTrip(once));
  });
});

/**
 * A colon fence whose info string names no admonition and is not on
 * `DIRECTIVE_ALLOWLIST` either — `{glossary}`, a custom Sphinx directive, or
 * anything markdown-it-container would otherwise have claimed on sight —
 * still round-trips byte for byte, the same guarantee the backtick path
 * already gives every directive Outline has no node for. Recorded verbatim
 * as a `code_fence` carrying the original marker character and run length,
 * rather than being parsed as a notice and coming back mangled or, for a
 * nested body, dropped from the document entirely.
 *
 * `{glossary}` specifically stays here rather than getting a real node: its
 * body is an indentation-significant definition list (`Term\n: Definition`),
 * and flattening that into ordinary blocks would lose the indent that makes
 * it one once written back out — a real deflist node (step 4) is needed
 * before that can round-trip as anything other than opaque text.
 */
describe("colon-fenced directives with no node at all still round-trip byte for byte", () => {
  test.each([
    [
      "a definition list under {glossary}",
      ":::::{glossary}\nTerm\n: Definition\n:::::",
    ],
    // Previously the plan's own "known limit": swallowed into a bare note.
    ["a dropdown", ":::{dropdown} More\nHidden.\n:::"],
    // A custom Sphinx admonition subclass, as the FM manual uses.
    ["a custom admonition subclass", ":::{vm}\nBody.\n:::"],
  ])("%s", (_name, source) => {
    expect(roundTrip(source)).toBe(source);
    expect(roundTrip(roundTrip(source))).toBe(source);
  });

  test("an unclosed fence auto-closes at end of document", () => {
    expect(roundTrip(":::{glossary}\nTerm\n: Def")).toBe(
      ":::{glossary}\nTerm\n: Def\n:::"
    );
  });
});

/**
 * `{ifconfig}`, `{grid}`, `{grid-item}` and `{margin}` — `DIRECTIVE_ALLOWLIST`
 * in `shared/editor/rules/directives.ts` — get a real, structured
 * `container_directive` node instead of the inert `code_fence` every other
 * directive falls back to: editable content, not opaque preserved text.
 *
 * Round-tripping settles one blank line before the closing fence, the same
 * shape `Notice`'s own output already has (`state.renderContent` separates
 * block children with a blank line; the raw preserved text these used to be
 * did not) — a real formatting difference from the old inert path, not a
 * bug, so these assert the settled shape directly rather than byte-identity
 * with the input.
 */
describe("ifconfig, grid, grid-item and margin become real directive nodes", () => {
  test("{ifconfig} wrapping a table", () => {
    const source =
      "::::{ifconfig} Class == 'A'\n| a | b |\n|---|---|\n| 1 | 2 |\n::::";
    const once = roundTrip(source);
    expect(once).toBe(
      "::::{ifconfig} Class == 'A'\n\n| a   | b   |\n|-----|-----|\n| 1   | 2   |\n\n::::"
    );
    expect(roundTrip(once)).toBe(once);
  });

  test("{ifconfig} wrapping a nested {figure-md}", () => {
    // The figure comes back on a backtick fence — Figure always writes one,
    // regardless of how it arrived (step 3's own established behaviour,
    // unrelated to this node) — so this is not byte-identical to the colon
    // form it was written in, only equivalent.
    const source =
      "::::{ifconfig} Class == 'A'\n:::{figure-md} label\n![](x.png)\n\nCaption\n:::\n::::";
    const once = roundTrip(source);
    expect(once).toBe(
      "::::{ifconfig} Class == 'A'\n```{figure-md} label\n![](x.png)\n\nCaption\n\n```\n\n::::"
    );
    expect(roundTrip(once)).toBe(once);
  });

  /**
   * `Directive`'s own option-lifting (`directiveOptions` in
   * `shared/editor/rules/directives.ts`) keeps `{ifconfig}`'s option lines
   * out of the visible body, the same mechanism `codeFenceOptions.ts` already
   * gives a genuinely unclaimed directive (tested above, with `{dropdown}` in
   * its place now that `{ifconfig}` no longer exercises that path).
   */
  test.each([
    [
      "one option line",
      "```{ifconfig} Class == 'A'\n:some-option: value\n\nBody text.\n```",
      "```{ifconfig} Class == 'A'\n:some-option: value\n\nBody text.\n\n```",
    ],
    [
      "several option lines",
      "```{ifconfig} Class == 'A'\n:opt1: a\n:opt2: b\n\nBody text.\n```",
      "```{ifconfig} Class == 'A'\n:opt1: a\n:opt2: b\n\nBody text.\n\n```",
    ],
    [
      "no options at all, unaffected",
      "```{ifconfig} Class == 'A'\nBody text.\n```",
      "```{ifconfig} Class == 'A'\nBody text.\n\n```",
    ],
  ])("%s", (_name, source, expected) => {
    const once = roundTrip(source);
    expect(once).toBe(expected);
    expect(roundTrip(once)).toBe(once);
  });

  test("an options-only body is lifted whole, leaving an empty body rather than losing anything", () => {
    const source = "```{ifconfig} Class == 'A'\n:only-option: value\n```";
    const once = roundTrip(source);
    expect(once).toContain(":only-option: value");
    expect(roundTrip(once)).toBe(once);
  });

  test("{margin}", () => {
    const source = ":::{margin}\nAside.\n:::";
    const once = roundTrip(source);
    expect(once).toBe(":::{margin}\nAside.\n\n:::");
    expect(roundTrip(once)).toBe(once);
  });

  test("{grid} wrapping two {grid-item} fences", () => {
    // Keeps the source's own generously-wide 6-colon grid fence rather than
    // shrinking to the minimal safe length (4 would clear the 3-colon
    // grid-items it wraps) — `requiredFenceLength` only ever grows a fence
    // past its own stored length, never shrinks it, the same "a directive
    // wrapped wider than strictly needed round-trips at that same width"
    // guarantee `CodeFence` already gives every directive Outline has no
    // node for.
    const source =
      "::::::{grid} 2\n:::{grid-item}\nOne\n:::\n:::{grid-item}\nTwo\n:::\n::::::";
    const once = roundTrip(source);
    expect(once).toBe(
      "::::::{grid} 2\n:::{grid-item}\nOne\n\n:::\n\n:::{grid-item}\nTwo\n\n:::\n\n::::::"
    );
    expect(roundTrip(once)).toBe(once);
  });

  test("{grid} wrapping a {grid-item} that itself needs to grow past a same-length sibling", () => {
    // The malformed real-world case from
    // Finding_the_optimal_deployment_configuration.md: the first
    // {grid-item} has no closer of its own, so the closing-fence search
    // (shared with `container_notice`'s own colon parsing, and with
    // markdown-it-container's native one) finds the *second* grid-item's own
    // closer instead and treats it as the first one's — nesting the second
    // grid-item inside the first rather than beside it. However this doc
    // actually got structured on parse, `requiredFenceLength` has to look at
    // what a nested `container_directive` child will *actually* be written
    // as — including its own stored-length floor, not just the minimum its
    // content alone would need — or a same-length collision between it and
    // its own child goes unnoticed and re-derives itself identically forever,
    // growing another stray fence on every single save.
    const source =
      "::::::{grid} 2\n:gutter: 0\n::::{grid-item}\n\n:::{figure-md} reference-distances-1\n![](media/camera_distances.001.png){width=500}\n\nReference Distances - 1\n:::\n::::{grid-item}\n:::{figure-md} reference-distances-2\n![](media/camera_distances.002.png){width=500}\n\nReference Distances - 2\n:::\n::::\n::::::";
    const once = roundTrip(source);
    expect(roundTrip(once)).toBe(once);
    // Settles at a fifth colon on the (now inner) first grid-item, one past
    // the second grid-item nested inside it at its own stored four.
    expect(once).toContain(":::::{grid-item}");
  });

  test("survives indented inside a list item", () => {
    const source = "1. Step\n\n   :::{margin}\n   Aside.\n   :::";
    const once = roundTrip(source);
    expect(once).toBe("1. Step\n\n   :::{margin}\n   Aside.\n\n   :::");
    expect(roundTrip(once)).toBe(once);
  });

  test("an admonition name is still claimed as a notice, unaffected", () => {
    // Guards the registration-order fix this node needed: `Directive` has to
    // register before `Notice` so `container_directive`'s own narrower
    // validate gets a look at a `:::` fence before `container_notice`'s
    // unconditional one would otherwise claim it regardless of directive
    // name — verified live by this test previously reporting `{margin}`
    // silently coming back as `{note}`.
    expect(roundTrip(":::{note}\nBody.\n:::")).toBe("```{note}\nBody.\n\n```");
    expect(roundTrip(":::warning\nBody.\n:::")).toBe(
      "```{caution}\nBody.\n\n```"
    );
  });

  test("a backtick code example inside does not collide, because the wrapper stays on colons", () => {
    // Flattening every fence to backticks on output — CodeFence's only option
    // before it could carry `fenceChar` — would end this block at the inner
    // ``` instead of the outer :::, truncating everything after it. Keeping
    // the wrapper on colons sidesteps the collision entirely, at any nesting
    // depth, without needing to know how deep the content goes.
    const source = ":::{margin}\n```python\nprint(1)\n```\n:::";
    const once = roundTrip(source);
    expect(once).toBe(":::{margin}\n```python\nprint(1)\n```\n\n:::");
    expect(roundTrip(once)).toBe(once);
  });

  test("an admonition wrapping a colon-fenced directive still clears a backtick run hiding three levels down", () => {
    // The general fence-collision guard (`requiredFenceLength`) has to keep
    // descending into a directive fenced in a *different* character than the
    // ancestor it's scanning for, rather than stopping there — this directive
    // is colon-fenced and wraps a real backtick code example three levels
    // down from a backtick-fenced admonition, which only the admonition's own
    // fence has to clear.
    const source =
      ":::{admonition} Title\n:::{ifconfig} Class == 'A'\n```python\nprint(1)\n```\n:::\n:::";
    const once = roundTrip(source);
    expect(once).toContain("print(1)");
    expect(once).toContain("Class == 'A'");
    expect(roundTrip(once)).toBe(once);
  });

  /**
   * `customFence`'s own `validate` only ever sees a directive's opening
   * line — there is no body yet to check when it decides whether to claim a
   * `:::` fence — so unlike the backtick path (which parses the body first
   * and only commits to a container if everything in it fits), a colon-fenced
   * directive whose body holds something `Directive`'s content expression
   * has nowhere to put already exists as real container tokens by the time
   * anything could object. `guardDirectiveContent` undoes that: found live
   * while testing this node, the same way the pre-existing "a colon fence
   * holding a table is emptied" gap was found for `container_notice` — an
   * `{ifconfig}` wrapping a table used to come back as an empty string
   * before `table` was added to `Directive`'s own content expression, and a
   * math block (never added, on purpose — `Directive` has no more use for
   * one than `Notice` does) would still do the same without this guard.
   */
  test("a colon-fenced directive holding what it cannot falls back to the inert fence, not an empty document", () => {
    const source = "::::{ifconfig} Class == 'A'\nProse.\n\n$$\nx^2\n$$\n::::";
    const once = roundTrip(source);
    expect(once).toBe(source);
    expect(roundTrip(once)).toBe(once);
  });

  test("only the offending grid-item falls back — its sibling is unaffected unless it shares the same outer span", () => {
    // Coarse, not surgical: the whole outermost container_directive span
    // (here, the {grid}) is what falls back, taking a sibling grid-item that
    // was perfectly fine on its own down with it too — simpler and safer
    // than trying to fix up just the one offending descendant while leaving
    // a partially-converted tree around it.
    const source =
      "::::::{grid} 2\n:::{grid-item}\nProse.\n\n$$\nx^2\n$$\n:::\n:::{grid-item}\nFine.\n:::\n::::::";
    const once = roundTrip(source);
    expect(once).toBe(source);
    expect(roundTrip(once)).toBe(once);
  });
});

/**
 * A directive with no node at all — genuinely unclaimed, unlike `{ifconfig}`
 * now — still keeps its own option lines out of the body, the same way a
 * claimed admonition already does — metadata, not prose, lifted onto the
 * `code_fence` node's `options` attribute rather than shown as a stray line
 * of text. Not editable yet; the point for now is that the data survives
 * structured rather than folded into the opaque body text, ready for an
 * editing surface later. `{dropdown}` here rather than `{ifconfig}` so this
 * still actually exercises `codeFenceOptions.ts` — the same mechanism
 * `Directive`'s own `directiveOptions` (tested separately, below, alongside
 * the rest of what `{ifconfig}` does now) was modelled on.
 */
describe("an unclaimed directive keeps its own option lines out of the body", () => {
  test.each([
    [
      "one option line",
      "```{dropdown} More\n:some-option: value\n\nBody text.\n```",
    ],
    [
      "several option lines",
      "```{dropdown} More\n:opt1: a\n:opt2: b\n\nBody text.\n```",
    ],
    ["no options at all, unaffected", "```{dropdown} More\nBody text.\n```"],
  ])("%s", (_name, source) => {
    const once = roundTrip(source);
    expect(once).toBe(source);
    expect(roundTrip(once)).toBe(once);
  });

  test("an options-only body is lifted whole, leaving an empty body rather than losing anything", () => {
    const source = "```{dropdown} More\n:only-option: value\n```";
    const once = roundTrip(source);
    expect(once).toContain(":only-option: value");
    expect(roundTrip(once)).toBe(once);
  });

  test("a normal code block is never mistaken for a directive with options", () => {
    // The outer guard is the fence's own info string, not what the body
    // looks like — "python" never matches the {directive} shape, so a code
    // sample that happens to contain a line shaped like an option is left
    // exactly as written.
    const source =
      "```python\n:this-looks-like-an-option: but-is-code\nprint(1)\n```";
    expect(roundTrip(source)).toBe(source);
  });

  test("a real admonition's own options are unaffected — notices.ts still owns those", () => {
    expect(roundTrip("```{note}\n:class: custom\n\nBody.\n```")).toBe(
      "```{note}\n:class: custom\n\nBody.\n\n```"
    );
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
/**
 * `{glossary}`'s own body — an RST/docutils definition list (`Term\n
 * Definition text`, indent-only, no `:`/`~` marker — verified against
 * docutils' own spec, and against the real content, that this is what a
 * Sphinx `glossary` directive's body actually is; MyST's own top-level
 * `deflist` extension uses a different, colon-marked syntax that does not
 * apply here). All or nothing per `{glossary}` block, the same bar every
 * other directive-body parser in this codebase holds itself to: if any
 * entry does not fit — a blank line between a term and its own definition,
 * something that is not ordinary block content — none of it becomes a
 * `definition_list`, and the whole fence stays the byte-exact opaque
 * `CodeFence` it already was.
 */
describe("glossary becomes a real definition list", () => {
  test("a simple two-entry glossary", () => {
    const source =
      ":::{glossary}\nANPR\n   Stands for Automatic Number Plate Recognition.\n\nANPR camera\n   A camera with ANPR capabilities.\n:::";
    const once = roundTrip(source);
    expect(once).toBe(
      ":::{glossary}\nANPR\n   Stands for Automatic Number Plate Recognition.\n\nANPR camera\n   A camera with ANPR capabilities.\n\n:::"
    );
    expect(roundTrip(once)).toBe(once);
  });

  test("a multi-paragraph definition stays one definition, not two", () => {
    const source =
      ":::{glossary}\nTerm\n   First paragraph.\n\n   Second paragraph, same definition.\n:::";
    const once = roundTrip(source);
    const doc = parser.parse(once);
    let termCount = 0;
    doc?.descendants((node) => {
      if (node.type.name === "definition_term") {
        termCount++;
      }
      return true;
    });
    expect(termCount).toBe(1);
    expect(roundTrip(once)).toBe(once);
  });

  test("the real 'Camera security keys pair' shape: bold sub-headers, a bullet list, and text: followed by a bare --- stays prose + a thematic break, not a heading", () => {
    // A real, verified hazard: with no blank line between them, CommonMark's
    // own setext rule reads "text:" + "---" as an <h2> instead of the prose
    // + RST transition it actually is here.
    const source = [
      ":::{glossary}",
      "",
      "Camera security keys pair",
      "   In {{PR}} cameras:",
      "   ---",
      "   **Keys to validate ANPR winners**",
      "",
      "   The {{SSA}} uses the public key obtained from the camera to:",
      "   - Validate that ANPR winners received from this camera originate from this camera.",
      "   - Ensure the authenticity of measurements and observations.",
      ":::",
    ].join("\n");
    const once = roundTrip(source);
    const doc = parser.parse(once);
    const types: string[] = [];
    doc?.descendants((node) => {
      types.push(node.type.name);
      return true;
    });
    expect(types).not.toContain("heading");
    expect(types).toContain("hr");
    expect(types).toContain("bullet_list");
    expect(roundTrip(once)).toBe(once);
  });

  test("the real 'Detection field' entry: a nested {grid} > {grid-item} > {figure-md} tree", () => {
    const source = [
      ":::{glossary}",
      "",
      "Detection field",
      "   OIML R 91 3.3.10: The section of road containing all possible locations of a detection point.",
      "",
      "   :::::{grid} 2",
      "",
      "   ::::{grid-item}",
      "   :::{figure-md} detection-field-and-projection-illustration",
      "   ![](media/detection_field_view_from_camera.001.png){width=300 align=center}",
      "",
      "   *Detection field* - Camera View - Shorter Field of View",
      "   :::",
      "   ::::",
      "",
      "   ::::{grid-item}",
      "",
      "   :::{figure-md}",
      "   ![](media/detection_field_view.001.png){width=300 align=center}",
      "",
      "   *Detection field* - Shorter Field of View",
      "   :::",
      "   ::::",
      "   :::::",
      ":::",
    ].join("\n");
    const once = roundTrip(source);
    const doc = parser.parse(once);
    let figureCount = 0;
    let gridItemCount = 0;
    doc?.descendants((node) => {
      if (node.type.name === "figure") {
        figureCount++;
      }
      if (
        node.type.name === "container_directive" &&
        node.attrs.directive === "grid-item"
      ) {
        gridItemCount++;
      }
      return true;
    });
    expect(figureCount).toBe(2);
    expect(gridItemCount).toBe(2);
    expect(roundTrip(once)).toBe(once);
  });

  test("the real 'Model approval parameter' entry: a nested {ifconfig} wrapping a table", () => {
    const source = [
      ":::{glossary}",
      "",
      "Model approval parameter",
      "   Selects the applicable model approval reference.",
      "",
      "   :::{ifconfig} Class == 'A'",
      "",
      "   | model approval reference | Model approval number |",
      "   | --- | --- |",
      "   | {{ASS}} | XXXXXXXXXXX |",
      "   :::",
      "   :::{ifconfig} Class == 'C'",
      "   ",
      "   :::",
      ":::",
    ].join("\n");
    const once = roundTrip(source);
    const doc = parser.parse(once);
    let tableCount = 0;
    doc?.descendants((node) => {
      if (node.type.name === "table") {
        tableCount++;
      }
      return true;
    });
    expect(tableCount).toBe(1);
    // The second, empty ifconfig must not gain a phantom checkbox.
    expect(JSON.stringify(doc?.toJSON())).not.toContain("checkbox");
    expect(roundTrip(once)).toBe(once);
  });

  test("a blank line between a term and its own definition declines the whole block", () => {
    // Docutils requires the definition to start on the very next line, no
    // gap — violating that anywhere makes the whole thing not a definition
    // list, and this falls back to the same byte-exact opaque fence any
    // other unrecognized body already gets, rather than guessing.
    const source =
      ":::{glossary}\nTerm\n\n   Definition after a blank line.\n:::";
    expect(roundTrip(source)).toBe(source);
  });

  test("a term with no indented content at all declines the whole block", () => {
    const source = ":::{glossary}\nTerm one\nTerm two\n:::";
    expect(roundTrip(source)).toBe(source);
  });

  test("the real Terms_Definitions_Concepts.md file round-trips stably", () => {
    // The actual file this step exists for: most entries become real
    // definition lists. Its ~300 bare `%` RST comment lines (whole
    // commented-out entries) all sit *between* `::::::{glossary}` fences at
    // the document's own top level, not inside any of them — so they become
    // top-level `myst_comment` nodes (siblings of the `container_directive`
    // fences), never interacting with `deflist.ts`'s own entry parsing at
    // all. (`deflist.ts` separately handles a `%` run *inside* a fence, see
    // the dedicated describe block above/below for that shape — this file
    // just doesn't happen to use it.)
    const filePath = path.join(
      "/var/www/doc-model-approval/source_install/2_Glossary",
      "Terms_Definitions_Concepts.md"
    );
    let source: string;
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch {
      return; // Not available outside this machine's checkout — skip quietly.
    }
    const once = roundTrip(source);
    expect(roundTrip(once)).toBe(once);
    const doc = parser.parse(once);
    let deflistCount = 0;
    let commentCount = 0;
    doc?.descendants((node) => {
      if (node.type.name === "definition_list") {
        deflistCount++;
      }
      if (node.type.name === "myst_comment") {
        commentCount++;
      }
      return true;
    });
    expect(deflistCount).toBeGreaterThan(0);
    expect(commentCount).toBeGreaterThan(0);
  });
});

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

  /**
   * `{width=...}` combined with `{align=...}` in an image's trailing
   * attrs_inline — the real shape `Underlying_concepts.md` uses
   * (`![](...){align=center width=300}`) and which used to fall back to an
   * inert code fence entirely, since the old width-only regex didn't match
   * a second key at all. `align` only has a real Outline equivalent for
   * `left`/`right` (`layoutClass`); `center` is recognized but produces no
   * override, since that's already what an unadorned Outline image renders
   * as — so it does not round-trip explicitly, only equivalently.
   */
  describe("figure-md recognizes align alongside width", () => {
    test("the real case from Underlying_concepts.md: align=center width=300", () => {
      const source =
        ":::{figure-md} label\n![](pic.png){align=center width=300}\n\nCaption\n:::";
      const once = roundTrip(source);
      expect(once).toBe(
        "```{figure-md} label\n![](pic.png){width=300}\n\nCaption\n\n```"
      );
      expect(roundTrip(once)).toBe(once);
    });

    test("order does not matter: width=300 align=center", () => {
      const source =
        ":::{figure-md} label\n![](pic.png){width=300 align=center}\n\nCaption\n:::";
      expect(roundTrip(source)).toBe(
        "```{figure-md} label\n![](pic.png){width=300}\n\nCaption\n\n```"
      );
    });

    test("align=left is captured as a real override and round-trips explicitly", () => {
      const source =
        ":::{figure-md} label\n![](pic.png){align=left width=400px}\n\nCaption\n:::";
      const once = roundTrip(source);
      expect(once).toBe(
        "```{figure-md} label\n![](pic.png){width=400 align=left}\n\nCaption\n\n```"
      );
      expect(roundTrip(once)).toBe(once);
    });

    test("align=right is captured as a real override and round-trips explicitly", () => {
      const source =
        ":::{figure-md} label\n![](pic.png){width=400 align=right}\n\nCaption\n:::";
      const once = roundTrip(source);
      expect(once).toBe(
        "```{figure-md} label\n![](pic.png){width=400 align=right}\n\nCaption\n\n```"
      );
      expect(roundTrip(once)).toBe(once);
    });

    test("align=top — a real MyST value, but a vertical axis Outline's image has no equivalent for — is left unrecognized", () => {
      // Falls back to the same inert, byte-exact code fence any other
      // unrecognized attrs_inline shape already gets, rather than guessing.
      const source =
        ":::{figure-md} label\n![](pic.png){width=300 align=top}\n\nCaption\n:::";
      expect(roundTrip(source)).toBe(source);
    });

    test("a third, unrecognized key is left unrecognized rather than dropped silently", () => {
      const source =
        ":::{figure-md} label\n![](pic.png){width=300 align=center scale=50}\n\nCaption\n:::";
      expect(roundTrip(source)).toBe(source);
    });
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
  test("a directive containing a same-length nested fence cannot round-trip", () => {
    // The ambiguity is upstream of any node: markdown-it's own core fence
    // rule (and `mystDirectiveFences`'s later conversion of one into a real
    // `container_directive`, for a directive on `DIRECTIVE_ALLOWLIST`) finds
    // the *first* closing run of three backticks — the nested code block's
    // own — and truncates there, regardless of what ends up claiming the
    // outer block afterwards. Content like this must not be wrapped in a
    // same-length directive fence to begin with.
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

  test("raw HTML survives as literal text, not as markup", () => {
    // The parser runs with html: false, so raw HTML is never turned into nodes
    // and simply passes through as text. That makes the html_image and
    // html_admonition extensions safe to use in a synced source tree, at the
    // cost of the block rendering as plain text inside Outline.
    const source = '<img src="media/photo.png" width="50%">';
    expect(roundTrip(source)).toBe(source);
  });
});

/**
 * `` {term}`text` `` is a real mark (`term_reference`), not inline code that
 * happens to sit next to the literal text `{term}` — which is what
 * markdown-it's own backticks rule made of it before, and which round-tripped
 * to the same string for the wrong reason.
 */
describe("{term} role becomes a term_reference mark", () => {
  function marksOf(source: string) {
    const found: { text: string; marks: string[] }[] = [];
    parser.parse(source)?.descendants((node) => {
      if (node.isText) {
        found.push({
          text: node.text ?? "",
          marks: node.marks.map((mark) => mark.type.name),
        });
      }
    });
    return found;
  }

  test("parses to the mark and drops the delimiters from the text", () => {
    expect(marksOf("See {term}`resolution` for details.")).toEqual([
      { text: "See ", marks: [] },
      { text: "resolution", marks: ["term_reference"] },
      { text: " for details.", marks: [] },
    ]);
  });

  test.each([
    ["mid-sentence", "See {term}`resolution` for details."],
    ["several in one line", "{term}`CAM` and {term}`field of view`."],
    ["characters markdown would escape", "A {term}`snake_case*name` here."],
    ["split-target form, kept verbatim", "A {term}`Display <target>` here."],
    ["inside a table cell", "| a   |\n|-----|\n| {term}`x` |"],
  ])("round-trips: %s", (_name, source) => {
    const once = roundTrip(source);
    expect(once.trim()).toBe(source);
    expect(roundTrip(once)).toBe(once);
  });

  test("inside a {glossary} definition", () => {
    const source = ":::{glossary}\nTerm\n   See {term}`other term`.\n\n:::";
    expect(roundTrip(source).trim()).toBe(source);
    expect(marksOf(source)).toContainEqual({
      text: "other term",
      marks: ["term_reference"],
    });
  });

  test.each([
    ["unclosed", "An {term}`unclosed role."],
    ["empty", "An {term}`` role."],
  ])("leaves a malformed role alone: %s", (_name, source) => {
    expect(
      marksOf(source).some((t) => t.marks.includes("term_reference"))
    ).toBe(false);
  });
});

/**
 * A `%` line comment — invisible in Sphinx output — becomes a `myst_comment`
 * node instead of the literal `%`-prefixed paragraph text it used to be: one
 * node per source line, holding the line as it was before `%` was put in
 * front of it, and writing back exactly as it was read.
 */
describe("% comments become myst_comment nodes", () => {
  function mystComments(source: string): string[] {
    const found: string[] = [];
    parser.parse(source)?.descendants((node) => {
      if (node.type.name === "myst_comment") {
        found.push(node.textContent);
      }
      return true;
    });
    return found;
  }

  function commentAttrs(source: string) {
    const found: { text: string; tight: boolean; spaced: boolean }[] = [];
    parser.parse(source)?.descendants((node) => {
      if (node.type.name === "myst_comment") {
        found.push({
          text: node.textContent,
          tight: node.attrs.tight,
          spaced: node.attrs.spaced,
        });
      }
      return true;
    });
    return found;
  }

  function topLevel(source: string): string[] {
    const found: string[] = [];
    parser.parse(source)?.forEach((node) => {
      found.push(node.type.name);
    });
    return found;
  }

  test("a single line keeps its content, not the marker's space", () => {
    const source = "% a MyST comment";
    expect(commentAttrs(source)).toEqual([
      { text: "a MyST comment", tight: false, spaced: true },
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  test("no space after the marker", () => {
    const source = "%no-space";
    expect(commentAttrs(source)).toEqual([
      { text: "no-space", tight: false, spaced: false },
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  test("each consecutive line is its own node, written back without blank lines", () => {
    const source = "% one\n% two\n% three";
    expect(commentAttrs(source)).toEqual([
      { text: "one", tight: false, spaced: true },
      { text: "two", tight: true, spaced: true },
      { text: "three", tight: true, spaced: true },
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  test("a blank line between two comment lines is kept", () => {
    const source = "% one\n\n% two";
    expect(commentAttrs(source).map((c) => c.tight)).toEqual([false, false]);
    expect(roundTrip(source)).toBe(source);
  });

  test("indentation after the marker is the line's own", () => {
    // `% ` is the marker; the two spaces after it belong to the line.
    const source = "%   indented";
    expect(mystComments(source)).toEqual(["  indented"]);
    expect(roundTrip(source)).toBe(source);
  });

  test("a run mixing %text and % text keeps every line exactly as written", () => {
    // `%Term` has no marker space, so the run's leading spaces are content.
    const source = "%Term\n%   Definition.";
    expect(commentAttrs(source)).toEqual([
      { text: "Term", tight: false, spaced: false },
      { text: "   Definition.", tight: true, spaced: false },
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  test("a comment line indented before its % keeps that indentation", () => {
    const source = "% - one\n  %indented\n% - two";
    expect(roundTrip(source)).toBe(source);
  });

  test("a bare % is a valid empty comment", () => {
    expect(mystComments("%")).toEqual([""]);
    expect(roundTrip("%")).toBe("%");
  });

  test("a trailing bare % in a run round-trips", () => {
    const source = "% a\n%";
    expect(mystComments(source)).toEqual(["a", ""]);
    expect(roundTrip(source)).toBe(source);
  });

  test("a comment line keeps its trailing spaces (a hard break)", () => {
    const source = "% Line one.  \n% Line two.";
    expect(mystComments(source)).toEqual(["Line one.  ", "Line two."]);
    expect(roundTrip(source)).toBe(source);
  });

  test("a commented-out nested list round-trips line for line", () => {
    const source = [
      "% -  Retrieve the data for each item:",
      "%    -  The license plate detected by the camera;",
      "%    -  The legal speed limit;",
      "% -  Validate or reject for each candidate violator",
    ].join("\n");
    expect(mystComments(source)).toEqual([
      "-  Retrieve the data for each item:",
      "   -  The license plate detected by the camera;",
      "   -  The legal speed limit;",
      "-  Validate or reject for each candidate violator",
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  // The serializer separates two sibling blocks with a blank line
  // (`flushClose`'s default), the convention every other node in this file
  // lives with — see "admonition bodies gain a trailing blank line" above.
  // A `%` line needs no blank line to end the block before it on *parse*
  // (these tests' structural assertions confirm it), but a source that
  // arrived without one gains one on *write*. Only a comment line directly
  // following another comment line is written back tight.

  test("terminates a paragraph without a blank line", () => {
    const source = "Prose.\n% hidden";
    expect(topLevel(source)).toEqual(["paragraph", "myst_comment"]);
    expect(roundTrip(source)).toBe("Prose.\n\n% hidden");
  });

  test("inside a list item", () => {
    const source = "* item\n  % note";
    expect(mystComments(source)).toEqual(["note"]);
    expect(roundTrip(source)).toBe("* item\n\n  % note");
  });

  test("inside a blockquote", () => {
    const source = "> quoted\n> % hidden";
    expect(mystComments(source)).toEqual(["hidden"]);
    expect(roundTrip(source)).toBe("> quoted\n>\n> % hidden");
  });

  test("inside a {note} body", () => {
    const source = "```{note}\nBody.\n\n% hidden\n% hidden too\n\n```";
    expect(mystComments(source)).toEqual(["hidden", "hidden too"]);
    expect(roundTrip(source)).toBe(source);
  });

  test("inside an {ifconfig} body", () => {
    const source = ":::{ifconfig} Class == 'A'\n% hidden\n:::";
    expect(mystComments(source)).toEqual(["hidden"]);
    // Same trailing-blank-line normalization the directive's own closing
    // fence gets for any body.
    expect(roundTrip(source)).toBe(
      ":::{ifconfig} Class == 'A'\n% hidden\n\n:::"
    );
  });

  test("50% of things is not a comment", () => {
    expect(topLevel("50% of things")).toEqual(["paragraph"]);
    expect(mystComments("50% of things")).toEqual([]);
  });

  test("4-space indent stays a code block, not a comment", () => {
    // Not comment-specific: indented code always normalizes to a fence
    // (`CodeBlock` inherits `CodeFence`'s `toMarkdown`). What matters is
    // that the line stayed a `code_block` and never became a comment.
    const source = "    % indented as code";
    expect(topLevel(source)).toEqual(["code_block"]);
    expect(roundTrip(source)).toBe("```\n% indented as code\n```");
  });

  test("a % line inside a code fence is untouched", () => {
    const source = "```\n% not a comment\n```";
    expect(mystComments(source)).toEqual([]);
    expect(roundTrip(source)).toBe(source);
  });

  test("a comment immediately followed by a list", () => {
    const source = "% c\n* item";
    expect(topLevel(source)).toEqual(["myst_comment", "bullet_list"]);
    expect(roundTrip(source)).toBe("% c\n\n* item");
  });

  /**
   * Sphinx's `{glossary}` reads its own body line by line, the reST way,
   * before any of it reaches MyST: at column 0 there, `% Term` is published
   * as a literal term, and `.. ` is the one comment it skips (whole entry,
   * definition lines included). Checked against Sphinx 8.2 and MyST-Parser
   * 5.1. So a commented-out entry is written `..`, and one written with `%`
   * — only ever by an earlier version of this editor, the real trees hold
   * none — opens as a comment and is written back with `..`.
   */
  test("a commented-out entry between two others splits the definition list", () => {
    const source = [
      ":::{glossary}",
      "Term one",
      "   Definition one.",
      "",
      ".. Term two (commented)",
      "..   Definition two.",
      "",
      "Term three",
      "   Definition three.",
      ":::",
    ].join("\n");

    const doc = parser.parse(source);
    let directive: ProsemirrorNode | undefined;
    doc?.descendants((node) => {
      if (node.type.name === "container_directive") {
        directive = node;
        return false;
      }
      return true;
    });
    expect(directive).toBeTruthy();

    const childTypes: string[] = [];
    directive?.forEach((node) => childTypes.push(node.type.name));
    expect(childTypes).toEqual([
      "definition_list",
      "myst_comment",
      "myst_comment",
      "definition_list",
    ]);
    expect(mystComments(source)).toEqual([
      "Term two (commented)",
      "  Definition two.",
    ]);
    // Trailing-blank-line normalization again, before the directive's own
    // closing fence.
    expect(roundTrip(source)).toBe(source.replace(/\n:::$/, "\n\n:::"));
    // The same entry written with `%` reads the same, and is written `..`.
    expect(roundTrip(source.replace(/^\.\. /gm, "%"))).toBe(roundTrip(source));
  });

  test("a glossary with every entry commented out is still a glossary", () => {
    // Sphinx builds it, empty, without a warning.
    const source = ":::{glossary}\n.. Only term\n..    Its definition.\n:::";
    expect(topLevel(source)).toEqual(["container_directive"]);
    expect(mystComments(source)).toEqual(["Only term", "   Its definition."]);
    expect(roundTrip(source)).toBe(source.replace(/\n:::$/, "\n\n:::"));
  });

  test("a glossary with nothing in it at all stays an opaque fence", () => {
    const source = ":::{glossary}\n:::";
    expect(topLevel(source)).toEqual(["code_block"]);
  });

  /**
   * A definition's body starting with `ensureNewLine` content — a comment,
   * an `hr`, a nested directive or notice — used to write back with a
   * spurious blank indented line before it: `DefinitionList.toMarkdown`
   * writes the body's indent eagerly, before its content renders, which a
   * plain paragraph continues on unnoticed but `ensureNewLine` mistook for
   * "something is already on this line" and separated from — indent and
   * all, since `wrapBlock` had already written it. Sphinx reads a blank
   * line between a term and its definition as ending the definition list,
   * so the entry (here, the whole rest of the glossary after it) silently
   * fell out of the list on the very next parse.
   */
  test("a definition body starting with a comment keeps its term, no blank line", () => {
    const source = [
      ":::{glossary}",
      "Term one",
      "   Body one.",
      "",
      "Term two",
      "   % Commented body.",
      ":::",
    ].join("\n");
    // A directive body gains a trailing blank line before its closing
    // fence regardless (see "admonition bodies gain a trailing blank line"
    // above) — unrelated to this fix. What this pins is that no blank line
    // appears *between the term and its comment*, which used to end the
    // definition list there and drop "Term two" from it entirely.
    expect(roundTrip(source)).toBe(source.replace(/\n:::$/, "\n\n:::"));
    expect(topLevel(source)).toEqual(["container_directive"]);
  });

  test("a definition body starting with an hr keeps its term, no blank line", () => {
    const source = [
      ":::{glossary}",
      "Term one",
      "   Body one.",
      "",
      "Term two",
      "   ---",
      ":::",
    ].join("\n");
    expect(roundTrip(source)).toBe(source.replace(/\n:::$/, "\n\n:::"));
    expect(topLevel(source)).toEqual(["container_directive"]);
  });

  test("the real operating_principle.md file round-trips stably", () => {
    // 21 consecutive and blank-separated `%` lines, among them a
    // commented-out two-level list.
    const filePath = path.join(
      "/var/www/doc-model-approval/source_install/3_Description_of_an_AverageSpeed_system",
      "20_Operating_principle/operating_principle.md"
    );
    let source: string;
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch {
      return; // Not available outside this machine's checkout — skip quietly.
    }
    const once = roundTrip(source);
    expect(roundTrip(once)).toBe(once);
    // Every comment line comes back exactly as it was in the source,
    // trailing spaces (hard breaks) included.
    const sourceComments = source
      .split("\n")
      .filter((line) => line.startsWith("%"));
    const writtenComments = once
      .split("\n")
      .filter((line) => line.startsWith("%"));
    expect(writtenComments).toEqual(sourceComments);
  });
});

/**
 * A MyST `(label)=` cross-reference target — nothing is rendered for it in
 * Sphinx either, but it assigns a label to whatever block follows for
 * `{ref}`/`{numref}` elsewhere in the document to point at. Becomes a
 * `myst_target` node instead of a stray paragraph of parenthesised text.
 */
describe("(label)= becomes a myst_target node", () => {
  function targetLabels(source: string): string[] {
    const found: string[] = [];
    parser.parse(source)?.descendants((node) => {
      if (node.type.name === "myst_target") {
        found.push(node.textContent);
      }
      return true;
    });
    return found;
  }

  function topLevel(source: string): string[] {
    const found: string[] = [];
    parser.parse(source)?.forEach((node) => {
      found.push(node.type.name);
    });
    return found;
  }

  test("a simple label round-trips", () => {
    const source = "(my-label)=\n\nProse.";
    expect(targetLabels(source)).toEqual(["my-label"]);
    expect(roundTrip(source)).toBe(source);
  });

  test("terminates a paragraph without a blank line", () => {
    const source = "Prose.\n(next)=\n\nMore.";
    expect(topLevel(source)).toEqual(["paragraph", "myst_target", "paragraph"]);
    expect(roundTrip(source)).toBe("Prose.\n\n(next)=\n\nMore.");
  });

  test("a single-character label is the minimum valid target", () => {
    expect(targetLabels("(1)=")).toEqual(["1"]);
    expect(roundTrip("(1)=")).toBe("(1)=");
  });

  test("empty parentheses are not a target", () => {
    expect(topLevel("()=")).toEqual(["paragraph"]);
    expect(targetLabels("()=")).toEqual([]);
  });

  test("missing the trailing = is not a target", () => {
    expect(topLevel("(label)")).toEqual(["paragraph"]);
  });

  test("4-space indent stays a code block, not a target", () => {
    const source = "    (indented)=";
    expect(topLevel(source)).toEqual(["code_block"]);
    expect(roundTrip(source)).toBe("```\n(indented)=\n```");
  });

  test("immediately followed by a heading", () => {
    const source = "(intro)=\n\n# Title";
    expect(topLevel(source)).toEqual(["myst_target", "heading"]);
    expect(roundTrip(source)).toBe(source);
  });

  test("inside a list item", () => {
    const source = "* item\n  (nested)=";
    expect(targetLabels(source)).toEqual(["nested"]);
    expect(roundTrip(source)).toBe("* item\n\n  (nested)=");
  });

  test("the real Functional_architecture.md file round-trips stably", () => {
    // 29 `(N)=` targets, each directly followed (no blank line) by a
    // `{dot}` role paragraph.
    const filePath = path.join(
      "/var/www/doc-model-approval/source_install/3_Description_of_an_AverageSpeed_system",
      "40_Functional_architecture/Functional_architecture.md"
    );
    let source: string;
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch {
      return; // Not available outside this machine's checkout — skip quietly.
    }
    const once = roundTrip(source);
    expect(roundTrip(once)).toBe(once);
    const sourceTargets = source
      .split("\n")
      .filter((line) => /^\([^)]+\)=$/.test(line));
    const writtenTargets = once
      .split("\n")
      .filter((line) => /^\([^)]+\)=$/.test(line));
    expect(writtenTargets).toEqual(sourceTargets);
    expect(writtenTargets.length).toBe(29);
  });
});

/**
 * `MYST_FIGURE_FOR_CAPTIONED_IMAGES` — opt-in, per installation. Off, a
 * captioned image is the plain `![caption](src)` it always was; on, one
 * standing alone in its paragraph is written as a `{figure-md}`.
 */
describe("captioned images as {figure-md}", () => {
  const FLAG = "MYST_FIGURE_FOR_CAPTIONED_IMAGES";
  const original = process.env[FLAG];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = original;
    }
  });

  const captioned = "![A camera](media/photo.png)";

  test("off by default: a captioned image stays a plain image", () => {
    delete process.env[FLAG];
    expect(roundTrip(captioned).trim()).toBe(captioned);
  });

  test("on: a lone captioned image is written as {figure-md}", () => {
    process.env[FLAG] = "true";
    const once = roundTrip(captioned);
    expect(once.trim()).toBe(
      "```{figure-md}\n![](media/photo.png)\n\nA camera\n\n```"
    );
    // Same shape `Figure` itself writes (blank line before the closing fence
    // included). It reads back as a real Figure, and is stable from there.
    expect(parser.parse(once)?.firstChild?.type).toBe(schema.nodes.figure);
    expect(roundTrip(once)).toBe(once);
  });

  test("on: width and alignment carry over", () => {
    process.env[FLAG] = "true";
    const once = roundTrip('![A camera](media/photo.png "left-50 =300x200")');
    expect(once).toContain("![](media/photo.png){width=300 align=left}");
  });

  test.each([
    ["no caption", "![](media/photo.png)"],
    ["image mid-sentence", "See ![icon](media/icon.png) here."],
    ["two images in one paragraph", "![a](a.png) ![b](b.png)"],
    ["linked image", "[![A camera](media/photo.png)](https://example.com)"],
    ["image in a table cell", "| a |\n|---|\n| ![A camera](media/photo.png) |"],
  ])("on: left alone — %s", (_name, source) => {
    process.env[FLAG] = "true";
    expect(roundTrip(source)).not.toContain("{figure-md}");
  });

  test("on: turning it off again brings the plain image back", () => {
    const doc = parser.parse(captioned);
    process.env[FLAG] = "true";
    expect(serializer.serialize(doc!)).toContain("{figure-md}");
    delete process.env[FLAG];
    expect(serializer.serialize(doc!).trim()).toBe(captioned);
  });
});

/**
 * A colon fence ends where MyST ends it. The parser tracks nesting so that a
 * `{glossary}` holding a `{grid}` holding a `{grid-item}` closes on its own
 * closer, but real content also leaves a fence without one of its own — a
 * `{glossary}` whose indented `{grid}` shares its colon count, the grid's
 * closer then doing for both, which MyST reads as the glossary's end. With
 * nesting tracked alone that fence found no closer and swallowed every block
 * after it into a single code block.
 */
describe("a colon fence without a closer of its own ends where MyST ends it", () => {
  function topLevel(source: string) {
    const doc = parser.parse(source);
    const found: string[] = [];
    doc?.forEach((node) => {
      found.push(
        node.type.name === "container_directive"
          ? `directive:${node.attrs.directive}`
          : node.type.name
      );
    });
    return found;
  }

  const shared =
    ":::::{glossary}\n" +
    "\n" +
    "Term one\n" +
    "   Definition.\n" +
    "\n" +
    "   :::::{grid} 2\n" +
    "\n" +
    "   ::::{grid-item}\n" +
    "   Cell\n" +
    "   ::::\n" +
    "   :::::\n" +
    "\n";

  test("the blocks after it stay separate", () => {
    const source =
      shared +
      ":::::{glossary}\n" +
      "\n" +
      "Term two\n" +
      "   Other.\n" +
      ":::::\n" +
      "\n" +
      "After.\n";

    expect(topLevel(source)).toEqual([
      "directive:glossary",
      "directive:glossary",
      "paragraph",
    ]);
  });

  test("it is still a definition list with its grid inside", () => {
    const doc = parser.parse(
      shared + ":::::{glossary}\n\nTerm two\n   Other.\n:::::\n"
    );
    const kinds: Record<string, number> = {};
    doc?.firstChild?.descendants((node) => {
      kinds[node.type.name] = (kinds[node.type.name] ?? 0) + 1;
    });

    expect(kinds.definition_list).toBe(1);
    expect(kinds.definition_term).toBe(1);
    // The grid and its one item.
    expect(kinds.container_directive).toBe(2);
  });

  test("well-formed nesting still closes on its own closer", () => {
    // Same colon count throughout, but the glossary has a closer of its own.
    const source = shared + ":::::\n\nAfter.\n";

    expect(topLevel(source)).toEqual(["directive:glossary", "paragraph"]);
  });

  test("a fence with no closer anywhere still runs to the end", () => {
    // Nothing to fall back to: it takes the rest of the document, as an
    // unclosed fence does in MyST too. (Not a definition list, because of
    // the unindented paragraph, so it stays an inert block.)
    const source = ":::::{glossary}\n\nTerm\n   Definition.\n\nStill inside.\n";

    expect(topLevel(source)).toHaveLength(1);
  });

  test("the result writes back as properly nested MyST", () => {
    const once = roundTrip(
      shared + ":::::{glossary}\n\nTerm two\n   Other.\n:::::\n\nAfter.\n"
    );

    // Outline writes the outer fence one colon longer than the grid it
    // holds, so the document no longer relies on a closer doing double duty.
    expect(once).toMatch(/^::::::\{glossary\}$/m);
    expect(topLevel(once)).toEqual([
      "directive:glossary",
      "directive:glossary",
      "paragraph",
    ]);
    expect(roundTrip(once)).toBe(once);
  });
});
