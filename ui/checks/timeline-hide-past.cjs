// "Hide past tasks" on the Timeline, at desktop (1440×900), phone (390×844,
// touch) and iPad (820×1180, touch): with it on, a task completed long ago is
// gone, an overdue open task stays, a task completed early and due ahead
// stays, the count says what is hidden, no project is left as an empty group,
// and the days drawn no longer reach back to the hidden task. Reload keeps
// the choice. docs/plans/2026-11-28-project-sprints.md.
// Each expectation is reported; it exits 1 if any fails.
//
// Run against the built UI (npm run build) with Playwright's Chromium:
//   NODE_PATH=<a node_modules with playwright-core> node checks/timeline-hide-past.cjs
// CHROME_CHANNEL picks the installed browser (default 'chrome'; '' for
// Playwright's own Chromium). SHOTS=<folder> saves a screenshot of each state.
const path = require('node:path')
const { chromium } = require('playwright-core')

const day = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE')
}
const task = (id, title, projectId, start, due, extra = {}) => ({
  id,
  title,
  notes: '',
  projectId,
  start: start === null ? null : day(start),
  due: due === null ? null : day(due),
  priority: 4,
  ...extra,
})
const done = (n) => ({ done: true, doneDay: day(n) })

// Open work, overdue and ahead; one completed today, one completed early.
const current = [
  task(1, 'Fix the onboarding crash', 1, -9, -4),
  task(2, 'Plan the launch party', 1, 3, 6),
  task(3, 'Set up analytics events', 2, 2, 5),
  task(4, 'Send the investor update', 1, null, -2, done(0)),
  task(5, 'Think about a referral programme', 1, null, null),
]
// From the completed history: early (stays), yesterday (hidden), long ago (hidden).
const history = [
  task(6, 'Write the press kit', 1, null, 2, done(-3)),
  task(7, 'Fix the footer links', 2, null, -1, done(-1)),
  task(8, 'Old landing page copy', 3, -25, -21, done(-20)),
]
const state = {
  rev: 1,
  nextId: 9,
  projects: [
    { id: 1, name: 'Hop launch', color: 1 },
    { id: 2, name: 'Website', color: 3 },
    { id: 3, name: 'Archive', color: 5 },
  ],
  tasks: current,
}

const failures = []
let passed = 0
const expect = (ok, what) => {
  if (ok) passed++
  else failures.push(what)
}

const sizes = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
  { name: 'ipad', viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
]

// What the chart shows: the rows by title, each project group with its count,
// the count line, and the first day the axis draws.
const read = (page) =>
  page.evaluate(() => {
    const titles = [...document.querySelectorAll('[data-timeline-completed], [data-task]')].map((e) =>
      (e.getAttribute('title') ?? e.textContent).split(/,| · /)[0].trim(),
    )
    const groups = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((b) => b.querySelector('.tabular-nums') && b.closest('[data-timeline-scroller], .overflow-auto'))
      .map((b) => ({
        name: b.querySelector('.truncate')?.textContent ?? '',
        count: Number(b.querySelector('.tabular-nums:last-child')?.textContent ?? 0),
      }))
    const bar = document.querySelector('[role="group"][aria-label="Filter"]')
    // The axis: the day drawn at the very left of the chart's header.
    const header = [...document.querySelectorAll('.sticky.top-0')].find((h) => h.closest('.overflow-auto'))
    const first = [...header.querySelectorAll('div')].find((d) => d.style.left === '0px' && /bottom-/.test(d.className))
    // The Website project's bar against its only open task's bar.
    const edges = (e) => (e ? [e.getBoundingClientRect().left, e.getBoundingClientRect().right] : null)
    const websiteSpan = edges(document.querySelector('[role="img"][aria-label^="Website spans "]'))
    const websiteTask = edges(document.querySelector('[data-timeline-bar][data-task="3"]') ?? document.querySelector('[data-task="3"]'))
    return {
      titles,
      groups,
      bar: bar?.textContent ?? null,
      firstDate: first ? Number([...first.querySelectorAll('span')].pop().textContent) : null,
      websiteSpan,
      websiteTask,
    }
  })

async function check() {
  const channel = process.env.CHROME_CHANNEL ?? 'chrome'
  const browser = await chromium.launch(channel ? { channel } : {})
  const shots = process.env.SHOTS
  try {
    for (const size of sizes) {
      const { name, ...options } = size
      const context = await browser.newContext(options)
      const syncs = []
      // Grouped by project, so every group's count can be read.
      await context.addInitScript(() => {
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem('done-timeline-by-project', 'yes')
          sessionStorage.setItem('seeded', '1')
        }
      })
      // Isolated from any installed server or real tasks.
      await context.route('http://done.test/**', async (route) => {
        const request = route.request()
        const pathname = new URL(request.url()).pathname
        if (pathname === '/api/me') return route.fulfill({ json: { mode: 'local' } })
        if (pathname === '/api/state') return route.fulfill({ json: state })
        if (pathname === '/api/finished') return route.fulfill({ json: history })
        if (pathname === '/api/sync') {
          syncs.push(request.postDataJSON())
          return route.fulfill({ json: { rev: 1 + syncs.length } })
        }
        if (pathname.startsWith('/api/')) return route.fulfill({ json: [] })
        return route.fulfill({ path: path.resolve(__dirname, '../dist/index.html'), contentType: 'text/html' })
      })
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      const ready = async () => {
        await page.goto('http://done.test/timeline')
        await page.locator('[data-timeline-completed="6"]').waitFor()
        await page.waitForTimeout(400)
      }
      await ready()
      const off = await read(page)
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-off.png`) })
      expect(off.titles.includes('Old landing page copy'), `${name}: with the option off the long-ago task should be on the chart`)
      expect(
        off.groups.some((g) => g.name === 'Archive'),
        `${name}: with the option off the Archive group should show`,
      )
      expect(off.bar === null, `${name}: with the option off there should be no hint under the header (${off.bar})`)
      // A project's bar covers its open tasks' days and no more: Website's
      // completed task is not counted, so its bar ends with task 3's.
      expect(
        off.websiteSpan && off.websiteTask && Math.abs(off.websiteSpan[0] - off.websiteTask[0]) <= 2 && Math.abs(off.websiteSpan[1] - off.websiteTask[1]) <= 2,
        `${name}: the Website bar should match its task's bar within 2px (${off.websiteSpan}, ${off.websiteTask})`,
      )

      // Turned on in the Timeline's menu.
      await page.getByRole('button', { name: 'More timeline options' }).click()
      const option = page.getByRole('checkbox', { name: 'Hide past tasks' })
      expect(!(await option.isChecked()), `${name}: Hide past tasks should start off`)
      await option.click()
      expect(await option.isChecked(), `${name}: Hide past tasks should show checked`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      const on = await read(page)
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-on.png`) })

      const has = (title) => on.titles.includes(title)
      expect(!has('Old landing page copy'), `${name}: the long-ago completed task is still shown`)
      expect(!has('Fix the footer links'), `${name}: the task completed and due yesterday is still shown`)
      expect(has('Fix the onboarding crash'), `${name}: the overdue open task was hidden`)
      expect(has('Write the press kit'), `${name}: the task completed early and due ahead was hidden`)
      expect(has('Send the investor update'), `${name}: the task completed today was hidden`)
      expect(has('Plan the launch party') && has('Set up analytics events'), `${name}: an open task ahead was hidden`)
      expect(/Past hidden/.test(on.bar ?? ''), `${name}: the header does not say past tasks are hidden (${on.bar})`)
      expect(/6 of 8 tasks/.test(on.bar ?? ''), `${name}: the count should be 6 of 8 tasks (two hidden) (${on.bar})`)
      expect(!on.groups.some((g) => g.name === 'Archive'), `${name}: the Archive group, whose only task is hidden, still shows`)
      expect(on.groups.length > 0 && on.groups.every((g) => g.count > 0), `${name}: a project group is empty: ${JSON.stringify(on.groups)}`)
      const website = (groups) => groups.find((g) => g.name === 'Website')?.count
      expect(
        website(off.groups) === 2 && website(on.groups) === 1,
        `${name}: Website should count 2 then 1 (${website(off.groups)}, ${website(on.groups)})`,
      )
      // Off, the days reach back a week before the long-ago completion; on, a week before the overdue task.
      const dateOf = (n) => Number(day(n).slice(8))
      expect(off.firstDate === dateOf(-27), `${name}: with it off the axis should start on the ${dateOf(-27)}th (${off.firstDate})`)
      expect(
        on.firstDate === dateOf(-16),
        `${name}: with it on the axis should start on the ${dateOf(-16)}th, after the hidden task (${on.firstDate})`,
      )
      expect(syncs.length === 0, `${name}: hiding changed tasks (${syncs.length} syncs)`)

      // Remembered on this device.
      await ready()
      const again = await read(page)
      expect(
        !again.titles.includes('Old landing page copy') && /Past hidden/.test(again.bar ?? ''),
        `${name}: the choice was not kept across a reload`,
      )

      // The hint turns it off again.
      await page.getByRole('button', { name: 'Show past tasks' }).click()
      await page.waitForTimeout(300)
      const back = await read(page)
      expect(back.titles.includes('Old landing page copy') && back.bar === null, `${name}: the hint did not turn hiding off`)
      expect(
        back.firstDate === off.firstDate && back.groups.length === off.groups.length,
        `${name}: turning it off did not bring back the same chart`,
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
  console.log(`timeline-hide-past: ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  - ${f}`)
  if (failures.length) process.exitCode = 1
}
check().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
