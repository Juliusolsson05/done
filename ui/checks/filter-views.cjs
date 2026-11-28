// The one filter on every task view (#115), at 1280x800 with a mouse and
// 390x844 with touch: Today and Inbox have the Filter, a filter set on Today
// follows to Inbox with the project it decides counted as "hidden here", the
// count is right on both, and Clear takes it away everywhere.
// Run against the built UI with Playwright and Chrome installed:
//   NODE_PATH=<playwright-core's node_modules> node checks/filter-views.cjs
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

const state = () => ({
  rev: 0,
  nextId: 30,
  projects: [
    { id: 1, name: 'Hop launch', color: 1 },
    { id: 2, name: 'Wedding', color: 4 },
  ],
  tasks: [
    task(10, 'Sketch the invitation', { projectId: 2, due: day(0), priority: 2, goalDay: day(0) }),
    task(11, 'Send the invitation list to Anna', { projectId: 2, due: day(0), priority: 2 }),
    task(12, 'Write the launch post', { projectId: 1, due: day(0), priority: 1 }),
    task(13, 'Book the café for the dinner', { projectId: 2, due: day(-1), priority: 3 }),
    task(17, 'Call the bank', { due: day(0), priority: 2 }),
    task(18, 'Renew the passport', { priority: 3 }),
    task(19, 'Print invitation drafts', { priority: 2 }),
  ],
})

async function run(browser, width, height, touch) {
  const where = `${width}x${height}`
  const context = await browser.newContext(
    touch ? { viewport: { width, height }, hasTouch: true, isMobile: true, userAgent: IPHONE } : { viewport: { width, height } },
  )
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  await page.route('http://localhost:4498/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/') return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
    if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
    if (pathname === '/api/state') return route.fulfill({ json: state() })
    if (pathname === '/api/entries' || pathname === '/api/notes') return route.fulfill({ json: [] })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://localhost:4498/')
  await page.getByText('Sketch the invitation').first().waitFor()
  const press = (locator) => (touch ? locator.tap() : locator.click())
  const go = async (key, title) => {
    await page.locator('body').press(key)
    await page.getByRole('heading', { name: title, level: 1 }).first().waitFor()
  }
  const bar = page.locator('[role="group"][aria-label="Filter"]')
  const barText = async () => ((await bar.count()) ? (await bar.innerText()).replace(/\s+/g, ' ') : '')

  // Today has the Filter: words, Wedding and P2.
  await go('2', 'Today')
  const button = page.getByRole('button', { name: /^Filter/ })
  assert.equal(await button.count(), 1, `${where}: Today has a Filter button`)
  await press(button)
  const words = page.getByLabel('Words in a task or its project')
  await words.waitFor()
  await words.fill('invit')
  await press(page.getByRole('menuitemcheckbox', { name: 'Wedding' }))
  await press(page.locator('[aria-label="Priority"]').getByText('P2', { exact: true }))
  await page.keyboard.press('Escape')
  await words.waitFor({ state: 'detached' })
  let text = await barText()
  for (const part of ['“invit”', 'Wedding', 'P2', '1 of 4 tasks']) assert.ok(text.includes(part), `${where}: Today's bar "${text}" has ${part}`)
  // The goal is never filtered; the rest is.
  await page.getByRole('region', { name: 'Today’s goal' }).waitFor()
  assert.equal(await page.locator('[data-task]').filter({ hasText: 'Call the bank' }).count(), 0, `${where}: Call the bank is filtered out`)

  // Inbox has it too, and the same filter follows; the Inbox decides the project.
  await go('1', 'Inbox')
  assert.equal(await page.getByRole('button', { name: /^Filter/ }).count(), 1, `${where}: Inbox has a Filter button`)
  text = await barText()
  for (const part of ['“invit”', 'P2', '1 hidden here', '1 of 3 tasks']) assert.ok(text.includes(part), `${where}: Inbox's bar "${text}" has ${part}`)
  assert.ok(!text.includes('Wedding'), `${where}: the project is hidden on Inbox`)
  await page.locator('[data-task]').filter({ hasText: 'Print invitation drafts' }).waitFor()
  assert.equal(await page.locator('[data-task]').filter({ hasText: 'Renew the passport' }).count(), 0, `${where}: Renew the passport is filtered out`)

  // Clear takes it away on every view.
  await press(bar.getByRole('button', { name: 'Clear' }))
  await bar.waitFor({ state: 'detached' })
  await page.locator('[data-task]').filter({ hasText: 'Renew the passport' }).waitFor()
  await go('2', 'Today')
  assert.equal(await bar.count(), 0, `${where}: no bar on Today after Clear`)
  await page.locator('[data-task]').filter({ hasText: 'Call the bank' }).waitFor()
  console.log(`filter views ${where}: ok`)
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
