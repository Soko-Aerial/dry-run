import { chromium } from 'playwright-core'

const URL = 'http://localhost:3111/'
const FILE = process.argv[2] ?? 'samples/davosdorf.plan'
const OUT = process.env.SHOT_PREFIX ?? '/tmp/shot'

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })

const errors: string[] = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', FILE)
await page.waitForSelector('text=/GO|NO-GO/', { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(5000)

console.log('=== INSPECTOR ===')
console.log(await page.locator('aside, [data-slot=resizable-panel]').last().innerText())

await page.screenshot({ path: `${OUT}-dark.png` })

// play, then chase camera
await page.getByRole('button', { name: 'Play' }).click()
await page.waitForTimeout(2500)
await page.getByRole('button', { name: 'Chase' }).click()
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}-chase.png` })
await page.getByRole('button', { name: 'Orbit' }).click()
await page.waitForTimeout(1500)

// select a waypoint from the tree -> inspector + camera focus
const wp = page.getByRole('treeitem').filter({ hasText: /^2/ }).first()
if (await wp.count()) {
  await wp.click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}-selected.png` })
}

// light theme
await page.getByRole('button', { name: 'Toggle theme' }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}-light.png` })

console.log('=== ERRORS ===')
console.log(errors.length ? errors.slice(0, 8).join('\n') : 'none')
await browser.close()
