import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { validateColorHex } from "../../utils/color";

const OPEN_TAG_REGEX = /^<mark\s+([^>]*)>/i;
const CLOSE_TAG_REGEX = /<\/mark>/gi;
const DATA_COLOR_REGEX = /\bdata-color\s*=\s*"([^"]*)"/i;
const BACKGROUND_COLOR_REGEX = /\bbackground-color\s*:\s*([^;"]+)/i;

/**
 * Reads the highlight color from the attributes of a `<mark>` opening tag.
 * Both the `data-color` attribute the editor writes to the DOM and an inline
 * `background-color` style are understood.
 *
 * @param attributes - the text between `<mark` and `>`.
 * @returns the color as a hex string, or null when there is no valid color.
 */
export function parseMarkColor(attributes: string): string | null {
  const match =
    attributes.match(DATA_COLOR_REGEX) ??
    attributes.match(BACKGROUND_COLOR_REGEX);
  const color = match?.[1].trim();
  return color && validateColorHex(color) ? color : null;
}

/**
 * Serializes a highlight color into the `<mark>` opening tag the parser above
 * reads back. The inline style is what a browser renders, so the highlight
 * shows in its color wherever the Markdown is rendered as HTML.
 *
 * @param color - a hex color.
 * @returns the opening tag.
 */
export function markOpenTag(color: string): string {
  return `<mark style="background-color: ${color}">`;
}

// Per-parse count of `<mark>` tags opened and not yet closed, so a stray
// `</mark>` never emits an unmatched closing token.
const openDepth = new WeakMap<StateInline, number>();

/**
 * A markdown-it plugin parsing `<mark style="background-color: #RRGGBB">` …
 * `</mark>` into highlight tokens carrying the color. `==text==` has no room for
 * a color, and the parser runs with `html: false`, so without this rule a
 * highlight color could not survive a trip through Markdown.
 *
 * A `<mark>` without a valid color, or without a closing tag, is left alone and
 * passes through as text like any other raw HTML.
 */
export default function highlightHtml(md: MarkdownIt): void {
  function tokenize(state: StateInline, silent: boolean): boolean {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) {
      return false;
    }
    const rest = state.src.slice(state.pos);

    const open = rest.match(OPEN_TAG_REGEX);
    if (open) {
      const color = parseMarkColor(open[1]);
      if (!color) {
        return false;
      }
      CLOSE_TAG_REGEX.lastIndex = state.pos + open[0].length;
      if (!CLOSE_TAG_REGEX.exec(state.src)) {
        return false;
      }
      if (!silent) {
        const token = state.push("highlight_open", "mark", 1);
        token.attrs = [["color", color]];
        token.markup = open[0];
        openDepth.set(state, (openDepth.get(state) ?? 0) + 1);
      }
      state.pos += open[0].length;
      return true;
    }

    CLOSE_TAG_REGEX.lastIndex = 0;
    const close = CLOSE_TAG_REGEX.exec(rest);
    if (close?.index === 0) {
      const depth = openDepth.get(state) ?? 0;
      if (depth === 0) {
        return false;
      }
      if (!silent) {
        const token = state.push("highlight_close", "mark", -1);
        token.markup = close[0];
        openDepth.set(state, depth - 1);
      }
      state.pos += close[0].length;
      return true;
    }

    return false;
  }

  md.inline.ruler.before("html_inline", "highlight_html", tokenize);
}
