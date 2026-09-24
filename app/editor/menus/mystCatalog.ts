import type { TFunction } from "i18next";

/**
 * How a directive is inserted and held: `markdown` — a directive block whose
 * body is ordinary editable content; `notice` — an Outline callout written
 * back as the admonition; `verbatim` — a directive block whose body is kept
 * as plain text, exactly as written.
 */
export type MystDirectiveKind = "markdown" | "notice" | "verbatim";

/** A MyST directive offered in the "Sphinx directive" menu. */
export interface MystDirectiveEntry {
  /** The directive name, without braces. */
  name: string;
  /** One line saying what it is for. */
  description: string;
  kind: MystDirectiveKind;
  /** An argument filled in on insertion, when one is nearly always wanted. */
  argument?: string;
}

/** A MyST role offered in the role field of the formatting toolbar. */
export interface MystRoleEntry {
  /** The role name, without braces. */
  name: string;
  /** One line saying what it is for. */
  description: string;
}

/**
 * The directives MyST, docutils, Sphinx and sphinx-design provide, as far as
 * they make sense to insert while writing. Figures and images are left out:
 * they have their own menu entries.
 *
 * @param t - the translation function.
 * @returns the directives, in the order they are listed.
 */
export function mystDirectives(t: TFunction): MystDirectiveEntry[] {
  return [
    {
      name: "ifconfig",
      description: t("Content shown only when a configuration condition holds"),
      kind: "markdown",
    },
    {
      name: "grid",
      description: t("Grid of items, with its number of columns"),
      kind: "markdown",
      argument: "2",
    },
    {
      name: "grid-item",
      description: t("One cell of a grid"),
      kind: "markdown",
    },
    {
      name: "margin",
      description: t("Note shown in the page margin"),
      kind: "markdown",
    },
    {
      name: "glossary",
      description: t("Glossary of terms and their definitions"),
      kind: "markdown",
    },
    { name: "note", description: t("Callout, note"), kind: "notice" },
    { name: "tip", description: t("Callout, tip"), kind: "notice" },
    { name: "hint", description: t("Callout, hint"), kind: "notice" },
    { name: "important", description: t("Callout, important"), kind: "notice" },
    { name: "warning", description: t("Callout, warning"), kind: "notice" },
    { name: "caution", description: t("Callout, caution"), kind: "notice" },
    { name: "attention", description: t("Callout, attention"), kind: "notice" },
    { name: "danger", description: t("Callout, danger"), kind: "notice" },
    { name: "error", description: t("Callout, error"), kind: "notice" },
    { name: "seealso", description: t("Callout, see also"), kind: "notice" },
    {
      name: "admonition",
      description: t("Callout with a title of its own"),
      kind: "notice",
    },
    {
      name: "raw",
      description: t("Output passed straight to one builder, such as LaTeX"),
      kind: "verbatim",
      argument: "latex",
    },
    {
      name: "eval-rst",
      description: t("reStructuredText, read by Sphinx"),
      kind: "verbatim",
    },
    {
      name: "tabularcolumns",
      description: t("LaTeX column layout for the next table"),
      kind: "verbatim",
    },
    {
      name: "toctree",
      description: t("Table of contents of other pages"),
      kind: "verbatim",
    },
    {
      name: "include",
      description: t("Contents of another file"),
      kind: "verbatim",
    },
    {
      name: "literalinclude",
      description: t("A source file, shown as code"),
      kind: "verbatim",
    },
    {
      name: "code-block",
      description: t("Code with syntax highlighting and options"),
      kind: "verbatim",
    },
    { name: "math", description: t("Displayed equation"), kind: "verbatim" },
    {
      name: "only",
      description: t("Content for some output formats only"),
      kind: "verbatim",
    },
    {
      name: "rubric",
      description: t("Heading kept out of the table of contents"),
      kind: "verbatim",
    },
    {
      name: "topic",
      description: t("Self-contained topic box"),
      kind: "verbatim",
    },
    {
      name: "sidebar",
      description: t("Box beside the text"),
      kind: "verbatim",
    },
    {
      name: "epigraph",
      description: t("Quotation opening a section"),
      kind: "verbatim",
    },
    { name: "pull-quote", description: t("Pull quote"), kind: "verbatim" },
    {
      name: "container",
      description: t("Container with a CSS class"),
      kind: "verbatim",
    },
    { name: "table", description: t("Table with a caption"), kind: "verbatim" },
    {
      name: "csv-table",
      description: t("Table from comma-separated values"),
      kind: "verbatim",
    },
    {
      name: "list-table",
      description: t("Table written as a nested list"),
      kind: "verbatim",
    },
    {
      name: "contents",
      description: t("Table of contents of this page"),
      kind: "verbatim",
    },
    {
      name: "hlist",
      description: t("List laid out in columns"),
      kind: "verbatim",
    },
    {
      name: "versionadded",
      description: t("Version a feature was added in"),
      kind: "verbatim",
    },
    {
      name: "versionchanged",
      description: t("What changed in a given version"),
      kind: "verbatim",
    },
    {
      name: "deprecated",
      description: t("Deprecation notice"),
      kind: "verbatim",
    },
    { name: "index", description: t("Index entries"), kind: "verbatim" },
    {
      name: "dropdown",
      description: t("Collapsible section"),
      kind: "verbatim",
    },
    { name: "card", description: t("Card"), kind: "verbatim" },
    { name: "tab-set", description: t("Set of tabs"), kind: "verbatim" },
    {
      name: "tab-item",
      description: t("One tab of a tab set"),
      kind: "verbatim",
    },
  ];
}

/**
 * The roles MyST, docutils and Sphinx provide that are useful while writing.
 *
 * @param t - the translation function.
 * @returns the roles, in the order they are listed.
 */
export function mystRoles(t: TFunction): MystRoleEntry[] {
  return [
    { name: "term", description: t("Glossary term") },
    { name: "ref", description: t("Link to a labelled target") },
    { name: "doc", description: t("Link to another page") },
    {
      name: "numref",
      description: t("Numbered reference to a figure or table"),
    },
    { name: "eq", description: t("Reference to an equation") },
    { name: "abbr", description: t("Abbreviation, with its expansion") },
    { name: "kbd", description: t("Keyboard keys") },
    { name: "guilabel", description: t("Label in a user interface") },
    { name: "menuselection", description: t("Menu path") },
    { name: "command", description: t("Command name") },
    { name: "file", description: t("File path") },
    { name: "download", description: t("Link to a downloadable file") },
    { name: "math", description: t("Inline equation") },
    { name: "sub", description: t("Subscript") },
    { name: "sup", description: t("Superscript") },
    { name: "code", description: t("Inline code") },
  ];
}
