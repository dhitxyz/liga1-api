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
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' WIB';
  console.log(`[${timeStr}] [${tag}] ${msg}`);
}

function cleanTeamName(raw) {
  if (!raw) return '';
  const upper = raw.trim().toUpperCase();
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
    const parts = timeStr.trim().split(':');
    const h = (parseInt(parts[0], 10) + 1) % 24;
    return `${String(h).padStart(2, '0')}:${parts[1]}`;
  } catch {
    return timeStr;
  }
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
    round: 'Pekan 7',
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
      signal: AbortSignal.timeout(12000),
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

async function scrapeIleague() {
  const html = await fetchHtml('https://ileague.id/');
  if (!html) return { standings: [], matches: [] };

  // Standings from full table page
  const standings = await scrapeStandings();

  // 2. Matches
  const matches = [];
  const accIdx = html.indexOf('accordionExample');
  if (accIdx !== -1) {
    const accHtml = html.substring(accIdx, accIdx + 35000);
    const cards = accHtml.split(/<div class=["']card["']/);
    const nowWib = new Date(Date.now() + 7 * 3600 * 1000);
    const todayIso = nowWib.toISOString().substring(0, 10);

    for (const c of cards.slice(1)) {
      const titles = Array.from(c.matchAll(/<img[^>]*title=["']([^"']+)["']/g)).map((m) => m[1]);
      const scoreM = c.match(/<span class=["']score-span["'][^>]*>([\s\S]*?)<\/span>/);
      const linkM = c.match(/BRI_SUPER_LEAGUE_2026-27\/(\d{4}-\d{2}-\d{2})/);

      if (titles.length >= 2) {
        const home = cleanTeamName(titles[0]);
        const away = cleanTeamName(titles[1]);
        const matchDateIso = linkM ? linkM[1] : todayIso;
        const rawScore = scoreM ? scoreM[1].replace(/<[^>]+>/g, '').trim() : '';
        const isLiveCard = /<span class=["']score-span["'][^>]*id=["']live_\d+["']/i.test(c);

        let isFinished = false;
        let scoreOrTime;
        let status;

        if (isLiveCard) {
          isFinished = false;
          status = 'LIVE';
          scoreOrTime = rawScore.includes(':') ? rawScore.replace(':', ' - ').trim() : '0 - 0';

          // Check live timeline on detail page for goal updates
          const detailLinkM = c.match(/href=["'](https:\/\/ileague\.id\/result\/detail\/[^"']+)["']/);
          if (detailLinkM) {
            try {
              const detailHtml = await fetchHtml(detailLinkM[1]);
              if (detailHtml) {
                const timelineIdx = detailHtml.indexOf('id="live_timeline"');
                if (timelineIdx !== -1) {
                  const tabPaneIdx = detailHtml.indexOf('id="live_lineup"', timelineIdx);
                  const timelineHtml = tabPaneIdx !== -1 ? detailHtml.substring(timelineIdx, tabPaneIdx) : detailHtml.substring(timelineIdx, timelineIdx + 80000);

                  const goalRegex = /<div class=["']alert alert-success col-lg-8([^"']*)["'][^>]*>([\s\S]*?)<\/div>/gi;
                  let m;
                  const homeGoals = new Set();
                  const awayGoals = new Set();
                  while ((m = goalRegex.exec(timelineHtml)) !== null) {
                    const isAway = m[1].includes('offset-lg-2');
                    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (/Goal!/i.test(text)) {
                      const minM = text.match(/(\d+)'/);
                      const min = minM ? minM[1] : '';
                      const playerM = text.match(/(?:GO+L!+\s*)([\w\s.]+?)(?:\s+mencetak|\s*$)/i);
                      const player = playerM ? playerM[1].trim() : text;
                      const key = `${min}_${player}`;
                      if (isAway) {
                        awayGoals.add(key);
                      } else {
                        homeGoals.add(key);
                      }
                    }
                  }
                  if (homeGoals.size > 0 || awayGoals.size > 0) {
                    scoreOrTime = `${homeGoals.size} - ${awayGoals.size}`;
                  }

                  // Auto-detect Full Time (FT) if match reached 90+ minutes
                  const minutes = Array.from(timelineHtml.matchAll(/(\d+)'/g)).map((x) => parseInt(x[1], 10));
                  const maxMinute = minutes.length > 0 ? Math.max(...minutes) : 0;
                  if (maxMinute >= 90) {
                    isFinished = true;
                    status = 'FT';
                  }
                }
              }
            } catch (e) {}
          }
        } else if (rawScore.includes(':') && !rawScore.toLowerCase().includes('wib') && !rawScore.toLowerCase().includes('wita')) {
          isFinished = true;
          scoreOrTime = rawScore.replace(':', ' - ').trim();
          status = 'FT';
        } else {
          isFinished = false;
          const timeClean = rawScore.match(/([0-2]?\d:[0-5]\d)/);
          scoreOrTime = wibToWita(timeClean ? timeClean[1] : '19:00');
          if (matchDateIso === todayIso) {
            status = 'Hari Ini';
          } else {
            status = '';
          }
        }

        matches.push({
          date: formatDateId(matchDateIso),
          isoDate: matchDateIso,
          homeTeam: home,
          awayTeam: away,
          scoreOrTime,
          status,
          isFinished,
          isToday: matchDateIso === todayIso,
        });
      }
    }
  }

  const roundM = html.match(/fixtures\/index\/BRI_SUPER_LEAGUE_[^\/]+\/(\d+)/);
  const currentRound = roundM ? parseInt(roundM[1], 10) : 8;

  return { standings, matches, currentRound };
}

async function scrapeFixturesRound(roundNum = 8) {
  const url = `https://ileague.id/fixtures/index/BRI_SUPER_LEAGUE_2026-27/${roundNum}/0`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const matches = [];
  const nowWib = new Date(Date.now() + 7 * 3600 * 1000);
  const todayIso = nowWib.toISOString().substring(0, 10);

  const sections = html.split(/<div align=["']left["'][^>]*class=["']col-md-12["']>/);
  for (const sec of sections.slice(1)) {
    const regex = /href=["']https:\/\/ileague\.id\/result\/detail\/BRI_SUPER_LEAGUE_2026-27\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)["'][\s\S]*?<span class=["']badge[^>]*>([\s\S]*?)<\/span>/g;
    let m;
    while ((m = regex.exec(sec)) !== null) {
      const dt = m[1];
      const home = cleanTeamName(m[2].replace(/_/g, ' '));
      const away = cleanTeamName(m[3].replace(/_/g, ' '));
      const rawBadge = m[4].replace(/<[^>]+>/g, '').trim();

      let scoreOrTime;
      let status;
      let isFinished;

      if (/^FT\b/i.test(rawBadge)) {
        isFinished = true;
        status = 'FT';
        scoreOrTime = rawBadge.replace(/^FT\s*/i, '').replace(':', ' - ').trim();
      } else {
        isFinished = false;
        scoreOrTime = wibToWita(rawBadge);
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
  let hasLive = false;
  let hasPendingToday = false;

  for (const m of matches) {
    if (m.status && m.status.toUpperCase() === 'LIVE') {
      hasLive = true;
      break;
    }
    if (m.isToday && !m.isFinished) {
      hasPendingToday = true;
    }
  }

  if (hasLive) return { delay: FAST_POLL_MS, label: 'LIVE 60s' };
  if (hasPendingToday) return { delay: PRE_MATCH_POLL_MS, label: 'PRE-MATCH 15m' };
  return { delay: IDLE_POLL_MS, label: 'IDLE 2 Jam' };
}

async function runScraper() {
  const current = loadCurrentData();
  const beforeCanonical = JSON.stringify({ standings: current.standings, matches: current.matches });

  const { standings: scrapedStandings, matches: scrapedMatches, currentRound: scrapedRound } = await scrapeIleague();

  if (scrapedStandings.length >= 15) {
    current.standings = scrapedStandings;
  }

  const roundNum = scrapedRound || 8;
  const currentRoundMatches = await scrapeFixturesRound(roundNum);
  const nextRoundMatches = await scrapeFixturesRound(roundNum + 1);

  const matchMap = new Map();
  let order = 0;
  for (const m of nextRoundMatches) {
    matchMap.set(`${m.homeTeam}_${m.awayTeam}`, { ...m, time: m.scoreOrTime, fixtureOrder: ++order });
  }
  for (const m of currentRoundMatches) {
    matchMap.set(`${m.homeTeam}_${m.awayTeam}`, { ...m, time: m.scoreOrTime, fixtureOrder: ++order });
  }
  for (const m of scrapedMatches) {
    const key = `${m.homeTeam}_${m.awayTeam}`;
    const existing = matchMap.get(key);
    const time = (existing && existing.time) ? existing.time : (m.scoreOrTime && m.scoreOrTime.includes(':') && !m.scoreOrTime.includes('-') ? m.scoreOrTime : '19:00');
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

  // Auto-apply finished matches to standings if ileague.id table has not updated yet
  if (current.standings && current.standings.length > 0) {
    for (const m of current.matches || []) {
      if (m.isFinished && m.scoreOrTime && m.scoreOrTime.includes('-')) {
        const parts = m.scoreOrTime.split('-').map((s) => parseInt(s.trim(), 10));
        if (!isNaN(parts[0]) && !isNaN(parts[1])) {
          const homeS = current.standings.find((s) => s.team.includes(m.homeTeam) || m.homeTeam.includes(s.team));
          const awayS = current.standings.find((s) => s.team.includes(m.awayTeam) || m.awayTeam.includes(s.team));
          if (homeS && homeS.played === 7 && m.date && m.date.includes('31 Okt')) {
            homeS.played = 8;
            if (parts[0] > parts[1]) {
              homeS.won += 1;
              homeS.points += 3;
            } else if (parts[0] === parts[1]) {
              homeS.draw += 1;
              homeS.points += 1;
            } else {
              homeS.lost += 1;
            }
            homeS.goalDiff += (parts[0] - parts[1]);
          }
          if (awayS && awayS.played === 7 && m.date && m.date.includes('31 Okt')) {
            awayS.played = 8;
            if (parts[1] > parts[0]) {
              awayS.won += 1;
              awayS.points += 3;
            } else if (parts[1] === parts[0]) {
              awayS.draw += 1;
              awayS.points += 1;
            } else {
              awayS.lost += 1;
            }
            awayS.goalDiff += (parts[1] - parts[0]);
          }
        }
      }
    }
    current.standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
      return b.won - a.won;
    });
    current.standings.forEach((s, idx) => s.rank = idx + 1);
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

