import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";

/** A MyST figure directive Outline can parse natively. */
export type FigureDirective = "figure" | "figure-md";

/** A MyST option line, e.g. `:width: 600`, reused from the notice rule's own convention. */
const OPTION_LINE = /^:[A-Za-z0-9_-]+:(?:\s|$)/;

/** A `:width: 600`-style option line, pixels only. */
const WIDTH_OPTION_LINE = /^:width:\s*(\d+)(?:px)?\s*$/;

/** A single `width=` token inside an image's trailing `{...}` attrs, bare or quoted, e.g. `width=600` or `width="600px"`. */
const WIDTH_TOKEN = /^width=["']?(\d+)(?:px)?["']?$/;

/**
 * A single `align=` token inside an image's trailing `{...}` attrs, e.g.
 * `align=center`. MyST's own `align` option (see
 * https://myst-parser.readthedocs.io/en/latest/syntax/images_and_figures.html)
 * also accepts `top`/`middle`/`bottom` — a different axis entirely, vertical
 * alignment for an image inline with text, which Outline's own image has no
 * equivalent for at all. Left unrecognized on purpose rather than guessed
 * at: this regex only ever matches the horizontal three Outline actually has
 * something to do with.
 */
const ALIGN_TOKEN = /^align=["']?(left|right|center)["']?$/;

/**
 * Sphinx/MyST's horizontal `align` values map onto Outline's own image
 * alignment override — `left-50`/`right-50` — except `center`, which is what
 * Outline's image already renders as with no override at all, so there is
 * nothing to set.
 */
const ALIGN_TO_LAYOUT_CLASS: Record<
  "left" | "right" | "center",
  string | null
> = {
  left: "left-50",
  right: "right-50",
  center: null,
};

/**
 * Read an image's trailing `{...}` attrs text for a recognized pixel width
 * and/or horizontal alignment — the only two MyST attrs_inline keys real
 * figures in this project's docs actually combine (`{width=300
 * align=center}`, `{align=center width=300}` — either order). MyST's
 * attrs_inline extension has a wider vocabulary than this — a `.class`
 * shorthand, `w=`/`h=` short option names, `scale`, `name` — none of it seen
 * in real content here; a third key, an unrecognized `align` value, or
 * either key repeated is left unrecognized rather than guessed at, same as
 * the rest of this file's own conservative bias.
 *
 * @param text - the trailing text immediately after an image, e.g.
 * `{width=300 align=center}`.
 * @returns the recognized width and/or layout class (`null` for a
 * recognized-but-inert `align=center`, `undefined` if no `align` token was
 * present at all), or undefined if `text` is not exactly this shape.
 */
function parseWidthAndAlignAttr(
  text: string
): { width?: number; layoutClass?: string | null } | undefined {
  const match = /^\{([^{}]*)\}$/.exec(text.trim());
  if (!match) {
    return undefined;
  }

  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 2) {
    return undefined;
  }

  let width: number | undefined;
  let align: "left" | "right" | "center" | undefined;
  for (const token of tokens) {
    const widthMatch = WIDTH_TOKEN.exec(token);
    if (widthMatch && width === undefined) {
      width = Number(widthMatch[1]);
      continue;
    }
    const alignMatch = ALIGN_TOKEN.exec(token);
    if (alignMatch && align === undefined) {
      align = alignMatch[1] as "left" | "right" | "center";
      continue;
    }
    return undefined;
  }

  if (width === undefined && align === undefined) {
    return undefined;
  }
  return {
    width,
    layoutClass: align ? ALIGN_TO_LAYOUT_CLASS[align] : undefined,
  };
}

type ParsedFigureInfo = {
  directive: FigureDirective;
  /** The directive's argument: a cross-reference label for figure-md, the image target for figure. */
  argument: string;
};

/**
 * Read a fence's info string as a `{figure}` or `{figure-md}` directive.
 *
 * @param info - the fence token's info string.
 * @returns the directive and its argument, or undefined if it names neither.
 */
function parseFigureInfo(info: string): ParsedFigureInfo | undefined {
  const match = /^\{(figure-md|figure)\}\s*(.*)$/.exec(info.trim());
  if (!match) {
    return undefined;
  }
  return { directive: match[1] as FigureDirective, argument: match[2].trim() };
}

/** A body paragraph, carrying both its raw source and its inline-parsed children. */
type BodyParagraph = {
  raw: string;
  children: Token[];
};

/**
 * Split a fence body into its top-level paragraphs, each carrying both its
 * raw source text and its inline-parsed children — the raw text for option
 * lines, which are read off the source rather than the parse tree, and the
 * children for everything else. Any block other than a bare paragraph
 * anywhere in the body fails the whole read.
 *
 * @param state - the core ruler state, used to reach the markdown-it instance.
 * @param body - the fence's raw body text.
 * @returns the body's paragraphs in order, or undefined if the body holds
 * anything other than a plain sequence of paragraphs.
 */
function splitBodyParagraphs(
  state: StateCore,
  body: string
): BodyParagraph[] | undefined {
  const bodyTokens: Token[] = [];
  state.md.block.parse(body, state.md, state.env, bodyTokens);

  if (bodyTokens.length === 0 || bodyTokens.length % 3 !== 0) {
    return undefined;
  }

  const paragraphs: BodyParagraph[] = [];
  for (let i = 0; i < bodyTokens.length; i += 3) {
    const open = bodyTokens[i];
    const inline = bodyTokens[i + 1];
    const close = bodyTokens[i + 2];
    if (
      open?.type !== "paragraph_open" ||
      inline?.type !== "inline" ||
      close?.type !== "paragraph_close"
    ) {
      return undefined;
    }
    const raw = inline.content;
    inline.children = [];
    state.md.inline.parse(raw, state.md, state.env, inline.children);
    paragraphs.push({ raw, children: inline.children });
  }
  return paragraphs;
}

/**
 * The rendered plain text of a caption paragraph's inline children.
 *
 * `alt` has no room for marks, so emphasis flattens to its plain text rather
 * than being lost outright. Anything this function does not recognize — a
 * link, an image, inline math, raw HTML — returns undefined so the caller can
 * decline the whole figure instead of guessing at how to represent it.
 *
 * @param children - the caption paragraph's inline child tokens.
 * @returns the flattened plain text, or undefined if a child token is not one
 * of text, inline code, a line break, or an emphasis/strikethrough wrapper.
 */
function extractPlainCaption(children: Token[]): string | undefined {
  const parts: string[] = [];
  for (const child of children) {
    if (child.type === "text" || child.type === "code_inline") {
      parts.push(child.content);
    } else if (child.type === "softbreak" || child.type === "hardbreak") {
      parts.push(" ");
    } else if (
      child.type === "strong_open" ||
      child.type === "strong_close" ||
      child.type === "em_open" ||
      child.type === "em_close" ||
      child.type === "s_open" ||
      child.type === "s_close"
    ) {
      continue;
    } else {
      return undefined;
    }
  }
  return parts.join("");
}

/**
 * The single image and, if present, its recognized pixel width and/or
 * alignment, from a paragraph's inline children — the shape a `{figure-md}`
 * body's image line parses into.
 *
 * MyST attrs_inline (`{width=600}`, `{width=300 align=center}`) is not
 * otherwise understood by Outline's own image markdown, so it arrives here
 * as ordinary trailing text right after the image token. Anything besides
 * exactly one image, optionally followed by exactly that shape of trailing
 * text, is not recognized.
 *
 * @param children - the image paragraph's inline child tokens.
 * @returns the image token and any recognized width/layout class, or
 * undefined if the children are not exactly an image alone or an image plus
 * a recognized attrs_inline attribute.
 */
function extractImageAndWidth(
  children: Token[]
): { image: Token; width?: number; layoutClass?: string | null } | undefined {
  if (children.length === 1 && children[0].type === "image") {
    return { image: children[0] };
  }
  if (
    children.length === 2 &&
    children[0].type === "image" &&
    children[1].type === "text"
  ) {
    const parsed = parseWidthAndAlignAttr(children[1].content.trim());
    if (parsed) {
      return { image: children[0], ...parsed };
    }
  }
  return undefined;
}

/** Pull a `:width:` line's pixel value out of an option paragraph, if present. */
function extractWidthOption(raw: string): {
  width: number | undefined;
  remaining: string;
} {
  let width: number | undefined;
  const remaining: string[] = [];
  for (const line of raw.split("\n")) {
    const match = WIDTH_OPTION_LINE.exec(line);
    if (match) {
      width = Number(match[1]);
    } else {
      remaining.push(line);
    }
  }
  return { width, remaining: remaining.join("\n") };
}

/**
 * Build the `figure_open`, `inline`, `figure_close` token triple a `Figure`
 * node parses from, for a figure the caller has already validated and is
 * ready to claim.
 *
 * @param state - the core ruler state, used to construct new tokens.
 * @param directive - which directive this arrived as.
 * @param argument - the directive's own argument (figure-md's label, or empty for figure).
 * @param image - the image token to wrap, already carrying its final
 * `meta.caption` and optional `meta.width`.
 * @param options - verbatim leftover option lines this rule does not
 * otherwise understand, or empty.
 */
function buildFigureTokens(
  state: StateCore,
  directive: FigureDirective,
  argument: string,
  image: Token,
  options: string
): Token[] {
  const openToken = new state.Token("figure_open", "figure", 1);
  openToken.meta = { directive, argument, options };
  openToken.block = true;

  const inlineToken = new state.Token("inline", "", 0);
  inlineToken.content = "";
  inlineToken.children = [image];
  inlineToken.block = true;

  const closeToken = new state.Token("figure_close", "figure", -1);
  closeToken.block = true;

  return [openToken, inlineToken, closeToken];
}

/**
 * Try to read a `{figure-md}` fence's body as a native figure: one image line
 * (its own trailing `{width=…}` recognized if present), then optionally a
 * blank line and one plain caption paragraph. Anything else — a legend, more
 * than one paragraph of caption, no image at all — is left for the caller to
 * fall back to an inert fence.
 */
function tryBuildFigureMd(
  state: StateCore,
  argument: string,
  body: string
): Token[] | undefined {
  const paragraphs = splitBodyParagraphs(state, body);
  if (!paragraphs || paragraphs.length < 1 || paragraphs.length > 2) {
    return undefined;
  }

  const imageResult = extractImageAndWidth(paragraphs[0].children);
  if (!imageResult) {
    return undefined;
  }

  let caption: string | undefined = "";
  if (paragraphs.length === 2) {
    caption = extractPlainCaption(paragraphs[1].children);
    if (caption === undefined) {
      return undefined;
    }
  }

  const { image, width, layoutClass } = imageResult;
  // The alt text on the image line itself and a separate caption paragraph
  // are two different things in MyST; Outline's image has room for only one.
  // The real templates leave the image line's alt empty, so prefer the
  // caption — but a non-empty, differing alt is ambiguous enough to decline
  // rather than silently pick one and lose the other.
  const existingAlt = image.content || "";
  if (existingAlt && caption && existingAlt !== caption) {
    return undefined;
  }

  image.meta = {
    ...image.meta,
    caption: caption || existingAlt,
    ...(width ? { width } : {}),
    // `layoutClass` may legitimately be `null` (a recognized but inert
    // `align=center`) as opposed to `undefined` (no `align` token at all) —
    // both are meaningful and neither should be dropped here.
    ...(layoutClass !== undefined ? { layoutClass } : {}),
  };

  return buildFigureTokens(state, "figure-md", argument, image, "");
}

/**
 * Try to read a `{figure}` fence's body as a native figure. The target lives
 * on the fence's own argument line rather than inside the body, so the body
 * holds at most one option paragraph (a run of `:key: value` lines — only
 * `:width:` is understood, any others are kept verbatim rather than dropped)
 * followed by an optional plain caption paragraph.
 *
 * A YAML-style `---`-delimited option block is not recognized here and falls
 * back to an inert fence, same as any other body shape this does not cover.
 */
function tryBuildFigure(
  state: StateCore,
  target: string,
  body: string
): Token[] | undefined {
  if (!target) {
    return undefined;
  }

  if (!body.trim()) {
    return buildFigureTokens(
      state,
      "figure",
      "",
      makeTargetImage(state, target),
      ""
    );
  }

  const paragraphs = splitBodyParagraphs(state, body);
  if (!paragraphs || paragraphs.length < 1 || paragraphs.length > 2) {
    return undefined;
  }

  let index = 0;
  let width: number | undefined;
  let options = "";

  const firstLines = paragraphs[0].raw.split("\n");
  if (firstLines.every((line) => OPTION_LINE.test(line))) {
    const extracted = extractWidthOption(paragraphs[0].raw);
    width = extracted.width;
    options = extracted.remaining;
    index = 1;
  }

  let caption: string | undefined = "";
  if (index < paragraphs.length) {
    caption = extractPlainCaption(paragraphs[index].children);
    if (caption === undefined) {
      return undefined;
    }
    index += 1;
  }

  if (index !== paragraphs.length) {
    // A legend, or a second paragraph of caption this rule does not expect.
    return undefined;
  }

  const image = makeTargetImage(state, target);
  image.meta = { caption, ...(width ? { width } : {}) };
  return buildFigureTokens(state, "figure", "", image, options);
}

/** A synthetic image token for `{figure}`, whose target is its own argument rather than a body image line. */
function makeTargetImage(state: StateCore, target: string): Token {
  const image = new state.Token("image", "img", 0);
  image.attrs = [
    ["src", target],
    ["alt", ""],
  ];
  image.content = "";
  return image;
}

/**
 * Claim a `{figure}` or `{figure-md}` fence Outline can represent natively —
 * a lone captioned image, optionally with a recognized pixel width — instead
 * of leaving it as an inert code fence.
 *
 * Runs on the fully block-parsed token stream, after the colon-fence
 * passthrough rule in `notices.ts` has already turned any colon-fenced
 * occurrence into a plain `fence` token alongside native backtick ones, so
 * this rule does not need to know which marker a figure arrived on.
 *
 * Registered last in the core ruler (`push`, not `after("block")`), so it
 * runs after `notices.ts`'s own rules have already reparsed and spliced in
 * the body of any admonition wrapping this figure — otherwise a figure
 * nested one level down, exactly the doc-model-approval case that motivated
 * the colon-fence work, would still be sitting inside the outer admonition's
 * unparsed raw text when this rule looked for it and never get claimed.
 *
 * A directive whose body holds anything beyond the shapes above — a legend
 * paragraph, more than one image, a differing alt and caption, a YAML option
 * block — is left untouched: it stays an inert `code_fence`, the same
 * fallback every directive Outline has no node for already gets, and nothing
 * is lost.
 *
 * @param md - the markdown-it instance to register the rule on.
 */
export default function figures(md: MarkdownIt): void {
  md.core.ruler.push("figure-directive-fence", (state) => {
    const tokens = state.tokens;

    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      if (token.type !== "fence") {
        continue;
      }

      const parsed = parseFigureInfo(token.info);
      if (!parsed) {
        continue;
      }

      const figureTokens =
        parsed.directive === "figure-md"
          ? tryBuildFigureMd(state, parsed.argument, token.content)
          : tryBuildFigure(state, parsed.argument, token.content);

      if (!figureTokens) {
        continue;
      }

      tokens.splice(i, 1, ...figureTokens);
    }

    return false;
  });
}
