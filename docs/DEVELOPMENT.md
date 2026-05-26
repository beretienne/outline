# MCP metadata/frontmatter development notes

## Scope implemented

This document records the work completed for the MCP enhancement that lets a client:

1. Fetch a collection table of contents through the existing `list_collection_documents` MCP tool.
2. Fetch per-document generated metadata through the new `fetch_document_frontmatter` MCP tool.

The implemented design is:

- DB-backed metadata, rendered as YAML only at the MCP boundary.
- One metadata record per published Outline document.
- Title and breadcrumb derived live at read time.
- Summary and ranked keywords stored and refreshed asynchronously.
- Node/TypeScript worker-based generation, with either heuristic generation or an OpenAI-compatible external/local endpoint.

## What was done

### 1. Codebase investigation and design decisions

The first step was to trace the existing MCP and document hierarchy surfaces:

- confirmed that `list_collection_documents` already exposes the published collection tree
- confirmed that collection hierarchy comes from `Collection.getCachedDocumentStructure()`
- confirmed that document breadcrumbs already exist through MCP helpers
- traced document lifecycle events, processors, and queue tasks to find the correct refresh hook points

The agreed design decisions were then captured in `docs/PLAN.md`:

- store generated metadata in the database rather than filesystem `.yml` sidecars
- use the existing Node/TypeScript queue worker, not Python
- keep one metadata record per document
- scope the feature to published documents only
- support either hosted AI or a locally hosted model endpoint through one provider abstraction

### 2. Persistence model and migration

Added a new model and migration:

- `server/models/DocumentMetadata.ts`
- `server/migrations/20260525123000-create-document-metadata.js`

The new table stores:

- `documentId`
- `teamId`
- `summary`
- `keywords`
- `provider`
- `sourceUpdatedAt`
- `generatedAt`

It is keyed per document and cleans up with document/team cascades.

### 3. Metadata generation utility

Added `server/utils/documentMetadata.ts`.

This utility now handles:

- deciding whether a document should have metadata at all
- creating or updating metadata when the document changed
- deleting metadata for drafts, archived documents, deleted documents, templates, or missing documents
- rendering YAML frontmatter for MCP responses
- generating summary and keywords through:
  - a local heuristic provider by default
  - an OpenAI-compatible HTTP endpoint when configured
- falling back to heuristics if the configured AI provider fails

Important implementation detail:

- title and breadcrumb are **not** persisted in `document_metadata`
- they are derived live when `fetch_document_frontmatter` is called

That avoids stale hierarchy state after reparenting or collection movement.

### 4. Queue task and processor wiring

Added:

- `server/queues/tasks/GenerateDocumentMetadataTask.ts`
- `server/queues/processors/DocumentMetadataProcessor.ts`

The processor schedules metadata refresh for:

- `documents.create`
- `documents.publish`
- `documents.update.debounced`
- `documents.title_change`
- `documents.unarchive`
- `documents.restore`
- `documents.archive`
- `documents.unpublish`
- `documents.delete`
- `documents.permanent_delete`

This keeps summary and keyword metadata in sync with content and title changes while leaving breadcrumb refresh to live MCP reads.

### 5. MCP surface extension

Updated `server/tools/documents.ts` to register `fetch_document_frontmatter`.

This tool now:

- requires `documents.info`
- loads the document with normal authorization
- ensures metadata exists and is fresh on demand
- resolves breadcrumb live
- returns two text payloads:
  1. JSON containing document metadata plus a `frontmatter` object
  2. rendered YAML frontmatter

Updated `server/routes/mcp/index.ts` instructions so MCP clients are explicitly guided to:

1. call `list_collection_documents` first
2. then call `fetch_document_frontmatter`

### 6. Environment configuration for AI generation

Updated `server/env.ts` with metadata-generation configuration:

- `DOCUMENT_METADATA_AI_PROVIDER`
- `DOCUMENT_METADATA_AI_URL`
- `DOCUMENT_METADATA_AI_MODEL`
- `DOCUMENT_METADATA_AI_API_KEY`

The default provider is `heuristic`.

### 7. Tests added

Added targeted tests in:

- `server/utils/documentMetadata.test.ts`
- `server/routes/mcp/index.test.ts`

The new tests cover:

- metadata generation for published documents
- metadata removal for drafts
- YAML rendering
- stale metadata refresh after document edits
- MCP `fetch_document_frontmatter` JSON + YAML response shape
- MCP on-demand refresh behavior after document updates

### 8. Validation and debugging steps carried out

During validation, several issues were found and fixed:

- local machine Postgres port `5432` was already occupied by another Outline instance
- the default test database credentials were hitting the wrong Postgres instance
- an incorrect helper import caused metadata generation failures
- the OpenAI-compatible URL construction needed normalization
- the warning logger call had to match the repo logger API
- the refresh processor needed to include create and title-change events

After those fixes, the focused suite passed.

## Files added or changed

### Added

- `docs/DEVELOPMENT.md`
- `server/migrations/20260525123000-create-document-metadata.js`
- `server/models/DocumentMetadata.ts`
- `server/queues/processors/DocumentMetadataProcessor.ts`
- `server/queues/tasks/GenerateDocumentMetadataTask.ts`
- `server/utils/documentMetadata.ts`
- `server/utils/documentMetadata.test.ts`

### Updated

- `server/env.ts`
- `server/models/index.ts`
- `server/routes/mcp/index.ts`
- `server/routes/mcp/index.test.ts`
- `server/tools/documents.ts`

## Tests and validation actually run

### Dependency/tooling note

This repository expects Yarn 4, but the local global `yarn` in this environment was not usable for the repo. Commands were run with:

```bash
npx -y @yarnpkg/cli-dist@4.11.0 ...
```

### Commands that were run

Focused validation was run against an isolated Postgres instance on port `55432` plus Redis on `6379`.

Database setup:

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:55432/outline-test \
REDIS_URL=redis://127.0.0.1:6379 \
NODE_ENV=test \
npx -y @yarnpkg/cli-dist@4.11.0 sequelize db:create
```

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:55432/outline-test \
REDIS_URL=redis://127.0.0.1:6379 \
NODE_ENV=test \
npx -y @yarnpkg/cli-dist@4.11.0 sequelize db:migrate
```

Focused server tests:

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:55432/outline-test \
REDIS_URL=redis://127.0.0.1:6379 \
NODE_ENV=test \
npx -y @yarnpkg/cli-dist@4.11.0 vitest run --project server \
  server/routes/mcp/index.test.ts \
  server/utils/documentMetadata.test.ts
```

Targeted formatting check:

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:55432/outline-test \
REDIS_URL=redis://127.0.0.1:6379 \
NODE_ENV=test \
npx -y @yarnpkg/cli-dist@4.11.0 prettier --check \
  server/models/DocumentMetadata.ts \
  server/migrations/20260525123000-create-document-metadata.js \
  server/utils/documentMetadata.ts \
  server/queues/tasks/GenerateDocumentMetadataTask.ts \
  server/queues/processors/DocumentMetadataProcessor.ts \
  server/tools/documents.ts \
  server/routes/mcp/index.ts \
  server/routes/mcp/index.test.ts \
  server/utils/documentMetadata.test.ts \
  server/env.ts \
  server/models/index.ts
```

### Earlier validation attempts

Two earlier validation attempts are worth recording:

1. An initial focused test run failed because the local `outline-test` connection pointed at an already-running Postgres instance that rejected the test credentials.
2. A broader lint attempt earlier in the task hit a pre-existing unrelated lint issue elsewhere in the repository, so validation was narrowed to the changed area.

## How to reproduce manually

### Option A: reproduce the focused automated validation exactly

Start Redis if it is not already running:

```bash
docker compose up -d redis
```

Start an isolated Postgres instance:

```bash
docker run -d \
  --name outline-metadata-test-pg \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=pass \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1:55432:5432 \
  postgres
```

Then run:

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:55432/outline-test \
REDIS_URL=redis://127.0.0.1:6379 \
NODE_ENV=test \
npx -y @yarnpkg/cli-dist@4.11.0 sequelize db:create
```

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:55432/outline-test \
REDIS_URL=redis://127.0.0.1:6379 \
NODE_ENV=test \
npx -y @yarnpkg/cli-dist@4.11.0 sequelize db:migrate
```

```bash
DATABASE_URL=postgres://user:pass@127.0.0.1:55432/outline-test \
REDIS_URL=redis://127.0.0.1:6379 \
NODE_ENV=test \
npx -y @yarnpkg/cli-dist@4.11.0 vitest run --project server \
  server/routes/mcp/index.test.ts \
  server/utils/documentMetadata.test.ts
```

When finished:

```bash
docker rm -f outline-metadata-test-pg
```

### Option B: manually exercise the MCP behavior

Prerequisites:

- migration applied
- worker service running
- Redis available
- MCP enabled in team preferences
- valid MCP/OAuth/API authentication that can access `documents.info` and collection read scopes

Manual flow:

1. Call `list_collection_documents` for a collection.
2. Pick one published document ID from the TOC response.
3. Call `fetch_document_frontmatter` with that document ID.
4. Confirm that the response contains:
   - JSON with `document` and `frontmatter`
   - a second payload containing YAML frontmatter
5. Update the document body or title.
6. Call `fetch_document_frontmatter` again and confirm summary/keywords refresh.

## External LLM / local model configuration

Metadata generation works without any external AI configuration because the default provider is `heuristic`.

To use an external or local OpenAI-compatible endpoint instead, set:

```bash
DOCUMENT_METADATA_AI_PROVIDER=openai-compatible
DOCUMENT_METADATA_AI_URL=http://localhost:11434/v1
DOCUMENT_METADATA_AI_MODEL=your-model-name
DOCUMENT_METADATA_AI_API_KEY=optional-token
```

Notes:

- `DOCUMENT_METADATA_AI_URL` must be an HTTP or HTTPS base URL.
- `DOCUMENT_METADATA_AI_MODEL` is required when `DOCUMENT_METADATA_AI_PROVIDER=openai-compatible`.
- `DOCUMENT_METADATA_AI_API_KEY` is optional and only needed when the endpoint requires bearer auth.
- A locally hosted model is expected to be exposed as a separate service; the Outline worker does not embed model runtime.
- If the configured provider fails, the implementation falls back to heuristic generation and logs a warning.

## Current behavior summary

At this point the feature behaves as follows:

- TOC comes from existing published collection hierarchy.
- Frontmatter fetch is on demand per document.
- Only published, non-archived, non-deleted, non-template documents keep metadata.
- Title and breadcrumb are always current because they are computed live.
- Summary and keywords are cached in `document_metadata`.
- Summary/keywords refresh on create, publish, debounced update, title change, restore/unarchive, archive/unpublish, delete, and permanent delete.
- Existing published documents without cached metadata are generated lazily the first time `fetch_document_frontmatter` is called.

## Remaining work

### 1. Add a real backfill path for existing published documents

This is the largest remaining gap.

Today, old published documents are populated lazily on first MCP metadata fetch. That is correct functionally, but it does not pre-warm the whole knowledge base.

Recommended follow-up:

1. add a dedicated backfill task or admin job
2. iterate all published documents
3. call `ensureDocumentMetadataByDocumentId` for each
4. batch/throttle work so the queue and database are not flooded
5. make the job resumable or idempotent
6. record failures clearly for retry

This would make the feature fully ready for first-use across large workspaces.

### 2. Decide rollout strategy for the AI provider

The configuration exists, but deployment decisions still need to be made:

- whether production should stay on `heuristic` initially
- which hosted or local endpoint should be used
- how secrets will be injected for `DOCUMENT_METADATA_AI_API_KEY`
- which model gives acceptable summary/keyword quality for this use case

Recommended follow-up:

1. test one hosted provider and one local OpenAI-compatible endpoint
2. capture expected latency/cost/quality
3. document the chosen production default

### 3. Add broader operational documentation

This file documents the development work, but a production-facing deployment note may still be needed elsewhere for:

- new environment variables
- migration rollout
- worker requirement
- backfill execution order

### 4. Expand test coverage around queue/event behavior

The current targeted tests cover the core utility and MCP responses well, but there is still room for deeper queue/event coverage.

Recommended additions:

- direct tests for `DocumentMetadataProcessor`
- explicit tests that archive/unpublish/delete remove metadata
- explicit tests for AI-provider failure fallback to heuristics
- tests for title-change refresh behavior

### 5. Decide whether the MCP response contract should stay JSON + YAML

The current tool returns both:

1. structured JSON
2. rendered YAML frontmatter

That is useful for both machine and human consumers, but if downstream clients want one canonical shape only, this may need to be narrowed later.

### 6. Run broader repo validation once the unrelated baseline issue is addressed

The changed area is passing its focused suite and formatting checks.

What remains at repository level is to rerun broader validation once unrelated baseline issues are cleared, especially if this work is prepared for merge.
