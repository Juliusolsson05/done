// The Timeline on a phone (390×844, touch): the days are the main thing, a
// day is wide enough for a finger, today is on screen when it opens, a hold
// and a drag moves a bar by a day, and a plain swipe scrolls without moving
// anything, and a tap opens the task. docs/plans/2026-11-27-phone-timeline.md.
//
// Run against the built UI (npm run build) with Playwright's Chromium:
//   NODE_PATH=<a node_modules with playwright-core> node checks/touch-timeline.cjs
// CHROME_CHANNEL picks the installed browser (default 'chrome'; '' for
// Playwright's own Chromium).
const assert = require('node:assert/strict')
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

async function check() {
  const channel = process.env.CHROME_CHANNEL ?? 'chrome'
  const browser = await chromium.launch(channel ? { channel } : {})
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
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

    // The chart: the days' part of the scroller (less any column of names
    // held at its left), the width of a day, and whether today is in it.
    const measure = () =>
      page.evaluate(() => {
        const scroller = [...document.querySelectorAll('div')].find(
          (d) => /overflow-auto/.test(d.className) && /overscroll-contain/.test(d.className),
        )
        const box = scroller.getBoundingClientRect()
        const header = [...scroller.querySelectorAll('div')].find((d) => /sticky/.test(d.className) && /top-0/.test(d.className))
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
        const today = dates.find((s) => /bg-primary/.test(s.className)).getBoundingClientRect()
        return {
          viewport: document.documentElement.clientWidth,
          grid: box.right - gridLeft,
          dayPx,
          todayOnScreen: today.left >= gridLeft && today.right <= box.right,
          scrollLeft: scroller.scrollLeft,
        }
      })
    const opened = await measure()
    assert.ok(opened.grid >= 0.75 * opened.viewport, `the days get ${Math.round(opened.grid)} of ${opened.viewport} px, under 75 %`)
    assert.ok(opened.dayPx >= 44, `a day is ${opened.dayPx} px, under 44`)
    assert.ok(opened.todayOnScreen, 'today is not on screen when the Timeline opens')

    // A finger, by the DevTools protocol: Playwright's touchscreen only taps.
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    const centreOf = async (title) => {
      const r = await page.locator(`[title^="${title},"]`).boundingBox()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }

    // A plain swipe on a bar scrolls the chart and changes no task.
    let from = await centreOf('Record the demo video')
    await touch('touchStart', from.x, from.y)
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', from.x - i * 15, from.y)
      await page.waitForTimeout(16)
    }
    await touch('touchEnd')
    await page.waitForTimeout(1200)
    const swiped = await measure()
    assert.ok(Math.abs(swiped.scrollLeft - opened.scrollLeft) >= 50, `a swipe scrolled the chart ${swiped.scrollLeft - opened.scrollLeft} px`)
    assert.equal(syncs.length, 0, 'a swipe changed a task')

    // Back to today, then hold a bar and drag it one day later.
    await page.locator('header').getByRole('button', { name: 'Today', exact: true }).tap()
    await page.waitForTimeout(800)
    from = await centreOf('Write the launch announcement')
    await touch('touchStart', from.x, from.y)
    await page.waitForTimeout(600)
    const steps = 8
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.x + (opened.dayPx * i) / steps, from.y)
      await page.waitForTimeout(16)
    }
    await touch('touchEnd')
    // Saved through the store's change(), which syncs it with the server.
    for (let waited = 0; !syncs.length && waited < 3000; waited += 100) await page.waitForTimeout(100)
    const moved = syncs.flatMap((s) => s.tasks).find((t) => t.id === 2)
    assert.ok(moved, 'the held bar was not saved')
    assert.equal(moved.due, day(1), 'the held bar did not move by one day')
    assert.equal(syncs.flatMap((s) => s.tasks).filter((t) => t.id !== 2).length, 0, 'another task changed')

    // A tap on a bar opens the task, and its sheet stays up.
    const groceries = page.locator('[title^="Buy groceries,"]')
    await groceries.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }))
    await page.waitForTimeout(300)
    // A plain touch, as for the swipe: Playwright's tap checks hit-testing
    // against a layout that the phone emulation widens (see the plan).
    const at = await centreOf('Buy groceries')
    await touch('touchStart', at.x, at.y)
    await page.waitForTimeout(60)
    await touch('touchEnd')
    await page.waitForTimeout(500)
    assert.equal(await page.getByRole('dialog', { name: 'Details' }).count(), 1, 'a tap on a bar did not open the task')
  } finally {
    await browser.close()
  }
}
check().then(
  () => console.log('touch-timeline: ok'),
  (error) => {
    console.error(error)
    process.exitCode = 1
  },
)
