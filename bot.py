#!/usr/bin/env python3
"""
Liga 1 Live Scraper & API Bot for Pterodactyl / VPS
Runs 24/7 in background:
- Scrapes real-time scores every 60s during matches (15:00 - 23:30 WIB)
- Scrapes every 15 mins during idle hours
- Serves /data.json via lightweight embedded HTTP server (0 extra pip dependencies)
- Optionally syncs to GitHub repository if GITHUB_TOKEN is configured
"""

import os
import sys
import time
import json
import base64
import urllib.request
import urllib.error
import datetime
import threading
import signal
from http.server import HTTPServer, BaseHTTPRequestHandler

from scraper import run_scraper, load_current_data, DATA_FILE

# Configuration from Environment Variables
PORT = int(os.environ.get("SERVER_PORT") or os.environ.get("PORT") or 8080)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
GITHUB_REPO = os.environ.get("GITHUB_REPO", "dhitxyz/liga1-api").strip()

# Polling intervals
FAST_POLL_SEC = int(os.environ.get("FAST_POLL_SEC", 60))       # 1 minute during matches
IDLE_POLL_SEC = int(os.environ.get("IDLE_POLL_SEC", 900))      # 15 minutes idle

stop_event = threading.Event()
state_lock = threading.Lock()
state = {
    "data": {},
    "last_scrape_time": 0,
    "last_status_msg": "Starting up..."
}


def log(tag, msg):
    now_wib = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
    time_str = now_wib.strftime("%Y-%m-%d %H:%M:%S WIB")
    print(f"[{time_str}] [{tag}] {msg}", flush=True)


def push_to_github(data_content: str, token: str, repo: str):
    """Sync data.json to GitHub repository via REST API (no git binary needed)."""
    if not token:
        return False

    url = f"https://api.github.com/repos/{repo}/contents/data.json"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "Liga1-Pterodactyl-Bot",
        "X-GitHub-Api-Version": "2022-11-28"
    }

    # 1. Fetch current file SHA
    sha = None
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                res_json = json.loads(resp.read().decode())
                sha = res_json.get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log("GITHUB", f"Failed to check sha: HTTP {e.code}")
    except Exception as e:
        log("GITHUB", f"Failed to check sha: {e}")

    # 2. Upload / Update data.json
    b64_content = base64.b64encode(data_content.encode("utf-8")).decode("utf-8")
    payload = {
        "message": "Auto-update Liga 1 live score [skip ci]",
        "content": b64_content,
        "branch": "main"
    }
    if sha:
        payload["sha"] = sha

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            if resp.status in (200, 201):
                log("GITHUB", f"Successfully synced data.json to GitHub ({repo})")
                return True
            else:
                log("GITHUB", f"GitHub PUT returned status {resp.status}")
    except Exception as e:
        log("GITHUB", f"Error syncing to GitHub: {e}")

    return False


def is_match_active(data):
    """Check if current time is within match hours or if matches are in progress."""
    now_wib = datetime.datetime.utcnow() + datetime.timedelta(hours=7)
    hour = now_wib.hour
    minute = now_wib.minute

    # Typical match window in Indonesia: 15:00 - 23:30 WIB
    if 15 <= hour < 23 or (hour == 23 and minute <= 30):
        return True

    # Also check if any today match is still not finished
    for m in data.get("matches", []):
        if m.get("isToday") and not m.get("isFinished"):
            return True

    return False


def poller_loop():
    """Background worker that scrapes scores at dynamic intervals."""
    log("POLLER", "Background poller started.")

    while not stop_event.is_set():
        interval = IDLE_POLL_SEC
        try:
            current, changed = run_scraper(save=True)
            with state_lock:
                state["data"] = current
                state["last_scrape_time"] = int(time.time() * 1000)

            # Determine next sleep interval
            in_match = is_match_active(current)
            interval = FAST_POLL_SEC if in_match else IDLE_POLL_SEC

            matches_info = []
            for m in current.get("matches", []):
                if m.get("isToday"):
                    matches_info.append(f"{m.get('homeTeam')} {m.get('scoreOrTime')} {m.get('awayTeam')}")

            today_summary = " | ".join(matches_info) if matches_info else "No matches today"

            if changed:
                log("UPDATE", f"Live data changed! Today: [{today_summary}]")
                if GITHUB_TOKEN:
                    with open(DATA_FILE, "r", encoding="utf-8") as f:
                        content_str = f.read()
                    push_to_github(content_str, GITHUB_TOKEN, GITHUB_REPO)
            else:
                msg = f"OK (Mode: {'MATCH 60s' if in_match else 'IDLE 15m'}) - {today_summary}"
                with state_lock:
                    state["last_status_msg"] = msg
                log("POLLER", f"Checked: {msg}. Next in {interval}s.")

        except Exception as e:
            log("ERROR", f"Error during scrape: {e}")
            interval = 60

        # Interruptible sleep
        stop_event.wait(interval)

    log("POLLER", "Background poller stopped.")


class ApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress verbose standard HTTP access logs in console
        pass

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, User-Agent")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")

        if path in ("", "/status"):
            with state_lock:
                d = state.get("data") or load_current_data()
            today_matches = [m for m in d.get("matches", []) if m.get("isToday")]
            res = {
                "service": "Liga 1 Live Scraper API",
                "status": "online",
                "lastUpdated": d.get("lastUpdated", 0),
                "inMatchWindow": is_match_active(d),
                "fastPollIntervalSec": FAST_POLL_SEC,
                "idlePollIntervalSec": IDLE_POLL_SEC,
                "githubSyncEnabled": bool(GITHUB_TOKEN),
                "githubRepo": GITHUB_REPO if GITHUB_TOKEN else None,
                "todayMatches": today_matches,
                "totalStandings": len(d.get("standings", []))
            }
            body = json.dumps(res, indent=2, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        elif path in ("/data.json", "/data"):
            with state_lock:
                d = state.get("data") or load_current_data()
            body = json.dumps(d, indent=2, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        elif path == "/sync":
            log("API", "Manual sync triggered via HTTP GET /sync")
            current, changed = run_scraper(save=True)
            with state_lock:
                state["data"] = current
            if changed and GITHUB_TOKEN:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    content_str = f.read()
                push_to_github(content_str, GITHUB_TOKEN, GITHUB_REPO)
            res = {"success": True, "dataChanged": changed, "lastUpdated": current.get("lastUpdated")}
            body = json.dumps(res, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error": "Not found. Use /data.json or /status"}')

    def do_POST(self):
        if self.path.rstrip("/") == "/sync":
            self.do_GET()
        else:
            self.send_response(404)
            self.end_headers()


def main():
    state["data"] = load_current_data()

    log("START", f"Liga 1 Bot starting on 0.0.0.0:{PORT}")
    log("START", f"Fast poll: {FAST_POLL_SEC}s | Idle poll: {IDLE_POLL_SEC}s")
    if GITHUB_TOKEN:
        log("START", f"GitHub auto-sync enabled for repository: {GITHUB_REPO}")
    else:
        log("START", "GitHub auto-sync disabled (set GITHUB_TOKEN env var to enable)")

    # Start background scraper thread
    poller_thread = threading.Thread(target=poller_loop, daemon=True)
    poller_thread.start()

    # Start HTTP server
    server = HTTPServer(("0.0.0.0", PORT), ApiHandler)

    def shutdown_handler(signum, frame):
        log("SHUTDOWN", "Shutdown signal received. Stopping server...")
        stop_event.set()
        threading.Thread(target=server.shutdown).start()

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    try:
        log("SERVER", f"HTTP Server ready at http://0.0.0.0:{PORT}/data.json")
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log("STOP", "Server stopped cleanly.")


if __name__ == "__main__":
    main()
