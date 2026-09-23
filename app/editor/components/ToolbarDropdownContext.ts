import { createContext, useContext } from "react";

/** What a selection-toolbar dropdown offers the custom content inside it. */
interface ToolbarDropdownContextValue {
  /** Closes the dropdown, e.g. once a form inside it has been submitted. */
  close: () => void;
}

/**
 * Lets custom content inside a selection-toolbar dropdown close it — menu
 * items close it on their own when chosen, a form field does not.
 */
export const ToolbarDropdownContext =
  createContext<ToolbarDropdownContextValue>({ close: () => undefined });

/**
 * The enclosing selection-toolbar dropdown, for custom content inside it.
 *
 * @returns the dropdown's controls; `close` does nothing outside a dropdown.
 */
export function useToolbarDropdown(): ToolbarDropdownContextValue {
  return useContext(ToolbarDropdownContext);
}
