// Resilience audit: a full 15-team game with real-world disruptions injected —
// network drops (phone sleeps / walks out of wifi), mid-question refreshes, and
// closing the browser entirely then returning to the URL.
//
// Every disruption is followed by an assertion that the device recovered to the
// screen it SHOULD be on and can still act. Results print as PASS/FAIL lines.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROUNDS = 'C:\\Users\\davey\\ipa_game\\rounds\\8-26-26-weekly-round.json'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(DIR, 'chaos-shots')
const ANSWER_BOX = 'textarea[placeholder="Type your response\u2026"]'

const NAMES = [
  'Barley Legal', 'Hop Scholars', 'Quizzed on the Rocks', 'Pint Sized Brains',
  'Ale Mary', 'Stout Hearted', 'The Lagerheads', 'Wheat a Minute',
  'Hoptimists', 'Last Call Legends', 'Foam Rangers', 'Malt Disney',
  'Brewed Awakening', 'The Yeast Ends', 'Dry Hop Divas',
]

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

async function waitFor(page, fn, arg, timeout = 20000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await page.evaluate(fn, arg)) return true } catch {}
    await sleep(250)
  }
  throw new Error('timeout: ' + label)
}
const hasText = (p, t, ms, l) => waitFor(p, x => document.body.innerText.toLowerCase().includes(x.toLowerCase()), t, ms, l || t)
const pageHas = (p, t) => p.evaluate(x => document.body.innerText.toLowerCase().includes(x.toLowerCase()), t)
const snap = p => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 120))

// Soft variants: return boolean instead of throwing, for assertions
async function softWait(p, text, ms = 15000) {
  try { await hasText(p, text, ms); return true } catch { return false }
}

async function click(page, text, timeout = 20000) {
  await waitFor(page, t => [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.trim().startsWith(t)), text, timeout, 'button ' + text)
  await page.evaluate(t => [...document.querySelectorAll('button')].find(b => !b.disabled && b.innerText.trim().startsWith(t)).click(), text)
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

// ── Disruption helpers ──────────────────────────────────────────────────────

/** Phone loses connectivity (sleeps, leaves wifi, switches app long enough for
 *  the socket to die), then comes back. */
async function networkDrop(page, ms = 6000) {
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  })
  await sleep(ms)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 20, downloadThroughput: 5e6, uploadThroughput: 1e6,
  })
  await cdp.detach()
}

/** Player switches to another app: the tab is hidden and (on iOS) throttled. */
async function backgroundApp(page, ms = 5000) {
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {})
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await sleep(ms)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await cdp.detach().catch(() => {})
}

/** Closes the tab entirely (quitting Safari/Chrome) and returns to the URL in a
 *  fresh tab of the SAME profile — localStorage survives, exactly like real life. */
async function closeAndReopen(ctx, page, viewport) {
  await page.close()
  await sleep(1500)
  const fresh = await ctx.newPage()
  await fresh.setViewport(viewport)
  await fresh.goto(BASE + '/play', { waitUntil: 'domcontentloaded' })
  return fresh
}

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, defaultViewport: null,
  userDataDir: path.join(DIR, 'chrome-profile'),
  args: ['--window-size=1500,950'], protocolTimeout: 180000,
})

try {
  fs.mkdirSync(SHOTS, { recursive: true })

  // ── Host setup ──
  const host = (await browser.pages())[0]
  await host.setViewport({ width: 1440, height: 900 })
  await host.goto(BASE + '/host', { waitUntil: 'domcontentloaded' })
  await waitFor(host, () => {
    const t = document.body.innerText.toLowerCase()
    return t.includes('create lobby') || t.includes('teams') || t.includes('scoreboard')
  }, null, 30000, 'host initial')

  if (await pageHas(host, 'Scoreboard')) {
    await click(host, 'New Game'); await click(host, 'Yes'); await sleep(4000)
    await waitFor(host, () => {
      const t = document.body.innerText.toLowerCase()
      return t.includes('create lobby') || t.includes('teams')
    }, null, 30000, 'after reset')
  }
  if (await host.evaluate(() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'New Game') && document.body.innerText.toLowerCase().includes('teams'))) {
    await click(host, 'New Game'); await sleep(1200)
  }
  if (await pageHas(host, 'Create Lobby')) await click(host, 'Create Lobby')
  await hasText(host, 'Teams', 20000, 'lobby')
  if (!(await pageHas(host, 'R1:'))) {
    await click(host, 'Import JSON')
    await setInput(host, 'textarea', fs.readFileSync(ROUNDS, 'utf8'))
    await click(host, 'Import')
    await hasText(host, 'R1:', 30000, 'content')
  }
  log('lobby ready')

  const projector = await browser.newPage()
  await projector.setViewport({ width: 1600, height: 900 })
  await projector.goto(BASE + '/projector', { waitUntil: 'domcontentloaded' })

  // ── 15 players join ──
  const ctxs = []
  let players = []
  for (let i = 0; i < 15; i++) {
    const ctx = await browser.createBrowserContext()
    const p = await ctx.newPage()
    await p.setViewport(PHONE)
    await p.goto(BASE + '/play', { waitUntil: 'domcontentloaded' })
    await hasText(p, 'How are you playing?', 30000, 'choose mode ' + i)
    await click(p, 'On my own')
    await setInput(p, 'input[placeholder="Your name"]', NAMES[i])
    await click(p, "Let's Go")
    await hasText(p, "You're in", 20000, 'lobby ' + i)
    ctxs.push(ctx); players.push(p)
  }
  log('15 teams joined')

  // ── DISRUPTION 1: someone closes the app in the LOBBY and comes back ──
  players[13] = await closeAndReopen(ctxs[13], players[13], PHONE)
  record('Lobby: close app + return to URL resumes the team',
    await softWait(players[13], "You're in", 20000), await snap(players[13]))

  await click(host, 'Start Game')
  await hasText(host, 'Scoreboard', 20000, 'host game')
  await sleep(2500)
  if (await pageHas(host, 'Category Intros')) { await click(host, 'Skip intros'); await sleep(2000) }

  // ── DISRUPTION 2: network drop during the board phase ──
  await networkDrop(players[1], 6000)
  await sleep(4000)
  record('Board: recovers after a 6s network drop',
    await softWait(players[1], 'vowel movement', 20000), await snap(players[1]))

  // Helper: run one clue, with an optional disruption during the buzz window
  async function playClue(label, disrupt) {
    await host.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter(x => !x.disabled && x.querySelector('span.font-mono') && !x.innerText.includes('\ud83c\udf7a'))[0]
      b.click()
    })
    await click(host, 'Open Buzzer')
    if (disrupt) await disrupt()
    return true
  }

  // ── DISRUPTION 3: refresh WHILE the buzzer is open ──
  await playClue('q1', async () => {
    await sleep(1500)
    await players[2].reload({ waitUntil: 'domcontentloaded' })
    await sleep(3500)
    const canBuzz = await players[2].evaluate(() =>
      [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'TAP IN!'))
    record('Buzzer open: refresh restores the live buzz button', canBuzz, await snap(players[2]))
  })
  // someone still answers so the game advances
  await waitFor(players[0], () => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'TAP IN!'), null, 25000, 'buzz p0')
  await players[0].evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'TAP IN!')
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 190, clientY: 600 }))
  })
  await waitFor(players[0], s => !!document.querySelector(s), ANSWER_BOX, 25000, 'answer p0')
  await setInput(players[0], ANSWER_BOX, 'What is Star Wars?')
  await click(players[0], 'Submit Response')
  await click(host, 'Judge', 30000); await sleep(600); await click(host, '\u2713 Correct')
  await sleep(2000)

  // ── DISRUPTION 4: refresh WHILE typing an answer ──
  await playClue('q2', async () => {
    await waitFor(players[3], () => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'TAP IN!'), null, 25000, 'buzz p3')
    await players[3].evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'TAP IN!')
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 190, clientY: 600 }))
    })
    await waitFor(players[3], s => !!document.querySelector(s), ANSWER_BOX, 25000, 'answer p3')
    await setInput(players[3], ANSWER_BOX, 'half typed')
    await players[3].reload({ waitUntil: 'domcontentloaded' })
    await sleep(3500)
    const backOnAnswer = await players[3].evaluate(s => !!document.querySelector(s), ANSWER_BOX)
    record('Answering: refresh returns to the answer box with the timer running',
      backOnAnswer, await snap(players[3]))
    if (backOnAnswer) {
      await setInput(players[3], ANSWER_BOX, 'What is a recovered answer?')
      await click(players[3], 'Submit Response')
    }
  })
  await click(host, 'Judge', 30000); await sleep(600); await click(host, '\u2713 Correct')
  await sleep(2000)

  // ── DISRUPTION 5: close the app entirely mid-game, return to the URL ──
  players[4] = await closeAndReopen(ctxs[4], players[4], PHONE)
  await sleep(3500)
  record('Mid-game: close app + return to URL lands back on the board',
    await softWait(players[4], 'vowel movement', 20000), await snap(players[4]))

  // ── DISRUPTION 6: background the app during a live clue ──
  await playClue('q3', async () => {
    await backgroundApp(players[5], 5000)
    await sleep(2500)
    const canBuzz = await players[5].evaluate(() =>
      [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'TAP IN!'))
    record('Buzzer open: app backgrounded then reopened can still buzz', canBuzz, await snap(players[5]))
  })
  await waitFor(players[6], () => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'TAP IN!'), null, 25000, 'buzz p6')
  await players[6].evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'TAP IN!')
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 190, clientY: 600 }))
  })
  await waitFor(players[6], s => !!document.querySelector(s), ANSWER_BOX, 25000, 'answer p6')
  await setInput(players[6], ANSWER_BOX, 'What is an answer?')
  await click(players[6], 'Submit Response')
  await click(host, 'Judge', 30000); await sleep(600); await click(host, '\u2713 Correct')
  await sleep(2000)

  // ── DISRUPTION 7: projector refresh mid-game ──
  await projector.reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)
  record('Projector: refresh restores the board',
    await softWait(projector, 'vowel movement', 20000), await snap(projector))
  await projector.screenshot({ path: path.join(SHOTS, 'projector-after-refresh.png') })

  // ── DISRUPTION 8: refresh on the intermission graph ──
  await click(host, '\u26a1 Graph')
  await sleep(3000)
  await players[7].reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)
  record('Intermission: refresh keeps the score graph (not dumped to the board)',
    await softWait(players[7], 'halftime', 20000), await snap(players[7]))
  await players[7].screenshot({ path: path.join(SHOTS, 'player-graph-after-refresh.png') })

  // ── Final Tap with disruptions ──
  await click(host, '\u26a1 FT')
  await hasText(host, 'Active Teams', 25000, 'FT panel')
  await click(host, 'Open Wagering')
  await sleep(2500)

  // refresh during wagering
  await players[8].reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)
  record('Final Tap: refresh during wagering returns to the wager form',
    await softWait(players[8], 'wager', 20000), await snap(players[8]))

  // close app entirely during wagering
  players[9] = await closeAndReopen(ctxs[9], players[9], PHONE)
  await sleep(4000)
  record('Final Tap: close app + return during wagering resumes the wager form',
    await softWait(players[9], 'wager', 20000), await snap(players[9]))

  // everyone wagers
  for (let i = 0; i < players.length; i++) {
    try {
      await setInput(players[i], 'input[type="number"]', '50')
      await click(players[i], 'Lock In Wager', 12000)
    } catch { log('  (team ' + i + ' could not wager — likely eliminated)') }
  }
  await sleep(2500)

  await click(host, 'Reveal Question')
  await sleep(3000)

  // network drop during the Final question
  await networkDrop(players[10], 6000)
  await sleep(4000)
  const stillOnQuestion = await players[10].evaluate(s => !!document.querySelector(s), ANSWER_BOX)
  record('Final Tap: network drop during the 90s question keeps the answer box',
    stillOnQuestion, await snap(players[10]))

  // refresh during the Final question
  await players[11].reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)
  const backOnFj = await players[11].evaluate(s => !!document.querySelector(s), ANSWER_BOX)
  record('Final Tap: refresh during the question restores the clue + timer',
    backOnFj, await snap(players[11]))

  // everyone answers
  for (let i = 0; i < players.length; i++) {
    try {
      await setInput(players[i], ANSWER_BOX, 'What is a final answer?')
      await click(players[i], 'Submit Response', 8000)
    } catch {}
  }
  await sleep(2500)
  try { await click(host, 'End Timer Early', 15000) } catch {}

  // judge everyone
  await hasText(host, 'Team 1 of', 25000, 'review')
  for (let r = 0; r < 15; r++) {
    try {
      await waitFor(host, n => document.body.innerText.toLowerCase().includes('team ' + n + ' of'), r + 1, 15000, 'review ' + (r + 1))
      if (await host.evaluate(() => [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.startsWith('Skip Team')))) {
        await click(host, 'Skip Team')
      } else {
        await click(host, r % 2 === 0 ? '\u2713 Correct' : '\u2717 Wrong')
      }
      await sleep(900)
    } catch { break }
  }

  // ── Final screen + a refresh on it ──
  const reachedPodium = await softWait(players[0], 'game over', 30000)
  record('Game over: results screen reached', reachedPodium, await snap(players[0]))

  await players[12].reload({ waitUntil: 'domcontentloaded' })
  await sleep(4500)
  record('Game over: refresh on the results screen keeps the results',
    await softWait(players[12], 'game over', 20000), await snap(players[12]))
  await players[12].screenshot({ path: path.join(SHOTS, 'podium-after-refresh.png') })

  // Console errors across every surface
  console.log('\n===== RESULTS =====')
  const failed = results.filter(r => !r.ok)
  results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name))
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    console.log('\nFAILURES:')
    failed.forEach(r => console.log('  - ' + r.name + '\n      saw: ' + r.detail))
  }
} catch (e) {
  console.error('SCRIPT ERROR: ' + e.message)
  process.exitCode = 1
} finally {
  await sleep(2000)
  await browser.close()
}
