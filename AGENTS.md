# Agent Operating Contract

This fork extends the official AEM CLI with DA-aware commands. Keep changes surgical and preserve the upstream `aem` and `hlx` compatibility surface unless a task explicitly asks for a breaking change.

## Content Bus vs Code Bus

- Authored EDS content belongs in DA source storage. Pages, nav, footer, and authored fragments should be created or updated through DA APIs, usually via `aem content seed`, `aem content clone`, `aem content add`, `aem content commit`, and `aem content push`.
- Git owns implementation assets: blocks, CSS, JavaScript, tools, media, config, tests, and documentation about the CLI itself.
- Do not add authored site pages as static HTML in an EDS repository unless the route is intentionally a Git-backed tool or asset.
- Use `aem route classify` and `aem route canonical` when ownership is unclear before editing.

## Remote Write Rules

- Prefer read-only commands first: `auth status`, `route classify`, `route canonical`, `preview status`, `index show`, `index validate`, `code status`, and content dry-runs.
- Commands that mutate remote systems must stay explicit. Preserve `--commit` or `--dry-run` behavior for content, publish, deploy, and code-bus operations.
- Never log bearer tokens. Use `aem auth login` locally and `--token` or `AEM_TOKEN` in automation.
- Keep `.hlx/.da-token.json` out of Git.

## Documentation Discovery

- `docs/cli-surface.json` is the machine-readable command inventory for the DA extension surface.
- Update `docs/cli-surface.json`, README command documentation, and any external docs site content when adding, renaming, or removing CLI commands.
- `test/cli-surface-docs.test.js` checks that the documented command inventory matches the registered CLI command tree.

## Verification

- Run `npm run lint` for documentation or small code changes.
- Run `npx mocha test/cli-surface-docs.test.js` after command-surface changes; the package-level `npm test` command enforces global coverage and is better suited to the full suite.
- Run `npm run check` before handoff when behavior changes are broader than docs or command registration.
