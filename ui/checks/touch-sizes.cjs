// Touch sizes and phone layout (#109), against the built UI with stubbed /api.
// Chromium's touch emulation: NODE_PATH may point to a playwright-core
// installation outside the app; CHROME_CHANNEL picks the browser (default
// 'chrome'). DIST may point to another build to compare (default ../dist).
//   NODE_PATH=... node ui/checks/touch-sizes.cjs
// Apple's minimum for a tap (HIG, Accessibility: 44x44 pt on iOS and iPadOS)
// and the 16 pt side margin of a compact-width iPhone screen.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright-core')

const DIST = path.resolve(process.env.DIST || path.join(__dirname, '../dist'))
const TAP = 44
const MARGIN = 16

// Every failure is reported, not only the first.
const failures = []
const expect = (ok, message) => ok || failures.push(message)

const two = (n) => String(n).padStart(2, '0')
const now = new Date()
const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`

function state() {
  // Enough lists that Lists scrolls on a phone, and tasks with long titles.
  const projects = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, name: `List number ${i + 1}`, color: i % 8 }))
  const tasks = [
    { id: 100, title: 'Write the onboarding email for the first customers', notes: '', projectId: 1, start: null, due: today, priority: 1 },
    { id: 101, title: 'Review pricing page copy', notes: '', projectId: 2, start: null, due: today, priority: 4 },
    { id: 102, title: 'Call the bank', notes: '', projectId: null, start: null, due: today, priority: 2 },
    { id: 103, title: 'First step', notes: '', projectId: 1, start: null, due: null, priority: 4, parentId: 100 },
    { id: 104, title: 'Second step', notes: '', projectId: 1, start: null, due: null, priority: 4, parentId: 100, done: true, doneDay: today },
    // A long list, so a screen pushed from a scrolled Lists has room to open mid-page.
    ...Array.from({ length: 30 }, (_, i) => ({
      id: 110 + i,
      title: `Long list task ${i + 1}`,
      notes: '',
      projectId: 14,
      start: null,
      due: null,
      priority: 4,
    })),
  ]
  return { rev: 1, nextId: 200, projects, tasks }
}

function entries() {
  const at = new Date(now)
  at.setHours(9, 0, 0, 0)
  const start = at.getTime()
  const row = (id, title, offsetMin, plannedMin, focusedMin) => ({
    id,
    taskId: null,
    title,
    day: today,
    startedAt: start + offsetMin * 60000,
    endedAt: start + (offsetMin + focusedMin) * 60000,
    plannedMs: plannedMin * 60000,
    focusedMs: focusedMin * 60000,
  })
  return [
    row(1, 'Write the onboarding email for the first customers', 0, 30, 42),
    row(2, 'Review pricing page copy', 60, 25, 25),
    row(3, 'Call the bank', 120, 15, 9),
  ]
}

// The safe areas an iPhone reports (status bar and Dynamic Island, home
// indicator, the notch strip turned sideways), which Chromium does not have.
const SAFE = { '390x844': [47, 34, 0, 0], '844x390': [0, 21, 47, 47], '820x1180': [24, 20, 0, 0] }

async function open(browser, options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  const safe = SAFE[`${options.viewport.width}x${options.viewport.height}`]
  if (safe)
    await page.addInitScript(([t, b, l, r]) => {
      const style = document.createElement('style')
      style.textContent = `:root{--safe-top:${t}px!important;--safe-bottom:${b}px!important;--safe-left:${l}px!important;--safe-right:${r}px!important}`
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
    }, safe)
  page.setDefaultTimeout(5000)
  // Isolated from any installed server or real tasks.
  await page.route('http://done.test/**', (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/') return route.fulfill({ path: path.join(DIST, 'index.html'), contentType: 'text/html' })
    if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
    if (pathname === '/api/state') return route.fulfill({ json: state() })
    if (pathname === '/api/entries') return route.fulfill({ json: entries() })
    if (pathname === '/api/notes' || pathname === '/api/finished') return route.fulfill({ json: [] })
    if (pathname === '/api/sync') return route.fulfill({ json: { rev: 2 } })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://done.test/')
  await page.getByRole('heading', { name: 'Today' }).first().waitFor()
  return { context, page }
}

const box = async (locator) => {
  const b = await locator.boundingBox()
  assert.ok(b, 'not on screen')
  // Whole points, as layout rounds them (43.99999 is 44).
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
}

// How much of the area around the middle of an element still lands on it
// when tapped, in whole pixels (its ::after counts, as on a real screen).
async function tapArea(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const cx = Math.floor(r.left + r.width / 2)
    const cy = Math.floor(r.top + r.height / 2)
    const lands = (x, y) => {
      const hit = document.elementFromPoint(x + 0.5, y + 0.5)
      return !!hit && (hit === el || el.contains(hit))
    }
    // The run of whole pixels around the middle that land on it.
    const run = (at) => {
      let a = 0
      let b = 0
      while (a < 60 && at(-(a + 1))) a++
      while (b < 60 && at(b + 1)) b++
      return a + b + 1
    }
    return { w: run((d) => lands(cx + d, cy)), h: run((d) => lands(cx, cy + d)) }
  })
}

// The left and right inset of what is drawn on the page: text (as laid
// out, not its button's padding), icons, fields and checks. A borderless
// button's box may run into the margin, as its tap area; its label may not.
async function insets(page, scope = '[data-slot="sidebar-inset"]') {
  return page.evaluate((scope) => {
    let left = Infinity
    let right = -Infinity
    const take = (r) => {
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) return
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
    }
    for (const root of document.querySelectorAll(scope))
      for (const el of root.querySelectorAll('*')) {
        if (getComputedStyle(el).visibility === 'hidden' || el.closest('[aria-hidden="true"], .sr-only')) continue
        if (el.matches('input, select, textarea, [role="checkbox"], svg')) take(el.getBoundingClientRect())
        for (const node of el.childNodes) {
          if (node.nodeType !== 3 || !node.textContent.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(node)
          for (const r of range.getClientRects()) take(r)
        }
      }
    return { left: Math.round(left), right: Math.round(innerWidth - right), width: innerWidth }
  }, scope)
}

async function phone(browser) {
  const { context, page } = await open(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const tab = (name) => page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true })
  // The navigation bar's way back, not the Lists tab of the same name.
  const back = () => page.locator('div.fixed.top-0 button').first()
  const margins = async (screen) => {
    const inset = await insets(page)
    expect(inset.left >= MARGIN && inset.right >= MARGIN, `${screen}: content inset ${JSON.stringify(inset)}`)
  }
  try {
    for (const name of ['Today', 'Lists']) {
      await tab(name).dispatchEvent('click')
      await page.getByRole('heading', { name, exact: true }).first().waitFor()
      await margins(name)
    }

    // Lists scrolled to its end, then a long list pushed from it: it opens at its top.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    assert.ok((await page.evaluate(() => window.scrollY)) > 100, 'Lists did not scroll')
    await page.getByRole('button', { name: /^List number 14/ }).tap()
    await page.getByRole('heading', { name: 'List number 14', exact: true }).first().waitFor()
    await page.waitForTimeout(400)
    const pushed = await page.evaluate(() => Math.round(window.scrollY))
    expect(pushed === 0, `a pushed screen opened at scrollY ${pushed}`)

    // The way back is a full-height bar button.
    const b = await box(back())
    expect(b.height >= TAP && b.width >= TAP, `back button ${b.width}x${b.height}`)
    await back().tap()

    // The Time sheet fits the phone: no sideways scrolling, every control on screen.
    await page.getByRole('button', { name: /^Time sheet/ }).tap()
    await page.getByRole('heading', { name: 'Time sheet', exact: true }).first().waitFor()
    await page.getByText('Call the bank').first().waitFor()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    const wide = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }))
    expect(wide.inner === 390 && wide.scroll <= 390, `Time sheet: layout viewport ${wide.inner}, page ${wide.scroll} wide`)
    for (const remove of await page.getByRole('button', { name: /^Remove from the time sheet/ }).all()) {
      const r = await box(remove)
      expect(r.x >= 0 && r.x + r.width <= 390 && r.height >= TAP && r.width >= TAP, `Time sheet remove button ${r.width}x${r.height} at x=${r.x}`)
    }
    await margins('Time sheet')
    await back().tap()

    await page.getByRole('button', { name: /^Settings/ }).tap()
    await page.getByRole('heading', { name: 'Settings', exact: true }).first().waitFor()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await margins('Settings')

    // The task sheet's Cancel and Done take the bar's whole height.
    await tab('Today').dispatchEvent('click')
    await page.getByRole('button', { name: 'Call the bank', exact: true }).tap()
    const sheet = page.getByRole('dialog', { name: 'Details' })
    for (const name of ['Cancel', 'Done']) {
      const r = await box(sheet.getByRole('button', { name, exact: true }))
      expect(r.height >= TAP && r.width >= TAP, `task sheet ${name} ${r.width}x${r.height}`)
    }
  } finally {
    await context.close()
  }
}

async function tablet(browser) {
  const { context, page } = await open(browser, { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'tablet')
    for (const check of await page.getByRole('checkbox').all()) {
      const area = await tapArea(check)
      expect(area.w >= TAP && area.h >= TAP, `task checkbox tap area ${area.w}x${area.h}`)
    }

    // The sidebar is put away on an upright iPad; its toggle is the way to
    // every other view, and has to be wholly on screen and big enough.
    for (const [key, heading] of [
      ['5', 'Board'],
      ['4', 'Timeline'],
      ['7', 'Time sheet'],
    ]) {
      await page.keyboard.press(key)
      await page.getByRole('heading', { name: heading, exact: true }).first().waitFor()
      await page.waitForTimeout(300)
      const toggle = await box(page.locator('[data-slot="sidebar-inset"] [data-sidebar="trigger"]').first())
      expect(toggle.x >= 0 && toggle.x + toggle.width <= 820, `${heading}: sidebar toggle at x=${toggle.x}`)
      expect(toggle.width >= TAP && toggle.height >= TAP, `${heading}: sidebar toggle ${toggle.width}x${toggle.height}`)
    }

    // Header buttons: the Time sheet's day arrows, and Timeline's Today and Filter.
    for (const name of ['Day before', 'Day after']) {
      const b = await box(page.getByRole('button', { name, exact: true }))
      expect(b.height >= TAP && b.width >= TAP, `${name} ${b.width}x${b.height}`)
    }
    await page.keyboard.press('4')
    await page.getByRole('heading', { name: 'Timeline', exact: true }).first().waitFor()
    for (const name of ['Today', /^Filter/]) {
      const b = await box(
        page
          .locator('header')
          .getByRole('button', { name, exact: typeof name === 'string' })
          .first(),
      )
      expect(b.height >= TAP, `Timeline header ${name} ${b.width}x${b.height}`)
    }
  } finally {
    await context.close()
  }
}

// A Mac with a mouse keeps its sizes exactly.
async function desktop(browser) {
  const { context, page } = await open(browser, { viewport: { width: 1440, height: 900 } })
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'desktop')
    const check = await box(page.getByRole('checkbox').first())
    expect(Math.round(check.height) === 18, `desktop checkbox ${check.width}x${check.height}`)
    await page.keyboard.press('7')
    await page.getByRole('heading', { name: 'Time sheet', exact: true }).waitFor()
    const arrow = await box(page.getByRole('button', { name: 'Day before', exact: true }))
    expect(Math.round(arrow.height) === 28, `desktop day arrow ${arrow.width}x${arrow.height}`)
    await page.getByText('Call the bank').first().waitFor()
    expect((await page.locator('table').count()) === 1, 'the desktop Time sheet is a table')
  } finally {
    await context.close()
  }
}

async function check() {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' })
  try {
    await phone(browser)
    await tablet(browser)
    await desktop(browser)
    assert.deepEqual(failures, [], 'touch sizes')
    console.log('touch sizes: all checks passed')
  } finally {
    await browser.close()
  }
}
check().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
