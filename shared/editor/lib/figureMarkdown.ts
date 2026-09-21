import type { Node as ProsemirrorNode } from "prosemirror-model";
import env from "../../env";
import type { MarkdownSerializerState } from "./markdown/serializer";

/**
 * Whether this installation writes a captioned image out as a MyST
 * `{figure-md}` directive — the `MYST_FIGURE_FOR_CAPTIONED_IMAGES`
 * environment variable. Off unless set.
 *
 * Read through `@shared/env` rather than an extension option: the markdown
 * serializer also runs on the server, from a module-level extension manager
 * built with no editor instance, where options never arrive. There the
 * value is the raw `process.env` string; in the browser it is the parsed
 * boolean the server presented.
 *
 * @returns true if captioned images should be written as `{figure-md}`.
 */
export function captionedImagesAsFigures(): boolean {
  const value = env?.MYST_FIGURE_FOR_CAPTIONED_IMAGES;
  return value === true || value === "true";
}

/**
 * The `{width=… align=…}` attribute block of a `{figure-md}` image line.
 *
 * Only a real left/right override round-trips as `align=`; Outline's own
 * default (no `layoutClass` override) is already what a MyST reader sees
 * for `align=center` too, so there is nothing to write back for it — see
 * `ALIGN_TO_LAYOUT_CLASS` in `rules/figures.ts` for the read side of this
 * same asymmetry. `full-width`, an Outline-only layout with no `align`
 * equivalent, is likewise left unwritten.
 *
 * @param image - the image node.
 * @returns the attribute block, or an empty string if there is nothing to say.
 */
export function figureMdImageAttrs(image: ProsemirrorNode): string {
  const parts: string[] = [];
  if (image.attrs.width) {
    parts.push(`width=${image.attrs.width}`);
  }
  if (image.attrs.layoutClass === "left-50") {
    parts.push("align=left");
  } else if (image.attrs.layoutClass === "right-50") {
    parts.push("align=right");
  }
  return parts.length ? `{${parts.join(" ")}}` : "";
}

/**
 * The image a paragraph should be written as a `{figure-md}` for, when
 * `captionedImagesAsFigures` is on: the paragraph's only child, captioned,
 * and carrying nothing a figure has no place for — a link, a diagram
 * source, a title. Anything else stays the plain image it is.
 *
 * @param paragraph - the paragraph node being serialized.
 * @returns the image to write as a figure, or undefined.
 */
export function loneCaptionedImage(
  paragraph: ProsemirrorNode
): ProsemirrorNode | undefined {
  if (paragraph.childCount !== 1) {
    return undefined;
  }
  const image = paragraph.firstChild;
  if (!image || image.type.name !== "image") {
    return undefined;
  }

  const { alt, source, title, marks } = image.attrs;
  const hasCaption = typeof alt === "string" && alt.trim() !== "";
  const hasLink = image.marks.length > 0 || (marks?.length ?? 0) > 0;
  if (!hasCaption || hasLink || source || title) {
    return undefined;
  }
  return image;
}

/**
 * Writes an image as a label-less `{figure-md}` directive, in exactly the
 * shape `Figure.toMarkdown` writes one that arrived as such.
 *
 * @param state - the serializer state.
 * @param image - the captioned image.
 * @param parent - the block being closed, for `closeBlock`.
 */
export function writeFigureMd(
  state: MarkdownSerializerState,
  image: ProsemirrorNode,
  parent: ProsemirrorNode
) {
  state.ensureNewLine();
  state.write("```{figure-md}\n");
  state.write(
    `![](${state.esc(image.attrs.src || "", false)})${figureMdImageAttrs(image)}`
  );
  state.closeBlock(parent);
  state.text(String(image.attrs.alt).replace("\n", " "), true);
  state.closeBlock(parent);
  state.ensureNewLine();
  state.write("```");
  state.closeBlock(parent);
}
