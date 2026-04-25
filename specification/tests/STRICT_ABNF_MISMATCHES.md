# Strict ABNF Mismatches

This file tracks fixture cases where `base` tests currently accept inputs that violate strict ABNF encoding rules from `specification/purl-proposed-grammar.abnf`.

## Policy

- Source of truth: `specification/purl-proposed-grammar.abnf`
- Strict mode requires separators inside qualifier/subpath values to be percent-encoded.
- Our test harness in `test/fixtures-base.test.js` marks these as expected strict failures.

## Mismatch Categories

1. Raw `/`, `+` or `\` inside qualifier values (must be percent-encoded)
2. Raw `+` or `\` inside subpath segments (must be percent-encoded)
3. Qualifier keys not explicitly allowed by type/global spec policy
4. Multi-value qualifier values where the key is not explicitly multi-value

## Current Base Fixture Cases (35)

The entries below are grouped by unique mismatch pattern. Each case points to a snippet id (`Mxx`) with a concrete ABNF-safe replacement.

- `[M01]` `specification/tests/types/bazel-test.json` :: `roundtrip` :: bazel module with default registry
- `[M01]` `specification/tests/types/bazel-test.json` :: `parse` :: bazel module with default registry
- `[M02]` `specification/tests/types/bazel-test.json` :: `parse` :: bazel module with custom registry
- `[M03]` `specification/tests/types/cocoapods-test.json` :: `parse` :: Parse test for PURL type: cocoapods
- `[M04]` `specification/tests/types/generic-test.json` :: `parse` :: Parse test for PURL type: generic
- `[M04]` `specification/tests/types/generic-test.json` :: `roundtrip` :: Roundtrip test for PURL type: generic
- `[M05]` `specification/tests/types/generic-test.json` :: `parse` :: Parse test for PURL type: generic
- `[M05]` `specification/tests/types/generic-test.json` :: `roundtrip` :: Roundtrip test for PURL type: generic
- `[M06]` `specification/tests/types/hex-test.json` :: `parse` :: Parse test for PURL type: hex
- `[M06]` `specification/tests/types/hex-test.json` :: `roundtrip` :: Roundtrip test for PURL type: hex
- `[M07]` `specification/tests/types/huggingface-test.json` :: `parse` :: Hugging Face model with staging endpoint
- `[M07]` `specification/tests/types/huggingface-test.json` :: `roundtrip` :: Hugging Face model with staging endpoint. Roundtrip a canonical input to canonical output.
- `[M07]` `specification/tests/types/huggingface-test.json` :: `parse` :: Parse test for PURL type: huggingface
- `[M07]` `specification/tests/types/huggingface-test.json` :: `roundtrip` :: Roundtrip test for PURL type: huggingface
- `[M08]` `specification/tests/types/julia-test.json` :: `parse` :: valid julia purl with both uuid and repository_url qualifiers
- `[M09]` `specification/tests/types/luarocks-test.json` :: `parse` :: Parse test for PURL type: luarocks
- `[M09]` `specification/tests/types/luarocks-test.json` :: `roundtrip` :: Roundtrip test for PURL type: luarocks
- `[M10]` `specification/tests/types/maven-test.json` :: `roundtrip` :: maven often uses qualifiers. Roundtrip a canonical input to canonical output.
- `[M11]` `specification/tests/types/maven-test.json` :: `parse` :: maven pom reference
- `[M12]` `specification/tests/types/maven-test.json` :: `roundtrip` :: maven pom reference. Roundtrip a canonical input to canonical output.
- `[M13]` `specification/tests/types/maven-test.json` :: `parse` :: Parse test for PURL type: maven
- `[M13]` `specification/tests/types/maven-test.json` :: `roundtrip` :: Roundtrip test for PURL type: maven
- `[M14]` `specification/tests/types/mlflow-test.json` :: `parse` :: MLflow model tracked in Azure Databricks (case insensitive)
- `[M15]` `specification/tests/types/mlflow-test.json` :: `roundtrip` :: MLflow model tracked in Azure Databricks (case insensitive). Roundtrip a canonical input to canonical output.
- `[M16]` `specification/tests/types/mlflow-test.json` :: `parse` :: MLflow model tracked in Azure ML (case sensitive)
- `[M16]` `specification/tests/types/mlflow-test.json` :: `roundtrip` :: MLflow model tracked in Azure ML (case sensitive). Roundtrip a canonical input to canonical output.
- `[M18]` `specification/tests/types/mlflow-test.json` :: `parse` :: MLflow model with unique identifiers
- `[M19]` `specification/tests/types/mlflow-test.json` :: `roundtrip` :: MLflow model with unique identifiers. Roundtrip a canonical input to canonical output.
- `[M17]` `specification/tests/types/mlflow-test.json` :: `parse` :: Parse test for PURL type: mlflow
- `[M17]` `specification/tests/types/mlflow-test.json` :: `roundtrip` :: Roundtrip test for PURL type: mlflow
- `[M18]` `specification/tests/types/mlflow-test.json` :: `parse` :: Parse test for PURL type: mlflow
- `[M20]` `specification/tests/types/mlflow-test.json` :: `roundtrip` :: Roundtrip test for PURL type: mlflow
- `[M21]` `specification/tests/types/npm-test.json` :: `parse` :: Parse test for PURL type: npm
- `[M21]` `specification/tests/types/npm-test.json` :: `roundtrip` :: Roundtrip test for PURL type: npm
- `[M22]` `specification/tests/types/otp-test.json` :: `roundtrip` :: Roundtrip test for <class 'type'> PURL

### Problematic Snippets and Suggested ABNF Diffs

`M01` (raw `/` in qualifier value)

```json
"input": "pkg:bazel/rules_java@7.8.0?repository_url=https://bcr.bazel.build/"
```

```diff
- "input": "pkg:bazel/rules_java@7.8.0?repository_url=https://bcr.bazel.build/"
+ "input": "pkg:bazel/rules_java@7.8.0?repository_url=https:%2F%2Fbcr.bazel.build%2F"
```

`M02` (raw `/` in qualifier value)

```json
"input": "pkg:bazel/rules_java@7.8.0?repository_url=https://example.org/bazel-registry/"
```

```diff
- "input": "pkg:bazel/rules_java@7.8.0?repository_url=https://example.org/bazel-registry/"
+ "input": "pkg:bazel/rules_java@7.8.0?repository_url=https:%2F%2Fexample.org%2Fbazel-registry%2F"
```

`M03` (raw `+` in subpath)

```json
"input": "pkg:cocoapods/GoogleUtilities@7.5.2#NSData+zlib"
```

```diff
- "input": "pkg:cocoapods/GoogleUtilities@7.5.2#NSData+zlib"
+ "input": "pkg:cocoapods/GoogleUtilities@7.5.2#NSData%2Bzlib"
```

`M04` (raw `/` in qualifier value)

```json
"input": "pkg:generic/openssl@1.1.10g?download_url=https://openssl.org/source/openssl-1.1.0g.tar.gz&checksum=sha256:de4d501267da"
```

```diff
- "input": "pkg:generic/openssl@1.1.10g?download_url=https://openssl.org/source/openssl-1.1.0g.tar.gz&checksum=sha256:de4d501267da"
+ "input": "pkg:generic/openssl@1.1.10g?download_url=https:%2F%2Fopenssl.org%2Fsource%2Fopenssl-1.1.0g.tar.gz&checksum=sha256:de4d501267da"
```

`M05` (raw `/` in qualifier value)

```json
"input": "pkg:generic/bitwarderl?vcs_url=git%2Bhttps://git.fsfe.org/dxtr/bitwarderl%40cc55108da32"
```

```diff
- "input": "pkg:generic/bitwarderl?vcs_url=git%2Bhttps://git.fsfe.org/dxtr/bitwarderl%40cc55108da32"
+ "input": "pkg:generic/bitwarderl?vcs_url=git%2Bhttps:%2F%2Fgit.fsfe.org%2Fdxtr%2Fbitwarderl%40cc55108da32"
```

`M06` (raw `/` in qualifier value)

```json
"input": "pkg:hex/bar@1.2.3?repository_url=https://myrepo.example.com"
```

```diff
- "input": "pkg:hex/bar@1.2.3?repository_url=https://myrepo.example.com"
+ "input": "pkg:hex/bar@1.2.3?repository_url=https:%2F%2Fmyrepo.example.com"
```

`M07` (raw `/` in qualifier value)

```json
"input": "pkg:huggingface/microsoft/deberta-v3-base@559062ad13d311b87b2c455e67dcd5f1c8f65111?repository_url=https://hub-ci.huggingface.co"
```

```diff
- "input": "pkg:huggingface/microsoft/deberta-v3-base@559062ad13d311b87b2c455e67dcd5f1c8f65111?repository_url=https://hub-ci.huggingface.co"
+ "input": "pkg:huggingface/microsoft/deberta-v3-base@559062ad13d311b87b2c455e67dcd5f1c8f65111?repository_url=https:%2F%2Fhub-ci.huggingface.co"
```

`M08` (raw `/` in qualifier value)

```json
"input": "pkg:julia/RegisterQD@0.3.1?repository_url=https://github.com/HolyLab/HolyLabRegistry&uuid=ac24ea0c-1830-11e9-18d4-81f172323054"
```

```diff
- "input": "pkg:julia/RegisterQD@0.3.1?repository_url=https://github.com/HolyLab/HolyLabRegistry&uuid=ac24ea0c-1830-11e9-18d4-81f172323054"
+ "input": "pkg:julia/RegisterQD@0.3.1?repository_url=https:%2F%2Fgithub.com%2FHolyLab%2FHolyLabRegistry&uuid=ac24ea0c-1830-11e9-18d4-81f172323054"
```

`M09` (raw `/` in qualifier value)

```json
"input": "pkg:luarocks/username/packagename@0.1.0-1?repository_url=https://example.com/private_rocks_server/"
```

```diff
- "input": "pkg:luarocks/username/packagename@0.1.0-1?repository_url=https://example.com/private_rocks_server/"
+ "input": "pkg:luarocks/username/packagename@0.1.0-1?repository_url=https:%2F%2Fexample.com%2Fprivate_rocks_server%2F"
```

`M10` (raw `/` in qualifier value)

```json
"input": "pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?classifier=sources&repository_url=repo.spring.io/release"
```

```diff
- "input": "pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?classifier=sources&repository_url=repo.spring.io/release"
+ "input": "pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?classifier=sources&repository_url=repo.spring.io%2Frelease"
```

`M11` (raw `/` in qualifier value)

```json
"input": "pkg:Maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=pom&repositorY_url=repo.spring.io/release"
```

```diff
- "input": "pkg:Maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=pom&repositorY_url=repo.spring.io/release"
+ "input": "pkg:Maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=pom&repositorY_url=repo.spring.io%2Frelease"
```

`M12` (raw `/` in qualifier value)

```json
"input": "pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=war&repository_url=https://repo.spring.io/release"
```

```diff
- "input": "pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=war&repository_url=https://repo.spring.io/release"
+ "input": "pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=war&repository_url=https:%2F%2Frepo.spring.io%2Frelease"
```

`M13` (raw `/` in qualifier value)

```json
"input": "pkg:maven/groovy/groovy@1.0?repository_url=https://maven.google.com"
```

```diff
- "input": "pkg:maven/groovy/groovy@1.0?repository_url=https://maven.google.com"
+ "input": "pkg:maven/groovy/groovy@1.0?repository_url=https:%2F%2Fmaven.google.com"
```

`M14` (raw `/` in qualifier value)

```json
"input": "pkg:mlflow/CreditFraud@3?repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
```

```diff
- "input": "pkg:mlflow/CreditFraud@3?repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
+ "input": "pkg:mlflow/CreditFraud@3?repository_url=https:%2F%2Fadb-5245952564735461.0.azuredatabricks.net%2Fapi%2F2.0%2Fmlflow"
```

`M15` (raw `/` in qualifier value)

```json
"input": "pkg:mlflow/creditfraud@3?repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
```

```diff
- "input": "pkg:mlflow/creditfraud@3?repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
+ "input": "pkg:mlflow/creditfraud@3?repository_url=https:%2F%2Fadb-5245952564735461.0.azuredatabricks.net%2Fapi%2F2.0%2Fmlflow"
```

`M16` (raw `/` in qualifier value)

```json
"input": "pkg:mlflow/CreditFraud@3?repository_url=https://westus2.api.azureml.ms/mlflow/v1.0/subscriptions/a50f2011-fab8-4164-af23-c62881ef8c95/resourceGroups/TestResourceGroup/providers/Microsoft.MachineLearningServices/workspaces/TestWorkspace"
```

```diff
- "input": "pkg:mlflow/CreditFraud@3?repository_url=https://westus2.api.azureml.ms/mlflow/v1.0/subscriptions/a50f2011-fab8-4164-af23-c62881ef8c95/resourceGroups/TestResourceGroup/providers/Microsoft.MachineLearningServices/workspaces/TestWorkspace"
+ "input": "pkg:mlflow/CreditFraud@3?repository_url=https:%2F%2Fwestus2.api.azureml.ms%2Fmlflow%2Fv1.0%2Fsubscriptions%2Fa50f2011-fab8-4164-af23-c62881ef8c95%2FresourceGroups%2FTestResourceGroup%2Fproviders%2FMicrosoft.MachineLearningServices%2Fworkspaces%2FTestWorkspace"
```

`M17` (raw `/` in qualifier value)

```json
"input": "pkg:mlflow/creditfraud@3?repository_url=https://westus2.api.azureml.ms/mlflow/v1.0/subscriptions/a50f2011-fab8-4164-af23-c62881ef8c95/resourceGroups/TestResourceGroup/providers/Microsoft.MachineLearningServices/workspaces/TestWorkspace"
```

```diff
- "input": "pkg:mlflow/creditfraud@3?repository_url=https://westus2.api.azureml.ms/mlflow/v1.0/subscriptions/a50f2011-fab8-4164-af23-c62881ef8c95/resourceGroups/TestResourceGroup/providers/Microsoft.MachineLearningServices/workspaces/TestWorkspace"
+ "input": "pkg:mlflow/creditfraud@3?repository_url=https:%2F%2Fwestus2.api.azureml.ms%2Fmlflow%2Fv1.0%2Fsubscriptions%2Fa50f2011-fab8-4164-af23-c62881ef8c95%2FresourceGroups%2FTestResourceGroup%2Fproviders%2FMicrosoft.MachineLearningServices%2Fworkspaces%2FTestWorkspace"
```

`M18` (raw `/` in qualifier value)

```json
"input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a&repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
```

```diff
- "input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a&repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
+ "input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a&repository_url=https:%2F%2Fadb-5245952564735461.0.azuredatabricks.net%2Fapi%2F2.0%2Fmlflow"
```

`M19` (raw `/` in qualifier value)

```json
"input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a"
```

```diff
- "input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a"
+ "input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&repository_url=https:%2F%2Fadb-5245952564735461.0.azuredatabricks.net%2Fapi%2F2.0%2Fmlflow&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a"
```

`M20` (raw `/` in qualifier value)

```json
"input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a&repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
```

```diff
- "input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a&repository_url=https://adb-5245952564735461.0.azuredatabricks.net/api/2.0/mlflow"
+ "input": "pkg:mlflow/trafficsigns@10?model_uuid=36233173b22f4c89b451f1228d700d49&run_id=410a3121-2709-4f88-98dd-dba0ef056b0a&repository_url=https:%2F%2Fadb-5245952564735461.0.azuredatabricks.net%2Fapi%2F2.0%2Fmlflow"
```

`M21` (raw `/` in qualifier value)

```json
"input": "pkg:npm/mypackage@12.4.5?vcs_url=git://host.com/path/to/repo.git%404345abcd34343"
```

```diff
- "input": "pkg:npm/mypackage@12.4.5?vcs_url=git://host.com/path/to/repo.git%404345abcd34343"
+ "input": "pkg:npm/mypackage@12.4.5?vcs_url=git:%2F%2Fhost.com%2Fpath%2Fto%2Frepo.git%404345abcd34343"
```

`M22` (raw `/` in qualifier values)

```json
"input": "pkg:otp/asn1@5.4.1?arch=amd64&platform=linux&repository_url=https://github.com/erlang/otp&vcs_url=git%2Bhttps://github.com/erlang/otp.git#src/asn1ct.erl"
```

```diff
- "input": "pkg:otp/asn1@5.4.1?arch=amd64&platform=linux&repository_url=https://github.com/erlang/otp&vcs_url=git%2Bhttps://github.com/erlang/otp.git#src/asn1ct.erl"
+ "input": "pkg:otp/asn1@5.4.1?arch=amd64&platform=linux&repository_url=https:%2F%2Fgithub.com%2Ferlang%2Fotp&vcs_url=git%2Bhttps:%2F%2Fgithub.com%2Ferlang%2Fotp.git#src/asn1ct.erl"
```

## How to Recompute

```bash
cd /Users/prabhu/work/cdxgen/cdx-purl
pnpm test
```

The strict mismatch detection logic is encoded in `test/fixtures-base.test.js` via:

- `hasStrictQualifierViolation()`
- `hasStrictSubpathViolation()`
- `hasUnknownQualifierViolation()`
- `hasDisallowedMultivalueQualifier()`
- `strictExpectedFailure()`
