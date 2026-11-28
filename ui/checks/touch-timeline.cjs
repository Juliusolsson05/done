// The Timeline on a phone (390×844, touch): the days are the main thing, a
// day is wide enough for a finger, today is on screen when it opens; and
// every press does what it should: a swipe scrolls, a tap opens, a hold and
// a drag moves a bar a day, a hold let go in place opens the task's menu
// (drag on move, menu on release in place, as on the Board), a tremble moves
// nothing, an off-screen bar is not dragged. docs/plans/2026-11-27-phone-timeline.md.
// Each expectation is reported; it exits 1 if any fails.
//
// Run against the built UI (npm run build) with Playwright's Chromium:
//   NODE_PATH=<a node_modules with playwright-core> node checks/touch-timeline.cjs
// CHROME_CHANNEL picks the installed browser (default 'chrome'; '' for
// Playwright's own Chromium).
const path = require('node:path')
const { chromium } = require('playwright-core')

const day = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE')
}

// 15 dated tasks over three weeks in three projects, and three with no date.
const spec = [
  ['Fix the onboarding crash on older iPhones', 1, -7, -2],
  ['Write the launch announcement', 1, null, 0],
  ['Record the demo video', 1, -1, 2],
  ['Send the investor update', 1, null, 3],
  ['Plan the launch party', 1, 4, 8],
  ['Review pricing page copy with the team', 2, null, 1],
  ['Redesign the landing hero', 2, -5, 1],
  ['Set up analytics events', 2, 2, 5],
  ['Write the changelog page', 2, 6, 9],
  ['Migrate the blog to the new host', 2, 9, 13],
  ['Buy groceries', 3, null, 0],
  ['Book flights to Stockholm', 3, null, 4],
  ['Renew passport', 3, 3, 11],
  ['Fix the bike', 3, null, -3],
  ['Call the landlord about the heating', 3, 10, 14],
]
const tasks = spec.map(([title, projectId, start, due], i) => ({
  id: i + 1,
  title,
  notes: '',
  projectId,
  start: start === null ? null : day(start),
  due: day(due),
  priority: 4,
}))
for (const [id, title, projectId] of [
  [16, 'Think about a referral programme', 1],
  [17, 'Fix the footer links', 2],
  [18, 'Clean the garage', 3],
])
  tasks.push({ id, title, notes: '', projectId, start: null, due: null, priority: 4 })
const state = {
  rev: 1,
  nextId: 19,
  projects: [
    { id: 1, name: 'Hop launch', color: 1 },
    { id: 2, name: 'Website', color: 3 },
    { id: 3, name: 'Home', color: 5 },
  ],
  tasks,
}

const failures = []
let passed = 0
const expect = (ok, what) => {
  if (ok) passed++
  else failures.push(what)
}

const scroller = `[...document.querySelectorAll('div')].find((d) => /overflow-auto/.test(d.className) && /overscroll-contain/.test(d.className))`
// The chart: the days' part of the scroller (less any column of names held
// at its left), the width of a day, and whether today is in it.
const measure = (page) =>
  page.evaluate((find) => {
    const el = eval(find)
    const box = el.getBoundingClientRect()
    const header = [...el.querySelectorAll('div')].find((d) => /sticky/.test(d.className) && /top-0/.test(d.className))
    const headerHeight = header.getBoundingClientRect().height
    const names = [...header.querySelectorAll('*')].filter(
      (e) => getComputedStyle(e).position === 'sticky' && e.getBoundingClientRect().height > headerHeight * 0.8,
    )
    const gridLeft = Math.max(box.left, ...names.map((e) => e.getBoundingClientRect().right))
    const dates = [...header.querySelectorAll('span')].filter((s) => /^\d{1,2}$/.test(s.textContent.trim()))
    const centres = dates
      .map((s) => s.getBoundingClientRect())
      .map((r) => r.left + r.width / 2)
      .sort((a, b) => a - b)
    let dayPx = Infinity
    for (let i = 1; i < centres.length; i++) dayPx = Math.min(dayPx, centres[i] - centres[i - 1])
    const today = dates.find((s) => /bg-primary/.test(s.className))?.getBoundingClientRect()
    return {
      viewport: document.documentElement.clientWidth,
      grid: box.right - gridLeft,
      dayPx,
      todayOnScreen: !!today && today.left >= gridLeft && today.right <= box.right,
      scrollLeft: el.scrollLeft,
    }
  }, scroller)

async function check() {
  const channel = process.env.CHROME_CHANNEL ?? 'chrome'
  const browser = await chromium.launch(channel ? { channel } : {})
  const contexts = []

  // A fresh phone with the Timeline open; `context` keeps one across a reload.
  async function open(context) {
    context ??= await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
    contexts.push(context)
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const syncs = []
    // Isolated from any installed server or real tasks.
    await page.route('http://done.test/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (pathname === '/') return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
      if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
      if (pathname === '/api/state') return route.fulfill({ json: state })
      if (pathname === '/api/sync') {
        syncs.push(request.postDataJSON())
        return route.fulfill({ json: { rev: 1 + syncs.length } })
      }
      return route.fulfill({ json: [] })
    })
    await page.goto('http://done.test/')
    await page.getByRole('button', { name: 'Lists', exact: true }).tap()
    await page.getByRole('button', { name: 'Timeline', exact: true }).tap()
    await page.locator('[title^="Write the launch announcement,"]').waitFor()
    await page.waitForTimeout(400)
    // A finger, by the DevTools protocol: Playwright's touchscreen only taps,
    // and its tap checks hit-testing against a layout the phone emulation
    // widens (see the plan).
    const cdp = await context.newCDPSession(page)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    const centreOf = async (title) => {
      const r = await page.locator(`[title^="${title},"]`).boundingBox()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, box: r }
    }
    // Held still for `ms`, then moved `dx` in steps, then let go.
    const hold = async (at, ms, dx) => {
      await touch('touchStart', at.x, at.y)
      await page.waitForTimeout(ms)
      for (let i = 1; i <= 8 && dx; i++) {
        await touch('touchMove', at.x + (dx * i) / 8, at.y)
        await page.waitForTimeout(16)
      }
      return touch('touchEnd')
    }
    const settled = async () => {
      for (let waited = 0; !syncs.length && waited < 1500; waited += 100) await page.waitForTimeout(100)
    }
    const changed = (id) => syncs.flatMap((s) => s.tasks).filter((t) => t.id === id)
    const others = (id) => syncs.flatMap((s) => s.tasks).filter((t) => t.id !== id)
    const menuShown = () => page.evaluate(() => !!document.querySelector('[role="menu"]'))
    const sheetShown = async () => (await page.getByRole('dialog', { name: 'Details' }).count()) > 0
    const header = page.locator('header')
    return { page, context, syncs, touch, centreOf, hold, settled, changed, others, menuShown, sheetShown, header }
  }

  async function scenario(name, run) {
    try {
      await run(await open())
    } catch (error) {
      failures.push(`${name}: ${String(error.message).split('\n')[0]}`)
    }
  }

  try {
    await scenario('layout', async ({ page }) => {
      const m = await measure(page)
      expect(m.grid >= 0.75 * m.viewport, `the days get ${Math.round(m.grid)} of ${m.viewport} px, under 75 %`)
      expect(m.dayPx >= 44, `a day is ${m.dayPx} px, under 44`)
      expect(m.todayOnScreen, 'today is not on screen when the Timeline opens')
    })

    await scenario('the check above a bar', async ({ page, centreOf }) => {
      // The top corner of a bar is the bar, not the check of its name line.
      const { box } = await centreOf('Write the launch announcement')
      const hit = await page.evaluate(
        ({ x, y }) => {
          const e = document.elementFromPoint(x, y)
          return e?.closest('[title^="Write the launch announcement,"]') ? 'bar' : `${e?.tagName} ${e?.getAttribute('aria-label') ?? ''}`
        },
        { x: box.x + 2, y: box.y + 2 },
      )
      expect(hit === 'bar', `the top edge of a bar is taken by ${hit}`)
    })

    await scenario('swipe', async ({ page, touch, centreOf, syncs }) => {
      const before = await measure(page)
      const from = await centreOf('Record the demo video')
      await touch('touchStart', from.x, from.y)
      for (let i = 1; i <= 10; i++) {
        await touch('touchMove', from.x - i * 15, from.y)
        await page.waitForTimeout(16)
      }
      await touch('touchEnd')
      await page.waitForTimeout(1200)
      const after = await measure(page)
      expect(Math.abs(after.scrollLeft - before.scrollLeft) >= 50, `a swipe scrolled the chart ${after.scrollLeft - before.scrollLeft} px`)
      expect(syncs.length === 0, 'a swipe changed a task')
    })

    await scenario('hold and drag', async ({ page, centreOf, hold, settled, changed, others }) => {
      const { dayPx } = await measure(page)
      await hold(await centreOf('Write the launch announcement'), 600, dayPx)
      await settled()
      expect(changed(2)[0]?.due === day(1), `a hold and a drag of one day saved ${JSON.stringify(changed(2)[0]?.due)}, not ${day(1)}`)
      expect(others(2).length === 0, 'a hold and a drag changed another task')
    })

    await scenario('a long hold, then a drag', async ({ page, touch, centreOf, settled, changed, menuShown }) => {
      const { dayPx } = await measure(page)
      const at = await centreOf('Write the launch announcement')
      await touch('touchStart', at.x, at.y)
      await page.waitForTimeout(1000)
      expect(!(await menuShown()), 'held a second, the window’s long-press menu opened while the bar was lifted')
      for (let i = 1; i <= 8; i++) {
        await touch('touchMove', at.x + (dayPx * i) / 8, at.y)
        await page.waitForTimeout(16)
      }
      await touch('touchEnd')
      await settled()
      expect(!(await menuShown()) && changed(2)[0]?.due === day(1), 'held a second then dragged: the menu opened or the bar did not move one day')
    })

    await scenario('a hold let go in place', async ({ page, centreOf, hold, syncs, menuShown, sheetShown }) => {
      await hold(await centreOf('Write the launch announcement'), 600, 0)
      await page.waitForTimeout(500)
      expect((await menuShown()) && syncs.length === 0 && !(await sheetShown()), 'a hold let go in place did not open the task’s menu alone')
    })

    // Let go a few pixels away, still in place: the menu opens under the
    // finger and the click the release sends must not choose an item of it.
    for (const wobble of [3, 4, 6]) {
      await scenario(`a hold let go ${wobble} px away`, async ({ page, touch, centreOf, syncs, menuShown, sheetShown }) => {
        const at = await centreOf('Write the launch announcement')
        await touch('touchStart', at.x, at.y)
        await page.waitForTimeout(450)
        await touch('touchMove', at.x + wobble, at.y)
        await page.waitForTimeout(30)
        await touch('touchEnd')
        await page.waitForTimeout(600)
        expect(
          (await menuShown()) && syncs.length === 0 && !(await sheetShown()),
          `held, let go ${wobble} px away: the menu did not stay open, or an item of it was chosen`,
        )
      })
    }

    await scenario('a hold on the check', async ({ page, touch, syncs, menuShown }) => {
      const check = page.getByRole('checkbox', { name: 'Complete: Write the launch announcement' })
      const r = await check.boundingBox()
      await touch('touchStart', r.x + r.width / 2, r.y + r.height / 2)
      await page.waitForTimeout(1000)
      expect(!(await menuShown()), 'held on the check, the window’s long-press menu opened while the finger was down')
      await touch('touchEnd')
      await page.waitForTimeout(600)
      const checked = await check.getAttribute('aria-checked').catch(() => null)
      expect(
        (await menuShown()) && syncs.length === 0 && checked !== 'true',
        'held on the check and let go: not the menu alone (or the task was completed)',
      )
    })

    await scenario('tap', async ({ page, touch, centreOf, sheetShown }) => {
      const at = await centreOf('Buy groceries')
      await touch('touchStart', at.x, at.y)
      await page.waitForTimeout(60)
      await touch('touchEnd')
      await page.waitForTimeout(500)
      expect(await sheetShown(), 'a tap on a bar did not open the task')
    })

    await scenario('stretch an end', async ({ page, centreOf, hold, settled, changed }) => {
      const { dayPx } = await measure(page)
      const { box } = await centreOf('Record the demo video')
      // The end's grip reaches past the bar's end.
      await hold({ x: box.x + box.width + 4, y: box.y + box.height / 2 }, 600, dayPx)
      await settled()
      const t = changed(3)[0]
      expect(t?.start === day(-1) && t?.due === day(3), `stretching the end by a day saved ${t?.start} to ${t?.due}`)
    })

    await scenario('a tremble at Quarter', async ({ page, centreOf, hold, settled, syncs, header }) => {
      await header.getByRole('radio', { name: 'Quarter' }).tap()
      await page.waitForTimeout(500)
      await hold(await centreOf('Write the launch announcement'), 600, 3)
      await settled()
      expect(syncs.length === 0, 'a hold let go 3 px away at Quarter moved the task')
    })

    await scenario('Quarter and back', async ({ page, header }) => {
      await header.getByRole('radio', { name: 'Quarter' }).tap()
      await page.waitForTimeout(400)
      await header.getByRole('radio', { name: 'Week' }).tap()
      await page.waitForTimeout(400)
      expect((await measure(page)).todayOnScreen, 'after Quarter and back to Week, today is off screen')
    })

    await scenario('an off-screen bar', async ({ page, hold, settled, syncs }) => {
      // Ended two days ago: off the left edge, its name held there.
      const name = page.locator('[data-timeline-title]').filter({ hasText: 'Fix the onboarding crash' })
      const r = await name.boundingBox()
      await hold({ x: r.x + 20, y: r.y + r.height / 2 }, 600, 120)
      await settled()
      expect(syncs.length === 0, 'a hold on the name of a bar that is off screen moved it')
    })

    await scenario('keyboard', async ({ page, header }) => {
      const stops = await header.getByRole('radio').evaluateAll((all) => all.filter((e) => e.tabIndex >= 0).length)
      expect(stops === 1, `the zoom takes ${stops} tab stops, not one`)
      await header.getByRole('radio', { name: 'Week' }).focus()
      await page.keyboard.press('ArrowRight')
      expect(
        (await header.getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')) === 'true',
        'an arrow key did not choose the next zoom',
      )
      const barStop = await page.locator('[title^="Write the launch announcement,"]').evaluate((e) => e.tabIndex)
      expect(barStop < 0, 'a bar is a second tab stop for the task its name already opens')
    })

    // The zoom is remembered across a reload.
    try {
      const first = await open()
      await first.header.getByRole('radio', { name: 'Day' }).tap()
      await first.page.waitForTimeout(300)
      await first.page.close()
      const again = await open(first.context)
      expect((await again.header.getByRole('radio', { name: 'Day' }).getAttribute('aria-checked')) === 'true', 'Day zoom was not remembered')
    } catch (error) {
      failures.push(`remembered zoom: ${String(error.message).split('\n')[0]}`)
    }
  } finally {
    await browser.close()
  }
  console.log(`touch-timeline: ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  - ${f}`)
  if (failures.length) process.exitCode = 1
}
check().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
