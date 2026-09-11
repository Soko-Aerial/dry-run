import { chromium } from 'playwright-core'

const URL = 'http://localhost:3111/'
const FILE = process.argv[2] ?? 'samples/davosdorf.plan'

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

// wait for the verdict panel
await page.waitForSelector('text=/^(GO|NO-GO)$/', { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(4000)

const panel = await page.locator('aside').innerText()
console.log('=== SIDEBAR ===\n' + panel)

const canvas = await page.locator('canvas').count()
const pixels = await page.evaluate(() => {
  const c = document.querySelector('canvas') as HTMLCanvasElement | null
  if (!c) return null
  return { w: c.width, h: c.height }
})
console.log('canvas count', canvas, pixels)

// exercise playback + chase camera
await page.getByRole('button', { name: 'Play' }).click()
await page.waitForTimeout(4000)
await page.screenshot({ path: process.env.SHOT_PREFIX + '-orbit.png' })
await page.getByText('Chase').click()
await page.waitForTimeout(4000)
await page.screenshot({ path: process.env.SHOT_PREFIX + '-chase.png' })
await page.getByText('Chase').click()
await page.waitForTimeout(2000)
await page.screenshot({ path: process.env.SHOT_PREFIX + '-orbit-return.png' })

console.log('=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : 'none')
await browser.close()
