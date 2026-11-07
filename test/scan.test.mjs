import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanText, scanPath } from "../scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", name);
const rules = (hits) => [...new Set(hits.map((h) => h.rule))].sort();

test("finds each v5 construct in a v5 client with its line", () => {
  const { results } = scanPath(fx("v5_client.py"));
  assert.deepEqual(rules(results), [
    "adam-id", "base-url", "campaign-report", "daily-budget", "list-paging",
    "no-metrics-rows", "org-context", "report-rows", "total-results",
  ]);
  const base = results.find((r) => r.rule === "base-url");
  assert.equal(base.line, 3);
  assert.match(base.fix, /api\.ads\.apple\.com\/v1/);
});

test("ignores common field names in files that never call the Search Ads API", () => {
  assert.deepEqual(scanPath(fx("unrelated.ts")).results, []);
});

test("does not flag code already on the Platform API", () => {
  assert.deepEqual(scanPath(fx("platform_client.ts")).results, []);
});

test("bulk keyword writes and lifetime budget are flagged with their replacements", () => {
  const hits = scanText([
    'url = BASE + "/campaigns/1/adgroups/2/targetingkeywords/bulk"',
    'body = {"budgetAmount": {"amount": "100"}, "orgId=": 1}',
  ].join("\n"));
  assert.deepEqual(rules(hits), ["bulk-write", "lifetime-budget", "org-context"]);
  assert.match(hits.find((h) => h.rule === "bulk-write").fix, /bulk-create/);
});

test("CLI exits 1 with findings, 0 without, and --json is parseable", () => {
  const cli = join(here, "..", "scan.mjs");
  const found = spawnSync(process.execPath, [cli, fx("v5_client.py"), "--json"], { encoding: "utf8" });
  assert.equal(found.status, 1);
  const out = JSON.parse(found.stdout);
  assert.equal(out.scannedFiles, 1);
  assert.ok(out.findings.length >= 9);
  const clean = spawnSync(process.execPath, [cli, fx("platform_client.ts")], { encoding: "utf8" });
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /No Apple Ads API v5 usage found/);
});
