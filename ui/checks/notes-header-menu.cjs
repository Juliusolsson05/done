// On an iPad, side by side (820x1180) and one note at a time (1024x1366),
// with touch: the open note's header has at most three controls, each at
// least 44 px tall, and its ⋯ menu moves the note to a folder and deletes it,
// with the toast's Undo and Cmd+Z each bringing it back. On an iPhone
// (390x844) a folder's ⋯ renames and deletes it.
// Run against the built UI with Playwright and Chrome installed:
//   NODE_PATH=<playwright-core's node_modules> node checks/notes-header-menu.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright-core')

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// A page on the built UI with the API faked: two notes, one project.
async function open(browser, width, height, userAgent) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, userAgent })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const now = Date.now()
  let notes = [
    { id: 1, text: 'Launch plan\n\nShip the beta', updatedAt: now, projectId: null, folder: null },
    { id: 2, text: 'Groceries\n\n- milk', updatedAt: now - 1000, projectId: null, folder: 'Personal' },
  ]
  // Isolate this check from any installed server or real tasks.
  await page.route('http://done.test/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/') return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
    if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
    if (pathname === '/api/state')
      return route.fulfill({ json: { rev: 0, nextId: 3, tasks: [], projects: [{ id: 1, name: 'Hop launch', color: 2 }] } })
    if (pathname === '/api/notes/delete') {
      notes = notes.filter((n) => n.id !== request.postDataJSON().id)
      return route.fulfill({ json: {} })
    }
    if (pathname === '/api/notes') {
      if (request.method() === 'GET') return route.fulfill({ json: notes })
      const note = request.postDataJSON()
      notes = [note, ...notes.filter((n) => n.id !== note.id)]
      return route.fulfill({ json: note })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://done.test/')
  return { context, page }
}

const saveOf = (page, id) => page.waitForRequest((r) => r.url().endsWith('/api/notes') && r.method() === 'POST' && r.postDataJSON().id === id)

async function tablet(browser, width, height) {
  const { context, page } = await open(browser, width, height, IPAD)
  const where = `${width}x${height}`
  // Notes, from the sidebar; put away on an iPad held upright, so opened first.
  const notesItem = page
    .locator('[data-sidebar=menu-button]')
    .filter({ hasText: /^Notes/ })
    .first()
  await notesItem.waitFor({ state: 'attached' })
  const onScreen = (el) => {
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.left >= 0 && box.right <= innerWidth
  }
  if (!(await notesItem.evaluate(onScreen))) {
    const trigger = page.locator('[data-slot=sidebar-trigger]')
    for (let i = 0; i < (await trigger.count()); i++) {
      if (await trigger.nth(i).evaluate(onScreen)) {
        await trigger.nth(i).tap()
        break
      }
    }
    await page.waitForFunction(
      (el) => {
        const box = el.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth
      },
      await notesItem.elementHandle(),
    )
  }
  await notesItem.tap()
  await page
    .getByRole('button', { name: /^Launch plan/ })
    .first()
    .tap()

  // The header: at most three controls, each 44 px tall or more.
  const header = page.locator('header').filter({ has: page.getByRole('button', { name: 'Read as a document' }) })
  await header.waitFor()
  const controls = await header.evaluate((el) =>
    [...el.querySelectorAll('button, [role=combobox], a[href], input, select')]
      .map((c) => ({ label: (c.getAttribute('aria-label') || c.textContent || '').trim(), box: c.getBoundingClientRect() }))
      .filter((c) => c.box.width > 0 && c.box.height > 0)
      .map((c) => ({ label: c.label, height: Math.round(c.box.height) })),
  )
  assert.ok(controls.length <= 3, `${where}: at most 3 controls in the note header, found ${controls.length}: ${JSON.stringify(controls)}`)
  for (const c of controls) assert.ok(c.height >= 44, `${where}: ${c.label} is ${c.height} px tall, under 44`)

  // ⋯, by tap: move the note to a folder.
  const more = page.getByRole('button', { name: 'Note actions' })
  const menu = page.getByRole('dialog', { name: 'Note actions' })
  const openMenu = async () => {
    await more.tap()
    await menu.waitFor()
  }
  await openMenu()
  let saved = saveOf(page, 1)
  await menu.getByRole('group', { name: 'Folder' }).getByRole('button', { name: 'Personal' }).tap()
  const moved = (await saved).postDataJSON()
  assert.equal(moved.folder, 'Personal', where)
  assert.equal(moved.text, 'Launch plan\n\nShip the beta', where)
  await menu.waitFor({ state: 'hidden' })

  // Delete through the menu; the toast's Undo brings it back.
  const deleteNote = async () => {
    await openMenu()
    const deleted = page.waitForRequest((r) => r.url().endsWith('/api/notes/delete'))
    await menu.getByRole('button', { name: 'Delete note' }).tap()
    assert.equal((await deleted).postDataJSON().id, 1, where)
    await page.getByRole('button', { name: /^Launch plan/ }).waitFor({ state: 'detached' })
  }
  await deleteNote()
  saved = saveOf(page, 1)
  await page.getByRole('button', { name: 'Undo' }).tap()
  assert.equal((await saved).postDataJSON().folder, 'Personal', where)
  await more.waitFor()

  // And again, undone with Cmd+Z (a hardware keyboard on an iPad).
  await deleteNote()
  saved = saveOf(page, 1)
  await page.keyboard.press('ControlOrMeta+z')
  assert.equal((await saved).postDataJSON().folder, 'Personal', where)
  await more.waitFor()
  console.log(`notes header menu ${where}: ok`, JSON.stringify(controls.map((c) => c.label)))
  await context.close()
}

async function phone(browser) {
  const { context, page } = await open(browser, 390, 844, IPHONE)
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('Lists').tap()
  await page
    .getByRole('button', { name: /^(\d+ )?Notes/ })
    .first()
    .tap()
  await page
    .getByRole('button', { name: /^Personal/ })
    .first()
    .tap()
  const sheet = page.getByRole('dialog', { name: 'Folder actions' })

  // Rename, in place under the title.
  await button('Folder actions').tap()
  await sheet.getByRole('button', { name: 'Rename folder' }).tap()
  let saved = saveOf(page, 2)
  const field = page.getByRole('textbox', { name: 'Folder name' })
  await field.fill('Home')
  await field.press('Enter')
  assert.equal((await saved).postDataJSON().folder, 'Home')
  await page.getByRole('heading', { name: 'Home' }).waitFor()

  // Delete: the note is taken out of the folder, never deleted.
  await button('Folder actions').tap()
  saved = saveOf(page, 2)
  await sheet.getByRole('button', { name: 'Delete folder' }).tap()
  const out = (await saved).postDataJSON()
  assert.equal(out.folder, null)
  assert.equal(out.text, 'Groceries\n\n- milk')
  await sheet.waitFor({ state: 'detached' })
  console.log('notes folder menu 390x844: ok')
  await context.close()
}

async function check() {
  const browser = await chromium.launch({ channel: process.env.CHROMIUM_CHANNEL ?? 'chrome' })
  try {
    await tablet(browser, 820, 1180)
    await tablet(browser, 1024, 1366)
    await phone(browser)
  } finally {
    await browser.close()
  }
}
check().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
