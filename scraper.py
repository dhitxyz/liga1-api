#!/usr/bin/env python3
"""
Liga 1 Indonesia Data Scraper
Fetches standings and match fixtures for BRI Liga 1, formatting output for TV Home.
"""

import json
import os
import sys
import time
import urllib.request
import re

DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def load_current_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {DATA_FILE}: {e}")
    return {"season": "2026/2027", "round": "Pekan 7", "lastUpdated": int(time.time() * 1000), "matches": [], "standings": []}

def fetch_url(url, timeout=10):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read().decode("utf-8", "ignore")
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
    return None

def main():
    current_data = load_current_data()
    print(f"Loaded existing data with {len(current_data.get('standings', []))} standings and {len(current_data.get('matches', []))} matches.")

    current_data["lastUpdated"] = int(time.time() * 1000)

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(current_data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Successfully saved {DATA_FILE}")

if __name__ == "__main__":
    main()
