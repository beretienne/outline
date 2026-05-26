# Outline repository instructions

## Build, dev, lint, and test commands

- Use **Yarn 4** (`packageManager: yarn@4.11.0`) and a supported Node version from `package.json` (`>=20.12 <21 || 22 || 24`).
- Local development:
  - `make up` starts Redis/Postgres, installs local SSL certs, installs dependencies, and runs `yarn dev:watch`.
  - `yarn dev:watch` runs the backend watcher plus the Vite frontend.
  - `yarn dev:backend` watches `server/`, `shared/`, and `plugins/` and rebuilds the backend.
- Build:
  - `yarn build` runs the Vite app build, extracts i18n strings, and transpiles `server/`, `shared/`, and plugin server code into `build/`.
- Lint / format:
  - `yarn lint`
  - `yarn format:check`
  - `yarn format`
- Tests:
  - `make test` provisions the test Postgres database, runs migrations, then runs the full suite.
  - `make watch` provisions the test database and starts Vitest in watch mode.
  - `yarn test` runs all Vitest projects.
  - `yarn test:server`, `yarn test:app`, `yarn test:shared` run project-specific suites.
  - `yarn test path/to/file.test.ts` runs a single test file.
  - `yarn test:server path/to/file.test.ts` or `yarn test:app path/to/file.test.ts` scopes a single file to one project.

## High-level architecture

- This is a TypeScript monorepo with four main code areas:
  - `app/`: the React web client. `app/index.tsx` creates one MobX `RootStore`, loads client plugins immediately, and renders lazy-loaded route trees/scenes.
  - `server/`: the Koa backend. `server/index.ts` starts one process host and enables named services from `server/services/` (`web`, `websockets`, `collaboration`, `worker`, `cron`, `admin`) based on `env.SERVICES`.
  - `shared/`: shared editor, utilities, validations, and types used by both app and server.
  - `plugins/`: first-class extension points used on both client and server.
- The `web` service mounts the main HTTP surfaces: `/api`, `/auth`, `/oauth`, `/mcp`, plus the app routes.
- Real-time behavior is split across two systems:
  - collaborative editing uses Yjs + Hocuspocus over `/collaboration`
  - non-editor realtime events use Socket.IO over `/realtime`
- The build is intentionally split:
  - frontend assets are built by Vite
  - `build.js` transpiles `server/`, `shared/`, and plugin server code with Babel into `build/`
  - `build:i18n` extracts translation strings from `shared/`, `app/`, `server/`, and `plugins/`
- Plugins are loaded dynamically on both sides:
  - client plugins are discovered with `import.meta.glob("../../plugins/*/client/index.{ts,js,tsx,jsx}")`
  - server plugins are loaded from built `plugins/*/server` files and can register hooks for API routes, auth providers, search providers, tasks, unfurls, email templates, and more

## Key conventions

- Use the repo path aliases consistently: `~/*` for `app`, `@server/*` for `server`, `@shared/*` for `shared`, and `plugins/*` for plugins.
- Keep tests colocated with the code as `*.test.ts` / `*.test.tsx`. Vitest chooses behavior by path: `server/**` runs in Node, `app/**` runs in jsdom, and `shared/**` runs in both `shared-node` and `shared-jsdom`.
- Frontend state is MobX-store driven. Prefer putting business logic in stores/models and keeping route-level UI in `app/scenes/` and shared UI in `app/components/`.
- Most backend API endpoints are RPC-style route names mounted under `/api` (for example `documents.list`, `auth.info`) rather than RESTful resource paths.
- Keep API routes thin. The common pattern is:
  - middleware such as `auth()`, `validate(schema)`, `pagination()`, `transaction()`
  - authorization through `authorize` / `can` policies
  - multi-model or write-heavy logic in `server/commands/*`
  - response shaping through `server/presenters/*` instead of returning raw Sequelize models
- When changing editor or collaboration behavior, inspect both client and server paths. The client editor uses shared editor code plus `MultiplayerEditor` / `Multiplayer` extensions, while the server collaboration service enforces authentication, persistence, metrics, and editor-version compatibility.
- Prefer the existing plugin hook system before adding special cases. Check the `Hook` enums and plugin managers in both `app/utils/PluginManager.ts` and `server/utils/PluginManager.ts` when a feature looks extensible.
- Do not edit locale files by hand for normal UI copy changes. Translation strings are extracted from source during `yarn build:i18n`.
- In ProseMirror `toDOM` code or any raw DOM attribute generation from user content, always pass user-controlled `href` / `src` values through `sanitizeUrl()`.
