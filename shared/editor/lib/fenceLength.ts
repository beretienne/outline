import type { Node as ProsemirrorNode } from "prosemirror-model";
import { longestRun } from "../nodes/CodeFence";
import { isVerbatimDirective } from "../rules/directives";

/** A fence when it contains nothing that could collide with it. */
export const DEFAULT_FENCE_LENGTH = 3;

/**
 * The shortest fence of `fenceChar` long enough to wrap every code fence,
 * figure, notice or directive this node contains, directly or nested further
 * down, without colliding with any of them.
 *
 * `Notice` always writes itself back with a backtick fence, regardless of how
 * it arrived — a deliberate simplification, since the character choice is
 * cosmetic in MyST. `Directive` instead preserves whichever character it
 * arrived with, matching the byte-exact promise the inert `CodeFence`
 * fallback already makes for the same directive names, so `fenceChar` is a
 * parameter rather than always backtick. A code fence grows its own to clear
 * its own content, a figure always uses three backticks — so without this, a
 * node wrapping any of them would end at the first inner fence line instead
 * of its own, truncating on parse and, on every subsequent save, growing
 * another stray fence around the wreckage.
 *
 * A child fenced in a *different* character never collides on its own
 * wrapper, but that does not mean it is safe to stop looking: it is real,
 * structured content, not opaque text, and something nested further inside
 * it — a code fence three levels down, say — can still use `fenceChar`
 * itself. Only a genuinely opaque node (`code_fence`/`code_block`, whose
 * content is raw preserved text) is scanned by its text content instead of
 * walked into; every other container keeps being descended into regardless
 * of its own wrapper character, so a deeper collision is never missed.
 *
 * @param node - the node whose content to scan.
 * @param fenceChar - the character this node itself is about to be wrapped
 * in. Defaults to backtick, matching every caller before `Directive` existed.
 * @returns the fence length to write, at least `DEFAULT_FENCE_LENGTH`.
 */
export function requiredFenceLength(
  node: ProsemirrorNode,
  fenceChar: string = "`"
): number {
  let innerMax = 0;
  node.descendants((child, _pos, parent) => {
    if (
      (child.type.name === "code_fence" || child.type.name === "code_block") &&
      parent &&
      isVerbatimDirective(parent)
    ) {
      // A verbatim directive's body is written bare, with no fence of its
      // own, so only a run of `fenceChar` in the text itself can collide.
      const contentRun = longestRun(child.textContent, fenceChar);
      innerMax = Math.max(innerMax, contentRun >= 3 ? contentRun : 0);
      return false;
    }
    if (child.type.name === "code_fence" || child.type.name === "code_block") {
      const childFenceChar: string = child.attrs.fenceChar || "`";
      const contentRun = longestRun(child.textContent, fenceChar);
      const childLength =
        childFenceChar === fenceChar
          ? Math.max(
              child.attrs.fenceLength || DEFAULT_FENCE_LENGTH,
              contentRun >= 3 ? contentRun + 1 : DEFAULT_FENCE_LENGTH
            )
          : contentRun >= 3
            ? contentRun + 1
            : 0;
      innerMax = Math.max(innerMax, childLength);
      return false;
    }
    if (child.type.name === "figure") {
      // Figure always writes a backtick fence, and its only content is an
      // image — nothing further to find inside it either way.
      if (fenceChar === "`") {
        innerMax = Math.max(innerMax, DEFAULT_FENCE_LENGTH);
      }
      return false;
    }
    if (child.type.name === "container_notice") {
      // Notice always writes a backtick fence too, regardless of how it
      // arrived, so its own wrapper is only ever a risk to a backtick
      // ancestor — but it can hold a directive of any character further
      // inside, so a mismatch here still has to keep descending.
      if (fenceChar === "`") {
        innerMax = Math.max(innerMax, requiredFenceLength(child, "`"));
        return false;
      }
      return true;
    }
    if (child.type.name === "container_directive") {
      const childFenceChar: string = child.attrs.fenceChar || ":";
      if (childFenceChar === fenceChar) {
        // What `child` will actually be written as — `Directive.toMarkdown`
        // floors by its own stored `fenceLength` too, so the *structural*
        // minimum alone understates it whenever the child arrived wrapped
        // wider than it strictly needed to be. Using the understated figure
        // here produced a same-length collision between this node and a
        // child nested exactly one level down with a stored length of its
        // own, and every save re-derived the identical understated answer,
        // growing another stray fence around it on top each time.
        const childWrittenLength = Math.max(
          child.attrs.fenceLength || DEFAULT_FENCE_LENGTH,
          requiredFenceLength(child, childFenceChar)
        );
        innerMax = Math.max(innerMax, childWrittenLength);
        return false;
      }
      // Different wrapper character, so this child's own fence is not a
      // collision risk — but it is not opaque text either, and may itself
      // hold a same-character code fence, notice or directive further down
      // (an `{ifconfig}` documenting a Python example, say), so descend.
      return true;
    }
    return true;
  });
  return innerMax > 0 ? innerMax + 1 : DEFAULT_FENCE_LENGTH;
}
