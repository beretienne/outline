# MCP collection metadata feature plan

## Goal

Add an MCP-facing capability that lets a client:

1. Retrieve a **table of contents** for a collection based on the document hierarchy.
2. Retrieve, on demand, **generated per-document metadata** containing:
   - title
   - optional breadcrumb/path within the collection
   - short summary (3-4 lines max)
   - ranked keywords

The generated metadata must stay in sync as document content and hierarchy evolve.

## What already exists in the codebase

### Existing MCP surface

- `server/tools/documents.ts` already exposes `list_collection_documents`, which returns the full hierarchical tree of published documents for a collection.
- `server/tools/fetch.ts` already exposes `fetch` for collections and documents.
- `server/tools/util.ts` already contains breadcrumb helpers (`getDocumentBreadcrumb`, `getBreadcrumbsForDocuments`).

### Existing hierarchy model

- `Collection` already stores and serves `documentStructure`, and `getCachedDocumentStructure()` is already the canonical way to retrieve the tree.
- This means the **TOC part is feasible without inventing a new hierarchy source**.

### Existing document update hook points

- `server/commands/documentCreator.ts`
- `server/commands/documentUpdater.ts`
- document move / publish / archive flows and their related queued processing

These are the natural places to trigger metadata refresh work when content or hierarchy changes.

### Existing async infrastructure

- The server already has queue/task/processor infrastructure under `server/queues/tasks` and `server/queues/processors`.
- This strongly suggests that metadata generation should be **asynchronous**, not synchronous in the request path.

### Existing metadata that may help

- `Document.summary` already exists on the document model.
- Breadcrumbs are already derivable.
- There is **no existing per-document keyword store** and no current YAML-frontmatter persistence model for this purpose.

## Main architectural observation

The requested behavior breaks into two fairly separate concerns:

1. **TOC serving** — already mostly supported by current collection hierarchy code.
2. **Generated metadata serving** — requires new persistence, regeneration triggers, and MCP response shaping.

Because of that, this feature is very likely best implemented as an **incremental extension of the current MCP tools**, not as a parallel standalone subsystem.

## Recommended implementation direction

### 1. Keep TOC as the first-class MCP entry point

The collection TOC should remain the first call a client makes.

This can likely be done by:

- reusing `list_collection_documents`, possibly extending its payload slightly
- or introducing a dedicated MCP tool with a more explicit name if we want a stable contract specialized for AI clients

Either way, the hierarchy source should stay `Collection.getCachedDocumentStructure()`.

### 2. Store generated metadata in application persistence, not as raw files

My current recommendation is:

- **store generated metadata in the database**
- **render YAML/frontmatter only when MCP returns it**

Why this currently looks strongest:

- the app already persists document state in the database
- hierarchy changes are application events, not filesystem events
- MCP consumers care about structured output, not necessarily real files on disk
- there is no existing file-based metadata pipeline in this repo for document-sidecar YAML files

This would avoid introducing a file synchronization problem on top of the actual metadata generation problem.

Possible persistence options:

- a dedicated `document_generated_metadata` table
- a JSONB column on `documents`

My current preference would be a **dedicated table**, because it cleanly separates generated state, refresh timestamps, versioning inputs, and possible failure/retry status from core document data.

### 3. Generate metadata asynchronously

Generation should likely run through the existing queue/task system.

Likely triggers:

- document created
- document text updated
- title updated
- document moved in hierarchy
- parent changed
- collection changed
- document published / unpublished / archived if TOC visibility depends on those states

Likely flow:

1. write operation completes normally
2. enqueue metadata refresh task
3. worker loads current document state + hierarchy context
4. generator produces summary/keywords/breadcrumb payload
5. store normalized metadata

This keeps request latency stable and gives room for retries, debouncing, and backfills.

### 4. Expose metadata through MCP separately from TOC

The user requirement says MCP should serve **TOC first, then additional information on request**.

That implies the API contract should stay two-step:

- first call: collection TOC
- second call: document metadata/frontmatter fetch

This is good design because it avoids over-fetching generated metadata for every node in large collections.

Potential MCP surface:

- `list_collection_documents` or `list_collection_toc`
- `fetch_document_frontmatter` or an extension of `fetch(document)` with an explicit metadata mode

I would lean toward a **separate MCP tool** for generated metadata so the contract stays obvious and we do not overload the existing generic `fetch` behavior too much.

## Confirmed planning decisions

### YAML/frontmatter shape

The selected direction is:

- generated metadata is stored in application persistence
- MCP renders it as YAML/frontmatter when requested
- the system does **not** maintain physical `.yml` sidecar files per document

This fits the current architecture much better than introducing a second file-based source of truth.

### Generator runtime

The selected direction is:

- generation stays in the existing Node/TypeScript worker system
- no Python process is introduced for this feature

This matches the current repository, which already has queue/task infrastructure and no Python runtime footprint.

### Summary and keyword generation

The selected direction is:

- title is sourced directly from the document
- breadcrumb is derived deterministically from collection hierarchy
- summary and ranked keywords are generated by a **pluggable AI provider** called from the Node/TypeScript worker

Why this is the current recommendation:

- the repo does not contain local model/runtime infrastructure
- there is no existing built-in keyword extraction or summarization subsystem suitable for high-quality metadata
- the feature request explicitly points toward an AI-based process

Local model use is absolutely possible, but the clean way to support it in this repository is:

- run the local model as a separate service or endpoint
- call it from the Node/TypeScript worker through the same provider abstraction used for hosted AI

That means the implementation should support both:

- hosted/external AI providers
- locally hosted model endpoints

What I do **not** recommend is embedding a model runtime directly into the Outline worker process, because that would introduce a large new runtime and operational surface that the repo does not currently have.

I also think the plan should leave room for a degraded fallback mode:

- if AI generation fails, title and breadcrumb are still available deterministically
- summary could temporarily fall back to an extractive heuristic
- keywords could temporarily fall back to a simpler local extraction strategy

That fallback should be considered resilience behavior, not the main product path.

### Metadata granularity

The selected direction is:

- one generated metadata record per Outline document
- no extra chunk-splitting layer inside a document

This keeps the first version aligned with the current document model and collection tree.

### Visibility scope

The selected direction is:

- TOC covers published documents only
- generated metadata is maintained for published documents only

This matches the current behavior of `list_collection_documents`.

## Breadcrumb note

Breadcrumbs may duplicate part of the TOC role.

My current view:

- keep breadcrumb in the generated metadata if documents may be fetched independently from the TOC
- otherwise it can be optional or omitted to reduce redundancy

This should be a payload decision rather than a core architectural blocker.

## Existing fields that may reduce scope

`Document.summary` already exists. That opens two possible strategies:

- reuse it as the “short summary” source where acceptable
- keep generated summary separate if the new MCP metadata must be independently versioned and refreshed

I would not overload `Document.summary` without confirming its current product semantics, but it is worth evaluating before introducing a second near-duplicate summary field.

## Concrete implementation plan

### Phase 1 — persistence model

Add a dedicated persistence model for generated metadata rather than overloading core document fields.

Current recommendation:

- create a dedicated table keyed by `documentId`
- store title snapshot, breadcrumb, summary, ordered keywords, freshness marker(s), generation timestamp, and optional status/error fields

Why this looks strongest:

- generated state is operationally distinct from authored content
- it supports retries, failures, and future generator-versioning cleanly
- it avoids cluttering the core `documents` model

### Phase 2 — regeneration pipeline

Add an async metadata regeneration task using the existing worker system.

Likely enqueue points:

- document create
- document update
- document publish
- move / reparent
- collection change
- archive / unarchive if publishing rules require cleanup

The worker should:

1. load the current published document
2. load collection context + breadcrumb
3. build deterministic fields (title + breadcrumb)
4. call the external AI provider abstraction to generate summary + ranked keywords
4. upsert the metadata record

Because hierarchy matters, the pipeline should also handle descendant refresh when a parent title or position changes.

The provider abstraction should be designed so the task can:

- pass normalized markdown/plain text plus hierarchy context
- receive structured summary + keyword output
- handle retries, timeouts, and provider failures without breaking document write flows
- target either a hosted provider or a local model endpoint with the same contract

### Phase 3 — MCP contract

Keep the TOC-first interaction explicit.

Recommended MCP surface:

- reuse or lightly extend `list_collection_documents` as the TOC call
- add a dedicated per-document metadata tool, e.g. `fetch_document_frontmatter`

That metadata tool should ideally return:

- structured JSON fields
- plus a rendered YAML/frontmatter representation for clients that want the serialized format directly

### Phase 4 — backfill

Add a backfill path for existing published documents so metadata exists before the next edit.

The backfill should be:

- enqueue-driven
- idempotent
- resumable

### Phase 5 — tests

Add tests for:

- TOC output staying aligned with collection hierarchy
- metadata generation after create/update
- breadcrumb refresh after move/reparent
- published-only visibility
- MCP response shape for TOC-first flow and per-document metadata fetch
- provider failure / fallback behavior for summary and keyword generation
