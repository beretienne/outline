import "./bootstrap";
import { Node } from "prosemirror-model";
import { commentSchema, schema, serializer } from "@server/editor";
import { APIUpdateExtension } from "@server/collaboration/APIUpdateExtension";
import { Comment, Document, Revision } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import type { CommentAnchor } from "@server/models/helpers/ProsemirrorHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";

/** How a detached comment fared. */
export interface RestoreResult {
  documentId: string;
  commentId: string;
  /** Whether its anchor was, or would be, put back. */
  restored: boolean;
  /** Why it was not, when it was not. */
  reason?: string;
}

/**
 * Reattaches comments to the text they were written on, for comments whose
 * anchor a Markdown update removed: every outline-sync push used to rebuild
 * the page from Markdown, which has no syntax for an anchor, so the threads
 * stayed but pointed at nothing. The anchor is taken from the newest revision
 * that still had it, and put back where the same text, with the text around
 * it, is in the page today. A comment whose text is gone, or appears several
 * times with no way to tell which, stays detached. Document-level comments,
 * which never had an anchor, are left alone.
 *
 * Pass `--dry-run` to only list what would be restored, and
 * `--document=<id>` (repeatable) to only look at those documents.
 *
 * @param exit whether to exit the process when done.
 * @param dryRun whether to only report, without saving anything.
 * @param documentIds only look at these documents, when given.
 * @returns what happened to each detached comment.
 */
export default async function main(
  exit = false,
  dryRun = false,
  documentIds?: string[]
): Promise<RestoreResult[]> {
  const results: RestoreResult[] = [];
  const comments = await Comment.unscoped().findAll({
    attributes: [
      "id",
      "documentId",
      "parentCommentId",
      "createdById",
      "resolvedAt",
      "data",
    ],
    where: documentIds ? { documentId: documentIds } : undefined,
    order: [["createdAt", "ASC"]],
  });
  // Only a thread's first comment is anchored; replies are not.
  const threads = comments.filter((comment) => !comment.parentCommentId);

  const byDocument = new Map<string, Comment[]>();
  for (const thread of threads) {
    const list = byDocument.get(thread.documentId) ?? [];
    list.push(thread);
    byDocument.set(thread.documentId, list);
  }

  for (const [documentId, documentThreads] of byDocument) {
    const document = await Document.unscoped().findByPk(documentId, {
      attributes: [
        "id",
        "title",
        "content",
        "text",
        "state",
        "lastModifiedById",
      ],
    });
    if (!document?.content) {
      continue;
    }

    const current = Node.fromJSON(schema, document.content);
    const anchored = new Set(
      ProsemirrorHelper.getCommentAnchors(current).map((a) => a.attrs.id)
    );
    const detached = documentThreads.filter(
      (comment) => !anchored.has(comment.id)
    );
    if (!detached.length) {
      continue;
    }

    const revisions = await Revision.unscoped().findAll({
      attributes: ["id", "content", "createdAt"],
      where: { documentId },
      order: [["createdAt", "DESC"]],
    });

    const anchors: CommentAnchor[] = [];
    for (const comment of detached) {
      const anchor = findAnchorInHistory(revisions, comment);
      if (anchor) {
        anchors.push(anchor);
      } else {
        results.push({
          documentId,
          commentId: comment.id,
          restored: false,
          reason:
            "no revision has its anchor (it may have been on the whole page)",
        });
      }
    }
    const { doc, missed } = ProsemirrorHelper.reanchorComments(
      current,
      anchors
    );
    const missedIds = new Set(missed.map((anchor) => anchor.attrs.id));
    for (const anchor of anchors) {
      results.push({
        documentId,
        commentId: anchor.attrs.id,
        restored: !missedIds.has(anchor.attrs.id),
        reason: missedIds.has(anchor.attrs.id)
          ? "its text is no longer in the page, or appears more than once"
          : undefined,
      });
    }

    for (const comment of detached) {
      const result = results.find((r) => r.commentId === comment.id);
      const verb = result?.restored
        ? dryRun
          ? "Would restore"
          : "Restoring"
        : "Cannot restore";
      console.log(
        `${verb} | ${document.title} | ${excerpt(comment)}` +
          (result?.reason ? ` | ${result.reason}` : "")
      );
    }

    if (dryRun || missed.length === anchors.length) {
      continue;
    }

    document.content = doc.toJSON();
    document.text = serializer.serialize(doc);
    DocumentHelper.applyProsemirrorToState(document, doc);

    await document.save({
      hooks: false,
      silent: true,
    });

    // Let a collaboration server holding the document merge the anchors,
    // rather than overwrite them with its own copy on the next save.
    await APIUpdateExtension.notifyUpdate(
      document.id,
      document.lastModifiedById
    );
  }

  const restored = results.filter((r) => r.restored).length;
  console.log(
    `${dryRun ? "Would restore" : "Restored"} ${restored} of ${results.length} detached comments`
  );

  if (exit) {
    process.exit(0);
  }

  return results;
}

/**
 * Finds a comment's anchor in the newest revision that still has it, with
 * the comment's current author and resolved state.
 *
 * @param revisions The document's revisions, newest first.
 * @param comment The comment.
 * @returns The anchor, or undefined if no revision has one.
 */
function findAnchorInHistory(
  revisions: Revision[],
  comment: Comment
): CommentAnchor | undefined {
  for (const revision of revisions) {
    if (
      !revision.content ||
      !JSON.stringify(revision.content).includes(comment.id)
    ) {
      continue;
    }
    const [anchor] = ProsemirrorHelper.getCommentAnchors(
      Node.fromJSON(schema, revision.content),
      new Set([comment.id])
    );
    if (anchor) {
      return {
        ...anchor,
        attrs: {
          id: comment.id,
          userId: comment.createdById,
          resolved: !!comment.resolvedAt,
          draft: false,
        },
      };
    }
  }
  return undefined;
}

/**
 * The start of a comment's text, for the report.
 *
 * @param comment The comment.
 * @returns Up to 60 characters of its text.
 */
function excerpt(comment: Comment): string {
  try {
    const text = ProsemirrorHelper.toPlainText(
      Node.fromJSON(commentSchema, comment.data)
    );
    return text.replace(/\s+/g, " ").trim().slice(0, 60);
  } catch {
    return comment.id;
  }
}

if (process.env.NODE_ENV !== "test") {
  const documentIds = process.argv
    .filter((arg) => arg.startsWith("--document="))
    .map((arg) => arg.slice("--document=".length));
  void main(
    true,
    process.argv.includes("--dry-run"),
    documentIds.length ? documentIds : undefined
  );
}
