import assert from "node:assert/strict";
import test from "node:test";

import { build, getAllowedQualifierKeysForType, parse } from "../index.js";

// The purl types whose packages come from an OS distribution, and which
// therefore carry a distro release. `swid` and `oci` are excluded: the first
// requires its own qualifiers and the second prohibits a namespace, so neither
// participates in this shape.
const OS_TYPES = ["alpm", "apk", "deb", "qpkg", "rpm"];

const BASELINE = Object.freeze({
  alpm: { namespace: "arch", name: "pacman", version: "6.0.1-1" },
  apk: { namespace: "alpine", name: "curl", version: "7.83.0-r0" },
  deb: { namespace: "debian", name: "curl", version: "7.88.1-10" },
  qpkg: { namespace: "blackberry", name: "com.qnx.sdp", version: "7.0.0" },
  rpm: { namespace: "fedora", name: "curl", version: "7.76.1-26" }
});

test("OS types accept the distro and distro_name release qualifiers", () => {
  for (const type of OS_TYPES) {
    for (const key of ["distro", "distro_name"]) {
      const built = build({
        type,
        ...BASELINE[type],
        qualifiers: { [key]: "bookworm" }
      });
      assert.equal(
        parse(built).qualifiers?.[key],
        "bookworm",
        `${type} must round-trip the ${key} qualifier`
      );
    }
  }
});

test("OS types accept distro and distro_name together, alongside arch", () => {
  const built = build({
    type: "deb",
    ...BASELINE.deb,
    qualifiers: { arch: "arm64", distro: "debian-12", distro_name: "bookworm" }
  });
  assert.equal(
    built,
    "pkg:deb/debian/curl@7.88.1-10?arch=arm64&distro=debian-12&distro_name=bookworm"
  );
  const parsed = parse(built);
  assert.equal(parsed.qualifiers.arch, "arm64");
  assert.equal(parsed.qualifiers.distro, "debian-12");
  assert.equal(parsed.qualifiers.distro_name, "bookworm");
});

test("a deb epoch round-trips both in the version and as a qualifier", () => {
  // The deb type definition carries this example, with the epoch inside the
  // version: dpkg presents one version string. rpm is the other way round, its
  // version being the version-release pair with the epoch in a qualifier.
  const specExample = build({
    type: "deb",
    namespace: "debian",
    name: "attr",
    version: "1:2.4.47-2",
    qualifiers: { arch: "source" }
  });
  assert.equal(specExample, "pkg:deb/debian/attr@1:2.4.47-2?arch=source");
  assert.equal(parse(specExample).version, "1:2.4.47-2");

  // Producers repeat the epoch as a qualifier. The repetition adds nothing, but
  // rejecting it would change the identity of every epoched package.
  for (const type of ["deb", "alpm", "rpm"]) {
    const built = build({
      type,
      ...BASELINE[type],
      qualifiers: { epoch: "1" }
    });
    assert.equal(parse(built).qualifiers.epoch, "1", `${type} must round-trip an epoch qualifier`);
  }
  assert.equal(
    parse(
      build({
        type: "deb",
        namespace: "debian",
        name: "bsdutils",
        version: "1:2.38.1-5+deb12u3",
        qualifiers: { arch: "arm64", distro: "debian-12", distro_name: "bookworm", epoch: "1" }
      })
    ).version,
    "1:2.38.1-5+deb12u3"
  );
});

test("the release qualifiers are not admitted for unrelated types", () => {
  for (const type of ["npm", "maven", "pypi", "cargo"]) {
    for (const key of ["distro", "distro_name"]) {
      assert.ok(
        !getAllowedQualifierKeysForType(type)?.has(key),
        `${key} must not be allowed for ${type}`
      );
    }
  }
  assert.throws(
    () => build({ type: "npm", name: "left-pad", version: "1.3.0", qualifiers: { distro_name: "bookworm" } }),
    (error) => error?.code === "E_UNKNOWN_QUALIFIER"
  );
});

test("file_name is accepted for every type, as a documented common qualifier", () => {
  for (const type of OS_TYPES.concat(["npm", "maven", "generic"])) {
    assert.ok(
      getAllowedQualifierKeysForType(type)?.has("file_name"),
      `file_name must be allowed for ${type}`
    );
  }
  const built = build({
    type: "deb",
    ...BASELINE.deb,
    qualifiers: { file_name: "curl_7.88.1-10_arm64.deb" }
  });
  assert.equal(parse(built).qualifiers.file_name, "curl_7.88.1-10_arm64.deb");
});
