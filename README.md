# Apple Ads API v5 → Platform API migration notes

Apple turns off the **Apple Ads Campaign Management API v5** (`api.searchads.apple.com/api/v5`) on **January 26, 2027**. After that date v5 endpoints return errors: no reports, no budget changes, no pauses. Anything that still calls v5 — a bidding script, a dashboard, a BI connector, a vendor's integration — stops that day.

The replacement is the **Apple Ads Platform API** (`api.ads.apple.com/v1`).

These notes come from moving a production Apple Ads connector across and running v5 and the Platform API side by side, read-only, on a live App Store account in October 2026. They list what stayed the same, what changed, and where the live API did not match the documentation. They describe one account; run a side-by-side read on yours before you switch writes.

Full write-up: **[Apple Ads API v5 shutdown: what changes and how to move](https://loopmarket.ing/guides/apple-ads-api-v5-shutdown?utm_source=github)**

## Contents

- [What does not change](#what-does-not-change)
- [What changes](#what-changes)
- [Where the live API disagreed with the documentation](#where-the-live-api-disagreed-with-the-documentation)
- [A migration plan that does not risk spend](#a-migration-plan-that-does-not-risk-spend)
- [Checklist](#checklist)

## What does not change

- **Authentication.** The same OAuth client-credentials flow, the same ES256 client secret and the same API user's key worked against the new API without re-issuing anything.
- **Campaign, ad group and keyword ids.** Campaigns created under v5 kept their ids in the Platform API, so history keyed on those ids still lines up (on our account; check yours with a side-by-side read).
- **The numbers.** Daily spend, impressions, taps and installs for the same days came back identical from both APIs. The metric names (`localSpend`, `impressions`, `taps`, `totalInstalls`, `tapInstalls`, `viewInstalls`) are the same.

## What changes

The hierarchy gains a level — **Org → Ad Account → Campaign** — and almost every request and response shape moves with it.

| | v5 | Platform API |
|---|---|---|
| Base URL | `api.searchads.apple.com/api/v5` | `api.ads.apple.com/v1` |
| Account context header | `X-AP-Context: orgId=…` | `X-AP-Context: adAccountId=…` |
| Listing accounts | `GET /acls` returns name, currency, time zone | `GET /acls` returns ids and roles only; currency and time zone come from `GET /ad-accounts/{id}` |
| Listing campaigns, ad groups, keywords | `GET` with `limit` and `offset`, `totalResults` in the response | `POST …/query` with filters and `pagination{offset, pageSize}`; no total count. Deleted objects only appear if you ask for `deleted EQUALS true` |
| Response envelope | `{ data, pagination, error.errors[] }` | `{ result, pagination, error{code, message, details[]} }` |
| Campaign fields | `adamId`, `countriesOrRegions`, `dailyBudgetAmount`, `servingStatus` | `promotedObjectId`, `targeting{countryOrRegion, supplySource}`, `dailyBudget.value`, `bidStrategy`, `systemStatus` / `displayStatus` |
| Ad group and keyword | `defaultBidAmount`, pricingModel `CPC`, keyword status `ACTIVE` | `bidStrategy.bid{amount, currency}`, pricingModel `CPT`, keyword status `ENABLED` |
| Updates | `PUT /campaigns/{id}` with `{ campaign: {…} }` | `PUT /campaigns/{id}` with only the changed fields, unwrapped. Arrays are replaced whole |
| Bulk writes | `…/bulk` with an array; duplicates come back as 200 with an error inside | `…/bulk-create` with `{ items: [{ correlationId, data }], allowPartialSuccess }`; success reported per item |
| Reports | `POST /reports/campaigns` | `POST /reports/apps/campaigns/query`. `DAILY` granularity covers at most 90 days per request |
| Rate limits | Thinly documented | `RateLimit-Limit` / `-Remaining` / `-Reset` on every response, `Retry-After` on 429 |
| Lifetime budget | Removed in v5.6 | Not on the campaign either. Plan a total as a daily budget plus an end date |

## Where the live API disagreed with the documentation

Read-only calls against our own account, October 2026. Each would have produced a silent wrong number or a hard failure if we had trusted the docs.

| The documentation says | What the API actually did |
|---|---|
| The campaign report requires a `campaignId` filter. | A `campaignId` filter is rejected with `400 INVALID_FIELD_ATTRIBUTE`. The filter field is `id` (a string). With no filter at all, the report returns the whole account in one call. |
| An empty report returns `result.rows: []`. | It returns `result: {}` with no `rows` key. Code that reads `rows.length` throws instead of reporting zero. |
| List responses carry a total count. | List endpoints return only `offset` and `pageSize`, and `pageSize` is the number of items returned, not the size you asked for. Read until an empty page. |
| Times are UTC. | Campaign reads return times without a zone (UTC). The same campaign's times in report metadata come back shifted into the account's time zone. Read schedules from the campaign, not the report. |
| The ad is the unit of delivery. | Campaigns migrated from v5 were serving with zero ads — `/ads/query` returned nothing. Do not assume every campaign has an ad to copy. |
| Any window can be requested with a granularity. | A one-day window is sent without granularity, and that day's figures arrive in `totalMetrics` instead of the daily rows. |

## A migration plan that does not risk spend

1. Inventory every caller of `api.searchads.apple.com` — scripts, scheduled jobs, BI connectors, vendors. Ask vendors for their cut-over date in writing.
2. Port the reads first and run them next to v5 against the same account. Compare spend, installs and the campaign list day by day; a difference of zero for two weeks is the bar we used.
3. Do not create a second connection that also writes or imports spend. Two connectors on one account double-count spend.
4. Switch writes one account at a time, starting with reversible ones: a budget change you can set back, a pause you can resume.
5. Finish well before the deadline. We set our own cut-over six weeks early, on December 11, 2026, so a surprise has room to be fixed.

## Checklist

- [ ] Every caller of `api.searchads.apple.com` found (code search, cron, BI tools, vendors)
- [ ] `X-AP-Context` switched from `orgId` to `adAccountId`; account currency and time zone read from `GET /ad-accounts/{id}`
- [ ] List calls moved to `POST …/query`, paged until an empty page (no total count)
- [ ] Response parsing reads `result` and `error{code, message, details[]}`
- [ ] Empty reports (`result: {}`) handled as zero, not as an error
- [ ] Report filters use `id`, not `campaignId`
- [ ] One-day windows read from `totalMetrics`
- [ ] `DAILY` report windows split into chunks of 90 days or less
- [ ] Bids read and written as `bidStrategy.bid{amount, currency}`; keyword status `ENABLED`
- [ ] Updates send only changed fields, unwrapped; arrays sent whole
- [ ] `RateLimit-*` and `Retry-After` honoured
- [ ] Side-by-side read shows zero difference for two weeks
- [ ] Writes switched one account at a time, reversible changes first
- [ ] Cut-over done before January 26, 2027

## Not porting a script before January?

[Loop Marketing](https://loopmarket.ing/?utm_source=github) connects to Apple Ads and Google Ads accounts and changes budgets and bids inside limits you set. Its Apple Ads connector already speaks both APIs and reads them side by side, so the switch is per account and reversible. Free trial, no credit card to begin.

## Corrections

Seen something different on your account? Open an issue with the endpoint, what you sent (no ids or credentials) and what came back.

---

Text licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Not affiliated with Apple. Apple Ads is a trademark of Apple Inc.
