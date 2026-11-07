const BASE = "https://api.ads.apple.com/v1";
export async function report(token: string, adAccountId: string) {
  return fetch(`${BASE}/reports/apps/campaigns/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-AP-Context": `adAccountId=${adAccountId}` },
  });
}
