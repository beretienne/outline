import ColorSwatchPreview from "../extensions/ColorSwatchPreview";
import DateTime from "../extensions/DateTime";
import DeleteEmptyDirective from "../extensions/DeleteEmptyDirective";
import DeleteNearAtom from "../extensions/DeleteNearAtom";
import HeadingPrefix from "../extensions/HeadingPrefix";
import History from "../extensions/History";
import InputRuleUndo from "../extensions/InputRuleUndo";
import MaxLength from "../extensions/MaxLength";
import TrailingNode from "../extensions/TrailingNode";
import type { AnyExtensionClass } from "../lib/types";
import Bold from "../marks/Bold";
import Code from "../marks/Code";
import Comment from "../marks/Comment";
import Highlight from "../marks/Highlight";
import Italic from "../marks/Italic";
import Link from "../marks/Link";
import TemplatePlaceholder from "../marks/Placeholder";
import Strikethrough from "../marks/Strikethrough";
import TermReference from "../marks/TermReference";
import Underline from "../marks/Underline";
import Attachment from "./Attachment";
import Blockquote from "./Blockquote";
import BulletList from "./BulletList";
import CheckboxItem from "./CheckboxItem";
import CheckboxList from "./CheckboxList";
import CodeBlock from "./CodeBlock";
import CodeFence from "./CodeFence";
import DefinitionBody from "./DefinitionBody";
import DefinitionList from "./DefinitionList";
import DefinitionTerm from "./DefinitionTerm";
import Directive from "./Directive";
import Doc from "./Doc";
import Embed from "./Embed";
import Emoji from "./Emoji";
import Figure from "./Figure";
import HardBreak from "./HardBreak";
import Heading from "./Heading";
import HorizontalRule from "./HorizontalRule";
import Image from "./Image";
import ListItem from "./ListItem";
import Math from "./Math";
import MathBlock from "./MathBlock";
import Mention from "./Mention";
import MystComment from "./MystComment";
import Notice from "./Notice";
import OrderedList from "./OrderedList";
import Paragraph from "./Paragraph";
import SimpleImage from "./SimpleImage";
import Table from "./Table";
import TableCell from "./TableCell";
import TableHeader from "./TableHeader";
import TableRow from "./TableRow";
import Text from "./Text";
import ToggleBlock from "./ToggleBlock";

import Video from "./Video";

type Nodes = AnyExtensionClass[];

/**
 * A set of inline nodes that are used in the editor. This is used for simple
 * editors that need basic formatting.
 */
export const inlineExtensions: Nodes = [
  Doc,
  InputRuleUndo,
  Paragraph,
  Emoji,
  Text,
  SimpleImage,
  Link,
  Code,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  History,
  TrailingNode,
  MaxLength,
  DateTime,
  HardBreak,
  DeleteNearAtom,
  ColorSwatchPreview,
];

export const listExtensions: Nodes = [
  CheckboxList,
  CheckboxItem,
  BulletList,
  OrderedList,
  ListItem,
];

export const tableExtensions: Nodes = [
  TableCell,
  TableHeader,
  TableRow,
  // Note: Table nodes comes last to ensure the table selection plugin is registered after the
  // plugins for table grips in TableCell and TableHeader.
  Table,
];

/**
 * The basic set of nodes that are used in the editor. This is used for simple
 * editors that need basic formatting and lists.
 */
export const basicExtensions: Nodes = [
  ...inlineExtensions,
  ...listExtensions,
  // Included for its paste handling, which removes copied heading prefixes;
  // without a headingPrefix option the extension is otherwise inert.
  HeadingPrefix,
];

/**
 * The full set of nodes that are used in the editor. This is used for rich
 * editors that need advanced formatting.
 */
export const richExtensions: Nodes = [
  // Ahead of `Code`, deliberately: input rules are tried in registration
  // order, and Code's own backtick rule matches the very keystroke that
  // closes a typed `` {term}`text` ``.
  TermReference,
  ...inlineExtensions.filter((n) => n !== SimpleImage),
  Image,
  Figure,
  CodeBlock,
  CodeFence,
  // Registered well before ...listExtensions further down, for the same
  // key-handler-ordering reason given there ("container type nodes should
  // be last"): its own Enter key must win over ListItem's splitListItem
  // when a comment sits inside a list item.
  MystComment,
  Blockquote,
  Embed,
  Attachment,
  Video,
  // Registered before Notice: both register a colon-fence container rule via
  // markdown-it-container, which always anchors itself immediately before
  // the core "fence" rule — so whichever registers first ends up earlier in
  // the block-ruler chain. Notice's own `container_notice` validates any
  // `:::` fence unconditionally true (relying on `unclaimedColonFence`,
  // registered right before it, to have already deferred anything that
  // isn't a real admonition); `container_directive` has to get its own,
  // narrower look at an allowlisted-but-non-admonition fence before that
  // catch-all ever sees it, or it never would.
  Directive,
  Notice,
  DeleteEmptyDirective,
  DefinitionList,
  DefinitionTerm,
  DefinitionBody,
  Heading,
  HeadingPrefix,
  HorizontalRule,
  Highlight,
  TemplatePlaceholder,
  Math,
  MathBlock,
  Mention,
  ToggleBlock,
  // Container type nodes should be last so that key handlers are registered for content inside
  // the container nodes first.
  ...listExtensions,
  ...tableExtensions,
];

/**
 * Add commenting and mentions to a set of nodes
 */
export const withComments = (nodes: Nodes) => [
  Mention,
  Comment,
  ...nodes.filter((node) => node !== Mention),
];
