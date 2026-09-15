import type { Command } from "prosemirror-state";
import { deleteEmptyDirectiveOrNotice } from "../commands/deleteEmptyDirective";
import Extension from "../lib/Extension";

/**
 * Lets Backspace/Delete remove an already-emptied `container_directive`/
 * `container_notice` outright — see `commands/deleteEmptyDirective.ts`.
 * Needed because both nodes are `isolating: true` (to stop two adjacent
 * ones from silently merging into one), which also stops the default
 * Backspace/Delete handling from reaching in to remove one even when
 * there's nothing left inside it.
 */
export default class DeleteEmptyDirective extends Extension {
  get name() {
    return "deleteEmptyDirective";
  }

  keys(): Record<string, Command> {
    return {
      Backspace: deleteEmptyDirectiveOrNotice,
      Delete: deleteEmptyDirectiveOrNotice,
    };
  }
}
