/**
 * Escapes raw block content (code & math fences) so it survives on a single
 * table-cell line. Their content bypasses the serializer's `esc()`, so the
 * backslash (the escape character) and pipe (the cell delimiter) are escaped
 * together in one pass to keep the content from breaking out of the column.
 *
 * @param text - the raw fence content.
 * @returns the escaped content, reversible with `unescapeRawTableCell`.
 */
export function escapeRawTableCell(text: string): string {
  return text.replace(/[\\|]/g, "\\$&");
}

/**
 * Reverses `escapeRawTableCell` when a fenced block is reconstructed from a
 * table cell, restoring the escaped backslashes and pipes. Markdown does not
 * unescape inside raw blocks, so this is applied during the nested re-parse.
 *
 * @param text - the escaped fence content.
 * @returns the original raw content.
 */
export function unescapeRawTableCell(text: string): string {
  return text.replace(/\\([\\|])/g, "$1");
}

/**
 * Matches the HTML comment that carries a cell's background color at the start
 * of its Markdown content, e.g. `<!-- bg:#fdea9bb3 -->`, together with the
 * whitespace separating it from the content.
 */
export const CELL_BACKGROUND_REGEX =
  /^<!--\s*bg\s*:\s*(#[0-9a-f]{3,8})\s*-->\s*/i;

/**
 * Writes the marker that carries a cell's background color through Markdown.
 * A pipe table has nowhere to put cell styling, so the color travels as an HTML
 * comment at the start of the cell, which renders as nothing wherever the
 * Markdown is turned into HTML.
 *
 * @param color - the background color in hex notation.
 * @returns the marker to prefix the cell content with.
 */
export function cellBackgroundMarker(color: string): string {
  return `<!-- bg:${color} -->`;
}
