// The Board fills the height its view has, and a card moves between columns
// from anywhere in a long column, with a mouse and with a finger.
// Run against the built UI (npm run build) with Playwright and Chrome:
//   NODE_PATH=<a folder holding playwright-core> node checks/board-heights.cjs
// The tasks are made up here; no server and no real tasks are touched.
const path = require('node:path')
const { chromium } = require('playwright-core')

// Every failure is reported, not only the first, so one run shows the whole picture.
const failures = []
const expect = (ok, said) => {
  if (!ok) failures.push(said)
  console.log(ok ? 'ok  ' : 'FAIL', said)
}

const LONG = 'Write the long onboarding email that explains every step of signing up, inviting the team and connecting the calendar'

// 50 in To do, 5 in In progress, none done today; two projects, long titles and subtasks.
function seed() {
  const tasks = []
  let id = 100
  const task = (title, projectId, extra = {}) => {
    id += 1
    tasks.push({ id, title, notes: '', projectId, start: null, due: null, priority: 4, status: null, done: false, ...extra })
    return id
  }
  for (let n = 1; n <= 50; n++) {
    const parent = task(n % 7 === 0 ? `${LONG} (${n})` : `To do ${n}`, n % 2 ? 1 : 2)
    if (n % 10 === 3) for (let k = 1; k <= 2; k++) task(`Step ${k} of ${n}`, n % 2 ? 1 : 2, { parentId: parent })
  }
  for (let n = 1; n <= 5; n++) task(n === 1 ? `${LONG} (doing)` : `Doing ${n}`, 1, { status: 'doing' })
  return {
    rev: 1,
    nextId: 1000,
    tasks,
    projects: [
      { id: 1, name: 'Hop launch', color: 1 },
      { id: 2, name: 'Home', color: 4 },
    ],
  }
}

async function open(browser, viewport, touch) {
  const context = await browser.newContext({ viewport, hasTouch: touch })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const state = seed()
  await page.route('http://done.test/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/') return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
    if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
    if (pathname === '/api/state') return route.fulfill({ json: state })
    if (pathname === '/api/notes') return route.fulfill({ json: [] })
    if (pathname === '/api/sync') {
      const change = request.postDataJSON()
      for (const t of change.tasks) state.tasks = [...state.tasks.filter((x) => x.id !== t.id), t]
      state.rev += 1
      return route.fulfill({ json: { rev: state.rev } })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://done.test/')
  await page.locator('main').waitFor()
  await page.keyboard.press('5')
  await page.locator('main h3').first().waitFor()
  await page.waitForTimeout(500)
  return { context, page }
}

// The columns are the parents of their headings, side by side in the board.
const lanes = (page) =>
  page.evaluate(() => {
    const columns = [...document.querySelectorAll('main h3')].map((h) => h.parentElement)
    const board = columns[0].parentElement.getBoundingClientRect()
    const scroller = document.scrollingElement
    const main = document.querySelector('main')
    const bar = document.querySelector('nav.fixed')
    return {
      documentScrolls: scroller.scrollHeight > scroller.clientHeight + 1,
      mainScrolls: main.scrollHeight > main.clientHeight + 1,
      boardBottom: board.bottom,
      addBottom: [...main.querySelectorAll('button')].find((b) => b.textContent.includes('Add task')).getBoundingClientRect().bottom,
      barTop: bar ? bar.getBoundingClientRect().top : window.innerHeight,
      columns: columns.map((c) => ({ bottom: c.getBoundingClientRect().bottom, cards: c.querySelectorAll('[data-task]').length })),
    }
  })

async function fills(page, where) {
  const m = await lanes(page)
  expect(!m.documentScrolls, `${where}: the document does not scroll`)
  expect(!m.mainScrolls, `${where}: the page does not scroll, the columns do`)
  for (const [i, c] of m.columns.entries())
    expect(
      Math.abs(c.bottom - m.boardBottom) <= 2,
      `${where}: column ${i + 1} reaches the board's bottom (${Math.round(c.bottom)} vs ${Math.round(m.boardBottom)})`,
    )
  expect(m.boardBottom <= m.barTop + 1 && m.addBottom <= m.barTop + 1, `${where}: the board and Add task end inside the view, above any tab bar`)
  return m
}

// A finger: touch down, held still past the hold, moved in steps, let go.
async function touchDrag(page, from, to, { pause = 0, then } = {}) {
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, [x, y]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  await touch('touchStart', from)
  await page.waitForTimeout(500)
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10])
    await page.waitForTimeout(16)
  }
  if (pause) await page.waitForTimeout(pause)
  // Then back from the edge, onto the column that scrolled in.
  const end = then ?? to
  await touch('touchMove', end)
  await page.waitForTimeout(50)
  await touch('touchEnd', end)
  await page.waitForTimeout(300)
}

const center = async (locator) => {
  const box = await locator.boundingBox()
  return [box.x + Math.min(40, box.width / 2), box.y + box.height / 2]
}
const column = (page, i) => page.locator('main h3').nth(i).locator('xpath=..')

async function desktop(browser) {
  const { context, page } = await open(browser, { width: 1280, height: 600 }, false)
  try {
    await fills(page, '1280x600')
    // The owner's case: far down a long To do column, onto the short In progress.
    const card = column(page, 0).locator('[data-task]').nth(44)
    await card.scrollIntoViewIfNeeded()
    const from = await center(card)
    const doing = await column(page, 1).boundingBox()
    await page.mouse.move(...from)
    await page.mouse.down()
    await page.mouse.move(from[0] + 5, from[1] + 5)
    await page.mouse.move(doing.x + doing.width / 2, from[1], { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect((await lanes(page)).columns[1].cards === 6, '1280x600: the 45th To do card lands in In progress')
    // Into the empty Done column, low down: near the bottom of the window.
    const top = column(page, 0).locator('[data-task]').first()
    await top.scrollIntoViewIfNeeded()
    const first = await center(top)
    const done = await column(page, 2).boundingBox()
    await page.mouse.move(...first)
    await page.mouse.down()
    await page.mouse.move(first[0] + 5, first[1] + 5)
    await page.mouse.move(done.x + done.width / 2, Math.min((await lanes(page)).boardBottom, 600) - 30, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect((await lanes(page)).columns[2].cards === 1, '1280x600: a card dropped low in the empty Done column lands')
  } finally {
    await context.close()
  }
}

async function phone(browser) {
  const { context, page } = await open(browser, { width: 390, height: 844 }, true)
  try {
    await fills(page, '390x844')
    // From To do onto In progress, which shows at the right edge.
    const from = await center(column(page, 0).locator('[data-task]').nth(2))
    await touchDrag(page, from, [375, 600])
    expect((await lanes(page)).columns[1].cards === 6, '390x844: a card dragged by touch lands in In progress')
    // Into the empty Done column, off screen: held at the edge, the columns scroll to it.
    const next = await center(column(page, 0).locator('[data-task]').first())
    await touchDrag(page, next, [386, 500], { pause: 2500, then: [200, 500] })
    expect((await lanes(page)).columns[2].cards === 1, '390x844: a card held at the edge reaches the empty Done column')
  } finally {
    await context.close()
  }
}

// Sideways, the phone has the least height of all.
async function phoneSideways(browser) {
  const { context, page } = await open(browser, { width: 844, height: 390 }, true)
  try {
    await fills(page, '844x390')
    const from = await center(column(page, 0).locator('[data-task]').first())
    await touchDrag(page, from, [600, 250])
    expect((await lanes(page)).columns[1].cards === 6, '844x390: a card dragged by touch lands in In progress')
  } finally {
    await context.close()
  }
}

async function tablet(browser) {
  const { context, page } = await open(browser, { width: 820, height: 1180 }, true)
  try {
    await fills(page, '820x1180')
    const from = await center(column(page, 0).locator('[data-task]').nth(1))
    const done = await column(page, 2).boundingBox()
    await touchDrag(page, from, [done.x + done.width / 2, 1000])
    expect((await lanes(page)).columns[2].cards === 1, '820x1180: a card dragged by touch lands in the empty Done column')
  } finally {
    await context.close()
  }
}

async function check() {
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    for (const run of [desktop, phone, phoneSideways, tablet]) {
      try {
        await run(browser)
      } catch (error) {
        expect(false, `${run.name}: ${error.message.split('\n')[0]}`)
      }
    }
  } finally {
    await browser.close()
  }
  console.log(failures.length ? `${failures.length} failed` : 'all passed')
  if (failures.length) process.exitCode = 1
}
check()
