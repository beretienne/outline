import "./bootstrap";
import { Collection, Document, Notification, Revision } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { sequelize } from "@server/storage/database";

/** What pruning did, or would do, to one document's history. */
export interface PruneResult {
  documentId: string;
  collectionId: string | null;
  /** The document's revisions before pruning. */
  total: number;
  /** The revisions removed, or that would be. */
  removed: number;
}

/**
 * Removes revisions that change nothing a reader can see: same title, icon,
 * colour and Markdown as the revision kept before them. Such revisions were
 * written when a page's collaborative state and content disagreed (a mark
 * swapped by y-prosemirror, a trailing paragraph, a formula's formatting), so
 * merely opening the page recorded an "edit". A revision whose only change is
 * a comment anchor counts as one too, since Markdown does not carry anchors.
 *
 * The first and the latest revision of each document are always kept, the
 * latest because new revisions are compared against it. Revisions are deleted
 * outright rather than soft-deleted, which the history would still list as
 * "Revision deleted"; notifications that pointed at one are moved to the
 * revision kept in its place, rather than deleted with it.
 *
 * Pass `--dry-run` to only report, and `--collection=<id>` or
 * `--document=<id>` (repeatable) to limit it.
 *
 * @param exit whether to exit the process when done.
 * @param dryRun whether to only report, without deleting anything.
 * @param scope only look at these collections or documents, when given.
 * @returns what happened to each document's history.
 */
export default async function main(
  exit = false,
  dryRun = false,
  scope: { collectionIds?: string[]; documentIds?: string[] } = {}
): Promise<PruneResult[]> {
  const results: PruneResult[] = [];
  const where = {
    ...(scope.collectionIds ? { collectionId: scope.collectionIds } : {}),
    ...(scope.documentIds ? { id: scope.documentIds } : {}),
  };
  const documents = await Document.unscoped().findAll({
    attributes: ["id", "title", "collectionId"],
    where,
    order: [["createdAt", "ASC"]],
    paranoid: false,
  });
  const collectionNames = new Map(
    (await Collection.unscoped().findAll({ attributes: ["id", "name"] })).map(
      (collection) => [collection.id, collection.name]
    )
  );

  for (const document of documents) {
    const revisions = await Revision.unscoped().findAll({
      where: { documentId: document.id },
      order: [["createdAt", "ASC"]],
    });
    if (revisions.length < 3) {
      continue;
    }

    // Revision id to delete → the kept revision that shows the same thing.
    const replacedBy = new Map<string, string>();
    let kept = revisions[0];
    let keptView = await visibleView(kept);

    for (const revision of revisions.slice(1, -1)) {
      const view = await visibleView(revision);
      if (view === keptView) {
        replacedBy.set(revision.id, kept.id);
      } else {
        kept = revision;
        keptView = view;
      }
    }

    // The latest revision is kept; if it looks like the one kept before it,
    // the no-op revisions in between still point at that earlier one, which
    // is equivalent.
    if (!replacedBy.size) {
      continue;
    }

    results.push({
      documentId: document.id,
      collectionId: document.collectionId ?? null,
      total: revisions.length,
      removed: replacedBy.size,
    });
    console.log(
      `${dryRun ? "Would remove" : "Removing"} ${replacedBy.size} of ${revisions.length}` +
        ` | ${collectionNames.get(document.collectionId ?? "") ?? "(no collection)"}` +
        ` | ${document.title}`
    );

    if (dryRun) {
      continue;
    }

    await sequelize.transaction(async (transaction) => {
      for (const [removedId, keptId] of replacedBy) {
        await Notification.unscoped().update(
          { revisionId: keptId },
          { where: { revisionId: removedId }, transaction }
        );
      }
      await Revision.unscoped().destroy({
        where: { id: [...replacedBy.keys()] },
        force: true,
        transaction,
      });
    });
  }

  const byCollection = new Map<
    string,
    { documents: number; removed: number }
  >();
  for (const result of results) {
    const name =
      collectionNames.get(result.collectionId ?? "") ?? "(no collection)";
    const entry = byCollection.get(name) ?? { documents: 0, removed: 0 };
    entry.documents++;
    entry.removed += result.removed;
    byCollection.set(name, entry);
  }
  for (const [name, { documents: count, removed }] of byCollection) {
    console.log(
      `${name}: ${dryRun ? "would remove" : "removed"} ${removed} revisions from ${count} documents`
    );
  }

  if (exit) {
    process.exit(0);
  }

  return results;
}

/**
 * What a reader sees of a revision: its title, icon, colour and Markdown.
 *
 * @param revision The revision.
 * @returns A string that is equal for revisions that look the same.
 */
async function visibleView(revision: Revision): Promise<string> {
  const markdown = await DocumentHelper.toMarkdown(revision, {
    includeTitle: false,
  });
  return JSON.stringify([
    revision.title,
    revision.icon,
    revision.color,
    markdown,
  ]);
}

if (process.env.NODE_ENV !== "test") {
  const values = (flag: string) =>
    process.argv
      .filter((arg) => arg.startsWith(`--${flag}=`))
      .map((arg) => arg.slice(flag.length + 3));
  const collectionIds = values("collection");
  const documentIds = values("document");
  void main(true, process.argv.includes("--dry-run"), {
    collectionIds: collectionIds.length ? collectionIds : undefined,
    documentIds: documentIds.length ? documentIds : undefined,
  });
}
