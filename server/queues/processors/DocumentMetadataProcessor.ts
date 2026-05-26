import GenerateDocumentMetadataTask from "@server/queues/tasks/GenerateDocumentMetadataTask";
import type { DocumentEvent, Event } from "@server/types";
import BaseProcessor from "./BaseProcessor";

/**
 * Keeps generated MCP document metadata in sync with document lifecycle events.
 */
export default class DocumentMetadataProcessor extends BaseProcessor {
  static applicableEvents: Event["name"][] = [
    "documents.create",
    "documents.publish",
    "documents.update.debounced",
    "documents.title_change",
    "documents.unarchive",
    "documents.restore",
    "documents.archive",
    "documents.unpublish",
    "documents.delete",
    "documents.permanent_delete",
  ];

  public async perform(event: DocumentEvent) {
    await new GenerateDocumentMetadataTask().schedule({
      documentId: event.documentId,
    });
  }
}
