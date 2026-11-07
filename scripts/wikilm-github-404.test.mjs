// node --test scripts/wikilm-github-404.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnoseContentsWrite404 } from "../src/lib/wikilm-diagnose.ts";

test("write 404 when token cannot see repo explains access", () => {
  const msg = diagnoseContentsWrite404({
    owner: "lugosi",
    repo: "family-wiki",
    branch: "main",
    fullPath: "wiki/people/maya.md",
    putBodyText:
      '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/contents#create-or-update-file-contents"}',
    repoStatus: 404,
  });
  assert.match(msg, /token can't access lugosi\/family-wiki/i);
  assert.doesNotMatch(msg, /contents#create/i);
});

test("write 404 on empty repo points at token Contents write", () => {
  const msg = diagnoseContentsWrite404({
    owner: "lugosi",
    repo: "family-wiki",
    branch: "main",
    fullPath: "wiki/people/maya.md",
    putBodyText: "Not Found",
    repoStatus: 200,
    repoSize: 0,
    defaultBranch: "main",
  });
  assert.match(msg, /is empty/i);
  assert.match(msg, /Contents: Read and write/i);
});

test("write 404 on wrong branch names the default branch", () => {
  const msg = diagnoseContentsWrite404({
    owner: "lugosi",
    repo: "family-wiki",
    branch: "main",
    fullPath: "wiki/people/maya.md",
    putBodyText: "Not Found",
    repoStatus: 200,
    repoSize: 42,
    defaultBranch: "master",
  });
  assert.match(msg, /branch “main” not found/i);
  assert.match(msg, /master/);
});

test("write 404 fallback tells you to recreate the PAT", () => {
  const msg = diagnoseContentsWrite404({
    owner: "lugosi",
    repo: "family-wiki",
    branch: "main",
    fullPath: "wiki/people/maya.md",
    putBodyText:
      '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/contents#create-or-update-file-contents","status":"404"}',
    repoStatus: 200,
    repoSize: 12,
    defaultBranch: "main",
  });
  assert.match(msg, /Contents write was refused/i);
  assert.match(msg, /WIKILM_GITHUB_TOKEN/);
  assert.doesNotMatch(msg, /documentation_url/);
});
