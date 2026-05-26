import fetch from "node-fetch";
import yaml from "js-yaml";
import { uniq } from "es-toolkit/compat";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Document, DocumentMetadata } from "@server/models";

const MAX_SUMMARY_LENGTH = 320;
const MAX_KEYWORDS = 8;
const OPENAI_PROVIDER = "openai-compatible";
const HEURISTIC_PROVIDER = "heuristic";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "around",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "can",
  "could",
  "did",
  "does",
  "done",
  "down",
  "during",
  "each",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "its",
  "just",
  "more",
  "most",
  "not",
  "now",
  "off",
  "onto",
  "only",
  "other",
  "our",
  "out",
  "over",
  "should",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "would",
  "your",
]);

type GeneratedMetadata = {
  summary: string;
  keywords: string[];
  provider: string;
};

/**
 * Returns true when the document should have generated metadata.
 *
 * @param document the document to inspect.
 * @returns whether metadata should exist.
 */
export function shouldGenerateDocumentMetadata(document: Document) {
  return (
    !!document.publishedAt &&
    !document.archivedAt &&
    !document.deletedAt &&
    !document.template
  );
}

/**
 * Ensures a document's generated metadata exists and is fresh.
 *
 * @param document the document to process.
 * @returns the current metadata record, or null when metadata should not exist.
 */
export async function ensureDocumentMetadata(document: Document) {
  if (!shouldGenerateDocumentMetadata(document)) {
    await DocumentMetadata.destroy({
      where: {
        documentId: document.id,
      },
    });
    return null;
  }

  const existing = await DocumentMetadata.findOne({
    where: {
      documentId: document.id,
    },
  });

  if (
    existing &&
    existing.sourceUpdatedAt.getTime() >= document.updatedAt.getTime()
  ) {
    return existing;
  }

  const generated = await generateMetadata(document);
  const values = {
    documentId: document.id,
    teamId: document.teamId,
    summary: generated.summary,
    keywords: generated.keywords,
    provider: generated.provider,
    sourceUpdatedAt: document.updatedAt,
    generatedAt: new Date(),
  };

  if (existing) {
    await existing.update(values);
    return existing;
  }

  return DocumentMetadata.create(values);
}

/**
 * Ensures metadata is up to date for a document ID.
 *
 * @param documentId the document id to process.
 * @returns the current metadata record, or null when metadata should not exist.
 */
export async function ensureDocumentMetadataByDocumentId(documentId: string) {
  const document = await Document.unscoped().findByPk(documentId, {
    paranoid: false,
  });

  if (!document) {
    await DocumentMetadata.destroy({
      where: {
        documentId,
      },
    });
    return null;
  }

  return ensureDocumentMetadata(document);
}

/**
 * Builds YAML frontmatter for a document using live document attributes plus
 * generated metadata.
 *
 * @param params the data to serialize.
 * @returns a YAML frontmatter string.
 */
export function renderDocumentFrontmatter({
  title,
  breadcrumb,
  summary,
  keywords,
}: {
  title: string;
  breadcrumb?: string;
  summary: string;
  keywords: string[];
}) {
  return `---\n${yaml.dump(
    {
      title,
      ...(breadcrumb ? { breadcrumb } : {}),
      summary,
      keywords,
    },
    {
      lineWidth: 80,
      noRefs: true,
      sortKeys: false,
    }
  )}---`;
}

async function generateMetadata(
  document: Document
): Promise<GeneratedMetadata> {
  if (env.DOCUMENT_METADATA_AI_PROVIDER === OPENAI_PROVIDER) {
    try {
      return await generateWithOpenAICompatibleProvider(document);
    } catch (error) {
      Logger.warn("Falling back to heuristic document metadata", {
        documentId: document.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return generateHeuristicMetadata(document);
}

function generateHeuristicMetadata(document: Document): GeneratedMetadata {
  const plainText = normalizeWhitespace(DocumentHelper.toPlainText(document));
  const summary = normalizeSummary(
    document.summary || extractSummaryFromText(plainText)
  );
  const keywords = extractKeywords(document.title, plainText);

  return {
    summary,
    keywords,
    provider: HEURISTIC_PROVIDER,
  };
}

async function generateWithOpenAICompatibleProvider(
  document: Document
): Promise<GeneratedMetadata> {
  if (!env.DOCUMENT_METADATA_AI_URL || !env.DOCUMENT_METADATA_AI_MODEL) {
    throw new Error(
      "DOCUMENT_METADATA_AI_URL and DOCUMENT_METADATA_AI_MODEL are required for openai-compatible provider"
    );
  }

  const plainText = normalizeWhitespace(DocumentHelper.toPlainText(document));
  const response = await fetch(
    new URL(
      "chat/completions",
      toUrlBase(env.DOCUMENT_METADATA_AI_URL)
    ).toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.DOCUMENT_METADATA_AI_API_KEY
          ? {
              Authorization: `Bearer ${env.DOCUMENT_METADATA_AI_API_KEY}`,
            }
          : {}),
      },
      body: JSON.stringify({
        model: env.DOCUMENT_METADATA_AI_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              'Return compact JSON only with keys "summary" and "keywords". The summary must be 3-4 short lines max, and keywords must be an ordered array of concise ranked phrases.',
          },
          {
            role: "user",
            content: [
              `Title: ${document.title}`,
              "",
              "Document content:",
              plainText.slice(0, 12000),
            ].join("\n"),
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("AI provider returned an empty response");
  }

  const parsed = parseModelResponse(content);
  const summary = normalizeSummary(parsed.summary);
  const keywords = normalizeKeywords(parsed.keywords);

  if (!summary || keywords.length === 0) {
    throw new Error("AI provider returned incomplete metadata");
  }

  return {
    summary,
    keywords,
    provider: OPENAI_PROVIDER,
  };
}

function parseModelResponse(content: string) {
  const normalized = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(normalized) as {
    summary?: unknown;
    keywords?: unknown;
  };

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.filter(
          (value): value is string => typeof value === "string"
        )
      : [],
  };
}

function extractSummaryFromText(text: string) {
  if (!text) {
    return "";
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const picked: string[] = [];
  let totalLength = 0;

  for (const sentence of sentences) {
    const nextLength = totalLength + sentence.length + (picked.length ? 1 : 0);

    if (picked.length >= 3 || nextLength > MAX_SUMMARY_LENGTH) {
      break;
    }

    picked.push(sentence);
    totalLength = nextLength;
  }

  if (picked.length > 0) {
    return picked.join(" ");
  }

  return text.slice(0, MAX_SUMMARY_LENGTH);
}

function extractKeywords(title: string, text: string) {
  const scores = new Map<string, number>();
  addKeywordScores(scores, title, 3);
  addKeywordScores(scores, text, 1);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_KEYWORDS)
    .map(([keyword]) => keyword);
}

function addKeywordScores(
  scores: Map<string, number>,
  text: string,
  weight: number
) {
  const tokens = text.toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g);

  if (!tokens) {
    return;
  }

  for (const token of tokens) {
    if (STOP_WORDS.has(token)) {
      continue;
    }

    scores.set(token, (scores.get(token) ?? 0) + weight);
  }
}

function normalizeSummary(summary: string) {
  const normalized = normalizeWhitespace(summary).slice(0, MAX_SUMMARY_LENGTH);
  return normalized.replace(/[,:;\s]+$/, "");
}

function normalizeKeywords(keywords: string[]) {
  return uniq(
    keywords
      .map((keyword) => normalizeWhitespace(keyword).toLocaleLowerCase())
      .filter((keyword) => keyword.length >= 2)
  ).slice(0, MAX_KEYWORDS);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toUrlBase(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
