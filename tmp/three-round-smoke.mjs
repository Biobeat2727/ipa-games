// Tapped In! three-round smoke rehearsal.
//
// Drives host + projector + 3 phones (plus one late arrival) through
// Round 1 → Round 2 → Round 3 → Final Tap against the LIVE backend, asserting
// every Round-3 behaviour introduced by supabase/add_round_three_{1_enum,2_game_logic}.sql and
// src/lib/rounds.ts. Results print as PASS/FAIL lines; exit code 1 on any FAIL.
//
// PREREQUISITES
//   * supabase/add_round_three_1_enum.sql, _2_game_logic.sql AND _3_category_round_check.sql
//     have been applied (three separate runs) to the database this frontend points at (.env). Without it the Round 2 → Round 3 transition
//     fails with "invalid input value for enum room_status".
//   * Dev server on http://localhost:4173  (npm run dev -- --port 4173)
//   * puppeteer-core resolvable from this folder (same setup as tmp/load-test.mjs)
//   * Sign in as host in the Chrome window when prompted (only manual step).
//
// This creates and finishes a real room — run it against a dev/staging project
// or on a night nothing is live.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJ = path.resolve(DIR, '..')
const FIXTURE = path.join(DIR, 'fixtures', 'three-round-smoke.json')
const SHOTS = path.join(DIR, 'three-round-shots')
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || DIR, 'tapped-in-smoke', 'chrome-profile')
const ANSWER_BOX = 'textarea[placeholder="Type your response\u2026"]'
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const NAMES = ['Alpha Ales', 'Bravo Brews', 'Charlie Casks']
const LATE_NAME = 'Late Larry'

// Same table as src/lib/rounds.ts DOUBLE_TAP_FLOORS and public.double_tap_floor()
const DT_FLOOR = { round_1: 500, round_2: 2000, round_3: 3000 }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function record(name, ok, detail) {
  results.push({ name, ok })
  log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail && !ok ? ' — ' + detail : ''))
}
// A documented, pre-existing gap (commit bd1fb5f, resilience audit): reported so
// the run shows current reality, but it does not fail the gate.
function recordKnown(name, ok, detail) {
  results.push({ name, ok, known: true })
  log((ok ? 'PASS  ' : 'KNOWN ') + name + (detail && !ok ? ' — ' + detail : ''))
}

// ── Supabase REST (anon) — reads the same .env the app uses ──────────────
const env = Object.fromEntries(
  fs.readFileSync(path.join(PROJ, '.env'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const SB_URL = env.VITE_SUPABASE_URL, SB_KEY = env.VITE_SUPABASE_ANON_KEY
if (!SB_URL || !SB_KEY) throw new Error('.env is missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body = null; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
async function activeRoom() {
  const { body } = await rest('rooms?select=*&status=neq.finished&order=created_at.desc&limit=1')
  return Array.isArray(body) ? body[0] : null
}
const teamsOf = async roomId => (await rest(`teams?select=id,name,score,is_active&room_id=eq.${roomId}`)).body

// ── Page helpers (same shape as tmp/load-test.mjs) ───────────────────────
async function waitFor(page, fn, arg, timeout = 20000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await page.evaluate(fn, arg)) return true } catch {}
    await sleep(250)
  }
  throw new Error('timeout: ' + (label || String(arg)))
}
const hasText = (p, t, ms, l) => waitFor(p, x => document.body.innerText.toLowerCase().includes(x.toLowerCase()), t, ms, l || `text "${t}"`)
const pageHas = (p, t) => p.evaluate(x => document.body.innerText.toLowerCase().includes(x.toLowerCase()), t)
async function softWait(p, text, ms = 15000) { try { await hasText(p, text, ms); return true } catch { return false } }
const snap = p => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)).catch(() => '(unreadable)')

async function click(page, text, timeout = 20000) {
  await waitFor(page, t => [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.trim().startsWith(t)), text, timeout, 'button ' + text)
  await page.evaluate(t => [...document.querySelectorAll('button')].find(b => !b.disabled && b.innerText.trim().startsWith(t)).click(), text)
}
// Click the same button N times as fast as the page allows (no awaits between)
async function clickBurst(page, text, n) {
  await waitFor(page, t => [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.trim().startsWith(t)), text, 20000, 'button ' + text)
  return page.evaluate(({ t, n }) => {
    let clicked = 0
    for (let i = 0; i < n; i++) {
      const b = [...document.querySelectorAll('button')].find(x => !x.disabled && x.innerText.trim().startsWith(t))
      if (b) { b.click(); clicked++ }
    }
    return clicked
  }, { t: text, n })
}
async function setInput(page, sel, val) {
  await waitFor(page, s => !!document.querySelector(s), sel, 15000, sel)
  await page.evaluate(({ s, v }) => {
    const el = document.querySelector(s)
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, { s: sel, v: val })
}
let shotN = 0
async function shot(page, name) {
  try { await page.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`) }) } catch {}
}
async function reload(page) { await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(3500) }

// Host question list: clue buttons carry a <span class="font-mono"> value.
// Pick the first enabled clue under the given round heading, optionally a 🍺 one.
async function hostClickClue(host, roundLabel, { doubleTap = false } = {}) {
  await waitFor(host, ({ label, dt }) => {
    const heading = [...document.querySelectorAll('p')].find(p => p.innerText.trim().toLowerCase().startsWith(label.toLowerCase()))
    if (!heading) return false
    const section = heading.parentElement
    return [...section.querySelectorAll('button')].some(b => !b.disabled && b.querySelector('span.font-mono') && (dt ? b.innerText.includes('\ud83c\udf7a') : !b.innerText.includes('\ud83c\udf7a')))
  }, { label: roundLabel, dt: doubleTap }, 20000, `${roundLabel} ${doubleTap ? 'Double Tap' : 'clue'} button`)
  return host.evaluate(({ label, dt }) => {
    const heading = [...document.querySelectorAll('p')].find(p => p.innerText.trim().toLowerCase().startsWith(label.toLowerCase()))
    const section = heading.parentElement
    const b = [...section.querySelectorAll('button')].find(b => !b.disabled && b.querySelector('span.font-mono') && (dt ? b.innerText.includes('\ud83c\udf7a') : !b.innerText.includes('\ud83c\udf7a')))
    const value = parseInt(b.querySelector('span.font-mono').innerText)
    const text = b.innerText
    b.click()
    return { value, text }
  }, { label: roundLabel, dt: doubleTap })
}
async function tapBuzz(p) {
  await waitFor(p, () => [...document.querySelectorAll('button')].some(x => x.innerText.trim() === 'TAP IN!'), null, 25000, 'buzz button')
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'TAP IN!')
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 190, clientY: 600 }))
  })
}
async function answer(p, text) {
  await waitFor(p, s => !!document.querySelector(s), ANSWER_BOX, 90000, 'answer box')
  await setInput(p, ANSWER_BOX, text)
  await click(p, 'Submit Response')
}
async function judge(host, outcome) {
  await click(host, 'Judge', 30000)
  await waitFor(host, () => document.body.innerText.includes('\u2713 Correct') && !document.body.innerText.includes('Waiting for response\u2026'), null, 12000).catch(() => {})
  await click(host, outcome === 'correct' ? '\u2713 Correct' : '\u2717 Wrong')
  await sleep(900)
}
/** One regular clue: host picks from `roundLabel`'s list, `player` buzzes and is judged correct. */
async function playRegularClue(host, player, roundLabel) {
  const clue = await hostClickClue(host, roundLabel)
  await click(host, 'Open Buzzer')
  await tapBuzz(player)
  const answered = answer(player, 'What is the right answer?')
  await judge(host, 'correct')
  await answered.catch(() => {})
  await sleep(1200)
  return clue
}
async function joinSolo(page, name) {
  await page.goto(`${BASE}/play`, { waitUntil: 'domcontentloaded' })
  await hasText(page, 'How are you playing?', 30000, `${name} choose-mode`)
  await click(page, 'On my own')
  await setInput(page, 'input[placeholder="Your name"]', name)
  await click(page, "Let's Go")
}

// ── Main ─────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, defaultViewport: null,
  // Outside the repo: a profile under tmp/ made Vite's watcher reload every page
  // on each Chrome cache write. Seeded once from tmp/chrome-profile (host sign-in).
  userDataDir: PROFILE_DIR,
  args: ['--window-size=1500,950', '--window-position=40,40'], protocolTimeout: 180000,
})

try {
  fs.mkdirSync(SHOTS, { recursive: true })
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const twoRound = { ...fixture, rounds: fixture.rounds.filter(r => r.round !== 3) }

  // ── Host: sign in, reset, create lobby ──
  const host = (await browser.pages())[0] ?? await browser.newPage()
  await host.setViewport({ width: 1440, height: 900 })
  await host.goto(`${BASE}/host`, { waitUntil: 'domcontentloaded' })
  await waitFor(host, () => {
    const t = document.body.innerText.toLowerCase()
    return t.includes('host sign in') || t.includes('create lobby') || t.includes('teams') || t.includes('scoreboard')
  }, null, 30000, 'host initial screen')
  if (await pageHas(host, 'Host sign in')) {
    log('### ACTION NEEDED: sign in as host in the Chrome window (waiting up to 8 min)')
    await waitFor(host, () => !document.body.innerText.toLowerCase().includes('host sign in'), null, 8 * 60_000, 'host sign-in')
  }
  await sleep(1500)
  if (await pageHas(host, 'Scoreboard')) {
    await click(host, 'New Game'); await click(host, 'Yes'); await sleep(4000)
    await waitFor(host, () => /create lobby|teams/.test(document.body.innerText.toLowerCase()), null, 30000, 'after reset')
  }
  if (await host.evaluate(() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'New Game') && document.body.innerText.toLowerCase().includes('teams'))) {
    await click(host, 'New Game'); await sleep(1200)
  }
  if (await pageHas(host, 'Create Lobby')) await click(host, 'Create Lobby')
  await hasText(host, 'Teams', 20000, 'lobby')
  log('lobby ready')

  // ── IMPORT 1: valid three-round fixture ──
  await click(host, 'Import JSON')
  await setInput(host, 'textarea', JSON.stringify(fixture))
  await click(host, 'Import')
  const summaryOk = await softWait(host, 'R1: 2 cats \u00b7 R2: 2 cats \u00b7 R3: 2 cats \u00b7 Final Tap \u2713', 30000)
  record('Import: valid three-round fixture → lobby shows R1/R2/R3 + Final Tap', summaryOk, await snap(host))
  await shot(host, 'lobby-three-round-summary')

  // ── IMPORT 2: two-round fixture must be rejected BEFORE anything is deleted ──
  await click(host, 'Replace')
  await setInput(host, 'textarea', JSON.stringify(twoRound))
  await click(host, 'Import')
  const rejected = await softWait(host, 'missing Round 3', 15000)
  record('Import: two-round fixture rejected with a host-facing "missing Round 3" error', rejected, await snap(host))
  const summaryKept = await pageHas(host, 'R3: 2 cats')
  record('Import: rejected file left the existing three-round content intact', summaryKept, await snap(host))
  await shot(host, 'lobby-two-round-rejected')
  await click(host, 'Cancel')

  // ── Projector + 3 phones ──
  const projector = await browser.newPage()
  await projector.setViewport({ width: 1600, height: 900 })
  await projector.goto(`${BASE}/projector`, { waitUntil: 'domcontentloaded' })

  const ctxs = [], players = []
  for (let i = 0; i < NAMES.length; i++) {
    const ctx = await browser.createBrowserContext()
    const p = await ctx.newPage()
    await p.setViewport(PHONE)
    await joinSolo(p, NAMES[i])
    await hasText(p, "You're in", 20000, `${NAMES[i]} lobby`)
    ctxs.push(ctx); players.push(p)
  }
  const [A, B, C] = players
  await hasText(host, '3 joined', 20000)

  // Start game requires the three-round content — button must read "Start Game"
  record('Lobby: Start Game enabled with rounds 1–3 present',
    await host.evaluate(() => [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.trim() === 'Start Game')))
  await click(host, 'Start Game')
  await hasText(host, 'Scoreboard', 20000, 'host game screen')
  await sleep(2500)
  if (await pageHas(host, 'Category Intros')) { await click(host, 'Skip intros'); await sleep(1500) }
  record('Round 1: host list marks Round 1 as now playing', await softWait(host, 'Round 1 \u2014 now playing', 10000), await snap(host))
  record('Round 1: projector board labelled Round 1', await softWait(projector, 'Round 1', 15000), await snap(projector))

  // ── ROUND 1: one clue to Alpha, then end the round early ──
  await playRegularClue(host, A, 'Round 1')
  await click(host, 'End Round 1 early')
  await hasText(host, 'Ready for Round 2?', 10000)
  await click(host, 'Show Scores & Start Round 2')
  record('R1 intermission: phone announces Round 2', await softWait(A, 'Round 2 is coming', 15000), await snap(A))
  record('R1 intermission: projector announces Round 2', await softWait(projector, 'Round 2 up next', 15000), await snap(projector))
  await shot(A, 'phone-r1-intermission'); await shot(projector, 'projector-r1-intermission')
  await click(host, 'Begin Round 2')
  record('Round 2: phone splash "ROUND 2"', await softWait(A, 'ROUND 2', 8000), await snap(A))
  record('Round 2: projector board labelled Round 2', await softWait(projector, 'Round 2', 15000), await snap(projector))
  record('Round 2: host list marks Round 2 as now playing', await softWait(host, 'Round 2 \u2014 now playing', 10000), await snap(host))
  await sleep(3000)
  if (await pageHas(host, 'Category Intros')) { await click(host, 'Skip intros'); await sleep(1500) }
  {
    const room = await activeRoom()
    record('Round 2: rooms.status = round_2', room?.status === 'round_2', room?.status)
  }

  // ── ROUND 2: one clue to Bravo, MANUAL early advance, refresh during intermission, rapid clicks ──
  await playRegularClue(host, B, 'Round 2')
  await click(host, 'End Round 2 early')
  record('Round 2: manual early advance offers Round 3 (not Final Tap)', await softWait(host, 'Ready for Round 3?', 10000), await snap(host))
  await click(host, 'Show Scores & Start Round 3')
  record('R2 intermission: phone announces Round 3', await softWait(B, 'Round 3 is coming', 15000), await snap(B))
  record('R2 intermission: projector announces Round 3', await softWait(projector, 'Round 3 up next', 15000), await snap(projector))

  // Refresh a phone + projector DURING the Round 2 intermission
  await reload(C); await reload(projector)
  record('R2 intermission: phone refresh restores the score map (not the board)', await softWait(C, 'Round Two Down', 20000), await snap(C))
  record('R2 intermission: projector refresh restores the score map', await softWait(projector, 'Round Two Down', 20000), await snap(projector))
  await shot(C, 'phone-r2-intermission-after-refresh')

  // Rapid transition clicks must land on Round 3 exactly once — never Final Tap
  const bursts = await clickBurst(host, 'Begin Round 3', 5)
  log(`Begin Round 3 clicked ${bursts}x in one tick`)
  await sleep(4000)
  {
    const room = await activeRoom()
    record('Rapid clicks: rooms.status = round_3 (no skipped round)', room?.status === 'round_3', room?.status)
    record('Rapid clicks: host never reached Final Tap', !(await pageHas(host, 'Active Teams')) && !(await pageHas(host, 'Open Wagering')), await snap(host))
  }
  record('Round 3: phone splash "ROUND 3" / Round 3 board', await softWait(A, 'ROUND 3', 8000) || await softWait(A, 'Smoke R3', 8000), await snap(A))
  record('Round 3: projector board labelled Round 3', await softWait(projector, 'Round 3', 15000), await snap(projector))
  record('Round 3: host list marks Round 3 as now playing', await softWait(host, 'Round 3 \u2014 now playing', 10000), await snap(host))
  await sleep(3000)
  if (await pageHas(host, 'Category Intros')) { await click(host, 'Skip intros'); await sleep(1500) }
  await shot(projector, 'projector-round3-board'); await shot(A, 'phone-round3-board')

  // ── ROUND 3: regular clue claim + judgment (Charlie) ──
  const r3Clue = await playRegularClue(host, C, 'Round 3')
  {
    const teams = await teamsOf((await activeRoom()).id)
    const c = teams.find(t => t.name === NAMES[2])
    record(`Round 3: regular clue judged — ${NAMES[2]} scored +${r3Clue.value}`, c?.score === r3Clue.value, JSON.stringify(c))
    record('Round 3: every team still is_active = true', teams.every(t => t.is_active), JSON.stringify(teams))
  }

  // ── ROUND 3: late team join ──
  const lateCtx = await browser.createBrowserContext()
  const late = await lateCtx.newPage()
  await late.setViewport(PHONE)
  await joinSolo(late, LATE_NAME)
  await hasText(late, "You're in", 20000, 'late arrival joined').catch(() => {})
  const lateIn = await softWait(late, 'Smoke R3', 20000) || await softWait(late, 'is choosing', 5000)
  record('Round 3: late arrival can create a team and lands on the Round 3 board', lateIn, await snap(late))
  record('Round 3: late arrival is not parked on the lobby waiting screen', !(await pageHas(late, 'Waiting for the host to start')), await snap(late))
  await shot(late, 'phone-late-join-round3')

  // ── ROUND 3: refresh host, phone, projector ──
  await reload(host); await reload(A); await reload(projector)
  record('Round 3: host refresh restores Round 3', await softWait(host, 'Round 3 \u2014 now playing', 20000), await snap(host))
  record('Round 3: phone refresh restores the Round 3 board', await softWait(A, 'Smoke R3', 20000), await snap(A))
  record('Round 3: projector refresh restores the Round 3 board', await softWait(projector, 'Round 3', 20000), await snap(projector))

  // ── ROUND 3: Double Tap with matching host / phone / database limits ──
  {
    const room = await activeRoom()
    const teams = await teamsOf(room.id)
    const alpha = teams.find(t => t.name === NAMES[0])
    const expectedMax = Math.max(alpha.score, DT_FLOOR.round_3)

    await hostClickClue(host, 'Round 3', { doubleTap: true })
    await hasText(host, 'Pick the team taking this Double Tap', 10000)
    await click(host, NAMES[0])
    record(`Round 3 DT: host panel shows max ${expectedMax} pts`, await softWait(host, `max ${expectedMax} pts`, 10000), await snap(host))
    record(`Round 3 DT: phone shows Max: $${expectedMax.toLocaleString()}`, await softWait(A, `Max: $${expectedMax.toLocaleString()}`, 15000), await snap(A))
    await shot(A, 'phone-round3-double-tap-wager')

    // Database limit, hit directly: an over-max wager must be refused, a legal one accepted.
    // src/lib/session.ts stores the player identity under this key
    const sessionId = await A.evaluate(() => localStorage.getItem('trivia_session_id'))
    if (sessionId) {
      const over = await rpc('confirm_question_selection', { p_room_id: room.id, p_team_id: alpha.id, p_question_id: room.pending_question_id, p_session_id: sessionId, p_wager: expectedMax + 1 })
      record(`Round 3 DT: database refuses wager ${expectedMax + 1} (> max)`, over.body === false, JSON.stringify(over))
      const under = await rpc('confirm_question_selection', { p_room_id: room.id, p_team_id: alpha.id, p_question_id: room.pending_question_id, p_session_id: sessionId, p_wager: 4 })
      record('Round 3 DT: database refuses wager 4 (< 5)', under.body === false, JSON.stringify(under))
    } else {
      record('Round 3 DT: database limit probe (session id not found in localStorage — skipped)', false, 'adjust the localStorage key lookup')
    }

    // Phone: over-max is not lockable, max is
    await setInput(A, 'input[type="number"]', String(expectedMax + 1))
    const overDisabled = await A.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.startsWith('Lock In')); return !!b && b.disabled })
    record('Round 3 DT: phone Lock In disabled for an over-max wager', overDisabled)
    await setInput(A, 'input[type="number"]', String(expectedMax))
    await click(A, 'Lock In')
    record(`Round 3 DT: host preview shows ${expectedMax} pts wagered`, await softWait(host, `${expectedMax} pts wagered`, 15000), await snap(host))
    await sleep(1500) // a real host reads the clue aloud before opening the buzzer
    await click(host, 'Open Buzzer')
    await answer(A, 'What is the double tap answer?')
    await click(host, '\u2713 Correct', 30000)
    await sleep(1500)
    const after = (await teamsOf(room.id)).find(t => t.name === NAMES[0])
    record(`Round 3 DT: judge_buzz accepted the wager — ${NAMES[0]} +${expectedMax}`, after?.score === alpha.score + expectedMax, JSON.stringify(after))
  }

  // ── ROUND 3 → FINAL TAP ──
  await click(host, 'End Round 3 early')
  record('Round 3 complete: host offers Final Tap', await softWait(host, 'Ready for Final Tap?', 10000), await snap(host))
  await click(host, 'Show Scores & Start Final Tap')
  record('R3 intermission: phone announces Final Tap', await softWait(A, 'Final Tap is next', 15000), await snap(A))
  record('R3 intermission: projector announces Final Tap', await softWait(projector, 'Final Tap up next', 15000), await snap(projector))
  {
    const teams = await teamsOf((await activeRoom()).id)
    record('Before Final Tap: no team eliminated yet (all is_active)', teams.every(t => t.is_active), JSON.stringify(teams))
  }
  await click(host, 'Start Final Tap')
  await hasText(host, 'Active Teams', 20000, 'FT starting panel')
  record('Final Tap: host found the Final question (no "No Final Tap question found" warning)', !(await pageHas(host, 'No Final Tap question found')), await snap(host))
  record('Final Tap: category is the Final block, not a Round 3 board', await softWait(A, 'Smoke Final', 15000), await snap(A))
  {
    const room = await activeRoom()
    const teams = await teamsOf(room.id)
    const larry = teams.find(t => t.name === LATE_NAME)
    record('Final Tap: rooms.status = final_jeopardy', room.status === 'final_jeopardy', room.status)
    record('Final Tap: only the 0-point late team is eliminated', larry?.is_active === false && teams.filter(t => t.name !== LATE_NAME).every(t => t.is_active), JSON.stringify(teams))
  }
  await shot(host, 'host-final-tap-start')

  // Wager → question → review → finished, with refresh recovery at each step
  await click(host, 'Open Wagering')
  await hasText(A, 'Enter your wager', 20000)
  await reload(B)
  record('Final Tap: phone refresh during wagering returns to the wager form', await softWait(B, 'wager', 20000), await snap(B))
  for (const p of [A, B, C]) { await setInput(p, 'input[type="number"]', '50'); await click(p, 'Lock In Wager', 12000) }
  await sleep(1500)
  await click(host, 'Reveal Question')
  await waitFor(A, s => !!document.querySelector(s), ANSWER_BOX, 20000, 'FJ question')
  record('Final Tap: phones show the null-value Final clue text', await softWait(A, 'SMOKE FINAL TAP CLUE', 10000), await snap(A))
  record('Final Tap: phones did NOT get a Round 3 clue', !(await pageHas(A, 'belongs to Round 3')))
  await reload(C)
  record('Final Tap: phone refresh during the question restores clue + timer', await softWait(C, 'SMOKE FINAL TAP CLUE', 20000), await snap(C))
  for (const p of [A, B, C]) { await setInput(p, ANSWER_BOX, 'What is the Final Tap?'); await click(p, 'Submit Response', 8000) }
  await sleep(2000)
  try { await click(host, 'End Timer Early', 8000) } catch {}
  await hasText(host, 'Team 1 of', 25000, 'review')
  await reload(host)
  // Host boot after a reload: session → room → teams → Game mount → Final Tap
  // rehydrate (half a dozen sequential queries). Wait for the game shell first,
  // then the review card, and keep the RIGHT panel text on failure.
  await softWait(host, 'Scoreboard', 30000)
  const reviewBack = await softWait(host, 'Team 1 of', 40000)
  const rightPanel = await host.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(-400)).catch(() => '(unreadable)')
  record('Final Tap: host refresh during review resumes review', reviewBack, rightPanel)
  for (let r = 0; r < 3; r++) {
    await waitFor(host, n => document.body.innerText.toLowerCase().includes('team ' + n + ' of'), r + 1, 15000, 'review ' + (r + 1))
    if (await host.evaluate(() => [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.startsWith('Skip Team')))) await click(host, 'Skip Team')
    else await click(host, '\u2713 Correct')
    await sleep(900)
  }
  record('Game over: phones reach the results screen', await softWait(A, 'game over', 30000), await snap(A))
  // Known gap (pre-existing, unrelated to Round 3): room discovery excludes finished
  // rooms, so a phone/projector refreshed AFTER game over cannot find its room and
  // falls back to the waiting screen. Recorded, not gated.
  await reload(B)
  recordKnown('Game over: phone refresh keeps the results (finished-game recovery — known gap)', await softWait(B, 'game over', 20000), await snap(B))
  await reload(projector)
  recordKnown('Game over: projector refresh keeps the winner screen (known gap)', await softWait(projector, 'wins', 20000) || await softWait(projector, 'game over', 5000), await snap(projector))
  {
    const { body } = await rest(`rooms?select=status,final_phase&order=created_at.desc&limit=1`)
    record('Game over: rooms.status = finished, final_phase = done', body?.[0]?.status === 'finished' && body?.[0]?.final_phase === 'done', JSON.stringify(body))
  }
  await shot(A, 'phone-game-over'); await shot(projector, 'projector-game-over')
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  process.exitCode = 1
  try {
    let n = 0
    for (const ctx of browser.browserContexts()) for (const pg of await ctx.pages()) {
      await pg.screenshot({ path: path.join(SHOTS, `zz-failure-${n}.png`) }).catch(() => {})
      console.error(`--- page ${n} (${pg.url()}):\n${(await pg.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => ''))}`)
      n++
    }
  } catch {}
} finally {
  console.log('\n===== RESULTS =====')
  const failed = results.filter(r => !r.ok && !r.known)
  const known  = results.filter(r => !r.ok && r.known)
  results.forEach(r => console.log((r.ok ? 'PASS  ' : r.known ? 'KNOWN ' : 'FAIL  ') + r.name))
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed` + (known.length ? `, ${known.length} known gap(s) not gated` : ''))
  if (failed.length) process.exitCode = 1
  await sleep(3000)
  await browser.close()
}
