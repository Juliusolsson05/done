const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core')

async function render() {
  const root = path.resolve(process.argv[2] || '.')
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  })
  const available = new Set(await fs.readdir(path.join(root, 'captures')))
  const output = path.join(root, 'exports')
  await fs.mkdir(output, { recursive: true })
  try {
    for (const [family, prefix, width, height] of [
      ['iphone', 'iPhone', 1206, 2622], ['ipad', 'iPad', 2064, 2752], ['duo', 'Duo', 1800, 1200],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
      for (const [index, view] of ['Today', 'Notes', 'Board', 'Upcoming'].entries()) {
        if (family === 'duo' && (index || !available.has('iPhone-Today.png') || !available.has('iPad-Notes.png'))) continue
        if (family !== 'duo' && !available.has(prefix + '-' + view + '.png')) continue
        const url = pathToFileURL(path.join(root, 'poster.html'))
        url.searchParams.set('family', family)
        url.searchParams.set('view', view)
        await page.goto(url.href)
        await page.locator('.glass img').first().waitFor()
        await page.evaluate(async () => {
          await Promise.all(Array.from(document.images, (image) => image.decode()))
          await document.fonts.ready
          const h = document.querySelector('h1').getBoundingClientRect()
          const f = document.querySelector('.device').getBoundingClientRect()
          if (h.bottom > f.top && h.right > f.left && document.querySelector('main').dataset.family !== 'duo') {
            throw new Error('Headline overlaps device')
          }
        })
        const filename = family === 'duo' ? 'Duo.png' : prefix + '-0' + (index + 1) + '-' + view + '.png'
        await page.screenshot({ path: path.join(output, filename), animations: 'disabled' })
        console.log(filename, width, height)
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
render().catch((error) => { console.error(error); process.exitCode = 1 })
