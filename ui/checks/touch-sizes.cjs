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
  // Enough lists that Lists scrolls on a phone, a long list, and a Today
  // long enough to count how many rows an iPad shows.
  const projects = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, name: `List number ${i + 1}`, color: i % 8 }))
  const task = (id, title, projectId, due, priority, more = {}) => ({ id, title, notes: '', projectId, start: null, due, priority, ...more })
  const tasks = [
    task(100, 'Write the onboarding email for the first customers', 1, today, 1),
    task(101, 'Review pricing page copy', 2, today, 4),
    task(102, 'Call the bank', null, today, 2),
    task(103, 'First step', 1, null, 4, { parentId: 100 }),
    task(104, 'Second step', 1, null, 4, { parentId: 100, done: true, doneDay: today }),
    ...Array.from({ length: 30 }, (_, i) => task(110 + i, `Long list task ${i + 1}`, 14, null, 4)),
    ...Array.from({ length: 30 }, (_, i) => task(300 + i, `Today task ${i + 1}`, 2, today, (i % 4) + 1)),
  ]
  return { rev: 1, nextId: 1000, projects, tasks }
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
    row(4, '', 180, 10, 10),
  ]
}

// The safe areas an iPhone or iPad reports (status bar and Dynamic Island,
// home indicator, the notch strip turned sideways), which Chromium does not have.
const SAFE = { '390x844': [47, 34, 0, 0], '844x390': [0, 21, 47, 47], '820x1180': [24, 20, 0, 0] }
// As Safari names itself on each (an iPad asks for the desktop site), so the
// page's own reading of the operating system sees a phone or a tablet.
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }
const PHONE_SIDEWAYS = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }
const IPAD = { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA }

async function open(browser, options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const safe = SAFE[`${options.viewport.width}x${options.viewport.height}`]
  if (safe && options.hasTouch)
    await page.addInitScript(([t, b, l, r]) => {
      const style = document.createElement('style')
      style.textContent = `:root{--safe-top:${t}px!important;--safe-bottom:${b}px!important;--safe-left:${l}px!important;--safe-right:${r}px!important}`
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
    }, safe)
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

// Until nothing is moving: a screen pushed in, a sheet rising, a menu opening.
const settled = (page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  )

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

const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY))

async function phone(browser) {
  const { context, page } = await open(browser, PHONE)
  const tab = (name) => page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true })
  const heading = (name) => page.getByRole('heading', { name, exact: true }).first()
  // The navigation bar's way back (named "Lists" before #109, like the tab;
  // the bar is drawn after the tab bar, so it is the last of the two).
  const backToLists = () => page.getByRole('button', { name: /^(Back to )?Lists$/ }).last()
  // A row of Lists, opened as a tap does, without scrolling the page to it.
  const openRow = async (name, title) => {
    await page.getByRole('button', { name }).first().dispatchEvent('click')
    await heading(title).waitFor()
    await settled(page)
  }
  const margins = async (screen) => {
    const inset = await insets(page)
    expect(inset.left >= MARGIN && inset.right >= MARGIN, `${screen}: content inset ${JSON.stringify(inset)}`)
  }
  try {
    for (const name of ['Today', 'Lists']) {
      await tab(name).dispatchEvent('click')
      await heading(name).waitFor()
      await settled(page)
      await margins(name)
    }

    // Lists scrolled part way, then a long list pushed from it: it opens at
    // its top, and Back returns to where Lists was.
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForFunction(() => Math.round(window.scrollY) === 300)
    await openRow(/^List number 14/, 'List number 14')
    const pushed = await scrollY(page)
    expect(pushed === 0, `a pushed screen opened at scrollY ${pushed}`)
    const back = backToLists()
    const b = await box(back)
    expect(b.height >= TAP && b.width >= TAP, `back button ${b.width}x${b.height}`)
    await back.tap()
    await heading('Lists').waitFor()
    await settled(page)
    const returned = await scrollY(page)
    expect(Math.abs(returned - 300) <= 1, `Back returned Lists at scrollY ${returned}, not 300`)

    // The same through search: Lists scrolled further, a task in a list found
    // and shown, and Back returns to this Lists, not the earlier one.
    await page.evaluate(() => window.scrollTo(0, 600))
    await page.waitForFunction(() => Math.round(window.scrollY) === 600)
    await page.getByRole('button', { name: 'Search', exact: true }).dispatchEvent('click')
    await page.getByRole('dialog').getByRole('textbox').fill('Long list task 3')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Long list task 3\b/ })
      .first()
      .click()
    await heading('List number 14').waitFor()
    await settled(page)
    await backToLists().tap()
    await heading('Lists').waitFor()
    await settled(page)
    const again = await scrollY(page)
    expect(Math.abs(again - 600) <= 1, `Back from a search result returned Lists at scrollY ${again}, not 600`)

    // A long press on the bar at the top is not a long press on the page.
    await page.evaluate(() => window.scrollTo(0, 0))
    await openRow(/^Time sheet/, 'Time sheet')
    await backToLists().dispatchEvent('contextmenu', { bubbles: true })
    expect((await page.getByRole('menu').count()) === 0, 'a long press on the navigation bar opened the page menu')
    await page.keyboard.press('Escape')

    // The Time sheet fits the phone: no sideways scrolling, every control on screen.
    await page.getByText('Call the bank').first().waitFor()
    const wide = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }))
    expect(wide.inner === 390 && wide.scroll <= 390, `Time sheet: layout viewport ${wide.inner}, page ${wide.scroll} wide`)
    for (const remove of await page.getByRole('button', { name: /^Remove from the time sheet/ }).all()) {
      const r = await box(remove)
      expect(r.x >= 0 && r.x + r.width <= 390 && r.height >= TAP && r.width >= TAP, `Time sheet remove button ${r.width}x${r.height} at x=${r.x}`)
    }
    expect((await page.getByText('No title', { exact: true }).count()) === 1, 'a block with no title shows no title')
    expect(
      (await page.getByRole('button', { name: 'Remove from the time sheet: No title', exact: true }).count()) === 1,
      'the remove button of a block with no title has no name for it',
    )
    await margins('Time sheet')
    await backToLists().tap()
    await heading('Lists').waitFor()

    await openRow(/^Settings/, 'Settings')
    await margins('Settings')
    // A phone's browser: no terminal commands, and the download pane says to
    // use done in the browser rather than offering the Mac app.
    expect((await page.getByRole('heading', { name: 'Connect an AI agent', exact: true }).count()) === 0, 'a phone browser offers terminal commands')
    expect(
      (await page.getByText('Use done in the browser', { exact: false }).count()) === 1,
      'a phone browser is not told to use done in the browser',
    )
    expect((await page.getByRole('link', { name: 'Download for Mac', exact: true }).count()) === 0, 'a phone browser is offered Download for Mac')

    // The task sheet's Cancel and Done take the bar's whole height.
    await tab('Today').dispatchEvent('click')
    await page.getByRole('button', { name: 'Call the bank', exact: true }).tap()
    const sheet = page.getByRole('dialog', { name: 'Details' })
    await settled(page)
    for (const name of ['Cancel', 'Done']) {
      const r = await box(sheet.getByRole('button', { name, exact: true }))
      expect(r.height >= TAP && r.width >= TAP, `task sheet ${name} ${r.width}x${r.height}`)
    }
  } finally {
    await context.close()
  }
}

// An iPhone on its side: clear of the 47 point notch strip, and the
// long-press menu wholly on the screen without scrolling.
async function sideways(browser) {
  const { context, page } = await open(browser, PHONE_SIDEWAYS)
  try {
    const inset = await insets(page)
    expect(inset.left >= 47 + MARGIN && inset.right >= 47 + MARGIN, `sideways Today: content inset ${JSON.stringify(inset)}`)

    await page.getByRole('button', { name: 'Call the bank', exact: true }).dispatchEvent('contextmenu', { bubbles: true })
    const menu = page.getByRole('menu')
    await menu.waitFor()
    await settled(page)
    const m = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), scrolls: el.scrollHeight > el.clientHeight + 1 }
    })
    expect(m.top >= 0 && m.bottom <= 390 - 21 && !m.scrolls, `sideways long-press menu ${JSON.stringify(m)} on a 390 tall screen`)
    const del = await box(page.getByRole('menuitem', { name: /^Delete/ }))
    expect(del.y + del.height <= 390 - 21, `sideways menu: Delete at y=${del.y}`)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Call the bank', exact: true }).tap()
    await settled(page)
    const sheet = await insets(page, '[role="dialog"][aria-label="Details"]')
    expect(sheet.left >= 47 + MARGIN && sheet.right >= 47 + MARGIN, `sideways task sheet: content inset ${JSON.stringify(sheet)}`)
  } finally {
    await context.close()
  }
}

async function tablet(browser) {
  const { context, page } = await open(browser, IPAD)
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'tablet')
    await settled(page)
    // As dense as a list a finger can use: on main this screen showed 25 rows.
    const shown = await page.evaluate(
      () => [...document.querySelectorAll('[data-task]')].filter((r) => r.getBoundingClientRect().bottom <= innerHeight).length,
    )
    expect(shown >= 22, `iPad Today shows ${shown} rows`)
    const title = await box(page.getByRole('heading', { name: 'Today', exact: true }))
    expect(title.y <= 72, `iPad Today title at y=${title.y}`)
    for (const check of (await page.getByRole('checkbox').all()).slice(0, 6)) {
      const area = await tapArea(check)
      expect(area.w >= TAP && area.h >= TAP, `task checkbox tap area ${area.w}x${area.h}`)
    }

    // The sidebar is put away on an upright iPad; its toggle is the way to
    // every other view, and has to be wholly on screen and big enough.
    for (const [key, name] of [
      ['5', 'Board'],
      ['4', 'Timeline'],
      ['7', 'Time sheet'],
    ]) {
      await page.keyboard.press(key)
      await page.getByRole('heading', { name, exact: true }).first().waitFor()
      await settled(page)
      const toggle = await box(page.locator('[data-slot="sidebar-inset"]').getByRole('button', { name: /^(Show sidebar|Toggle Sidebar)$/ }))
      expect(toggle.x >= 0 && toggle.x + toggle.width <= 820, `${name}: sidebar toggle at x=${toggle.x}`)
      expect(toggle.width >= TAP && toggle.height >= TAP, `${name}: sidebar toggle ${toggle.width}x${toggle.height}`)
      const area = await tapArea(page.locator('[data-slot="sidebar-inset"]').getByRole('button', { name: /^(Show sidebar|Toggle Sidebar)$/ }))
      expect(area.w >= TAP && area.h >= TAP, `${name}: sidebar toggle tap area ${area.w}x${area.h}`)
    }

    // Header buttons: the Time sheet's day arrows, and Timeline's Today and Filter.
    for (const name of ['Day before', 'Day after']) {
      const r = await box(page.getByRole('button', { name, exact: true }))
      expect(r.height >= TAP && r.width >= TAP, `${name} ${r.width}x${r.height}`)
    }
    await page.keyboard.press('4')
    await page.getByRole('heading', { name: 'Timeline', exact: true }).first().waitFor()
    for (const name of ['Today', /^Filter/]) {
      const r = await box(
        page
          .locator('header')
          .getByRole('button', { name, exact: typeof name === 'string' })
          .first(),
      )
      expect(r.height >= TAP, `Timeline header ${name} ${r.width}x${r.height}`)
    }
  } finally {
    await context.close()
  }
}

// A browser with a mouse, however narrow, still offers the Mac app and the
// agent commands; a phone's layout with a mouse is a narrow Mac window.
async function narrowMouse(browser) {
  const { context, page } = await open(browser, { viewport: { width: 700, height: 900 } })
  try {
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Lists', exact: true }).click()
    await page.getByRole('button', { name: /^Settings/ }).click()
    await page.getByRole('heading', { name: 'Settings', exact: true }).first().waitFor()
    for (const pane of ['Connect an AI agent', 'Desktop app'])
      expect((await page.getByRole('heading', { name: pane, exact: true }).count()) === 1, `a 700 wide mouse window lost "${pane}"`)
  } finally {
    await context.close()
  }
}

// A Mac with a mouse keeps its sizes exactly, at any window width.
async function desktop(browser, width) {
  const { context, page } = await open(browser, { viewport: { width, height: 900 } })
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'desktop')
    await settled(page)
    const check = await box(page.getByRole('checkbox').first())
    expect(check.height === 18, `${width}: desktop checkbox ${check.width}x${check.height}`)
    const title = await box(page.getByRole('heading', { name: 'Today', exact: true }))
    expect(title.y === 40, `${width}: desktop Today title at y=${title.y}`)
    expect((await page.locator('[data-view-header] [data-sidebar="trigger"]').count()) === 0, `${width}: a toggle in the desktop header`)
    await page.keyboard.press('7')
    await page.getByRole('heading', { name: 'Time sheet', exact: true }).waitFor()
    const arrow = await box(page.getByRole('button', { name: 'Day before', exact: true }))
    expect(arrow.height === 28, `${width}: desktop day arrow ${arrow.width}x${arrow.height}`)
    await page.getByText('Call the bank').first().waitFor()
    expect((await page.locator('table').count()) === 1, `${width}: the desktop Time sheet is a table`)
    await page.getByText('Call the bank').first().click({ button: 'right' })
    const item = await box(page.getByRole('menuitem').first())
    expect(item.height === 28, `${width}: desktop menu row ${item.height}`)
  } finally {
    await context.close()
  }
}

async function check() {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' })
  try {
    for (const run of [phone, sideways, tablet, narrowMouse]) {
      try {
        await run(browser)
      } catch (error) {
        failures.push(`${run.name}: ${String(error.message).split('\n').slice(0, 3).join(' ')}`)
      }
    }
    for (const width of [1440, 1024, 800]) {
      try {
        await desktop(browser, width)
      } catch (error) {
        failures.push(`desktop ${width}: ${String(error.message).split('\n').slice(0, 3).join(' ')}`)
      }
    }
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
