## Project&Packages Managing

- **Always** initialize projects via CLI scaffolding tools — never hand-write manifest/config files like `package.json`, `pyproject.toml`, etc.
- Use the idiomatic initializer for the ecosystem:
  - **Node.js / TS**: `pnpm dlx create next-app@latest`, `pnpm create vite`, `pnpm init`, etc.
  - **Python**: `uv init`, 'uv add' etc.
- After scaffolding, modify generated files only when necessary (add deps via `pnpm add`, `uv add`, etc. — not by editing manifests by hand).

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues and are managed with `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

## Architecture

Before writing code, read `docs/architecture.md`. It is the binding blueprint for module layout, dependency rules, the request lifecycle, data access, synchronisation, background jobs, and the web client, and it includes the definition of done for every ticket. If your change needs a different structure, update that document in the same pull request and explain why; do not silently diverge from it.
