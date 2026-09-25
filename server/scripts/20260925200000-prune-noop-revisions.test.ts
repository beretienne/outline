import { Transform } from "prosemirror-transform";
import { parser, schema } from "@server/editor";
import { Notification, Revision } from "@server/models";
import {
  buildDocument,
  buildNotification,
  buildUser,
} from "@server/test/factories";
import main from "./20260925200000-prune-noop-revisions";

// The test environment has its own database connection.
vi.mock("./bootstrap", () => ({}));

describe("prune-noop-revisions", () => {
  /**
   * Writes one revision per version, a minute apart, oldest first.
   *
   * @param versions The content of each revision.
   * @returns The document and its revisions.
   */
  const setup = async (versions: object[]) => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const revisions: Revision[] = [];
    const start = Date.now() - versions.length * 60_000;
    for (const [index, content] of versions.entries()) {
      document.content = content as typeof document.content;
      const revision = Revision.buildFromDocument(document);
      revision.createdAt = new Date(start + index * 60_000);
      revisions.push(await revision.save());
    }
    return { user, document, revisions };
  };

  const text = (markdown: string) => parser.parse(markdown).toJSON();

  // The same text with a trailing empty paragraph: nothing a reader sees.
  const withTrailingParagraph = (markdown: string) => {
    const doc = parser.parse(markdown);
    return doc
      .copy(doc.content.append(schema.nodes.paragraph.create().content))
      .toJSON();
  };

  // The same text with a comment on it: invisible in Markdown too.
  const withComment = (markdown: string) => {
    const doc = parser.parse(markdown);
    return new Transform(doc)
      .addMark(1, 5, schema.marks.comment.create({ id: "c1", userId: "u1" }))
      .doc.toJSON();
  };

  it("removes revisions that change nothing visible, keeping first and latest", async () => {
    const { document, revisions } = await setup([
      text("First version."),
      withTrailingParagraph("First version."),
      withComment("First version."),
      text("Second version."),
      text("Second version."),
      text("Second version."),
    ]);

    const [dry] = await main(false, true, { documentIds: [document.id] });
    expect(dry).toMatchObject({ total: 6, removed: 3 });
    expect(await Revision.count({ where: { documentId: document.id } })).toBe(
      6
    );

    await main(false, false, { documentIds: [document.id] });

    const left = await Revision.unscoped().findAll({
      where: { documentId: document.id },
      order: [["createdAt", "ASC"]],
      paranoid: false,
    });
    expect(left.map((r) => r.id)).toEqual([
      revisions[0].id,
      revisions[3].id,
      revisions[5].id,
    ]);
  });

  it("moves a notification from a removed revision to the one kept for it", async () => {
    const { user, document, revisions } = await setup([
      text("Same."),
      text("Same."),
      text("Different."),
    ]);
    const notification = await buildNotification({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      revisionId: revisions[1].id,
    });

    await main(false, false, { documentIds: [document.id] });

    await notification.reload();
    expect(notification.revisionId).toBe(revisions[0].id);
    expect(await Notification.count({ where: { id: notification.id } })).toBe(
      1
    );
  });

  it("keeps every revision of a document whose edits are all real", async () => {
    const { document } = await setup([
      text("One."),
      text("Two."),
      text("Three."),
    ]);

    const results = await main(false, false, { documentIds: [document.id] });

    expect(results).toEqual([]);
    expect(await Revision.count({ where: { documentId: document.id } })).toBe(
      3
    );
  });
});
