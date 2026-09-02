// Tapped In! 15-team load test.
// Drives host + projector + 15 phone-sized players through a real game against
// the live backend: join, three regular rounds (5 judged questions each, 3 with
// steals) advanced through the REAL transition controls, the score map after
// every round, Final Tap with wagers, full FJ review, and the finished-game screens.
// Screenshots land in ./screenshots.
//
// The ONLY manual step: sign in as host in the browser window when prompted.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = path.dirname(fileURLToPath(import.meta.url))
// Newest three-round file in rounds/ unless ROUNDS_JSON overrides it. Files from
// before the Round 3 release are two-round games and the importer refuses them.
const ROUNDS_JSON = process.env.ROUNDS_JSON ?? (() => {
  const dir = path.join(DIR, '..', 'rounds')
  const candidates = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f))
    .filter(f => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return [1, 2, 3].every(n => j.rounds?.some(r => r.round === n)) } catch { return false } })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  if (!candidates.length) throw new Error('no three-round JSON in rounds/ — set ROUNDS_JSON')
  return candidates[0]
})()
// Outside the repo (Vite ignores tmp/ now, but the smoke script already keeps the
// signed-in host profile here — share it).
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || DIR, 'tapped-in-smoke', 'chrome-profile')
const SHOTS = path.join(DIR, 'screenshots')

const NAMES = [
  'Barley Legal', 'Hop Scholars', 'Quizzed on the Rocks', 'Pint Sized Brains',
  'Ale Mary', 'Stout Hearted', 'The Lagerheads', 'Wheat a Minute',
  'Hoptimists', 'Last Call Legends', 'Foam Rangers', 'Malt Disney',
  'Brewed Awakening', 'The Yeast Ends', 'Dry Hop Divas',
]

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Generic page helpers ────────────────────────────────────────────────────

async function waitFor(page, fn, arg, timeout = 15000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      if (await page.evaluate(fn, arg)) return true
    } catch { /* navigation race — retry */ }
    await sleep(250)
  }
  throw new Error(`timeout waiting for ${label || arg} on ${page.url()}`)
}

// CSS `uppercase` classes change innerText casing — every text check must be
// case-insensitive.
const hasText = (page, text, timeout, label) =>
  waitFor(page, t => document.body && document.body.innerText.toLowerCase().includes(t.toLowerCase()), text, timeout, label || `text "${text}"`)

const pageHas = (page, text) =>
  page.evaluate(t => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text)

async function clickButton(page, text, { timeout = 15000 } = {}) {
  await waitFor(page, t => {
    const b = [...document.querySelectorAll('button')].find(x => !x.disabled && x.innerText.trim().startsWith(t))
    return !!b
  }, text, timeout, `button "${text}"`)
  await page.evaluate(t => {
    const b = [...document.querySelectorAll('button')].find(x => !x.disabled && x.innerText.trim().startsWith(t))
    b.click()
  }, text)
}

// React-controlled inputs need the native setter + an input event
async function setInput(page, selector, value, timeout = 15000) {
  await waitFor(page, s => !!document.querySelector(s), selector, timeout, selector)
  await page.evaluate(({ s, v }) => {
    const el = document.querySelector(s)
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, { s: selector, v: value })
}

let shotCount = 0
async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  shotCount++
  log(`📸 ${name}.png`)
}

// ── Main ────────────────────────────────────────────────────────────────────

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: null,
  userDataDir: PROFILE_DIR, // keeps the host sign-in across runs
  args: ['--window-size=1500,950', '--window-position=40,40'],
  // 17 live pages make captureScreenshot occasionally exceed the 30s default
  protocolTimeout: 180_000,
})

try {
  fs.mkdirSync(SHOTS, { recursive: true })

  // ── Host: sign in (manual), reset, create lobby, import content ──
  const host = (await browser.pages())[0] ?? await browser.newPage()
  await host.setViewport({ width: 1440, height: 900 })
  await host.goto(`${BASE}/host`, { waitUntil: 'domcontentloaded' })

  // Wait out the 'checking' phase, then see which screen we're on.
  // Lowercased: the live game screen renders its label as "SCOREBOARD" (CSS uppercase).
  await waitFor(host, () => {
    const t = document.body.innerText.toLowerCase()
    return t.includes('host sign in') || t.includes('create lobby') || t.includes('teams') || t.includes('scoreboard')
  }, null, 30000, 'host initial screen')

  if (await pageHas(host, 'Host sign in')) {
    log('### ACTION NEEDED: type your host email + password into the Chrome window, then Sign in. Waiting up to 8 minutes…')
    await waitFor(host, () => !document.body.innerText.toLowerCase().includes('host sign in'), null, 8 * 60_000, 'host sign-in to complete')
    log('Signed in.')
  }
  await sleep(1500)

  // If a previous room exists (lobby or mid-game), reset to a fresh lobby.
  // The in-game New Game confirm is a compact "Sure? / Yes / Cancel" in the
  // scoreboard header (the game-over screen's variant says "Yes, New Game" —
  // startsWith('Yes') matches both), and it reloads the page, so re-wait after.
  if (await pageHas(host, 'Scoreboard')) {
    log('Active game found — clicking New Game to reset')
    await clickButton(host, 'New Game')
    await clickButton(host, 'Yes')
    await sleep(4000)
    await waitFor(host, () => {
      const t = document.body.innerText.toLowerCase()
      return t.includes('create lobby') || t.includes('teams') || t.includes('host sign in')
    }, null, 30000, 'host screen after New Game reload')
  }
  if (await host.evaluate(() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'New Game') && document.body.innerText.toLowerCase().includes('teams'))) {
    log('Old lobby found — starting a new game')
    await clickButton(host, 'New Game')
    await sleep(1000)
  }
  if (await pageHas(host, 'Create Lobby')) {
    await clickButton(host, 'Create Lobby')
  }
  await hasText(host, 'Teams', 20000, 'lobby screen')
  log('Lobby created.')

  // Import content. Real round files now carry their own category descriptions;
  // only synthesize placeholders when the file has none, so the round-start
  // reveal flow is always exercised.
  const content = JSON.parse(fs.readFileSync(ROUNDS_JSON, 'utf8'))
  const realDescriptions = content.rounds.some(r => r.categories.some(c => c.description?.trim()))
  if (!realDescriptions) {
    let dNum = 0
    for (const r of content.rounds) for (const c of r.categories) {
      c.description = `Placeholder intro #${++dNum}: a couple of sentences the host reads aloud about ${c.name} before play begins.`
    }
  }
  log(`Content file: ${path.basename(ROUNDS_JSON)} (${realDescriptions ? 'real' : 'placeholder'} descriptions)`)
  const json = JSON.stringify(content)
  // (Re)import unless the lobby already shows a complete three-round summary
  const summaryNow = await host.evaluate(() => [...document.querySelectorAll('p')].map(p => p.innerText).find(t => t.includes('R1:')) ?? '')
  if (!/R3: [1-9]/.test(summaryNow) || !summaryNow.includes('Final Tap ✓')) {
    await clickButton(host, summaryNow ? 'Replace' : 'Import JSON')
    await setInput(host, 'textarea', json)
    await clickButton(host, 'Import')
    await waitFor(host, () => /R3: [1-9]/.test(document.body.innerText), null, 30000, 'three-round content summary')
  }
  const summaryLine = await host.evaluate(() => [...document.querySelectorAll('p')].map(p => p.innerText).find(t => t.includes('R1:')))
  log('Content:', summaryLine)
  if (!summaryLine.includes('Final Tap ✓')) log('⚠ content has no Final Tap question!')

  // ── Projector ──
  const projector = await browser.newPage()
  await projector.setViewport({ width: 1600, height: 900 })
  await projector.goto(`${BASE}/projector`, { waitUntil: 'domcontentloaded' })

  // ── 15 solo players in isolated contexts ──
  const makeContext = () =>
    browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext()

  const players = []
  async function joinSolo(i, p) {
    await p.goto(`${BASE}/play`, { waitUntil: 'domcontentloaded' })
    await sleep(500)
    if (await pageHas(p, "You're in")) { log(`[${i}] already joined`); return } // session restored
    await hasText(p, 'How are you playing?', 30000, `player ${i} choose-mode`)
    await clickButton(p, 'On my own')
    await setInput(p, 'input[placeholder="Your name"]', NAMES[i])
    await clickButton(p, "Let's Go")
    await hasText(p, "You're in", 20000, `player ${i} lobby`)
    log(`joined [${i}] ${NAMES[i]}`)
  }
  for (let i = 0; i < 15; i++) {
    const ctx = await makeContext()
    const p = await ctx.newPage()
    await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    try {
      await joinSolo(i, p)
    } catch (e) {
      const text = await p.evaluate(() => document.body.innerText).catch(() => '(unreadable)')
      log(`player ${i} join failed (${e.message}); page says:\n---\n${text}\n---\nretrying once…`)
      await shot(p, `zz-join-fail-${i}`)
      await joinSolo(i, p) // second attempt from the top; a thrown error here aborts the run
    }
    players.push(p)
  }

  // 16th visitor: "With a team" path → sees the 15-team pick list
  const lateCtx = await makeContext()
  const late = await lateCtx.newPage()
  await late.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await late.goto(`${BASE}/play`, { waitUntil: 'domcontentloaded' })
  await hasText(late, 'How are you playing?', 30000, 'late player choose-mode')
  await clickButton(late, 'With a team')
  await setInput(late, 'input[placeholder="Your name"]', 'Late Larry')
  await clickButton(late, 'Next')
  await hasText(late, 'Now pick your team', 20000, 'team pick list')
  await sleep(2000) // let the staggered row animations finish
  await shot(late, '02-player-join-pick-team')
  await lateCtx.close()

  // Host lobby with all 15
  await hasText(host, '15 joined', 20000, '15 teams in host lobby')
  await sleep(500)
  await shot(host, '01-host-lobby-15-teams')
  await shot(players[3], '03-player-lobby')

  // ── Start game ──
  await clickButton(host, 'Start Game')
  await hasText(host, 'Scoreboard', 20000, 'host game screen')
  log('Game started.')
  await sleep(2500)

  // ── Round-start category reveal (host steps through the intros) ──
  // Every round with descriptions opens the intro panel; step through it each time.
  async function runCategoryIntros(round) {
    if (!(await pageHas(host, 'Category Intros'))) {
      try { await hasText(host, 'Category Intros', 6000, 'reveal panel') } catch { log(`Round ${round}: no category intros`); return }
    }
    await sleep(800)
    if (round === 1) await shot(host, '03z-host-reveal-panel-start') // nothing revealed yet — full intro list
    let revealClicks = 0
    while (await host.evaluate(() =>
      [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.trim().startsWith('Reveal “')))) {
      await clickButton(host, 'Reveal “')
      revealClicks++
      if (round === 1 && revealClicks === 3) {
        await sleep(450) // mid-pop
        await shot(projector, '03a-projector-mid-reveal')
        await shot(players[2], '03b-player-mid-reveal')
        await shot(host, '03c-host-reveal-panel')
      }
      await sleep(round === 1 ? 1000 : 500)
    }
    await clickButton(host, 'To the board')
    log(`Round ${round} category reveal: stepped through ${revealClicks} categories`)
    await sleep(1200)
    if (round === 1) await shot(host, '03d-host-board-list-descriptions') // descriptions during normal play
  }
  await runCategoryIntros(1)

  // ── Play 15 questions, 5 per round (dynamic pick: highest-value non-Double-Tap first) ──
  const scores = new Array(15).fill(0)
  const timings = []

  // Only the round in play: its heading carries "now playing" in the host list.
  // Serialized into the page so both helpers share one definition.
  const currentRoundButtonsSrc = `(() => {
    const heading = [...document.querySelectorAll('p')].find(p => p.innerText.toLowerCase().includes('now playing'))
    const scope = heading ? heading.parentElement : document
    return [...scope.querySelectorAll('button')]
      .filter(b => !b.disabled && b.querySelector('span.font-mono') && !b.innerText.includes('\u{1F37A}'))
  })()`
  async function pickQuestion() {
    return host.evaluate(src => {
      const btns = eval(src)
        .map(b => ({ v: parseInt(b.querySelector('span.font-mono').innerText), t: b.innerText.slice(0, 40) }))
        .sort((a, b) => b.v - a.v)
      return btns[0] ?? null
    }, currentRoundButtonsSrc)
  }
  async function clickQuestion(value) {
    await host.evaluate(({ v, src }) => {
      const b = eval(src).find(x => parseInt(x.querySelector('span.font-mono').innerText) === v)
      b.click()
    }, { v: value, src: currentRoundButtonsSrc })
  }

  // Real round transitions — the same buttons the host presses on the night.
  async function advanceRound(from) {
    const next = from === 3 ? 'Final Tap' : `Round ${from + 1}`
    await clickButton(host, `End Round ${from} early`)
    await clickButton(host, `Show Scores & Start ${next}`)
    await hasText(players[0], from === 1 ? 'Round One Down' : from === 2 ? 'Round Two Down' : 'Last Call', 15000, 'player score map')
    await sleep(3500) // draw-on animation
    await shot(players[0], `06-r${from}-player-graph`)
    await shot(projector, `07-r${from}-projector-graph`)
    await shot(host, `08-r${from}-host-graph`)
    if (from === 3) {
      await clickButton(host, 'Start Final Tap')
      return
    }
    await clickButton(host, `Begin ${next}`)
    await hasText(projector, next, 15000, `projector ${next} board`)
    await sleep(3000) // splash
    await shot(players[1], `06b-r${from + 1}-player-board`)
    await shot(projector, `07b-r${from + 1}-projector-board`)
    await runCategoryIntros(from + 1)
  }

  async function tapBuzz(p) {
    await waitFor(p, () => {
      const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'TAP IN!')
      return !!b
    }, null, 25000, 'buzz button')
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'TAP IN!')
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 187, clientY: 600 }))
    })
  }
  // Answer window opens for this team either immediately or after a prior wrong
  async function typeAnswer(p, answer) {
    await waitFor(p, () => !!document.querySelector('textarea[placeholder="Type your response…"]'), null, 90000, 'answer box')
    await setInput(p, 'textarea[placeholder="Type your response…"]', answer)
    await clickButton(p, 'Submit Response')
  }

  async function judgeNext(outcome) {
    await clickButton(host, 'Judge', { timeout: 30000 })
    // Give the response a moment to arrive so the panel shows real text
    await waitFor(host, () => {
      const t = document.body.innerText
      return t.includes('✓ Correct') && !t.includes('Waiting for response…')
    }, null, 12000, 'response in judging panel').catch(() => {})
    await clickButton(host, outcome === 'correct' ? '✓ Correct' : '✗ Wrong')
    await sleep(800)
  }

  for (let i = 0; i < 15; i++) {
    if (i === 5) await advanceRound(1)
    if (i === 10) await advanceRound(2)
    const q = await pickQuestion()
    if (!q) { log('⚠ ran out of questions at', i); break }
    const t0 = Date.now()
    await clickQuestion(q.v)
    await clickButton(host, 'Open Buzzer')

    // A steal on questions 9-11: a leader buzzes first and whiffs
    let wrongIdx = null
    if (i >= 9 && i <= 11) {
      const cand = [0, 1, 2][i - 9]
      if (scores[cand] - q.v > 0) wrongIdx = cand
    }

    // Buzz order must be deterministic: the wrong-answer team taps first, and the
    // 600ms gap guarantees their server timestamp wins.
    const tasks = []
    if (wrongIdx !== null) {
      await tapBuzz(players[wrongIdx])
      tasks.push(typeAnswer(players[wrongIdx], 'What is… uh… beer?'))
      await sleep(600)
    }
    await tapBuzz(players[i])
    tasks.push(typeAnswer(players[i], 'What is the right answer!'))
    const answers = Promise.all(tasks)

    if (wrongIdx !== null) {
      await judgeNext('wrong')
      scores[wrongIdx] -= q.v
      log(`Q${i + 1} [$${q.v}] steal: ${NAMES[wrongIdx]} wrong`)
    }
    await judgeNext('correct')
    await answers.catch(e => log('answer task note:', e.message))
    scores[i] += q.v
    timings.push(Date.now() - t0)
    log(`R${i < 5 ? 1 : i < 10 ? 2 : 3} Q${i + 1} [$${q.v}] ${NAMES[i]} correct → ${scores[i]} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    await sleep(1200) // board settles
  }
  log('Scores:', NAMES.map((n, i) => `${n}:${scores[i]}`).join(' '))

  // ── Score chip + all-scores overlay (use a mid-pack player) ──
  await sleep(2000)
  await shot(players[7], '04-player-board-scorechip')
  await players[7].evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('all scores'))
    b?.click()
  })
  await sleep(1200)
  await shot(players[7], '05-player-all-scores-overlay')
  // Best-effort close so the overlay doesn't sit over player 7's later screens
  await players[7].evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => ['✕', '×', 'Close'].some(t => x.innerText.trim() === t))
    b?.click()
  })
  await players[7].keyboard.press('Escape').catch(() => {})

  // ── Round 3 → Final Tap through the real transition (every positive team advances — all 15) ──
  await advanceRound(3)
  await hasText(host, 'Active Teams', 20000, 'FT starting panel')
  await sleep(1500)
  await shot(host, '09-host-final-tap-teams')
  await shot(projector, '10-projector-final-tap-start')

  await clickButton(host, 'Open Wagering')
  await hasText(players[5], 'Enter your wager', 20000, 'wager screen')
  await sleep(1000)
  await shot(players[5], '11-player-fj-wager')

  // 12 teams lock wagers; 3 stay pending for the status screenshots
  async function lockWager(p, amount) {
    await setInput(p, 'input[type="number"]', String(amount))
    await clickButton(p, 'Lock In Wager')
    await hasText(p, 'Team wager locked in', 15000, 'wager locked')
  }
  for (let i = 0; i < 12; i++) await lockWager(players[i], 50 + i * 10)
  await sleep(1500)
  await shot(projector, '12-projector-fj-wagers-pending')
  await shot(host, '13-host-fj-wager-status')
  for (let i = 12; i < 15; i++) await lockWager(players[i], 25)

  // ── Reveal question, everyone answers, host ends timer ──
  await clickButton(host, 'Reveal Question')
  // Placeholder text never shows up in innerText — wait for the answer box itself
  await waitFor(players[0], () => !!document.querySelector('textarea[placeholder="Type your response…"]'), null, 20000, 'FJ question screen')
  await sleep(1000)
  await shot(players[0], '14-player-fj-question')
  await shot(projector, '15-projector-fj-question')

  for (let i = 0; i < 15; i++) {
    const p = players[i]
    await setInput(p, 'textarea[placeholder="Type your response…"]', i % 3 === 0 ? 'What is the correct thing?' : 'What is a wild guess?')
    await clickButton(p, 'Submit Response')
  }
  await waitFor(host, () => (document.body.innerText.match(/locked in/g) || []).length >= 15, null, 30000, 'all FJ responses').catch(() => {})
  await clickButton(host, 'End Timer Early')

  // ── Review all 15 teams (correct if their answer was "correct thing") ──
  await hasText(host, 'Team 1 of', 20000, 'FJ review start')
  for (let r = 0; r < 15; r++) {
    await waitFor(host, n => document.body.innerText.toLowerCase().includes(`team ${n} of`), r + 1, 20000, `review team ${r + 1}`)
    const isCorrect = await pageHas(host, 'correct thing')
    if (await host.evaluate(() => [...document.querySelectorAll('button')].some(b => !b.disabled && b.innerText.startsWith('Skip Team')))) {
      await clickButton(host, 'Skip Team')
    } else {
      await clickButton(host, isCorrect ? '✓ Correct' : '✗ Wrong')
    }
    await sleep(1000)
  }

  // ── Finished! Podium / winner / tip-jar screens ──
  await hasText(players[0], 'Game Over', 30000, 'player podium')
  await sleep(3000)
  await shot(players[0], '16-player-final-podium')
  // Collapsed podium: does everything fit without scrolling?
  const fits = await players[0].evaluate(() => {
    const el = document.scrollingElement || document.documentElement
    const fb = [...document.querySelectorAll('button')].find(b => b.innerText.includes('Send feedback'))
    return {
      scrollable: el.scrollHeight - el.clientHeight,
      feedbackTop: fb ? Math.round(fb.getBoundingClientRect().top) : null,
      feedbackOnScreen: fb ? fb.getBoundingClientRect().bottom <= el.clientHeight : false,
    }
  })
  log('collapsed podium fit: ' + JSON.stringify(fits))

  // Expand to all teams
  await clickButton(players[0], 'Show all')
  await sleep(900)
  await shot(players[0], '16d-player-podium-expanded')

  // Footer below the standings: tip jar, feedback box, venue links
  await players[0].evaluate(() => {
    const el = document.scrollingElement || document.documentElement
    el.scrollTop = el.scrollHeight
  })
  await sleep(900)
  await shot(players[0], '16b-player-podium-footer')

  // Feedback box: open, type, send, confirm the thank-you state (which only
  // renders when the insert actually succeeded)
  await clickButton(players[0], '💬 Send feedback')
  await sleep(600)
  await setInput(players[0], 'textarea', 'LOAD TEST feedback - safe to delete. Great night!')
  await clickButton(players[0], 'Send')
  const thanked = await (async () => {
    try { await hasText(players[0], 'Thanks', 12000, 'feedback thanks'); return true } catch { return false }
  })()
  log('feedback submitted OK: ' + thanked)
  await shot(players[0], '16c-player-feedback-sent')
  await shot(players[9], '17-player-final-podium-midpack')
  await shot(projector, '18-projector-winner')
  await shot(host, '19-host-game-over')

  log(`DONE. ${shotCount} screenshots. Avg question cycle: ${(timings.reduce((a, b) => a + b, 0) / timings.length / 1000).toFixed(1)}s`)
} catch (err) {
  console.error('FAILED:', err.message)
  try {
    let n = 0
    for (const ctx of browser.browserContexts()) {
      for (const pg of await ctx.pages()) {
        await pg.screenshot({ path: path.join(SHOTS, `zz-failure-${n}.png`) }).catch(() => {})
        const text = await pg.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '')
        console.error(`--- page ${n} (${pg.url()}):\n${text}`)
        n++
      }
    }
  } catch {}
  process.exitCode = 1
} finally {
  await sleep(4000)
  await browser.close()
}
