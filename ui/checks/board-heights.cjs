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
  // Counted from before the app starts: sounds made (oscillators started),
  // and the window's touchmove listeners that may stop a scroll.
  await page.addInitScript(() => {
    window.__sounds = 0
    window.__blockers = 0
    const start = OscillatorNode.prototype.start
    OscillatorNode.prototype.start = function (...args) {
      window.__sounds += 1
      return start.apply(this, args)
    }
    const listen = window.addEventListener
    window.addEventListener = function (type, fn, options) {
      if (type === 'touchmove' && options && options.passive === false) window.__blockers += 1
      return listen.call(this, type, fn, options)
    }
  })
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

// What a finger does, through Chrome's touch input: points by finger id.
async function fingers(page) {
  const cdp = await page.context().newCDPSession(page)
  return (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) })
}
const counts = (page) => page.evaluate(() => [...document.querySelectorAll('[data-lane]')].map((c) => c.querySelectorAll('[data-task]').length))
const sounds = (page) => page.evaluate(() => window.__sounds)
const menuShown = (page) => page.evaluate(() => !!document.querySelector('[role="menu"]'))
const editorShown = (page) => page.evaluate(() => !!document.querySelector('[role="dialog"]'))
const copyBox = (page) =>
  page.evaluate(() => {
    const copy = document.querySelector('[data-board-copy], div[aria-hidden].pointer-events-none.fixed.z-50')
    if (!copy) return null
    const box = copy.getBoundingClientRect()
    return { left: box.left, top: box.top }
  })
const cardIn = (page, lane, i) => page.locator(`[data-lane="${lane}"] [data-task]`).nth(i)
const settle = async (page) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

// Pressing a card with a finger, on an iPad and on a phone.
async function touchRules(browser, viewport) {
  const where = `${viewport.width}x${viewport.height}`
  const { context, page } = await open(browser, viewport, true)
  try {
    const t = await fingers(page)
    // iOS only lets a touchmove listener stop a scroll if it was there when the touch began.
    expect((await page.evaluate(() => window.__blockers)) >= 1, `${where}: the scroll blocker is listening before any card is held`)
    if (viewport.width >= 768) expect((await page.locator('main header').innerText()).includes('hold'), `${where}: the hint says to press and hold`)

    // A tap on the title opens the task, as before.
    await cardIn(page, 'todo', 0).locator('[data-findable]').tap()
    await page.waitForTimeout(400)
    expect(await editorShown(page), `${where}: a tap on a card opens it`)
    await settle(page)

    // Held still on the check, then let go: the menu, and nothing else.
    for (const [part, hold] of [
      ['[role="checkbox"]', 500],
      ['[data-findable]', 500],
      ['[data-findable]', 1000],
    ]) {
      const box = await cardIn(page, 'todo', 0).locator(part).boundingBox()
      const at = [box.x + Math.min(box.width / 2, 20), box.y + box.height / 2]
      const before = await sounds(page)
      await t('touchStart', [at])
      await page.waitForTimeout(hold)
      await t('touchEnd', [])
      await page.waitForTimeout(500)
      const name = `${part === '[data-findable]' ? 'title' : 'check'} for ${hold} ms`
      expect((await counts(page)).join() === '50,5,0', `${where}: held still on the ${name} and let go, nothing moves or completes`)
      expect(!(await editorShown(page)), `${where}: held still on the ${name} and let go, the task does not open`)
      expect((await sounds(page)) === before, `${where}: held still on the ${name} and let go, nothing is heard`)
      expect(await menuShown(page), `${where}: held still on the ${name} and let go, the card's menu opens`)
      expect(!(await copyBox(page)), `${where}: held still on the ${name} and let go, no copy is left behind`)
      await settle(page)
    }

    // Held past the menu's long press, then dragged: the drag wins, and the copy is under the finger.
    const from = await center(cardIn(page, 'todo', 1))
    const card = await cardIn(page, 'todo', 1).boundingBox()
    const doing = await page.locator('[data-lane="doing"]').boundingBox()
    const before = await sounds(page)
    await t('touchStart', [from])
    await page.waitForTimeout(1000)
    const to = [Math.min(doing.x + 60, viewport.width - 40), from[1] + 40]
    for (let i = 1; i <= 8; i++) {
      await t('touchMove', [[from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8]])
      await page.waitForTimeout(16)
    }
    const copy = await copyBox(page)
    expect(
      copy && Math.abs(copy.left - (to[0] - (from[0] - card.x))) <= 2 && Math.abs(copy.top - (to[1] - (from[1] - card.y))) <= 2,
      `${where}: the held copy is under the finger (${copy && [Math.round(copy.left), Math.round(copy.top)]} vs ${[Math.round(to[0] - (from[0] - card.x)), Math.round(to[1] - (from[1] - card.y))]})`,
    )
    expect(!(await menuShown(page)), `${where}: a held card being dragged does not open the menu`)
    await t('touchEnd', [])
    await page.waitForTimeout(400)
    expect((await counts(page)).join() === '49,6,0', `${where}: held past the long press and dragged, the card lands in In progress`)
    expect(!(await menuShown(page)) && !(await editorShown(page)), `${where}: after a drag, no menu and no task open`)
    expect((await sounds(page)) > before, `${where}: a drop is heard`)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(400)
    expect((await counts(page)).join() === '50,5,0', `${where}: undo puts the dropped card back`)

    // A second finger let go does not drop the card the first one holds.
    const one = await center(cardIn(page, 'todo', 2))
    const two = await center(cardIn(page, 'todo', 4))
    await t('touchStart', [one])
    await page.waitForTimeout(500)
    await t('touchMove', [[one[0] + 20, one[1] + 20]])
    await t('touchStart', [
      [one[0] + 20, one[1] + 20],
      [...two, 1],
    ])
    await page.waitForTimeout(50)
    // Chrome's touchEnd names the fingers that come up: the second.
    await t('touchEnd', [[...two, 1]])
    await page.waitForTimeout(100)
    expect(!!(await copyBox(page)), `${where}: a second finger let go leaves the card held`)
    await t('touchEnd', [])
    await page.waitForTimeout(400)
    await settle(page)

    // The held card's task finishes elsewhere mid-drag: the hold ends, and the next drag works.
    const gone = cardIn(page, 'todo', 3)
    const id = await gone.getAttribute('data-task')
    const g = await center(gone)
    await t('touchStart', [g])
    await page.waitForTimeout(500)
    await t('touchMove', [[g[0] + 20, g[1] + 20]])
    await page.evaluate((id) => document.querySelector(`[data-task="${id}"] [role="checkbox"]`).click(), id)
    await page.waitForTimeout(600)
    const empty = await page.locator('[data-lane="done"]').boundingBox()
    await t('touchMove', [[Math.min(empty.x + 40, viewport.width - 40), empty.y + empty.height - 100]])
    await page.waitForTimeout(50)
    await t('touchEnd', [])
    await page.waitForTimeout(400)
    expect(!(await copyBox(page)), `${where}: a card finished mid-drag leaves no copy behind`)
    const ready = await counts(page)
    const n = await center(cardIn(page, 'todo', 0))
    await touchDrag(page, n, [Math.min(doing.x + 60, viewport.width - 40), n[1]])
    const after = await counts(page)
    expect(after[1] === ready[1] + 1, `${where}: after that, the next drag works`)
  } finally {
    await context.close()
  }
}

// A mouse on a touch layout (a Mac window under 768 wide; an iPad's trackpad).
async function narrowMouse(browser) {
  const { context, page } = await open(browser, { width: 700, height: 800 }, false)
  try {
    const from = await center(cardIn(page, 'todo', 0))
    await page.mouse.move(...from)
    await page.mouse.down()
    await page.mouse.move(from[0] + 30, from[1] + 30, { steps: 4 })
    // The button comes up where the page never hears it: the next move has no button held.
    await page.evaluate(
      ([x, y]) => {
        const at = document.elementFromPoint(x, y)
        at.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 0 }))
      },
      [from[0] + 40, from[1] + 40],
    )
    await page.waitForTimeout(100)
    expect(!(await copyBox(page)), '700x800 mouse: a card no longer follows the pointer once no button is held')
    await page.mouse.up()
  } finally {
    await context.close()
  }
}

// A phone held sideways gives the columns more than a sliver.
async function sidewaysRoom(browser) {
  const { context, page } = await open(browser, { width: 844, height: 390 }, true)
  try {
    const board = await page.locator('[data-board]').boundingBox()
    expect(board.height >= 190, `844x390: the columns get room (${Math.round(board.height)} px tall)`)
  } finally {
    await context.close()
  }
}

const ipadRules = (browser) => touchRules(browser, { width: 820, height: 1180 })
const phoneRules = (browser) => touchRules(browser, { width: 390, height: 844 })

async function check() {
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    for (const run of [desktop, phone, phoneSideways, tablet, ipadRules, phoneRules, narrowMouse, sidewaysRoom]) {
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
