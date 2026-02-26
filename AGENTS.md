# AGENTS.md

## Scope
This file defines non-negotiable engineering constraints and delivery criteria for this repository.

## Architecture Constraints
1. Content Persistence
- MUST persist all page content as Block JSON.
- MUST NOT use HTML as source-of-truth storage.
- SHOULD keep HTML as a derived render/export artifact only.

2. AI Editing Contract
- MUST accept AI edits only as partial patch operations (JSON ops).
- MUST NOT allow AI to rewrite full-page content in one response.
- MUST enforce patch scope to the user-selected block subtree only.

3. Undo / Reversibility
- MUST make every content change undoable.
- MUST implement at least an operation stack for Undo.
- MUST treat one AI patch response as one atomic undoable operation.

4. Self-Host Requirement
- MUST support self-host deployment via docker-compose.
- MUST support user-provided LLM settings: `api_key`, `base_url`, `model`.
- SHOULD avoid vendor lock-in in provider integration.

5. Publish Path (MVP)
- MUST ship MVP publish flow through static export.
- MUST generate `exports/<site>/index.html` and `exports/<site>/assets/`.
- SHOULD ensure exported files are directly hostable by Caddy/Nginx.

6. Tech Stack Baseline
- MUST prefer TypeScript across apps/packages.
- MUST use Next.js for frontend (`apps/web`).
- MUST use Node.js + Fastify for backend (`apps/api`).
- MUST use SQLite first, with Prisma as initial ORM.

## Task Completion Criteria
- MUST define and validate patch schema before applying any AI patch.
- MUST reject out-of-scope patch targets (outside selected subtree).
- MUST ensure Undo stack integration is covered in API/service contracts.
- MUST preserve static export directory contract exactly:
  - `exports/<site>/index.html`
  - `exports/<site>/assets/*`
- SHOULD keep dependencies minimal and avoid heavy external systems in MVP.
- SHOULD provide clear local run path (`pnpm`, `docker-compose`) without cloud-only assumptions.
- SHOULD keep package boundaries clean (`apps/*` for runtime, `packages/*` for shared domain logic).
