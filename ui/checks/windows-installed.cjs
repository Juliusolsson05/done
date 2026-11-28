// Drive the installed WebView2, with its native SQLite backend and its ordinary user profile.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('playwright-core')

const [exe, phase, evidence] = process.argv.slice(2)
const title = 'Choose plants for the terrace'
const editedTitle = 'Choose flowers for the terrace'
const noteTitle = 'Garden gathering'
const noteBody = noteTitle + '\n\n1. Choose a spot\n   1. Check the afternoon light'
const finalNote = noteBody + '\n2. Bring water'

function mcp(name, args = {}) {
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n'
  const result = spawnSync(exe, ['mcp'], { input, encoding: 'utf8', timeout: 10000, windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  const response = JSON.parse(result.stdout.trim())
  assert.ok(response.result && !response.result.isError, JSON.stringify(response))
  return JSON.parse(response.result.content[0].text)
}

async function until(description, read, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await read()
    if (result) return result
    await delay(250)
  }
  throw new Error('Timed out waiting for ' + description)
}

async function run() {
  const port = phase === 'create' ? 19222 : 19223
  const endpoint = 'http://127.0.0.1:' + port
  const app = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port },
    stdio: 'inherit',
  })
  let browser
  let page
  try {
    await until('the installed WebView2 endpoint', async () => {
      assert.equal(app.exitCode, null, 'done exited before the window appeared')
      return fetch(endpoint + '/json/version').then((r) => r.ok, () => false)
    })
    browser = await chromium.connectOverCDP(endpoint)
    page = await until('the application page', () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')))
    page.setDefaultTimeout(12000)
    await page.getByRole('heading', { name: 'Today', exact: true }).waitFor()
    await page.keyboard.press('1')
    await page.getByRole('heading', { name: 'Inbox', exact: true }).waitFor()
    if (phase === 'create') {
      await page.keyboard.press('q')
      const taskInput = page.getByRole('textbox', { name: 'New task', exact: true })
      await taskInput.fill(title)
      await taskInput.press('Enter')
      await page.getByText(title, { exact: true }).first().waitFor()
      const task = await until('saved task via installed MCP', () => mcp('list_tasks').tasks.find((t) => t.title === title))
      console.log('create: task saved by the window and read back by the installed MCP (id ' + task.id + ').')
      // Quick add stays open after Enter, with the caret in its field, where a
      // digit is text, not a view key. Escape closes it, as a person would.
      await taskInput.press('Escape')
      await taskInput.waitFor({ state: 'hidden' })
      await page.keyboard.press('8')
      await page.getByRole('heading', { name: 'Notes', exact: true }).waitFor()
      await page.getByRole('button', { name: 'New note', exact: true }).click()
      await page.getByRole('textbox', { name: 'Note', exact: true }).click()
      await page.keyboard.insertText(noteBody)
      const note = await until('saved Markdown via installed MCP', () => mcp('list_notes').notes.find((n) => n.text === noteBody))
      console.log('create: note saved by the window and read back by the installed MCP (id ' + note.id + ').')
      await page.screenshot({ path: path.join(evidence, 'windows-notes.png') })
      mcp('update_task', { id: task.id, title: editedTitle })
      mcp('update_note', { id: note.id, text: finalNote })
    } else {
      await page.getByText(editedTitle, { exact: true }).first().waitFor()
      console.log('reopen: the relaunched window shows the task as the MCP left it.')
      await page.screenshot({ path: path.join(evidence, 'windows-inbox.png') })
      await page.keyboard.press('8')
      await page.getByRole('heading', { name: 'Notes', exact: true }).waitFor()
      await page.getByText(noteTitle, { exact: true }).first().waitFor()
      console.log('reopen: the relaunched window lists the note.')
      assert.ok(mcp('list_notes').notes.some((n) => n.text === finalNote), 'edited Markdown should survive reinstall')
    }
    console.log(phase + ': installed application and MCP share saved tasks and notes.')
  } catch (error) {
    if (page) {
      console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 2000))
      await page.screenshot({ path: path.join(evidence, phase + '-failure.png') }).catch(() => {})
    }
    throw error
  } finally {
    if (app.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'])
    await browser?.close().catch(() => {})
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
