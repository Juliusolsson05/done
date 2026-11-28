const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('playwright-core')

async function run() {
  const exe = process.argv[2]
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_task', arguments: { title: 'Keep my Windows task' } } }) + '\n'
  const saved = spawnSync(exe, ['mcp'], { input, encoding: 'utf8', timeout: 10000 })
  assert.equal(saved.status, 0, saved.stderr)
  assert.match(saved.stdout, /Keep my Windows task/)
  const app = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19229' }, stdio: 'inherit' })
  const origin = 'http://127.0.0.1:19229'
  const deadline = Date.now() + 30000
  while (!(await fetch(origin + '/json/version').then((r) => r.ok, () => false))) {
    assert.equal(app.exitCode, null)
    if (Date.now() > deadline) throw new Error('No WebView2 port opened')
    await delay(250)
  }
  const browser = await chromium.connectOverCDP(origin)
  const page = browser.contexts()[0].pages()[0]
  try {
    const ready = page.getByRole('button', { name: 'Restart to update', exact: true })
    await ready.waitFor({ timeout: 90000 })
    await ready.click()
    const exited = Date.now() + 45000
    while (app.exitCode === null) {
      if (Date.now() > exited) throw new Error('App did not exit for its updater')
      await delay(250)
    }
    assert.equal(app.exitCode, 0)
  } finally { await browser.close().catch(() => {}) }
}
run().catch((error) => { console.error(error); process.exit(1) })
