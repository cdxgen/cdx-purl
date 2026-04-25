# cdx-purl

Strict, definition-driven package-url parser/builder for Node.js.

- Pure JavaScript
- No runtime dependencies
- ABNF-first strict parsing
- Type rules loaded from `specification/types/*-definition.json`
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
  qualifiers: { checksum: "sha1:aaa,sha256:bbb" },
  subpath: null,
});
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

The library generates typed classes/builders for every type definition under `specification/types/*-definition.json`:

`alpm`, `apk`, `bazel`, `bitbucket`, `bitnami`, `cargo`, `chrome-extension`, `cocoapods`, `composer`, `conan`, `conda`, `cpan`, `cran`, `deb`, `docker`, `gem`, `generic`, `github`, `golang`, `hackage`, `hex`, `huggingface`, `julia`, `luarocks`, `maven`, `mlflow`, `npm`, `nuget`, `oci`, `opam`, `otp`, `pub`, `pypi`, `qpkg`, `rpm`, `swid`, `swift`, `vscode-extension`, `yocto`.

| Requirement area                                                   | Official spec source                                                                                      | What this library enforces                                                                         | Primary error codes                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Canonical type and qualifier key casing                            | `specification/purl-proposed-grammar.abnf` + type definitions                                             | Type and qualifier keys canonicalized to lowercase; deterministic qualifier ordering               | `E_INVALID_TYPE`, `E_INVALID_QUALIFIER_KEY`, `E_DUPLICATE_QUALIFIER`                                                       |
| ABNF strict parse rules                                            | `specification/purl-proposed-grammar.abnf`                                                                | Scheme must be `pkg`; strict separator usage; strict percent-encoding acceptance and decoding      | `E_INVALID_SCHEME`, `E_INVALID_QUALIFIERS`, `E_BAD_PERCENT_ENCODING`, `E_DISALLOWED_PERCENT_ENCODING`, `E_INVALID_SUBPATH` |
| Component requirements (`namespace`, `name`, `version`, `subpath`) | `specification/types/*-definition.json` (`*_definition.requirement`)                                      | Enforces required/prohibited/optional semantics per type                                           | `E_REQUIRED_COMPONENT`, `E_PROHIBITED_COMPONENT`, `E_MISSING_NAME`, `E_MISSING_VERSION`                                    |
| Character constraints and normalization                            | `specification/types/*-definition.json` (`permitted_characters`, `normalization_rules`, `case_sensitive`) | Applies case and normalization rules before validation and canonical build                         | `E_PERMITTED_CHARACTERS`, `E_INVALID_CHARACTER`                                                                            |
| Qualifier allow-list per type                                      | `specification/types/*-definition.json` (`qualifiers_definition`)                                         | Rejects unknown qualifier keys except global/spec-compat policy keys                               | `E_UNKNOWN_QUALIFIER`                                                                                                      |
| Qualifier value cardinality                                        | strict policy                                                                                             | Multi-value qualifiers rejected unless explicitly allowed (`checksum`)                             | `E_MULTIVALUE_QUALIFIER`, `E_INVALID_QUALIFIER_VALUE`                                                                      |
| Required qualifiers                                                | `specification/types/*-definition.json` (`qualifiers_definition.requirement`)                             | Missing required qualifier is rejected in parse and build flows                                    | `E_REQUIRED_QUALIFIER`                                                                                                     |
| Type-specific semantic rules                                       | type specs and implementation policy                                                                      | CPAN uppercase author namespace and no `::` in distribution name; Swift host/owner namespace shape | `E_CPAN_NAMESPACE`, `E_CPAN_NAME`, `E_SWIFT_NAMESPACE`                                                                     |
| Typed class safety                                                 | generated type registry from definitions                                                                  | Type-locked parse for each typed class with mismatch detection                                     | `E_TYPE_MISMATCH`                                                                                                          |

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
