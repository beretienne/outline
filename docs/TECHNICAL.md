# Technical notes

## AI answers setting

The **AI answers** preference appears to be scaffolding rather than a complete implementation in this repository.

What exists in the public tree:

- `app/scenes/Settings/Features.tsx` exposes the setting, but the switch is rendered as disabled.
- `server/models/SearchQuery.ts` and `server/presenters/searchQuery.ts` support a stored `answer` field.
- `server/migrations/20231212011038-search-query-answer.js` adds the `search_queries.answer` column.
- `plugins/enterprise/client/translations.tsx` contains UI copy for AI-generated answers.

What is not present here:

- no server module that calls an LLM provider
- no search pipeline that generates and persists `SearchQuery.answer`
- no search UI component that renders an answer block
- no obvious OpenAI / Anthropic / prompt / retrieval implementation

The likely conclusion is that the open repository contains schema and UI placeholders, while the actual AI-answer implementation lives in a separate enterprise/private TypeScript module that is not included here.
