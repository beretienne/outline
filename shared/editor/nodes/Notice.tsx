import { t } from "i18next";
import type Token from "markdown-it/lib/token.mjs";
import { WarningIcon, InfoIcon, StarredIcon, DoneIcon } from "outline-icons";
import { wrappingInputRule } from "prosemirror-inputrules";
import type { FocusEvent, KeyboardEvent } from "react";
import type {
  NodeSpec,
  Node as ProsemirrorNode,
  NodeType,
} from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { Primitive } from "utility-types";
import toggleWrap from "../commands/toggleWrap";
import { requiredFenceLength } from "../lib/fenceLength";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import noticesRule, { parseNoticeInfo } from "../rules/notices";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import type { ComponentProps } from "../types";
import Node from "./Node";

export enum NoticeTypes {
  Info = "info",
  Success = "success",
  Tip = "tip",
  Warning = "warning",
}

/**
 * Which of the four notice styles each directive is drawn in. Sphinx gives
 * eleven admonitions their own colour; these are the closest four, grouped the
 * way Sphinx's own stylesheets group them — the severe ones together, the
 * advisory ones together.
 *
 * The directive name itself is kept on the node, so nothing here is lossy: this
 * only decides the icon and the border colour.
 */
const directiveToNoticeStyle: Record<string, NoticeTypes> = {
  admonition: NoticeTypes.Info,
  attention: NoticeTypes.Warning,
  caution: NoticeTypes.Warning,
  danger: NoticeTypes.Warning,
  error: NoticeTypes.Warning,
  hint: NoticeTypes.Tip,
  important: NoticeTypes.Info,
  note: NoticeTypes.Info,
  seealso: NoticeTypes.Success,
  tip: NoticeTypes.Tip,
  warning: NoticeTypes.Warning,
  // Outline's own names, written by the `:::style` syntax.
  info: NoticeTypes.Info,
  success: NoticeTypes.Success,
};

/**
 * The directive a notice is written back as when it does not remember how it
 * arrived — one created in the editor rather than parsed from MyST.
 */
const noticeTypeToMystDirective: Record<NoticeTypes, string> = {
  [NoticeTypes.Info]: "note",
  [NoticeTypes.Tip]: "tip",
  [NoticeTypes.Warning]: "caution",
  [NoticeTypes.Success]: "seealso",
};

export default class Notice extends Node {
  get name() {
    return "container_notice";
  }

  get rulePlugins() {
    return [noticesRule];
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        style: {
          default: NoticeTypes.Info,
        },
        // The MyST directive this arrived as. Null for a notice created in the
        // editor, which is written back from `style` instead.
        directive: {
          default: null,
        },
        // The directive's argument. MyST renders it as the block's heading.
        title: {
          default: "",
        },
        // The directive's option lines, e.g. ":class: danger", kept verbatim.
        // They are metadata rather than prose, so they are not shown.
        options: {
          default: "",
        },
      },
      // `paragraph` is listed first deliberately: when an edit (e.g.
      // deleting all of a notice's content) leaves this node needing
      // ProseMirror to synthesize a default child from scratch, it walks
      // this expression's alternatives in order and takes the first one
      // that's trivially createable — with `list` first, that resolved to
      // an empty checkbox item (`- [ ]`) instead of an empty paragraph, a
      // real, user-visible bug found live. Order here only affects that
      // default; every one of these types remains equally allowed as
      // actual content regardless of position.
      content:
        "(paragraph | list | blockquote | hr | heading | code_block | code_fence | attachment | figure | table | container_directive)+",
      group: "block",
      defining: true,
      draggable: true,
      parseDOM: [
        {
          tag: `div.${EditorStyleHelper.notice}`,
          preserveWhitespace: "full",
          contentElement: (node: HTMLDivElement) =>
            node.querySelector(`div.${EditorStyleHelper.noticeContent}`) ||
            node,
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.className.includes(NoticeTypes.Tip)
              ? NoticeTypes.Tip
              : dom.className.includes(NoticeTypes.Warning)
                ? NoticeTypes.Warning
                : dom.className.includes(NoticeTypes.Success)
                  ? NoticeTypes.Success
                  : undefined,
            directive: dom.dataset.directive || null,
            title: dom.dataset.title || "",
            options: dom.dataset.options || "",
          }),
        },
        // Quill editor parsing
        {
          tag: "div.ql-hint",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.dataset.hint,
          }),
        },
        // GitBook parsing
        {
          tag: "div.alert.theme-admonition",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.className.includes(NoticeTypes.Warning)
              ? NoticeTypes.Warning
              : dom.className.includes(NoticeTypes.Success)
                ? NoticeTypes.Success
                : undefined,
          }),
        },
        // Confluence parsing
        {
          tag: "div.confluence-information-macro",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.className.includes("confluence-information-macro-tip")
              ? NoticeTypes.Success
              : dom.className.includes("confluence-information-macro-note")
                ? NoticeTypes.Tip
                : dom.className.includes("confluence-information-macro-warning")
                  ? NoticeTypes.Warning
                  : undefined,
          }),
        },
      ],
      toDOM: (node) => {
        const title: string = node.attrs.title || "";
        const content = ["div", { class: EditorStyleHelper.noticeContent }, 0];

        return [
          "div",
          {
            class: `${EditorStyleHelper.notice} ${node.attrs.style}`,
            ...(node.attrs.directive
              ? { "data-directive": node.attrs.directive }
              : {}),
            ...(title ? { "data-title": title } : {}),
            ...(node.attrs.options
              ? { "data-options": node.attrs.options }
              : {}),
          },
          // The hole must be its parent's only child, so a title needs a
          // wrapper. Notices without one keep the flatter markup they had.
          title
            ? [
                "div",
                { class: EditorStyleHelper.noticeBody },
                ["div", { class: EditorStyleHelper.noticeTitle }, title],
                content,
              ]
            : content,
        ];
      },
    };
  }

  commands({ type }: { type: NodeType }) {
    return {
      container_notice: (attrs: Record<string, Primitive>) =>
        toggleWrap(type, attrs),
      info: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Info),
      warning: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Warning),
      success: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Success),
      tip: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Tip),
    };
  }

  handleStyleChange = (
    state: EditorState,
    dispatch: ((tr: Transaction) => void) | undefined,
    style: NoticeTypes
  ): boolean => {
    const { tr, selection } = state;
    const { $from } = selection;
    const node = $from.node(-1);

    if (node?.type.name === this.name) {
      if (dispatch) {
        const transaction = tr.setNodeMarkup($from.before(-1), undefined, {
          ...node.attrs,
          style,
          // Picking a style in the toolbar is a decision about what this block
          // is, so the directive it arrived as no longer applies — otherwise a
          // note switched to "warning" would still be written back as {note}.
          directive: null,
        });
        dispatch(transaction);
      }
      return true;
    }
    return false;
  };

  /**
   * Parks ProseMirror's own selection inside this notice the moment the
   * title is about to receive focus, so anything reading `state.selection`
   * — the toolbar's style picker included — resolves to this notice rather
   * than wherever the selection last happened to be. There is no document
   * position inside the title field itself for ProseMirror to land on, and
   * nothing here ever moves focus there on purpose (no `view.focus()`):
   * dispatching on mousedown, before the browser's own default click
   * handling actually moves focus to the field, briefly syncs ProseMirror's
   * DOM selection to this position and then leaves it there, since nothing
   * further gets dispatched while the title has focus — right up until the
   * native click completes and focus lands in the field as normal.
   */
  handleTitleMouseDown =
    ({ getPos, view }: ComponentProps) =>
    () => {
      const $pos = view.state.doc.resolve(getPos() + 1);
      view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
    };

  /**
   * Pressing Enter while editing the title moves the cursor into the
   * notice's own body instead of inserting a line break — a title is a
   * single line, the same reasoning Image's caption field already applies
   * to itself.
   */
  handleTitleKeyDown =
    ({ getPos, view }: ComponentProps) =>
    (event: KeyboardEvent<HTMLDivElement>) => {
      // The title div sits inside the same contentEditable region ProseMirror
      // manages, but is not part of its document model — there is no
      // position inside it for ProseMirror to resolve. Left unstopped, a key
      // like Backspace still bubbles up to ProseMirror's own keymap, which
      // then acts on whatever position its selection last happened to be at
      // instead of where the cursor visually is: a genuine, observed case
      // joined this whole notice into the one before it and dropped its own
      // title, deleting a single character in the field. Every key is
      // stopped here so the native field handles all of them — typing,
      // backspace, arrows — and only Enter additionally gets its default
      // (a literal line break in the field) prevented and redirected.
      event.stopPropagation();
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      const $pos = view.state.doc.resolve(getPos() + 1);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView()
      );
      view.focus();
    };

  /**
   * Commits an edited title on blur, the same pattern Image's own caption
   * field uses for `alt` — the title lives on the node as a plain string
   * attribute, not as ProseMirror content, so this is a `setNodeMarkup`
   * rather than a document edit. The directive this arrived as is left
   * alone: editing the title's text does not change which directive it is.
   */
  handleTitleBlur =
    ({ node, getPos, view }: ComponentProps) =>
    (event: FocusEvent<HTMLDivElement>) => {
      const title = event.currentTarget.innerText.trim();
      if (title === (node.attrs.title || "")) {
        return;
      }
      view.dispatch(
        view.state.tr.setNodeMarkup(getPos(), undefined, {
          ...node.attrs,
          title,
        })
      );
    };

  component = (props: ComponentProps) => {
    const { node } = props;
    const title: string = node.attrs.title || "";

    let icon;
    if (node.attrs.style === NoticeTypes.Tip) {
      icon = <StarredIcon />;
    } else if (node.attrs.style === NoticeTypes.Warning) {
      icon = <WarningIcon />;
    } else if (node.attrs.style === NoticeTypes.Success) {
      icon = <DoneIcon />;
    } else {
      icon = <InfoIcon />;
    }

    const content = (
      <div className={EditorStyleHelper.noticeContent} ref={props.contentRef} />
    );

    return (
      <div className={`${EditorStyleHelper.notice} ${node.attrs.style}`}>
        <div className={EditorStyleHelper.noticeIcon} contentEditable={false}>
          {icon}
        </div>
        <div className={EditorStyleHelper.noticeBody}>
          {/* Always rendered, not conditional on `title` — clearing every
              character used to make this div disappear along with it, and
              with no field left to click into there was no way to type a
              new one back in. CSS hides it while empty and neither focused
              nor hovered, the same way Image's own caption field hides an
              empty one, rather than this component deciding visibility.

              contentEditable is not an event boundary on its own — nesting
              `true` directly inside ProseMirror's already-editable root does
              not carve out a separate island; browsers treat the whole
              region as one continuous editable surface either way. This
              outer div's `false` is what actually isolates the title from
              it, the same way the icon div above does; the real field is
              the `true` nested one story down. */}
          <div contentEditable={false}>
            <div
              className={EditorStyleHelper.noticeTitle}
              contentEditable={props.isEditable}
              suppressContentEditableWarning
              data-placeholder={t("Add a title")}
              onMouseDown={this.handleTitleMouseDown(props)}
              onBlur={this.handleTitleBlur(props)}
              onKeyDown={this.handleTitleKeyDown(props)}
            >
              {title}
            </div>
          </div>
          {content}
        </div>
      </div>
    );
  };

  inputRules({ type }: { type: NodeType }) {
    return [wrappingInputRule(/^:::$/, type)];
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    const style: NoticeTypes = node.attrs.style || NoticeTypes.Info;
    const directive =
      node.attrs.directive || noticeTypeToMystDirective[style] || style;
    const title = node.attrs.title ? ` ${node.attrs.title}` : "";
    const fence = "`".repeat(requiredFenceLength(node));

    // `write` only applies the current list-item indentation once, at the
    // very start of whatever string it's given — a leading "\n" packed into
    // that same string (as this used to do) starts a fresh line the prefix
    // never reaches, so a notice nested in a list item silently lost its
    // indentation, and with it its place inside the list, on every save.
    // `ensureNewLine` plus a separate `write` call each get their own,
    // correctly-prefixed turn.
    state.ensureNewLine();
    state.write(`${fence}{${directive}}${title}\n`);
    if (node.attrs.options) {
      // MyST wants a blank line between the option block and the body.
      state.write(`${node.attrs.options}\n\n`);
    }
    state.renderContent(node);
    state.ensureNewLine();
    state.write(fence);
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      block: "container_notice",
      getAttrs: (tok: Token) => {
        const parsed = parseNoticeInfo(tok.info ?? "", { allowBare: true });
        const style = parsed
          ? directiveToNoticeStyle[parsed.directive]
          : NoticeTypes.Info;

        // `directive` is only worth carrying when the style alone would not
        // reproduce it. Two cases drop it. A bare `:::warning` is Outline's own
        // style name rather than a MyST directive, so writing it back as
        // `{warning}` would be a guess. And `{caution}` is already what the
        // warning style serializes to, so recording it would leave two ways to
        // spell the same node and break `parse(serialize(doc)) === doc`.
        const directive =
          parsed?.braced &&
          parsed.directive !== noticeTypeToMystDirective[style]
            ? parsed.directive
            : null;

        return {
          style,
          directive,
          title: parsed?.title ?? "",
          options: tok.meta?.options ?? "",
        };
      },
    };
  }
}
