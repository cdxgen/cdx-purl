# Strict Checksum Mismatches

This file tracks fixture cases where `base` tests currently accept checksum qualifier inputs that violate strict checksum validation.

## Policy

- Checksum values use `algorithm:digest` entries, optionally comma-delimited.
- Algorithm is required for each entry.
- Digest must be hex and match the expected length for the algorithm.
- Current strict error codes:
  - `E_CHECKSUM_MISSING_ALGORITHM`
  - `E_CHECKSUM_INVALID_DIGEST_FOR_ALGORITHM`

## Mismatch Categories

1. Missing checksum algorithm (no `algorithm:` prefix)
2. Digest length mismatch for a known algorithm
3. Non-hex digest for a known algorithm

## Current Base Fixture Cases (5)

- `specification/tests/spec/specification-test.json` :: `build` :: Build with multiple checksum
- `specification/tests/spec/specification-test.json` :: `roundtrip` :: Roundtrip with multiple checksum
- `specification/tests/types/generic-test.json` :: `parse` :: Parse test for PURL type: generic
- `specification/tests/types/generic-test.json` :: `roundtrip` :: Roundtrip test for PURL type: generic
- `specification/tests/types/generic-test.json` :: `build` :: Build test for PURL type: generic

## Problematic Snippets and Suggested Diffs

### C01: short sha256 digest in generic type fixtures

Problematic snippet:

```json
"checksum": "sha256:de4d501267da"
```

Suggested diff (example replacement):

```diff
- "checksum": "sha256:de4d501267da"
+ "checksum": "sha256:de4d501267da000000000000000000000000000000000000000000000000"
```

### C02: short sha1/sha256 digests in spec checksum fixtures

Problematic snippet:

```json
"checksum": "sha1:ad9503c3e994a4f,sha256:41bf9088b3a1e6c1ef1d"
```

Suggested diff (example replacement):

```diff
- "checksum": "sha1:ad9503c3e994a4f,sha256:41bf9088b3a1e6c1ef1d"
+ "checksum": "sha1:ad9503c3e994a4f000000000000000000000000,sha256:41bf9088b3a1e6c1ef1d00000000000000000000000000000000000000000000"
```

## How to Recompute

```bash
pnpm test:base
```

The strict checksum mismatch detection logic is encoded in `test/fixtures-base.test.js` via:

- `hasInvalidChecksumQualifier()`
- `strictExpectedFailure()`
