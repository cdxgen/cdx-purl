# cdx-purl

Strict, definition-driven package-url parser/builder for Node.js.

- Pure JavaScript
- No runtime dependencies
- ABNF-first strict parsing
- Type rules are generated from `specification/types/*-definition.json` into `generated/type-rules.js`
- Deterministic canonicalization and roundtrip behavior

[![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)](./AI-DECLARATION.md)

## Install

```bash
pnpm add @cdxgen/cdx-purl
```

```bash
npm install @cdxgen/cdx-purl
```

```bash
bun add @cdxgen/cdx-purl
```

```bash
deno add npm:@cdxgen/cdx-purl
```

## Quick start

```js
import {
  parse,
  build,
  roundTrip,
  Purl,
  NpmPurl,
  MavenPurl,
  TypedPurlBuilders,
  TypedPurls,
} from "@cdxgen/cdx-purl";

const parsed = parse("pkg:npm/%40angular/animation@12.3.1");
const built = build(parsed);
const canonical = roundTrip(built);

const npmPurl = NpmPurl.builder()
  .setScope("@angular")
  .setName("animation")
  .setVersion("12.3.1")
  .build()
  .toString();

const MavenBuilder = TypedPurlBuilders.maven;
const mvn = new MavenBuilder()
  .setNamespace("org.apache.commons")
  .setName("io")
  .buildString();

console.log(parsed, canonical, npmPurl, mvn, !!TypedPurls.swift);
```

## API

- `parse(input)` parse and validate strict ABNF + type rules
- `build(parts)` canonical build with strict validation
- `roundTrip(input)` parse then build canonical output
- `Purl` immutable strict value object
- `PurlBuilder` fluent generic builder
- `TypedPurlBuilders` generated builder classes keyed by type
- `TypedPurls` generated typed classes keyed by type
- `getTypedPurlBuilder(type)` and `getTypedPurlClass(type)` lookup helpers

Runtime note: `index.js` imports generated `TYPE_RULES_SOURCE` from `generated/type-rules.js`; it does not read `specification/types` JSON files at execution time.

All named typed exports (for example `NpmPurlBuilder`, `RpmPurl`, `VscodeExtensionPurlBuilder`) are concrete generated classes, not placeholders.

## Validation behavior (strict by design)

### Unknown qualifier keys are rejected

```js
import { build } from "@cdxgen/cdx-purl";

build({
  type: "maven",
  namespace: "org.apache.commons",
  name: "io",
  version: "1.3.4",
  qualifiers: { mykey: "value" }, // throws E_UNKNOWN_QUALIFIER
  subpath: null,
});
```

### Only explicitly allowed multivalue qualifiers are accepted

```js
import { build } from "@cdxgen/cdx-purl";

// throws E_MULTIVALUE_QUALIFIER
build({
  type: "maven",
  namespace: "org.apache.commons",
  name: "io",
  version: "1.3.4",
  qualifiers: { classifier: "sources,docs" },
  subpath: null,
});

// allowed: checksum supports comma-delimited values
build({
  type: "generic",
  namespace: null,
  name: "openssl",
  version: "1.1.1w",
  qualifiers: {
    checksum:
      "sha1:da39a3ee5e6b4b0d3255bfef95601890afd80709,sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  subpath: null,
});
```

### Checksum values are validated by algorithm

Checksum entries must use `algorithm:digest` form. The library validates each entry against an internal algorithm map and rejects digests that are missing an algorithm, non-hex, or wrong length for the selected algorithm.

```js
import { parse } from "@cdxgen/cdx-purl";

// success: valid lengths for each algorithm
parse(
  "pkg:generic/openssl@1.1.1w?checksum=" +
    "sha1:da39a3ee5e6b4b0d3255bfef95601890afd80709," +
    "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
);

// throws E_CHECKSUM_MISSING_ALGORITHM
parse("pkg:generic/openssl@1.1.1w?checksum=da39a3ee5e6b4b0d3255bfef95601890afd80709");

// throws E_CHECKSUM_INVALID_DIGEST_FOR_ALGORITHM (wrong length)
parse("pkg:generic/openssl@1.1.1w?checksum=sha256:abc123");

// throws E_CHECKSUM_INVALID_DIGEST_FOR_ALGORITHM (non-hex)
parse(
  "pkg:generic/openssl@1.1.1w?checksum=" +
    "sha1:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
);
```

### Type-specific required and prohibited fields are enforced

```js
import { build } from "@cdxgen/cdx-purl";

// swift namespace is required and must contain host/owner
build({
  type: "swift",
  namespace: null, // throws E_REQUIRED_COMPONENT / E_SWIFT_NAMESPACE
  name: "alamofire",
  version: null,
  qualifiers: null,
  subpath: null,
});
```

## Supported purl types

The library generates typed classes/builders for every type definition at generation time from `specification/types/*-definition.json`:

`alpm`, `apk`, `bazel`, `bitbucket`, `bitnami`, `cargo`, `chrome-extension`, `cocoapods`, `composer`, `conan`, `conda`, `cpan`, `cran`, `deb`, `docker`, `gem`, `generic`, `github`, `golang`, `hackage`, `hex`, `huggingface`, `julia`, `luarocks`, `maven`, `mlflow`, `npm`, `nuget`, `oci`, `opam`, `otp`, `pub`, `pypi`, `qpkg`, `rpm`, `swid`, `swift`, `vscode-extension`, `yocto`.

| Requirement area                                                   | Official spec source                                                                                      | What this library enforces                                                                         | Primary error codes                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Canonical type and qualifier key casing                            | `specification/purl-proposed-grammar.abnf` + type definitions                                             | Type and qualifier keys canonicalized to lowercase; deterministic qualifier ordering               | `E_INVALID_TYPE`, `E_INVALID_QUALIFIER_KEY`, `E_DUPLICATE_QUALIFIER`                                                       |
| ABNF strict parse rules                                            | `specification/purl-proposed-grammar.abnf`                                                                | Scheme must be `pkg`; strict separator usage; strict percent-encoding acceptance and decoding      | `E_INVALID_SCHEME`, `E_INVALID_QUALIFIERS`, `E_BAD_PERCENT_ENCODING`, `E_DISALLOWED_PERCENT_ENCODING`, `E_INVALID_SUBPATH` |
| Component requirements (`namespace`, `name`, `version`, `subpath`) | `specification/types/*-definition.json` (`*_definition.requirement`)                                      | Enforces required/prohibited/optional semantics per type                                           | `E_REQUIRED_COMPONENT`, `E_PROHIBITED_COMPONENT`, `E_MISSING_NAME`, `E_MISSING_VERSION`                                    |
| Character constraints and normalization                            | `specification/types/*-definition.json` (`permitted_characters`, `normalization_rules`, `case_sensitive`) | Applies case and normalization rules before validation and canonical build                         | `E_PERMITTED_CHARACTERS`, `E_INVALID_CHARACTER`                                                                            |
| Qualifier allow-list per type                                      | `specification/types/*-definition.json` (`qualifiers_definition`)                                         | Rejects unknown qualifier keys except global/spec-compat policy keys                               | `E_UNKNOWN_QUALIFIER`                                                                                                      |
| Qualifier value cardinality                                        | strict policy                                                                                             | Multi-value qualifiers rejected unless explicitly allowed (`checksum`)                             | `E_MULTIVALUE_QUALIFIER`, `E_INVALID_QUALIFIER_VALUE`, `E_CHECKSUM_MISSING_ALGORITHM`, `E_CHECKSUM_INVALID_DIGEST_FOR_ALGORITHM` |
| Required qualifiers                                                | `specification/types/*-definition.json` (`qualifiers_definition.requirement`)                             | Missing required qualifier is rejected in parse and build flows                                    | `E_REQUIRED_QUALIFIER`                                                                                                     |
| Type-specific semantic rules                                       | type specs and implementation policy                                                                      | CPAN uppercase author namespace and no `::` in distribution name; Swift host/owner namespace shape | `E_CPAN_NAMESPACE`, `E_CPAN_NAME`, `E_SWIFT_NAMESPACE`                                                                     |
| Typed class safety                                                 | generated type registry from definitions                                                                  | Type-locked parse for each typed class with mismatch detection                                     | `E_TYPE_MISMATCH`                                                                                                          |

### Normalization opcode model

Normalization rule free text from `specification/types/*-definition.json` is compiled into opcode arrays in `generated/type-rules.js`.
`index.js` applies these opcodes in order via `applyNormalizationRules(...)` and rejects unknown opcodes with `E_UNKNOWN_NORMALIZATION_OP`.

Current opcode semantics:

- `to_lowercase`: lowercase the full value.
- `apply_kebab_case`: collapse non-alphanumeric runs to `-` and trim outer dashes (preserves letter case).
- `replace_underscore_with_dash`: replace all `_` with `-`.
- `replace_dot_with_underscore`: replace all `.` with `_`.
- `replace_non_alnum_with_underscore`: lowercase then replace each non `[a-z0-9]` character with `_`.

Opcode precedence is resolved in the generator (`scripts/generate-type-rules.mjs`) so emitted arrays are deterministic across regeneration.
For conflicting rules, precedence is applied before runtime. Example for PyPI names:

1. `replace_dot_with_underscore`
2. `replace_underscore_with_dash`

This guarantees canonical idempotence for mixed forms like `A_B-C.D~x` -> `a-b-c-d~x`.

### Known normalization limitation

- `alpm.version` includes a normalization rule that references `vercmp(8)` semantics.
- This library currently keeps `alpm` support without applying that version normalization logic.
- Parsing and validation still run for `alpm`, but no additional `vercmp`-based rewrite is applied to version values.

## Test commands

```bash
pnpm test
pnpm test:base
pnpm test:typed
pnpm test:typed:all
pnpm test:mutation
pnpm test:fuzz
```

### Deterministic fuzz controls

```bash
PURL_FUZZ_SEED=1337
PURL_FUZZ_CASES=300
PURL_FUZZ_HOPS=10
PURL_FUZZ_MUTATION_CASES=200
PURL_TYPED_FUZZ_SEED=4242
PURL_TYPED_FUZZ_CASES=240
PURL_TYPED_FUZZ_HOPS=8
pnpm test:fuzz
```

Coverage includes:

- base fixture compatibility tests
- typed class and builder coverage across all registered types
- adversarial strict-policy tests
- mutation-driven negative tests generated from type definitions
- deterministic fuzz and mutation fuzz with reproducible seeds

## Support policy

- Runtime support: Node `>=20`, Bun `>=1.0.0`, Deno `>=1.40.0`
- CI test matrix (Node): `20.x`, `22.x`, `24.x`, `25.x`
- CI runtime smoke coverage: Bun and Deno
- Build and publish path: Node `24.x` with npm trusted publishing + provenance

## License

MIT License. See [LICENSE](./LICENSE) for details.
