import "./bootstrap";
import { Node } from "prosemirror-model";
import * as Y from "yjs";
import { withTrailingNode } from "@shared/editor/lib/trailingNode";
import { schema, serializer } from "@server/editor";
import { APIUpdateExtension } from "@server/collaboration/APIUpdateExtension";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";

const limit = 100;

/**
 * Repairs documents whose collaborative state no longer holds their content,
 * which the editor would otherwise write back as an edit the first time the
 * document is opened. The content is the source of truth: an editing session
 * always saves content derived from the state, so a difference can only come
 * from an API update the state failed to follow. The trailing paragraph the
 * editor adds on load is stored in both.
 *
 * Pass `--dry-run` to only list the documents that would be repaired.
 *
 * @param exit whether to exit the process when done.
 * @param dryRun whether to only report, without saving anything.
 * @returns the number of documents that were, or would be, repaired.
 */
export default async function main(exit = false, dryRun = false) {
  let repaired = 0;
  let page = 0;

  for (;;) {
    const documents = await Document.unscoped().findAll({
      attributes: [
        "id",
        "title",
        "content",
        "text",
        "state",
        "lastModifiedById",
      ],
      limit,
      offset: page * limit,
      order: [["createdAt", "ASC"]],
    });

    for (const document of documents) {
      if (!document.state || !document.content) {
        continue;
      }

      const doc = withTrailingNode(Node.fromJSON(schema, document.content));
      const content = Node.fromJSON(schema, document.content);
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, document.state);

      if (content.eq(doc) && DocumentHelper.stateHolds(ydoc, doc)) {
        continue;
      }

      repaired++;
      console.log(
        `${dryRun ? "Would repair" : "Repairing"} ${document.id} ${document.title}`
      );

      if (dryRun) {
        continue;
      }

      document.content = doc.toJSON();
      document.text = serializer.serialize(doc);
      DocumentHelper.applyProsemirrorToState(document, doc);

      await document.save({
        hooks: false,
        silent: true,
      });

      // Let a collaboration server holding the document merge the repair,
      // rather than overwrite it with its own copy on the next save.
      await APIUpdateExtension.notifyUpdate(
        document.id,
        document.lastModifiedById
      );
    }

    if (documents.length < limit) {
      break;
    }
    page++;
  }

  console.log(`${dryRun ? "Would repair" : "Repaired"} ${repaired} documents`);

  if (exit) {
    process.exit(0);
  }

  return repaired;
}

if (process.env.NODE_ENV !== "test") {
  void main(true, process.argv.includes("--dry-run"));
}
