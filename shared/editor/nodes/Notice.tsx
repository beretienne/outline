import type Token from "markdown-it/lib/token.mjs";
import { WarningIcon, InfoIcon, StarredIcon, DoneIcon } from "outline-icons";
import { wrappingInputRule } from "prosemirror-inputrules";
import type {
  NodeSpec,
  Node as ProsemirrorNode,
  NodeType,
} from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import type { Primitive } from "utility-types";
import toggleWrap from "../commands/toggleWrap";
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
      content:
        "(list | blockquote | hr | paragraph | heading | code_block | code_fence | attachment)+",
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
                { class: "notice-body" },
                ["div", { class: "notice-title" }, title],
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

  component = (props: ComponentProps) => {
    const { node } = props;

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

    return (
      <div className={`${EditorStyleHelper.notice} ${node.attrs.style}`}>
        <div className={EditorStyleHelper.noticeIcon} contentEditable={false}>
          {icon}
        </div>
        <div
          className={EditorStyleHelper.noticeContent}
          ref={props.contentRef}
        />
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

    state.write(`\n\`\`\`{${directive}}${title}\n`);
    if (node.attrs.options) {
      // MyST wants a blank line between the option block and the body.
      state.write(`${node.attrs.options}\n\n`);
    }
    state.renderContent(node);
    state.ensureNewLine();
    state.write("```");
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
          parsed?.braced && parsed.directive !== noticeTypeToMystDirective[style]
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
