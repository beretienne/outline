import { parser } from "@server/editor";
import { DocumentMetadata } from "@server/models";
import { buildDocument, buildDraftDocument } from "@server/test/factories";
import {
  ensureDocumentMetadataByDocumentId,
  renderDocumentFrontmatter,
} from "./documentMetadata";

describe("documentMetadata", () => {
  it("generates summary and keywords for a published document", async () => {
    const document = await buildDocument({
      text: "Architecture overview. This document explains the metadata pipeline, worker flow, and MCP integration in detail.",
    });

    const metadata = await ensureDocumentMetadataByDocumentId(document.id);

    expect(metadata).not.toBeNull();
    expect(metadata?.summary).toContain("Architecture overview");
    expect(metadata?.keywords.length).toBeGreaterThan(0);
  });

  it("removes metadata for a draft document", async () => {
    const document = await buildDraftDocument({
      text: "Draft content that should not have generated metadata.",
    });

    const metadata = await ensureDocumentMetadataByDocumentId(document.id);

    expect(metadata).toBeNull();
    expect(
      await DocumentMetadata.count({
        where: {
          documentId: document.id,
        },
      })
    ).toBe(0);
  });

  it("renders YAML frontmatter", () => {
    const yaml = renderDocumentFrontmatter({
      title: "Metadata doc",
      breadcrumb: "Knowledge Base › MCP",
      summary: "A short summary.",
      keywords: ["mcp", "metadata"],
    });

    expect(yaml).toContain("title: Metadata doc");
    expect(yaml).toContain("breadcrumb: Knowledge Base");
    expect(yaml).toContain("summary: A short summary.");
    expect(yaml).toContain("- mcp");
  });

  it("refreshes stale metadata after the document content changes", async () => {
    const document = await buildDocument({
      text: "First version. This summary should be replaced later.",
    });
    const initial = await ensureDocumentMetadataByDocumentId(document.id);

    await document.update({
      content: parser
        .parse(
          "Second version. This metadata should now mention orchestration and local models."
        )
        ?.toJSON(),
      text: "Second version. This metadata should now mention orchestration and local models.",
    });

    const refreshed = await ensureDocumentMetadataByDocumentId(document.id);

    expect(initial?.summary).not.toEqual(refreshed?.summary);
    expect(refreshed?.summary).toContain("Second version");
  });
});
