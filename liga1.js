/**
 * Liga 1 Live Scraper & API Bot (Node.js version for PM2 / Pterodactyl)
 * Runs 24/7 alongside WhatsApp bot in the same container.
 * Zero external npm dependencies (uses native fetch & http).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.SERVER_PORT || process.env.PORT || 8080;
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const GITHUB_REPO = (process.env.GITHUB_REPO || 'dhitxyz/liga1-api').trim();

const FAST_POLL_MS = 60 * 1000;            // 1 menit saat ada laga LIVE
const PRE_MATCH_POLL_MS = 15 * 60 * 1000;  // 15 menit jika ada laga hari ini yang belum tuntas
const IDLE_POLL_MS = 2 * 60 * 60 * 1000;   // 2 jam jika seluruh laga sudah selesai (FT) atau hari libur

const DAYS_ID = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const MONTHS_ID = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const TEAM_NAME_MAP = {
  'PERSIJA': 'Persija Jakarta',
  'DEWA UNITED': 'Dewa United',
  'BALI UNITED': 'Bali United',
  'MADURA UNITED': 'Madura United',
  'PERSIB': 'Persib Bandung',
  'PERSITA': 'Persita',
  'BHAYANGKARA': 'Bhayangkara FC',
  'PERSIK': 'Persik Kediri',
  'AREMA': 'Arema FC',
  'PERSEBAYA': 'Persebaya',
  'PSM': 'PSM Makassar',
  'JAVA UNITED': 'Java United',
  'BORNEO': 'Borneo FC',
  'GARUDAYAKSA': 'Garudayaksa FC',
  'PSS SLEMAN': 'PSS Sleman',
  'ISENMULANG': 'Isenmulang Kalteng',
  'PERSIJAP': 'Persijap Jepara',
  'PSIM': 'PSIM Yogyakarta',
  'ADHYAKSA': 'Adhyaksa FC',
};

const SORTED_TEAM_KEYS = Object.entries(TEAM_NAME_MAP).sort((a, b) => b[0].length - a[0].length);

function log(tag, msg) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' WITA';
  console.log(`[${timeStr}] [${tag}] ${msg}`);
}

function cleanTeamName(raw) {
  if (!raw) return '';
  const upper = raw.trim().toUpperCase().replace(/_/g, ' ');
  for (const [k, v] of SORTED_TEAM_KEYS) {
    const wordRegex = new RegExp('\\b' + k + '\\b', 'i');
    if (wordRegex.test(upper)) return v;
  }
  for (const [k, v] of SORTED_TEAM_KEYS) {
    if (upper.includes(k)) return v;
  }
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Fc\b/g, 'FC');
}

function wibToWita(timeStr) {
  try {
    const clean = timeStr.replace(/[^\d:]/g, '').trim();
    const parts = clean.split(':');
    if (parts.length < 2) return timeStr;
    const h = (parseInt(parts[0], 10) + 1) % 24;
    return `${String(h).padStart(2, '0')}:${parts[1]}`;
  } catch {
    return timeStr;
  }
}

function isMatchTime(str) {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  if (s.includes('wib') || s.includes('wita')) return true;
  const m = s.match(/^([0-2]?\d)[:.]([0-5]\d)$/);
  if (m) {
    const hour = parseInt(m[1], 10);
    const min = m[2];
    if (hour >= 13 && hour <= 23) return true;
    if (hour >= 10 && (min === '00' || min === '15' || min === '30' || min === '45')) return true;
  }
  return false;
}

function getMatchKickoffMs(isoDate, timeStr) {
  if (!isoDate || !timeStr) return null;
  const isWib = timeStr.toLowerCase().includes('wib');
  const clean = timeStr.replace(/[^\d:]/g, '');
  const parts = clean.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;

  const [year, month, day] = isoDate.split('-').map((x) => parseInt(x, 10));
  // If explicitly WIB, UTC is h - 7. Otherwise default is WITA (data.json standard), UTC is h - 8.
  const utcOffset = isWib ? 7 : 8;
  return Date.UTC(year, month - 1, day, h - utcOffset, m, 0);
}

function formatDateId(dateStr) {
  try {
    const dt = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00Z');
    const dayName = DAYS_ID[(dt.getUTCDay() + 6) % 7];
    return `${dayName}, ${dt.getUTCDate()} ${MONTHS_ID[dt.getUTCMonth() + 1]}`;
  } catch {
    return dateStr;
  }
}

function loadCurrentData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      log('ERROR', `Failed to read ${DATA_FILE}: ${e.message}`);
    }
  }
  return {
    season: '2026/2027',
    round: 'Pekan 9',
    lastUpdated: Date.now(),
    matches: [],
    standings: [],
  };
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return await res.text();
  } catch (e) {
    log('FETCH', `Failed fetching ${url}: ${e.message}`);
  }
  return null;
}

async function scrapeStandings() {
  const html = await fetchHtml('https://ileague.id/table/index/BRI_SUPER_LEAGUE_2026-27');
  if (!html) return [];
  const standings = [];
  const tableM = html.match(/<table[^>]*result-point[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableM) return [];
  const tbodyM = tableM[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyM) return [];
  const rows = tbodyM[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  for (const r of rows) {
    const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map((c) =>
      c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()
    );
    if (cells.length >= 10 && /^\d+$/.test(cells[0])) {
      standings.push({
        rank: parseInt(cells[0], 10),
        team: cleanTeamName(cells[1]),
        played: parseInt(cells[2], 10),
        won: parseInt(cells[3], 10),
        draw: parseInt(cells[4], 10),
        lost: parseInt(cells[5], 10),
        goalDiff: parseInt(cells[8], 10),
        points: parseInt(cells[9], 10),
      });
    }
  }
  return standings;
}

async function scrapeIleague(savedTimesMap) {
  const html = await fetchHtml('https://ileague.id/');
  if (!html) return { standings: [], matches: [] };

  // Standings from full table page
  const standings = await scrapeStandings();

  // 2. Matches
  const matches = [];
  const accIdx = html.indexOf('accordionExample');
  if (accIdx !== -1) {
    const endIdx = html.indexOf('</section>', accIdx);
    const accHtml = endIdx !== -1 ? html.substring(accIdx, endIdx) : html.substring(accIdx, accIdx + 120000);
    const cards = accHtml.split(/<div class=["']card["']/);
    const now = Date.now();
    const nowWita = new Date(now + 8 * 3600 * 1000);
    const todayIso = nowWita.toISOString().substring(0, 10);

    for (const c of cards.slice(1)) {
      const titles = Array.from(c.matchAll(/<img[^>]*title=["']([^"']+)["']/g)).map((m) => m[1]);
      const scoreM = c.match(/<span class=["']score-span["'][^>]*>([\s\S]*?)<\/span>/);
      const linkM = c.match(/BRI_SUPER_LEAGUE_2026-27\/(\d{4}-\d{2}-\d{2})/);
      const detailLinkM = c.match(/href=["'](https:\/\/ileague\.id\/result\/detail\/[^"']+)["']/);

      if (titles.length >= 2) {
        const home = cleanTeamName(titles[0]);
        const away = cleanTeamName(titles[1]);
        const matchKey = `${home}_${away}`;
        const matchDateIso = linkM ? linkM[1] : todayIso;
        const isToday = (matchDateIso === todayIso);
        const rawScore = scoreM ? scoreM[1].replace(/<[^>]+>/g, '').trim() : '';
        const hasLiveId = /id=["']live_\d+["']/i.test(c);

        let matchKickoffTime = (savedTimesMap && savedTimesMap.get(matchKey)) || undefined;
        let isFinished = false;
        let scoreOrTime = '';
        let status = '';

        let kickoffMs = null;
        let elapsedMinutes = 999;
        if (matchKickoffTime) {
          kickoffMs = getMatchKickoffMs(matchDateIso, matchKickoffTime);
          if (kickoffMs) elapsedMinutes = (now - kickoffMs) / (60 * 1000);
        }

        if (!isMatchTime(rawScore) && rawScore.includes(':')) {
          scoreOrTime = rawScore.replace(':', ' - ').trim();

          // If score has started and it's within match window or has live ID, default to LIVE
          if (hasLiveId || (isToday && elapsedMinutes < 100)) {
            status = 'LIVE';
            isFinished = false;
          }

          // Check detail page for FT vs LIVE, live score, and kickoff time
          if (detailLinkM) {
            try {
              const detailHtml = await fetchHtml(detailLinkM[1]);
              if (detailHtml) {
                const liveScoreM = detailHtml.match(/id=["']live_score["'][^>]*>([\s\S]*?)<\/span>/i);
                if (liveScoreM && liveScoreM[1].includes(':')) {
                  scoreOrTime = liveScoreM[1].replace(':', ' - ').trim();
                }

                const kickOffM = detailHtml.match(/Kick\s*Off\s*<b>([0-2]?\d:[0-5]\d)\s*(?:WIB)?<\/b>/i);
                if (kickOffM) {
                  matchKickoffTime = wibToWita(kickOffM[1]);
                  kickoffMs = getMatchKickoffMs(matchDateIso, matchKickoffTime);
                  if (kickoffMs) elapsedMinutes = (now - kickoffMs) / (60 * 1000);
                }

                const isFT = />\s*FT\s*<\/div>/i.test(detailHtml) || />\s*Full\s*Time\s*<\/div>/i.test(detailHtml);

                // A match can ONLY be FT if at least 95 minutes have passed since kickoff!
                if (isFT && elapsedMinutes >= 95) {
                  isFinished = true;
                  status = 'FT';
                } else if (hasLiveId || (isToday && elapsedMinutes < 100)) {
                  isFinished = false;
                  status = 'LIVE';
                } else if (elapsedMinutes >= 135) {
                  isFinished = true;
                  status = 'FT';
                }
              }
            } catch (e) {}
          }

          // Safe fallback: never assume FT if match is within playing window or has live ID
          if (!status) {
            if (hasLiveId || (isToday && elapsedMinutes < 100)) {
              status = 'LIVE';
              isFinished = false;
            } else {
              status = 'FT';
              isFinished = true;
            }
          }
        } else {
          isFinished = false;
          const timeClean = rawScore.match(/([0-2]?\d:[0-5]\d)/);
          scoreOrTime = wibToWita(timeClean ? timeClean[1] : '19:00');
          matchKickoffTime = scoreOrTime;
          status = isToday ? 'Hari Ini' : '';
        }

        matches.push({
          date: formatDateId(matchDateIso),
          isoDate: matchDateIso,
          homeTeam: home,
          awayTeam: away,
          scoreOrTime,
          status,
          isFinished,
          isToday,
          time: matchKickoffTime || (scoreOrTime && !scoreOrTime.includes('-') ? scoreOrTime : undefined),
        });
      }
    }
  }

  const roundM = html.match(/fixtures\/index\/BRI_SUPER_LEAGUE_[^\/]+\/(\d+)/);
  const currentRound = roundM ? parseInt(roundM[1], 10) : 9;

  return { standings, matches, currentRound };
}

async function scrapeFixturesRound(roundNum = 8) {
  const url = `https://ileague.id/fixtures/index/BRI_SUPER_LEAGUE_2026-27/${roundNum}/0`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const matches = [];
  const nowWita = new Date(Date.now() + 8 * 3600 * 1000);
  const todayIso = nowWita.toISOString().substring(0, 10);

  const sections = html.split(/<div align=["']left["'][^>]*class=["']col-md-12["']>/);
  for (const sec of sections.slice(1)) {
    const rowRegex = /href=["']https:\/\/ileague\.id\/result\/detail\/BRI_SUPER_LEAGUE_2026-27\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)["'][\s\S]*?<td style=["']border:0;["']>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = rowRegex.exec(sec)) !== null) {
      const dt = m[1];
      const home = cleanTeamName(m[2]);
      const away = cleanTeamName(m[3]);
      const rawCell = m[4].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      let scoreOrTime;
      let status;
      let isFinished;

      if (/\bFT\b/i.test(rawCell)) {
        isFinished = true;
        status = 'FT';
        const cleanScore = rawCell.replace(/\bFT\b/i, '').trim();
        scoreOrTime = cleanScore.includes(':') ? cleanScore.replace(':', ' - ') : cleanScore;
      } else if (!isMatchTime(rawCell) && rawCell.includes(':')) {
        isFinished = false;
        status = 'LIVE';
        const cleanScore = rawCell.replace(/\bLIVE\b/i, '').trim();
        scoreOrTime = cleanScore.includes(':') ? cleanScore.replace(':', ' - ') : cleanScore;
      } else {
        isFinished = false;
        const timeClean = rawCell.match(/([0-2]?\d:[0-5]\d)/);
        scoreOrTime = wibToWita(timeClean ? timeClean[1] : '19:00');
        status = dt === todayIso ? 'Hari Ini' : '';
      }

      matches.push({
        date: formatDateId(dt),
        isoDate: dt,
        homeTeam: home,
        awayTeam: away,
        scoreOrTime,
        status,
        isFinished,
        isToday: dt === todayIso,
      });
    }
  }
  return matches;
}

async function syncToGithub(jsonContent) {
  if (!GITHUB_TOKEN) return false;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`;
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Liga1-Node-Bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    let sha = null;
    const getRes = await fetch(url, { headers });
    if (getRes.ok) {
      const getJson = await getRes.json();
      sha = getJson.sha;
    }

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Auto-update Liga 1 live score [skip ci]',
        content: Buffer.from(jsonContent, 'utf8').toString('base64'),
        branch: 'main',
        ...(sha ? { sha } : {}),
      }),
    });

    if (putRes.ok) {
      log('GITHUB', `Successfully synced data.json to GitHub (${GITHUB_REPO})`);
      return true;
    } else {
      log('GITHUB', `GitHub PUT returned status ${putRes.status}`);
    }
  } catch (e) {
    log('GITHUB', `Error syncing to GitHub: ${e.message}`);
  }
  return false;
}

function getPollingState(data) {
  const matches = data.matches || [];
  const now = Date.now();
  const nowWita = new Date(now + 8 * 3600 * 1000);
  const todayWitaIso = nowWita.toISOString().substring(0, 10);

  let hasLive = false;
  let hasKickoffSoon = false;
  let hasPendingToday = false;
  let minTimeToKickoff = Infinity;

  for (const m of matches) {
    const isToday = (m.isoDate === todayWitaIso);

    // 1. Explicit LIVE status
    if (m.status && m.status.toUpperCase() === 'LIVE') {
      hasLive = true;
      break;
    }

    if (isToday) {
      const matchTime = m.time || m.scoreOrTime;
      const kickoffMs = getMatchKickoffMs(m.isoDate, matchTime);

      if (!m.isFinished && m.status !== 'FT') {
        if (kickoffMs) {
          const timeToKickoff = kickoffMs - now;
          if (timeToKickoff > 0 && timeToKickoff < minTimeToKickoff) {
            minTimeToKickoff = timeToKickoff;
          }

          // Playing window: 5 min before kickoff until 135 min after kickoff
          if (now >= kickoffMs - 5 * 60 * 1000 && now <= kickoffMs + 135 * 60 * 1000) {
            hasLive = true;
            break;
          }
          // Within 30 min before kickoff
          if (now >= kickoffMs - 30 * 60 * 1000 && now < kickoffMs) {
            hasKickoffSoon = true;
          }
        }
        hasPendingToday = true;
      }
    }
  }

  if (hasLive) return { delay: FAST_POLL_MS, label: 'LIVE 60s' };
  if (hasKickoffSoon) return { delay: 2 * 60 * 1000, label: 'PRE-MATCH 2m' };
  if (hasPendingToday) {
    if (minTimeToKickoff <= 2 * 3600 * 1000) {
      return { delay: PRE_MATCH_POLL_MS, label: 'PRE-MATCH 15m' };
    }
    const safeDelay = Math.min(IDLE_POLL_MS, Math.max(PRE_MATCH_POLL_MS, minTimeToKickoff - 2 * 3600 * 1000));
    return { delay: safeDelay, label: `PRE-MATCH ${Math.round(safeDelay / 60000)}m` };
  }
  return { delay: IDLE_POLL_MS, label: 'IDLE 2 Jam' };
}

async function runScraper() {
  const current = loadCurrentData();
  const beforeCanonical = JSON.stringify({ standings: current.standings, matches: current.matches });

  // Remember existing saved kickoff times so they don't get lost when matches finish
  const savedTimesMap = new Map();
  for (const oldM of (current.matches || [])) {
    if (oldM.time && !oldM.time.includes('-')) {
      savedTimesMap.set(`${oldM.homeTeam}_${oldM.awayTeam}`, oldM.time);
    }
  }

  const { standings: scrapedStandings, matches: scrapedMatches, currentRound: scrapedRound } = await scrapeIleague(savedTimesMap);

  const oldRound = current.round;
  const roundNum = scrapedRound || 9;
  current.round = `Pekan ${roundNum}`;
  const isNewRound = Boolean(oldRound && oldRound !== current.round);

  if (scrapedStandings.length >= 15) {
    const prevMap = new Map();
    for (const oldS of (current.standings || [])) {
      prevMap.set(oldS.team, isNewRound ? oldS.rank : (oldS.prevRank || oldS.rank));
    }
    for (const s of scrapedStandings) {
      if (s.prevRank === undefined) {
        s.prevRank = prevMap.get(s.team) || s.rank;
      }
    }
    current.standings = scrapedStandings;
  }
  const currentRoundMatches = await scrapeFixturesRound(roundNum);
  const nextRoundMatches = await scrapeFixturesRound(roundNum + 1);

  const matchMap = new Map();
  let order = 0;
  for (const m of nextRoundMatches) {
    const key = `${m.homeTeam}_${m.awayTeam}`;
    const time = (m.scoreOrTime && !m.scoreOrTime.includes('-')) ? m.scoreOrTime : (savedTimesMap.get(key) || '19:00');
    matchMap.set(key, { ...m, time, fixtureOrder: ++order });
  }
  for (const m of currentRoundMatches) {
    const key = `${m.homeTeam}_${m.awayTeam}`;
    const time = (m.scoreOrTime && !m.scoreOrTime.includes('-')) ? m.scoreOrTime : (savedTimesMap.get(key) || '19:00');
    matchMap.set(key, { ...m, time, fixtureOrder: ++order });
  }
  for (const m of scrapedMatches) {
    const key = `${m.homeTeam}_${m.awayTeam}`;
    const existing = matchMap.get(key);
    const time = (m.time && !m.time.includes('-'))
      ? m.time
      : (existing && existing.time && !existing.time.includes('-'))
        ? existing.time
        : (savedTimesMap.get(key) || '19:00');
    const fOrder = existing ? existing.fixtureOrder : ++order;
    matchMap.set(key, { ...existing, ...m, time, fixtureOrder: fOrder });
  }

  if (matchMap.size > 0) {
    const list = Array.from(matchMap.values());
    list.sort((a, b) => {
      const dateA = a.isoDate || '';
      const dateB = b.isoDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.time || '';
      const timeB = b.time || '';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (a.fixtureOrder || 0) - (b.fixtureOrder || 0);
    });
    current.matches = list;
  }

  const afterCanonical = JSON.stringify({ standings: current.standings, matches: current.matches });
  const changed = beforeCanonical !== afterCanonical;

  current.lastUpdated = Date.now();
  const jsonContent = JSON.stringify(current, null, 2) + '\n';
  fs.writeFileSync(DATA_FILE, jsonContent, 'utf8');

  return { current, changed, jsonContent };
}

let cachedData = loadCurrentData();

async function poll() {
  try {
    const { current, changed, jsonContent } = await runScraper();
    cachedData = current;

    const pollState = getPollingState(current);
    const todaySummary = (current.matches || [])
      .filter((m) => m.isToday)
      .map((m) => `${m.homeTeam} ${m.scoreOrTime} ${m.awayTeam}`)
      .join(' | ') || 'No matches today';

    if (changed) {
      log('UPDATE', `Live data changed! Today: [${todaySummary}]`);
      if (GITHUB_TOKEN) {
        await syncToGithub(jsonContent);
      }
    } else {
      log('POLLER', `Checked (Mode: ${pollState.label}) - ${todaySummary}`);
    }

    setTimeout(poll, pollState.delay);
  } catch (e) {
    log('ERROR', `Poll error: ${e.message}`);
    setTimeout(poll, 60000);
  }
}

// Embedded HTTP Server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0].replace(/\/+$/, '');
  if (url === '' || url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'Liga 1 Live Scraper (Node.js)',
      status: 'online',
      lastUpdated: cachedData.lastUpdated,
      mode: getPollingState(cachedData).label,
      githubSyncEnabled: Boolean(GITHUB_TOKEN),
    }, null, 2));
  } else if (url === '/data.json' || url === '/data') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(JSON.stringify(cachedData, null, 2));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

if (process.argv.includes('--once')) {
  (async () => {
    log('ONCE', 'Running single scrape execution...');
    const { current, changed } = await runScraper();
    log('ONCE', `Scrape complete. Total matches: ${current.matches?.length || 0}. Changed: ${changed}`);
    process.exit(0);
  })();
} else {
  server.listen(PORT, '0.0.0.0', () => {
    log('START', `Liga 1 Node Bot running on port ${PORT}`);
    if (GITHUB_TOKEN) log('START', `GitHub auto-sync enabled for ${GITHUB_REPO}`);
    poll();
  });
}

