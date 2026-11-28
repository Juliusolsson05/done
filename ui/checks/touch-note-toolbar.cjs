// Run against the built UI with Playwright and its WebKit browser installed.
// NODE_PATH can point to an existing Playwright installation outside the app.
const assert = require('node:assert/strict')
const path = require('node:path')
const { devices, webkit } = require('playwright-core')

async function check() {
  const browser = await webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE })
  try {
    const page = await browser.newPage(devices['iPhone 13'])
    page.setDefaultTimeout(5000)
    const note = { id: 1, text: 'Garden gathering\n\n1. Choose a spot\n2. Decide what to bring', updatedAt: Date.now() }
    // Isolate this check from any installed server or real tasks.
    await page.route('http://done.test/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (pathname === '/') return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
      if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
      if (pathname === '/api/state') return route.fulfill({ json: { rev: 0, nextId: 2, tasks: [], projects: [] } })
      if (pathname === '/api/notes') {
        if (request.method() === 'GET') return route.fulfill({ json: [note] })
        Object.assign(note, request.postDataJSON())
        return route.fulfill({ json: note })
      }
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://done.test/')
    const button = (name) => page.getByRole('button', { name, exact: true })
    await button('Lists').tap()
    await button('Notes').tap()
    await page.getByRole('button', { name: /^All notes/ }).tap()
    await page.getByRole('button', { name: /^Garden gathering/ }).tap()
    await page.locator('.cm-line').filter({ hasText: 'Decide what to bring' }).tap()

    const bar = page.getByRole('toolbar', { name: 'Formatting' })
    await bar.getByRole('button', { name: 'Lists' }).tap()
    const saved = page.waitForRequest((request) => request.url().endsWith('/api/notes') && request.method() === 'POST')
    await page.getByRole('button', { name: /^Indent/ }).tap()
    assert.match((await saved).postDataJSON().text, /^   1\. Decide what to bring$/m)
    assert.equal(await page.getByRole('textbox', { name: 'Note' }).evaluate((e) => e === document.activeElement), true)
    await bar.getByRole('button', { name: 'Lists' }).tap()
    await page.getByRole('button', { name: /^Outdent/ }).tap()
    await bar.getByRole('button', { name: 'Done' }).tap()
    await bar.waitFor({ state: 'hidden' })
    // Any delayed focus restoration would cover the tab bar again.
    await button('Today').tap()
    await page.getByRole('heading', { name: 'Today' }).waitFor()
  } finally {
    await browser.close()
  }
}
check().catch((error) => { console.error(error); process.exitCode = 1 })
