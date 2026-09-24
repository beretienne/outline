import { CheckmarkIcon, TrashIcon } from "outline-icons";
import { observer } from "mobx-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { isValidRoleName } from "@shared/editor/rules/mystRole";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";
import { mystRoles } from "../menus/mystCatalog";
import type { MystRoleEntry } from "../menus/mystCatalog";
import { useEditor } from "./EditorContext";
import Input from "./Input";
import ToolbarButton from "./ToolbarButton";
import { useToolbarDropdown } from "./ToolbarDropdownContext";
import Tooltip from "./Tooltip";

type Props = {
  /** The name of the role already on the selection, if there is one. */
  activeName?: string;
};

/** How many suggestions are listed at once. */
const MAX_SUGGESTIONS = 8;

/**
 * The body of the selection toolbar's Role dropdown: a field for the role's
 * name — `ref`, `abbr`, a project's own `dot` — applied with Enter or the
 * checkmark. As the name is typed, matching roles are listed below it — the
 * standard ones and the ones this collection's documents already use — to
 * pick with the arrow keys and Enter, or a click. On an existing role the
 * field is prefilled, so it renames the role, and a trash button turns it
 * back into plain text.
 */
export const MystRoleInput = observer(function RoleInput({
  activeName,
}: Props) {
  const { t } = useTranslation();
  const { commands, view, props: editorProps } = useEditor();
  const { documents, collections } = useStores();
  const { close } = useToolbarDropdown();
  const [name, setName] = useState(activeName ?? "");
  const [highlighted, setHighlighted] = useState(-1);
  const listId = useId();
  const trimmed = name.trim();
  const valid = isValidRoleName(trimmed);

  const document = editorProps.id ? documents.get(editorProps.id) : undefined;
  const collectionId = document?.collectionId;

  useEffect(() => {
    if (collectionId) {
      void collections.fetchMystNames(collectionId);
    }
  }, [collectionId, collections]);

  const usedNames = collectionId
    ? collections.mystNames.get(collectionId)?.roles
    : undefined;

  const suggestions = useMemo(() => {
    const catalog = mystRoles(t);
    const known = new Set(catalog.map((entry) => entry.name));
    const all: MystRoleEntry[] = [
      ...catalog,
      ...(usedNames ?? [])
        .filter((used) => !known.has(used))
        .map((used) => ({
          name: used,
          description: t("Used in this collection"),
        })),
    ];
    const query = trimmed.toLocaleLowerCase();
    if (!query) {
      return all.slice(0, MAX_SUGGESTIONS);
    }
    const startsWith = all.filter((entry) => entry.name.startsWith(query));
    const contains = all.filter(
      (entry) =>
        !entry.name.startsWith(query) &&
        (entry.name.includes(query) ||
          entry.description.toLocaleLowerCase().includes(query))
    );
    return [...startsWith, ...contains]
      .filter((entry) => entry.name !== query)
      .slice(0, MAX_SUGGESTIONS);
  }, [t, trimmed, usedNames]);

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
    setHighlighted(-1);
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
        const active = window.document.activeElement;
        if (!active || active === window.document.body) {
          view.focus();
        }
      });
    },
    [view]
  );

  const apply = useCallback(
    (roleName: string) => {
      if (!isValidRoleName(roleName)) {
        return;
      }
      commands.myst_role({ name: roleName });
      finish();
    },
    [commands, finish]
  );

  const handleApply = useCallback(() => apply(trimmed), [apply, trimmed]);

  const handleRemove = useCallback(() => {
    commands.removeMystRole();
    finish();
  }, [commands, finish]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" && suggestions.length) {
        event.preventDefault();
        setHighlighted((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp" && suggestions.length) {
        event.preventDefault();
        setHighlighted((index) =>
          index <= 0 ? suggestions.length - 1 : index - 1
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const picked = suggestions[highlighted];
        apply(picked ? picked.name : trimmed);
      }
    },
    [apply, highlighted, suggestions, trimmed]
  );

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <Wrapper column>
      <Row>
        <Input
          autoFocus
          value={name}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t("Role name, for example ref")}
          aria-label={t("Role name")}
          aria-invalid={trimmed !== "" && !valid}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            highlighted >= 0 ? optionId(highlighted) : undefined
          }
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
      </Row>
      {suggestions.length ? (
        <Suggestions id={listId} role="listbox" aria-label={t("Roles")}>
          {suggestions.map((entry, index) => (
            <Suggestion
              key={entry.name}
              id={optionId(index)}
              role="option"
              aria-selected={index === highlighted}
              $highlighted={index === highlighted}
              // Keeps focus in the field, so the dropdown stays open.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(entry.name)}
            >
              <RoleName>{`{${entry.name}}`}</RoleName>
              <RoleDescription>{entry.description}</RoleDescription>
            </Suggestion>
          ))}
        </Suggestions>
      ) : null}
    </Wrapper>
  );
});

const Wrapper = styled(Flex)`
  pointer-events: all;
  gap: 4px;
  padding: 6px;
  min-width: 300px;
`;

const Row = styled(Flex)`
  gap: 6px;
  align-items: center;
`;

const Suggestions = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
`;

const Suggestion = styled.li<{ $highlighted: boolean }>`
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: var(--pointer);
  background: ${(props) =>
    props.$highlighted ? props.theme.listItemHoverBackground : "transparent"};

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const RoleName = styled.span`
  font-family: ${s("fontFamilyMono")};
  font-size: 13px;
  color: ${s("text")};
`;

const RoleDescription = styled.span`
  font-size: 13px;
  color: ${s("textTertiary")};
`;
