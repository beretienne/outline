import { BaseTask } from "./base/BaseTask";
import { ensureDocumentMetadataByDocumentId } from "@server/utils/documentMetadata";

type Props = {
  documentId: string;
};

/**
 * Generates or refreshes stored MCP metadata for a document.
 */
export default class GenerateDocumentMetadataTask extends BaseTask<Props> {
  public async perform({ documentId }: Props) {
    await ensureDocumentMetadataByDocumentId(documentId);
  }
}
