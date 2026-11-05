// Late-join roster test. Host + projector run with the Supabase realtime
// websocket BLOCKED (BLOCK=0 to disable) — the worst case where the database
// INSERT event for a new team never arrives. A solo team then joins mid-game
// and buzzes: host and projector must show its name, never "Unknown".
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJ = path.resolve(DIR, '..')
const FIXTURE = path.join(DIR, 'fixtures', 'three-round-smoke.json')
const SHOTS = path.join(DIR, 'late-join-shots')
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || DIR, 'tapped-in-smoke', 'chrome-profile')
const ANSWER_BOX = 'textarea[placeholder="Type your response\u2026"]'
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const NAMES = ['Alpha Ales', 'Bravo Brews', 'Charlie Casks']
const LATE_NAME = 'Late Larry'
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
  await waitFor(p, () => [...document.querySelectorAll('button')].some(x => x.innerText.trim() === 'TAP IN!' && !x.hasAttribute('aria-disabled')) && !document.body.innerText.includes('Buzz window closed'), null, 25000, 'buzz button')
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'TAP IN!' && !x.hasAttribute('aria-disabled'))
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 190, clientY: 600 }))
  })
}
async function joinSolo(page, name) {
  await page.goto(`${BASE}/play`, { waitUntil: 'domcontentloaded' })
  await hasText(page, 'How are you playing?', 30000, `${name} choose-mode`)
  await click(page, 'On my own')
  await setInput(page, 'input[placeholder="Your name"]', name)
  await click(page, "Let's Go")
}

const BLOCK = process.env.BLOCK !== '0'
async function blockRealtime(page) {
  if (!BLOCK) return
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  await cdp.send('Network.setBlockedURLs', { urls: ['*/realtime/v1/*'] })
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, defaultViewport: null, userDataDir: PROFILE_DIR,
  args: ['--window-size=1500,950', '--window-position=40,40'], protocolTimeout: 180000,
})
let failed = 0
try {
  fs.mkdirSync(SHOTS, { recursive: true })
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const host = (await browser.pages())[0] ?? await browser.newPage()
  await host.setViewport({ width: 1440, height: 900 })
  await blockRealtime(host)
  await host.goto(`${BASE}/host`, { waitUntil: 'domcontentloaded' })
  await waitFor(host, () => /host sign in|create lobby|teams|scoreboard/.test(document.body.innerText.toLowerCase()), null, 30000, 'host initial')
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
  await click(host, 'Import JSON')
  await setInput(host, 'textarea', JSON.stringify(fixture))
  await click(host, 'Import')
  await hasText(host, 'Final Tap ✓', 30000, 'import')

  const projector = await browser.newPage()
  await projector.setViewport({ width: 1600, height: 900 })
  await blockRealtime(projector)
  await projector.goto(`${BASE}/projector`, { waitUntil: 'domcontentloaded' })

  for (const name of ['Alpha Ales', 'Bravo Brews']) {
    const p = await (await browser.createBrowserContext()).newPage()
    await p.setViewport(PHONE); await joinSolo(p, name); await hasText(p, "You're in", 20000, name)
  }
  await hasText(host, '2 joined', 20000)
  await click(host, 'Start Game')
  await hasText(host, 'Scoreboard', 20000, 'host game screen')
  await sleep(2500)
  if (await pageHas(host, 'Category Intros')) { await click(host, 'Skip intros'); await click(host, 'Skip'); await sleep(1500) }
  await sleep(2000)
  log('game running; realtime blocked on host+projector: ' + BLOCK)

  // ── late solo team ──
  const late = await (await browser.createBrowserContext()).newPage()
  await late.setViewport(PHONE)
  const t0 = Date.now()
  await joinSolo(late, LATE_NAME)
  await hasText(late, "You're in", 20000, 'late joined').catch(() => {})
  const hostSees = await softWait(host, LATE_NAME, 12000)
  log(`host saw late team after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${hostSees}`)
  const projSees = await softWait(projector, LATE_NAME, 12000)
  const rec = (n, ok, d) => { if (!ok) failed++; log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : ' — ' + d)) }
  rec('Host scoreboard lists the late team', hostSees, await snap(host))
  rec('Projector lists the late team', projSees, await snap(projector))

  // ── late team buzzes ──
  await hostClickClue(host, 'Round 1')
  await click(host, 'Open Buzzer')
  await tapBuzz(late)
  await sleep(4000)
  await shot(host, 'host-after-late-buzz'); await shot(projector, 'projector-after-late-buzz')
  rec('Host buzz list names the late team (no "Unknown")', !(await pageHas(host, 'Unknown')), await snap(host))
  rec('Projector buzz shows the late team (no "?")', await pageHas(projector, LATE_NAME), await snap(projector))
} catch (e) { failed++; log('ERROR ' + e.message) }
finally { await browser.close() }
log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
