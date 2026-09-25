import { Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { parser, schema } from "@server/editor";
import { Revision } from "@server/models";
import { buildComment, buildDocument, buildUser } from "@server/test/factories";
import main from "./20260925100000-restore-comment-anchors";

// The test environment has its own database connection.
vi.mock("./bootstrap", () => ({}));

/**
 * Marks the first occurrence of `needle` in the parsed Markdown with a comment.
 *
 * @param markdown The document's Markdown.
 * @param needle The text to comment on.
 * @param id The comment id.
 * @returns The document.
 */
const withComment = (markdown: string, needle: string, id: string) => {
  const doc = parser.parse(markdown);
  let from = -1;
  doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? "").indexOf(needle) : -1;
    if (from === -1 && at !== -1) {
      from = pos + at;
    }
  });
  return new Transform(doc).addMark(
    from,
    from + needle.length,
    schema.marks.comment.create({ id, userId: "u1" })
  ).doc;
};

const commentedText = (content: object | null, id: string) => {
  let text = "";
  Node.fromJSON(schema, content).descendants((node) => {
    if (
      node.marks.some((m) => m.type.name === "comment" && m.attrs.id === id)
    ) {
      text += node.text ?? "";
    }
  });
  return text;
};

describe("restore-comment-anchors", () => {
  const setup = async (before: string, needle: string, after: string) => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      text: before,
    });
    const comment = await buildComment({
      userId: user.id,
      documentId: document.id,
    });

    // A revision from when the comment was still anchored…
    document.content = withComment(before, needle, comment.id).toJSON();
    await Revision.buildFromDocument(document).save();

    // …then a Markdown update that detached it.
    document.content = parser.parse(after).toJSON();
    await document.save();

    return { document, comment };
  };

  it("reattaches a comment whose text is still in the page", async () => {
    const { document, comment } = await setup(
      "The reference point is fixed.",
      "reference point",
      "Intro added.\n\nThe reference point is fixed."
    );

    const dry = await main(false, true, [document.id]);
    expect(dry).toEqual([
      {
        documentId: document.id,
        commentId: comment.id,
        restored: true,
        reason: undefined,
      },
    ]);
    await document.reload();
    expect(commentedText(document.content, comment.id)).toBe("");

    await main(false, false, [document.id]);
    await document.reload();
    expect(commentedText(document.content, comment.id)).toBe("reference point");
  });

  it("leaves a comment detached when its text is gone", async () => {
    const { document, comment } = await setup(
      "Remove that.\n\nKeep this.",
      "Remove that",
      "Keep this."
    );

    const [result] = await main(false, false, [document.id]);
    expect(result.restored).toBe(false);
    await document.reload();
    expect(commentedText(document.content, comment.id)).toBe("");
  });

  it("reports a comment that never had an anchor", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      text: "Some text.",
    });
    const comment = await buildComment({
      userId: user.id,
      documentId: document.id,
    });

    const [result] = await main(false, true, [document.id]);
    expect(result).toMatchObject({ commentId: comment.id, restored: false });
  });
});
