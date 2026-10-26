#!/usr/bin/env python3
"""
Liga 1 Indonesia 100% Automated Scraper
Fetches standings and match fixtures from the official I-League / LIB competition platform.
Outputs data.json for TV Home Launcher.
"""

import json
import os
import sys
import time
import urllib.request
import re
import datetime

DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "id,en;q=0.9"
}

DAYS_ID = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
MONTHS_ID = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

TEAM_NAME_MAP = {
    "PERSIJA": "Persija Jakarta",
    "DEWA UNITED": "Dewa United",
    "BALI UNITED": "Bali United",
    "MADURA UNITED": "Madura United",
    "PERSIB": "Persib Bandung",
    "PERSITA": "Persita",
    "BHAYANGKARA": "Bhayangkara FC",
    "PERSIK": "Persik Kediri",
    "AREMA": "Arema FC",
    "PERSEBAYA": "Persebaya",
    "PSM": "PSM Makassar",
    "JAVA UNITED": "Java United",
    "BORNEO": "Borneo FC",
    "GARUDAYAKSA": "Garudayaksa FC",
    "PSS SLEMAN": "PSS Sleman",
    "ISENMULANG": "Isenmulang Kalteng",
    "PERSIJAP": "Persijap Jepara",
    "PSIM": "PSIM Yogyakarta",
    "ADHYAKSA": "Adhyaksa FC"
}

def clean_team_name(raw):
    raw_upper = raw.strip().upper()
    for k, v in TEAM_NAME_MAP.items():
        if k in raw_upper:
            return v
    return raw.strip().title().replace("Fc", "FC")

def format_date_id(date_str):
    try:
        dt = datetime.datetime.strptime(date_str, "%Y-%m-%d")
        return f"{DAYS_ID[dt.weekday()]}, {dt.day} {MONTHS_ID[dt.month]}"
    except Exception:
        return date_str

def load_current_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {DATA_FILE}: {e}")
    return {
        "season": "2026/2027",
        "round": "Pekan 7",
        "lastUpdated": int(time.time() * 1000),
        "matches": [],
        "standings": []
    }

def fetch_html(url, timeout=12):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read().decode("utf-8", "ignore")
    except Exception as e:
        print(f"Fetch failed for {url}: {e}")
    return None

def scrape_ileague():
    html = fetch_html("https://ileague.id/")
    if not html:
        return None, None

    # 1. Parse Standings
    standings = []
    tables = re.findall(r"<table[^>]*>(.*?)</table>", html, re.DOTALL | re.I)
    if tables:
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tables[0], re.DOTALL)
        for row in rows:
            cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.DOTALL)
            clean = [re.sub(r"<[^>]+>", "", c).replace("&nbsp;", "").strip() for c in cells]
            if len(clean) >= 3 and clean[0].isdigit():
                rank = int(clean[0])
                team_name = clean_team_name(clean[1])
                pts = int(clean[2]) if clean[2].isdigit() else 0
                standings.append({
                    "rank": rank,
                    "team": team_name,
                    "points": pts
                })

    # 2. Parse Matches
    matches = []
    idx = html.find("accordionExample")
    if idx != -1:
        acc_html = html[idx:idx+35000]
        cards = re.split(r"<div class=[\"\x27]card[\"\x27]>", acc_html)
        
        # Determine today's date in WIB
        now_wib = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
        today_iso = now_wib.strftime("%Y-%m-%d")

        for c in cards[1:]:
            titles = re.findall(r'<img[^>]*title=["\']([^"\']+)["\']', c)
            score_m = re.search(r'<span class=["\']score-span["\'][^>]*>(.*?)</span>', c, re.DOTALL)
            link_m = re.search(r'BRI_SUPER_LEAGUE_2026-27/([0-9]{4}-[0-9]{2}-[0-9]{2})', c)

            if len(titles) >= 2:
                home = clean_team_name(titles[0])
                away = clean_team_name(titles[1])
                match_date_iso = link_m.group(1) if link_m else today_iso
                date_display = format_date_id(match_date_iso)

                raw_score = re.sub(r'<[^>]+>', '', score_m.group(1)).strip() if score_m else ''
                is_finished = bool(':' in raw_score and not any(k in raw_score.lower() for k in ['wib', 'wita']))

                if is_finished:
                    score_or_time = raw_score.replace(':', ' - ').strip()
                    status = 'FT'
                else:
                    time_clean = re.search(r'([0-2]?[0-9]:[0-5][0-9])', raw_score)
                    score_or_time = time_clean.group(1) if time_clean else '19:00'
                    if match_date_iso == today_iso:
                        status = 'Hari Ini'
                    else:
                        try:
                            m_dt = datetime.datetime.strptime(match_date_iso, '%Y-%m-%d')
                            status = DAYS_ID[m_dt.weekday()][:3]
                        except Exception:
                            status = 'Nanti'
                is_today = (match_date_iso == today_iso)

                matches.append({
                    "date": date_display,
                    "homeTeam": home,
                    "awayTeam": away,
                    "scoreOrTime": score_or_time,
                    "status": status,
                    "isFinished": is_finished,
                    "isToday": is_today
                })

    return standings, matches

def main():
    current = load_current_data()
    print(f"Loaded existing data: {len(current.get('standings', []))} standings, {len(current.get('matches', []))} matches")

    scraped_standings, scraped_matches = scrape_ileague()

    updated = False

    if scraped_standings and len(scraped_standings) >= 15:
        print(f"Successfully scraped {len(scraped_standings)} standings from ileague.id")
        
        # Merge stats from current standings to retain played/won/draw/lost/goalDiff
        old_standings_map = {s["team"]: s for s in current.get("standings", [])}
        new_standings = []
        for s in scraped_standings:
            team = s["team"]
            old = old_standings_map.get(team, {})
            new_standings.append({
                "rank": s["rank"],
                "team": team,
                "played": old.get("played", 7),
                "won": old.get("won", 4),
                "draw": old.get("draw", 1),
                "lost": old.get("lost", 2),
                "goalDiff": old.get("goalDiff", 0),
                "points": s["points"]
            })
        current["standings"] = new_standings
        updated = True

    if scraped_matches and len(scraped_matches) >= 3:
        print(f"Successfully scraped {len(scraped_matches)} matches from ileague.id")
        current["matches"] = scraped_matches
        updated = True

    current["lastUpdated"] = int(time.time() * 1000)

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Updated {DATA_FILE} successfully (Updated: {updated})")

if __name__ == "__main__":
    main()
