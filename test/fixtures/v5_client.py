import requests

BASE = "https://api.searchads.apple.com/api/v5"

def headers(token, org_id):
    return {"Authorization": f"Bearer {token}", "X-AP-Context": f"orgId={org_id}"}

def campaigns(token, org_id):
    r = requests.get(f"{BASE}/campaigns?limit=1000&offset=0", headers=headers(token, org_id))
    body = r.json()
    total = body["pagination"]["totalResults"]
    return [(c["id"], c["adamId"], c["dailyBudgetAmount"]["amount"]) for c in body["data"]], total

def report(token, org_id, start, end):
    payload = {"startTime": start, "endTime": end, "granularity": "DAILY",
               "returnRecordsWithNoMetrics": False}
    r = requests.post(f"{BASE}/reports/campaigns", json=payload, headers=headers(token, org_id))
    for row in r.json()["data"]["reportingDataResponse"]["row"]:
        for day in row.granularity:
            yield day["date"], day["localSpend"]["amount"]
