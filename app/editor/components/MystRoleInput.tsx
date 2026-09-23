import { CheckmarkIcon, TrashIcon } from "outline-icons";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { isValidRoleName } from "@shared/editor/rules/mystRole";
import Flex from "~/components/Flex";
import { useEditor } from "./EditorContext";
import Input from "./Input";
import ToolbarButton from "./ToolbarButton";
import { useToolbarDropdown } from "./ToolbarDropdownContext";
import Tooltip from "./Tooltip";

type Props = {
  /** The name of the role already on the selection, if there is one. */
  activeName?: string;
};

/**
 * The body of the selection toolbar's Role dropdown: a field for the role's
 * name — `ref`, `abbr`, a project's own `dot` — applied with Enter or the
 * checkmark. On an existing role it is prefilled, so the same field renames
 * it, and a trash button turns it back into plain text.
 */
export function MystRoleInput({ activeName }: Props) {
  const { t } = useTranslation();
  const { commands, view } = useEditor();
  const { close } = useToolbarDropdown();
  const [name, setName] = useState(activeName ?? "");
  const trimmed = name.trim();
  const valid = isValidRoleName(trimmed);

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  // Close the dropdown and give focus back to the editor — on the next
  // frame, once the menu has finished its own focus handling on close.
  const finish = useCallback(() => {
    close();
    requestAnimationFrame(() => view.focus());
  }, [close, view]);

  // However the dropdown closes — Escape included, which the menu handles
  // before this field ever sees the key — focus left with nowhere to go is
  // handed back to the editor, so typing carries on where it was.
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body) {
          view.focus();
        }
      });
    },
    [view]
  );

  const handleApply = useCallback(() => {
    if (!valid) {
      return;
    }
    commands.myst_role({ name: trimmed });
    finish();
  }, [commands, finish, valid, trimmed]);

  const handleRemove = useCallback(() => {
    commands.removeMystRole();
    finish();
  }, [commands, finish]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleApply();
      }
    },
    [handleApply]
  );

  return (
    <Wrapper>
      <Input
        autoFocus
        value={name}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t("Role name, for example ref")}
        aria-label={t("Role name")}
        aria-invalid={trimmed !== "" && !valid}
        spellCheck={false}
      />
      <Tooltip content={activeName ? t("Rename role") : t("Apply role")}>
        <ToolbarButton
          onClick={handleApply}
          disabled={!valid}
          aria-label={activeName ? t("Rename role") : t("Apply role")}
        >
          <CheckmarkIcon />
        </ToolbarButton>
      </Tooltip>
      {activeName ? (
        <Tooltip content={t("Remove role")}>
          <ToolbarButton onClick={handleRemove} aria-label={t("Remove role")}>
            <TrashIcon />
          </ToolbarButton>
        </Tooltip>
      ) : null}
    </Wrapper>
  );
}

const Wrapper = styled(Flex)`
  pointer-events: all;
  gap: 6px;
  padding: 6px;
  align-items: center;
  min-width: 260px;
`;
