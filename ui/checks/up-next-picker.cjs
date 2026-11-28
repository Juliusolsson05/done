// Up next, at 1280x800 with a mouse and 390x844 with touch: open it from the
// Focus page, find a task by typing "invit sketch", add it as a 45 min block,
// see it queued, and remove it. On touch, each control in a queued row is at
// least 44 px tall.
// Run against the built UI with Playwright and Chrome installed:
//   NODE_PATH=<playwright-core's node_modules> node checks/up-next-picker.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright-core')

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const two = (n) => String(n).padStart(2, '0')
const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
const task = (id, title, fields = {}) => ({ id, title, notes: '', projectId: null, start: null, due: null, priority: 4, done: false, ...fields })

// A day as it might look, with a finished task whose title is close to an open one.
const state = () => ({
  rev: 0,
  nextId: 30,
  projects: [
    { id: 1, name: 'Hop launch', color: 1 },
    { id: 2, name: 'Wedding', color: 4 },
  ],
  tasks: [
    task(10, 'Sketch the invitation', { projectId: 2, due: day(0), priority: 2, goalDay: day(0) }),
    task(11, 'Send the invitation list to Anna', { projectId: 2, due: day(0), priority: 3 }),
    task(12, 'Write the launch post', { projectId: 1, due: day(0), priority: 1 }),
    task(20, 'Sketch the invitation envelope', { projectId: 2, done: true, doneDay: day(-1) }),
  ],
})

async function open(browser, width, height, touch) {
  const context = await browser.newContext(
    touch ? { viewport: { width, height }, hasTouch: true, isMobile: true, userAgent: IPHONE } : { viewport: { width, height } },
  )
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  // Isolate this check from any installed server or real tasks. Served as
  // localhost, never fetched: a block's id comes from crypto.randomUUID,
  // which a page only has in a secure context, as the app always is.
  await page.route('http://localhost:4499/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/') return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
    if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
    if (pathname === '/api/state') return route.fulfill({ json: state() })
    if (pathname === '/api/entries' || pathname === '/api/notes') return route.fulfill({ json: [] })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://localhost:4499/')
  return { context, page }
}

async function run(browser, width, height, touch) {
  const where = `${width}x${height}`
  const { context, page } = await open(browser, width, height, touch)
  const press = (locator) => (touch ? locator.tap() : locator.click())
  await page.getByText('Today', { exact: true }).first().waitFor()
  await page.keyboard.press('6')
  await press(page.getByRole('button', { name: /^Options/ }))
  await press(page.getByRole('button', { name: 'Up next', exact: true }))
  const panel = page.getByRole('dialog', { name: 'Up next' })
  await panel.waitFor()

  // The task, found by typing words out of order.
  await press(panel.locator('#up-next-task'))
  const field = page.getByRole('combobox', { name: 'Find a task' })
  await field.fill('invit sketch')
  const options = page.getByRole('option')
  await options.first().waitFor()
  assert.deepEqual(
    (await options.allInnerTexts()).map((t) => t.split('\n')[0]),
    ['Sketch the invitation'],
    `${where}: "invit sketch" finds only the open task`,
  )
  await press(options.first())
  await page.getByRole('listbox').waitFor({ state: 'detached' })

  // The length, then Add.
  await press(panel.getByRole('radio', { name: '45 min' }))
  await press(panel.getByRole('button', { name: 'Add', exact: true }))
  const queued = panel.getByRole('list', { name: 'Queued blocks' }).getByRole('listitem')
  await queued.first().waitFor()
  assert.equal(await queued.count(), 1, where)
  const row = (await queued.first().innerText()).replace(/\s+/g, ' ')
  assert.match(row, /Sketch the invitation/, where)
  assert.match(row, /45 min/, where)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('done-up-next') ?? '[]'))
  assert.deepEqual(
    stored.map((b) => [b.taskId, b.minutes]),
    [[10, 45]],
    `${where}: the block is saved`,
  )

  // On touch, every control in the row is a finger's size.
  if (touch) {
    const heights = await queued
      .first()
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    assert.ok(heights.length >= 3 && heights.every((h) => h >= 44), `${where}: row controls ${heights} px tall`)
  }

  await press(panel.getByRole('button', { name: 'Remove: Sketch the invitation' }))
  await queued.first().waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('done-up-next') ?? '[]')), [], `${where}: removed`)
  console.log(`up next picker ${where}: ok`)
  await context.close()
}

async function check() {
  const browser = await chromium.launch({ channel: process.env.CHROMIUM_CHANNEL ?? 'chrome' })
  try {
    await run(browser, 1280, 800, false)
    await run(browser, 390, 844, true)
  } finally {
    await browser.close()
  }
}
check().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
