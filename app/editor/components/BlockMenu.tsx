import { DocumentIcon, SettingsIcon, ShapesIcon } from "outline-icons";
import { cloneDeep } from "es-toolkit/compat";
import { observer } from "mobx-react";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Icon from "@shared/components/Icon";
import { noticeStyleForDirective } from "@shared/editor/nodes/Notice";
import type { MenuItem } from "@shared/editor/types";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import { TextHelper } from "@shared/utils/TextHelper";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import getMenuItems from "../menus/block";
import { mystDirectives } from "../menus/mystCatalog";
import type { MystDirectiveEntry } from "../menus/mystCatalog";
import { useEditor } from "./EditorContext";
import type { Props as SuggestionsMenuProps } from "./SuggestionsMenu";
import SuggestionsMenu from "./SuggestionsMenu";
import SuggestionsMenuItem from "./SuggestionsMenuItem";

/**
 * Hook that returns a template menu item with children for inserting template
 * content into the editor, or undefined if no templates are available.
 */
function useTemplateMenuItem(): MenuItem | undefined {
  const { t } = useTranslation();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const { documents, templates: templatesStore } = useStores();
  const editor = useEditor();
  const documentId = editor.props.id;
  const document = documentId ? documents.get(documentId) : undefined;
  const collectionId = document?.collectionId;

  return useMemo(() => {
    if (!user) {
      return undefined;
    }

    const allTemplates = templatesStore.published.filter(
      (template) => !!template.data
    );
    const hasTemplates = allTemplates.some(
      (template) =>
        template.isWorkspaceTemplate || template.collectionId === collectionId
    );

    if (!hasTemplates) {
      return undefined;
    }

    const toMenuItem = (template: (typeof allTemplates)[0]): MenuItem => ({
      name: "noop",
      title: TextHelper.replaceTemplateVariables(
        template.titleWithDefault,
        user
      ),
      icon: template.icon ? (
        <Icon
          value={template.icon}
          initial={template.initial}
          color={template.color ?? undefined}
        />
      ) : (
        <DocumentIcon />
      ),
      keywords: template.titleWithDefault,
      onClick: () => {
        const data = cloneDeep(template.data);
        ProsemirrorHelper.replaceTemplateVariables(data, user);
        editor.insertContent(data);
      },
    });

    const children = (): MenuItem[] => {
      const collectionTemplates = allTemplates.filter(
        (template) =>
          !template.isWorkspaceTemplate &&
          template.collectionId === collectionId
      );
      const workspaceTemplates = allTemplates.filter(
        (tmpl) => tmpl.isWorkspaceTemplate
      );

      const items: MenuItem[] = collectionTemplates.map(toMenuItem);

      if (collectionTemplates.length && workspaceTemplates.length) {
        items.push({ name: "separator" });
      }

      if (workspaceTemplates.length) {
        for (const template of workspaceTemplates) {
          items.push(toMenuItem(template));
        }
      }

      return items;
    };

    return {
      name: "noop",
      title: t("Templates"),
      icon: <ShapesIcon />,
      keywords: "template",
      children,
    } satisfies MenuItem;
  }, [user, templatesStore.published, collectionId, editor, t]);
}

/**
 * Hook that returns the "Sphinx directive" menu item: every MyST directive,
 * built-in ones and the ones this collection's documents already use, as
 * children. Typing a directive's name after "/" finds it directly.
 */
function useDirectiveMenuItem(): MenuItem {
  const { t } = useTranslation();
  const { documents, collections } = useStores();
  const editor = useEditor();
  const documentId = editor.props.id;
  const document = documentId ? documents.get(documentId) : undefined;
  const collectionId = document?.collectionId;

  useEffect(() => {
    if (collectionId) {
      void collections.fetchMystNames(collectionId);
    }
  }, [collectionId, collections]);

  const usedNames = collectionId
    ? collections.mystNames.get(collectionId)?.directives
    : undefined;

  return useMemo(() => {
    const catalog = mystDirectives(t);
    const known = new Set(catalog.map((entry) => entry.name));
    const projectEntries: MystDirectiveEntry[] = (usedNames ?? [])
      .filter((name) => !known.has(name))
      .map((name) => ({
        name,
        description: t("Used in this collection"),
        kind: "verbatim",
      }));

    const toMenuItem = (entry: MystDirectiveEntry): MenuItem => ({
      name:
        entry.kind === "notice" ? "container_notice" : "container_directive",
      title: `{${entry.name}}`,
      subtitle: entry.description,
      icon: <SettingsIcon />,
      keywords: `${entry.name} ${entry.description}`,
      attrs:
        entry.kind === "notice"
          ? {
              style: noticeStyleForDirective(entry.name),
              directive: entry.name,
            }
          : { directive: entry.name, argument: entry.argument ?? "" },
    });

    const children = (): MenuItem[] => {
      const items = catalog.map(toMenuItem);
      if (projectEntries.length) {
        items.push({ name: "separator" }, ...projectEntries.map(toMenuItem));
      }
      return items;
    };

    return {
      name: "noop",
      title: t("Sphinx directive"),
      icon: <SettingsIcon />,
      keywords: "myst sphinx directive",
      children,
    } satisfies MenuItem;
  }, [t, usedNames]);
}

type Props = Omit<SuggestionsMenuProps, "renderMenuItem" | "items"> &
  Required<Pick<SuggestionsMenuProps, "embeds">>;

function BlockMenu(props: Props) {
  const { t } = useTranslation();
  const { elementRef } = useEditor();
  const templateMenuItem = useTemplateMenuItem();
  const directiveMenuItem = useDirectiveMenuItem();

  const items = useMemo(() => {
    const baseItems = getMenuItems(t, elementRef);
    // The directive entry goes with the other Sphinx entries, before the
    // MyST comment.
    const commentIndex = baseItems.findIndex(
      (item) => item.name === "myst_comment"
    );
    baseItems.splice(
      commentIndex === -1 ? baseItems.length : commentIndex,
      0,
      directiveMenuItem
    );

    if (!templateMenuItem) {
      return baseItems;
    }

    return [...baseItems, { name: "separator" } as MenuItem, templateMenuItem];
  }, [t, elementRef, templateMenuItem, directiveMenuItem]);

  const renderMenuItem = useCallback<SuggestionsMenuProps["renderMenuItem"]>(
    (item, _index, options) => (
      <SuggestionsMenuItem
        {...options}
        icon={item.icon}
        title={item.title}
        subtitle={item.subtitle}
        shortcut={item.shortcut}
        disclosure={options.disclosure}
      />
    ),
    []
  );

  return (
    <SuggestionsMenu
      {...props}
      filterable
      trigger="/"
      renderMenuItem={renderMenuItem}
      items={items}
    />
  );
}

export default observer(BlockMenu);
