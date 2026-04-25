import assert from "node:assert/strict";
import test from "node:test";

import {
  DockerPurl,
  GenericPurlBuilder,
  MavenPurl,
  NpmPurl,
  PurlBuilder,
  build,
  parse
} from "../index.js";

test("NpmPurl builder creates canonical scoped package", () => {
  const purl = NpmPurl.builder()
    .setScope("@angular")
    .setName("animation")
    .setVersion("12.3.1")
    .build();

  assert.equal(purl.toString(), "pkg:npm/%40angular/animation@12.3.1");
});

test("MavenPurl builder maps groupId/artifactId", () => {
  const purl = MavenPurl.builder()
    .setGroupId("org.apache.commons")
    .setArtifactId("io")
    .setVersion("1.3.4")
    .setQualifier("classifier", "sources")
    .build();

  assert.equal(purl.toString(), "pkg:maven/org.apache.commons/io@1.3.4?classifier=sources");
});

test("DockerPurl builder supports repository_url qualifier", () => {
  const purl = DockerPurl.builder()
    .setNamespace("customer")
    .setImage("dockerimage")
    .setVersion("sha256:244fd47e07d10")
    .setQualifier("repository_url", "gcr.io")
    .build();

  assert.equal(
    purl.toString(),
    "pkg:docker/customer/dockerimage@sha256:244fd47e07d10?repository_url=gcr.io"
  );
});

test("parser and builder are round-trip compatible", () => {
  const parsed = parse("pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=zip&classifier=dist");
  const rebuilt = build(parsed);
  assert.equal(rebuilt, "pkg:maven/org.apache.xmlgraphics/batik-anim@1.9.1?classifier=dist&type=zip");
});

test("type convenience methods exist only on exact typed builders", () => {
  const base = new PurlBuilder();
  const generic = new GenericPurlBuilder();
  const npm = NpmPurl.builder();
  const maven = MavenPurl.builder();
  const docker = DockerPurl.builder();

  assert.equal(typeof base.setScope, "undefined");
  assert.equal(typeof base.setGroupId, "undefined");
  assert.equal(typeof base.setArtifactId, "undefined");
  assert.equal(typeof base.setImage, "undefined");

  assert.equal(typeof generic.setScope, "undefined");
  assert.equal(typeof generic.setGroupId, "undefined");
  assert.equal(typeof generic.setArtifactId, "undefined");
  assert.equal(typeof generic.setImage, "undefined");

  assert.equal(typeof npm.setScope, "function");
  assert.equal(typeof npm.setGroupId, "undefined");
  assert.equal(typeof npm.setArtifactId, "undefined");
  assert.equal(typeof npm.setImage, "undefined");

  assert.equal(typeof maven.setScope, "undefined");
  assert.equal(typeof maven.setGroupId, "function");
  assert.equal(typeof maven.setArtifactId, "function");
  assert.equal(typeof maven.setImage, "undefined");

  assert.equal(typeof docker.setScope, "undefined");
  assert.equal(typeof docker.setGroupId, "undefined");
  assert.equal(typeof docker.setArtifactId, "undefined");
  assert.equal(typeof docker.setImage, "function");
});

