# AGENTS.md

Guidance for AI/code agents working in `cdx-purl`.

## Project goals

- Implement a strict, highly spec-compliant package-url library in pure JavaScript.
- Source of truth order:
  1. `specification/purl-proposed-grammar.abnf`
  2. `specification/types/*-definition.json`
  3. `specification/tests/**/*-test.json`
- Runtime dependencies are not allowed.
- Tests should use Node built-ins (`node:test`, `node:assert`).

## Current architecture

- Core implementation: `index.js`
  - `parse`
  - `build`
  - `roundTrip`
  - `Purl`, `PurlBuilder`
  - generated type registries: `TypedPurlBuilders`, `TypedPurls`
- Definition-driven type rules are loaded from `specification/types`.
- Strict ABNF mismatch ledger: `specification/tests/STRICT_ABNF_MISMATCHES.md`.

## Phase policy

- Phase 1: strict parser/build + canonical roundtrip + fixture coverage.
- Phase 2: advanced type-specific validation and normalization.
  - Reject unknown qualifier keys unless explicitly allowed by spec policy.
  - Reject multi-value qualifiers unless explicitly allowed.
  - Enforce type requirement/prohibited rules for namespace/version/subpath/qualifiers.

## Required workflow for code changes

1. Update implementation in `index.js` (or split modules if needed).
2. If `specification/types/*-definition.json` changes, regenerate `generated/type-rules.js`.
3. Add/update tests under `test/`.
4. Run tests before finalizing.
5. If spec/tests mismatch is discovered, add/update `specification/tests/STRICT_ABNF_MISMATCHES.md` and note it clearly.

Regenerate command:

```bash
node scripts/generate-type-rules.mjs
```

## Test commands

```bash
node scripts/check-generated-type-rules.mjs
pnpm test
pnpm test:base
pnpm test:typed
pnpm test:fuzz
```

Deterministic fuzz controls:

```bash
PURL_FUZZ_SEED=1337 PURL_FUZZ_CASES=300 PURL_FUZZ_HOPS=10 PURL_FUZZ_MUTATION_CASES=200 pnpm test:fuzz
```

## Qualifier policy audit

- Use `scripts/dump-qualifier-policy.mjs` to dump the effective qualifier allow-list per type.
- The output is deterministic JSON keyed by purl type with sorted qualifier keys.

```bash
node scripts/dump-qualifier-policy.mjs
```

## Qualifier compatibility overrides

- `index.js` contains `COMPAT_QUALIFIER_OVERRIDES_BY_TYPE` for strict-policy compatibility exceptions that are merged into `QUALIFIER_POLICY_BY_TYPE`.
- These are not a replacement for `specification/types/*-definition.json`; they are a narrow shim for known ecosystem cases.
- Current overrides are intentionally limited to `conan`, `deb`, and `rpm`.
- If this map changes, also update qualifier-policy tests and re-run `node scripts/dump-qualifier-policy.mjs`.

## Coding rules

- Keep ASCII unless file already requires Unicode.
- Prefer deterministic behavior over heuristic tolerance.
- Avoid silent repairs in strict mode.
- Preserve backward-compatible exports where practical.
- Add concise comments only where logic is non-obvious.

## When unsure

- Do not guess spec semantics.
- Raise a clear question and cite exact file/test case lines.
