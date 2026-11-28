// The address keeps the app's place: a refresh on /upcoming stays on
// Upcoming, and Back from an open task closes it and stays on its view. On a
// window and on a phone.
// Run against the built UI (npm run build) with Playwright and Chrome:
//   NODE_PATH=<a folder holding playwright-core> node checks/routes.cjs
// The tasks are made up here; no server and no real tasks are touched.
const path = require('node:path')
const { chromium } = require('playwright-core')

const failures = []
const expect = (ok, said) => {
  if (!ok) failures.push(said)
  console.log(ok ? 'ok  ' : 'FAIL', said)
}

const today = new Date()
const day = (offset) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const task = (id, title, due) => ({ id, title, notes: '', projectId: null, start: null, due, priority: 4, status: null, done: false })

async function open(browser, viewport, touch) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const state = {
    rev: 1,
    nextId: 1000,
    tasks: [task(101, 'Call the bank', day(0)), task(102, 'Book flights', day(3)), { ...task(103, 'Find the reservation', null), parentId: 101 }],
    projects: [],
  }
  // Every address of the app's is answered with the app, as the server does.
  await page.route('http://done.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
    if (pathname === '/api/state') return route.fulfill({ json: state })
    if (pathname === '/api/notes') return route.fulfill({ json: [] })
    if (pathname === '/api/entries' || pathname === '/api/finished') return route.fulfill({ json: [] })
    if (pathname === '/api/sync') return route.fulfill({ json: { rev: ++state.rev } })
    if (pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
  })
  return { context, page }
}

const heading = (page) =>
  page
    .locator('h1')
    .first()
    .textContent({ timeout: 3000 })
    .catch(() => null)
// A window edits the task in its row; a phone opens it in a sheet.
const editorOpen = (page, phone) =>
  phone
    ? page
        .locator('[role="dialog"][aria-label="Details"]')
        .isVisible()
        .catch(() => false)
    : page
        .locator('input[value="Call the bank"]')
        .count()
        .then((n) => n > 0)

async function run(browser, where, viewport, touch) {
  const { context, page } = await open(browser, viewport, touch)
  await page.goto('http://done.test/upcoming')
  await page.locator('main').waitFor()
  expect((await heading(page)) === 'Upcoming', `${where}: /upcoming opens Upcoming`)
  await page.reload()
  await page.locator('main').waitFor()
  expect((await heading(page)) === 'Upcoming', `${where}: a refresh on /upcoming stays on Upcoming (${await heading(page)})`)

  // To Today, then a task opened from it.
  await page.goto('http://done.test/today')
  await page.locator('[data-task="101"]').first().waitFor()
  await page.getByText('Call the bank').first().click()
  await page.waitForTimeout(400)
  expect(await editorOpen(page, touch), `${where}: tapping a task in Today opens it`)
  expect(new URL(page.url()).searchParams.get('task') === '101', `${where}: the open task is in the address (${page.url()})`)
  await page.reload()
  await page.locator('main').waitFor()
  await page.waitForTimeout(400)
  expect(await editorOpen(page, touch), `${where}: a refresh keeps the task open`)
  await page.goBack()
  await page.waitForTimeout(400)
  expect(new URL(page.url()).pathname === '/today', `${where}: Back from the task stays in the app, on /today (${page.url()})`)
  expect((await heading(page)) === 'Today', `${where}: Back from the task shows Today`)
  expect(!(await editorOpen(page, touch)), `${where}: Back from the task closes it`)
  // Subtasks can be linked even when their parent's row is collapsed.
  if (!touch) {
    await page.goto('http://done.test/today?task=103')
    await page.locator('main').waitFor()
    const title = page.getByRole('textbox', { name: 'Task', exact: true })
    await title.waitFor()
    expect((await title.inputValue()) === 'Find the reservation', 'a collapsed subtask link opens the correct editor')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await title.waitFor({ state: 'hidden' })
    expect(new URL(page.url()).search === '', 'closing a linked subtask clears its address')
  }
  await context.close()
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.CHROMIUM_CHANNEL ?? 'chrome' })
  try {
    await run(browser, 'window', { width: 1280, height: 800 }, false)
    await run(browser, 'phone', { width: 390, height: 844 }, true)
  } finally {
    await browser.close()
  }
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
