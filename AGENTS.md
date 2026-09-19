# Codex project working rules

## Default analysis scope

- By default, read and search project source, configuration, and tests only. Relevant locations include `app/`, `components/`, `data/`, `db/`, `drizzle/`, `hooks/`, `lib/`, `public/`, `scripts/`, `tests/`, and necessary root configuration files.
- Prefer targeted searches within those locations. Do not recursively scan or use generated output as general project context.

## Generated, dependency, cache, and runtime directories

- By default, exclude `node_modules/`, `.next/`, `.pnpm-store/`, `.vinext/`, `.wrangler/`, `.sites-runtime/`, `dist/`, `out/`, `coverage/`, and other generated, cache, or runtime output from recursive reads and searches.
- Treat the repository's tracked `build/` directory as project tooling source, not generated output. Read it only when the task concerns the build or Sites/Vite integration; do not broadly scan it by default.
- Tests, builds, and development servers may create required generated output. After the command completes, do not treat that output as primary context for subsequent code analysis.

## Dependency investigation

- Do not treat `node_modules/` as permanently forbidden. Inspect it only when confirming a third-party implementation, resolving types that project source cannot clarify, diagnosing a dependency-specific bug, or when the user explicitly requests dependency inspection.
- For ordinary dependency questions, inspect `package.json`, the lockfile, project imports, and—when necessary—official type definitions or documentation before reading installed package internals.

## Environment files and secrets

- Do not read, print, or report actual values from `.env.local` or other secret-bearing environment files.
- When required, verify only whether expected environment variable names are present, without exposing their values.
