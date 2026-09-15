import type { Command } from "prosemirror-state";
import {
  preventDirectiveMergeBackward,
  preventDirectiveMergeForward,
} from "../commands/preventDirectiveMerge";
import Extension from "../lib/Extension";

/**
 * Stops Backspace/Delete from silently merging two adjacent
 * `container_directive`/`container_notice` blocks (e.g. two `{glossary}`s,
 * or an `{ifconfig}` and a `{grid}`) into one — see
 * `commands/preventDirectiveMerge.ts` for the bug this guards against.
 */
export default class PreventDirectiveMerge extends Extension {
  get name() {
    return "preventDirectiveMerge";
  }

  keys(): Record<string, Command> {
    return {
      Backspace: preventDirectiveMergeBackward,
      Delete: preventDirectiveMergeForward,
    };
  }
}
