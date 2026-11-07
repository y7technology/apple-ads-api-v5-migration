#!/usr/bin/env node
// Finds Apple Ads Campaign Management API v5 usage in a codebase and says what each hit becomes in the Platform API.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, extname } from "node:path";

const SHUTDOWN = Date.UTC(2027, 0, 26);
const GUIDE = "https://loopmarket.ing/guides/apple-ads-api-v5-shutdown?utm_source=scanner";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "out", ".next", ".nuxt", "target",
  "Pods", "DerivedData", ".venv", "venv", "__pycache__", ".gradle", ".idea", "coverage",
]);
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz", ".jar",
  ".class", ".so", ".dylib", ".dll", ".exe", ".woff", ".woff2", ".ttf", ".mp4", ".mov", ".lock",
]);
const MAX_BYTES = 2 * 1024 * 1024;

// Rules marked `context` use field names common outside Apple Ads (adamId, granularity, …),
// so they only fire in files that also talk to the Search Ads API.
const CONTEXT = /searchads|X-AP-Context|orgId=/i;

export const RULES = [
  {
    id: "base-url",
    re: /api\.searchads\.apple\.com\/api\/v\d+/g,
    fix: "Base URL becomes https://api.ads.apple.com/v1. v5 stops answering on 2027-01-26.",
  },
  {
    id: "org-context",
    re: /orgId=/g,
    fix: "X-AP-Context becomes adAccountId=<id>. Check the id is in GET /acls first; on our account it equalled the old orgId.",
  },
  {
    id: "campaign-report",
    re: /\/reports\/campaigns(?!\/[a-z]*\/?query)/g,
    fix: "POST /reports/apps/campaigns/query. Filter on `id` (string), not `campaignId` (400). Empty result is `result: {}` with no rows. DAILY spans at most 90 days; a one-day window takes no granularity and returns totalMetrics.",
  },
  {
    id: "search-terms-report",
    re: /\/searchterms(?!\/query)/g,
    fix: "POST /reports/apps/searchterms/query with campaignId EQUALS. Rows can split one term across keywords and ad groups; sum by term.",
  },
  {
    id: "list-paging",
    re: /\/(?:campaigns|adgroups|targetingkeywords|negativekeywords)(?:\/[\w{}$.]+)*\?[^\s'"`]*\b(?:limit|offset)=/g,
    fix: "Lists become POST …/query with pagination{offset, pageSize}. No total count comes back; read until an empty page. Deleted objects need deleted EQUALS true.",
  },
  {
    id: "total-results",
    re: /\btotalResults\b/g,
    fix: "List responses have no total count in the Platform API. Page until a page comes back empty.",
    context: true,
  },
  {
    id: "bulk-write",
    re: /\/(?:targetingkeywords|negativekeywords)\/(?:delete\/)?bulk\b/g,
    fix: "POST /v1/keywords/bulk-create or /v1/negative-keywords/bulk-create (bulk-delete) with { items: [{ correlationId, data }], allowPartialSuccess }. Success is reported per item.",
  },
  {
    id: "daily-budget",
    re: /\bdailyBudgetAmount\b/g,
    fix: "dailyBudget: { value: { amount, currency } }. Updates send only the changed fields, not wrapped in { campaign: … }.",
  },
  {
    id: "lifetime-budget",
    re: /\bbudgetAmount\b/g,
    fix: "Lifetime budget is gone (removed in v5.6, absent in the Platform API). Send a daily budget plus an end time instead.",
    context: true,
  },
  {
    id: "default-bid",
    re: /\bdefaultBidAmount\b/g,
    fix: "Ad group bid becomes bidStrategy.bid{amount, currency}; pricingModel is CPT.",
  },
  {
    id: "keyword-bid",
    re: /\bbidAmount\b/g,
    fix: "Keyword bid field is `bid`; enabled keywords have status ENABLED, not ACTIVE.",
    context: true,
  },
  {
    id: "countries",
    re: /\bcountriesOrRegions\b/g,
    fix: "Campaign countries move to targeting.countryOrRegion (with supplySource, supplyPlacement).",
  },
  {
    id: "adam-id",
    re: /\badamId\b/g,
    fix: "Campaign app id is promotedObjectId with promotedObjectType APPSTORE_APP.",
    context: true,
  },
  {
    id: "serving-status",
    re: /\bservingStatus\b/g,
    fix: "Serving state is systemStatus / displayStatus.",
    context: true,
  },
  {
    id: "error-envelope",
    re: /\bmessageCode\b/g,
    fix: "Errors arrive as error{code, message, details[]} with string codes, not error.errors[].messageCode.",
    context: true,
  },
  {
    id: "report-rows",
    re: /\.granularity\b(?!\s*=)/g,
    fix: "Report rows carry granularMetrics[] and totalMetrics; metadata uses id/name instead of campaignId/campaignName.",
    context: true,
  },
  {
    id: "no-metrics-rows",
    re: /\breturnRecordsWithNoMetrics\b/g,
    fix: "Omit options in the Platform API report; rows with no metrics are not returned by default.",
  },
];

export function scanText(text) {
  const inContext = CONTEXT.test(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const hits = [];
  for (const rule of RULES) {
    if (rule.context && !inContext) continue;
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const ln = lineOf(m.index);
      hits.push({ rule: rule.id, line: ln + 1, column: m.index - lineStarts[ln] + 1, match: m[0], fix: rule.fix });
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.column - b.column);
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(p);
    } else if (e.isFile() && !SKIP_EXT.has(extname(e.name).toLowerCase())) {
      yield p;
    }
  }
}

export function scanPath(root) {
  const files = statSync(root).isDirectory() ? walk(root) : [root];
  const results = [];
  let scanned = 0;
  for (const file of files) {
    let buf;
    try {
      if (statSync(file).size > MAX_BYTES) continue;
      buf = readFileSync(file);
    } catch { continue; }
    if (buf.includes(0)) continue;
    scanned++;
    for (const h of scanText(buf.toString("utf8"))) results.push({ file: relative(process.cwd(), file) || file, ...h });
  }
  return { scanned, results };
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const json = argv.includes("--json");
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: apple-ads-v5-scan [path ...] [--json]\nExits 1 when v5 usage is found, 0 when none.");
    return 0;
  }
  const roots = args.length ? args : ["."];
  let scanned = 0;
  const results = [];
  for (const r of roots) {
    try {
      const out = scanPath(r);
      scanned += out.scanned;
      results.push(...out.results);
    } catch (e) {
      console.error(`apple-ads-v5-scan: cannot read ${r}: ${e.message}`);
      return 2;
    }
  }
  const daysLeft = Math.ceil((SHUTDOWN - Date.now()) / 86400000);
  if (json) {
    console.log(JSON.stringify({ scannedFiles: scanned, daysUntilShutdown: daysLeft, findings: results }, null, 2));
    return results.length ? 1 : 0;
  }
  if (!results.length) {
    console.log(`No Apple Ads API v5 usage found in ${scanned} files.`);
    console.log("Also check callers outside this code: cron jobs, BI connectors, vendors.");
    return 0;
  }
  let lastFile = "";
  for (const r of results) {
    if (r.file !== lastFile) { console.log(`\n${r.file}`); lastFile = r.file; }
    console.log(`  ${r.line}:${r.column}  ${r.rule}  ${r.match}\n      → ${r.fix}`);
  }
  const files = new Set(results.map((r) => r.file)).size;
  console.log(`\n${results.length} v5 usages in ${files} files (${scanned} scanned).`);
  console.log(daysLeft > 0 ? `v5 shuts down on 2027-01-26 — ${daysLeft} days from now.` : "v5 shut down on 2027-01-26.");
  console.log(`Migration notes: ${GUIDE}`);
  return 1;
}

const invokedDirectly = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
