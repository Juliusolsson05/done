// On an iPad (820x1180, touch) the open note's header has at most three
// controls, each at least 44 px tall, and its ⋯ menu moves the note to a
// folder and deletes it, with Undo bringing it back.
// Run against the built UI with Playwright and Chrome installed:
//   NODE_PATH=<playwright-core's node_modules> node checks/notes-header-menu.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright-core')

async function check() {
  const browser = await chromium.launch({ channel: process.env.CHROMIUM_CHANNEL ?? 'chrome' })
  try {
    const context = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const now = Date.now()
    let notes = [
      { id: 1, text: 'Launch plan\n\nShip the beta', updatedAt: now, projectId: null, folder: null },
      { id: 2, text: 'Groceries\n\n- milk', updatedAt: now - 1000, projectId: null, folder: 'Personal' },
    ]
    const saves = []
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
        saves.push(note)
        notes = [note, ...notes.filter((n) => n.id !== note.id)]
        return route.fulfill({ json: note })
      }
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://done.test/')
    await page.locator('[data-slot=sidebar-trigger]').first().waitFor({ state: 'attached' })

    // Notes, from the sidebar (put away on an iPad held upright).
    const trigger = page.locator('[data-slot=sidebar-trigger]')
    for (let i = 0; i < (await trigger.count()); i++) {
      const box = await trigger.nth(i).boundingBox()
      if (box && box.x >= 0 && box.x < 820) {
        await trigger.nth(i).tap()
        await page.waitForTimeout(500)
        break
      }
    }
    await page
      .locator('[data-sidebar=menu-button]')
      .filter({ hasText: /^Notes/ })
      .first()
      .tap()
    await page
      .getByRole('button', { name: /^Launch plan/ })
      .first()
      .tap()

    // The header: at most three controls, each 44 px tall or more.
    const header = page.locator('header').filter({ has: page.getByRole('heading', { name: 'Notes' }) })
    await header.waitFor()
    const controls = await header.evaluate((el) =>
      [...el.querySelectorAll('button, [role=combobox], a[href], input, select')]
        .map((c) => ({ label: (c.getAttribute('aria-label') || c.textContent || '').trim(), box: c.getBoundingClientRect() }))
        .filter((c) => c.box.width > 0 && c.box.height > 0)
        .map((c) => ({ label: c.label, height: Math.round(c.box.height) })),
    )
    assert.ok(controls.length <= 3, `at most 3 controls in the note header, found ${controls.length}: ${JSON.stringify(controls)}`)
    for (const c of controls) assert.ok(c.height >= 44, `${c.label} is ${c.height} px tall, under 44`)

    // ⋯, by tap: move the note to a folder.
    const more = header.getByRole('button', { name: 'Note actions' })
    await more.tap()
    const menu = page.getByRole('menu', { name: 'Note actions' })
    await menu.waitFor()
    const saved = page.waitForRequest((r) => r.url().endsWith('/api/notes') && r.method() === 'POST')
    await menu.getByRole('menuitemradio', { name: 'Personal' }).tap()
    const moved = (await saved).postDataJSON()
    assert.equal(moved.id, 1)
    assert.equal(moved.folder, 'Personal')
    assert.equal(moved.text, 'Launch plan\n\nShip the beta')
    await menu.waitFor({ state: 'hidden' })

    // Delete through the menu, then Undo.
    await more.tap()
    const deleted = page.waitForRequest((r) => r.url().endsWith('/api/notes/delete'))
    await page.getByRole('menu', { name: 'Note actions' }).getByRole('menuitem', { name: 'Delete note' }).tap()
    assert.equal((await deleted).postDataJSON().id, 1)
    await page.getByRole('button', { name: /^Launch plan/ }).waitFor({ state: 'detached' })
    const restored = page.waitForRequest((r) => r.url().endsWith('/api/notes') && r.method() === 'POST')
    await page.getByRole('button', { name: 'Undo' }).tap()
    const back = (await restored).postDataJSON()
    assert.equal(back.id, 1)
    assert.equal(back.folder, 'Personal')
    await page
      .getByRole('button', { name: /^Launch plan/ })
      .first()
      .waitFor()
    console.log('notes header menu: ok', JSON.stringify(controls.map((c) => c.label)))
  } finally {
    await browser.close()
  }
}
check().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
