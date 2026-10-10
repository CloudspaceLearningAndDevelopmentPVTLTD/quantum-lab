import { test, expect, type Page } from '@playwright/test'

import { waitForHydration } from './helpers'

test.describe.configure({ mode: 'serial' })

const qasmExport = (page: Page) => page.locator('pre').first()

/** selectOption only accepts string labels, so resolve the regex against the options. */
const selectPreset = async (page: Page, re: RegExp) => {
  const select = page.getByLabel(/presets/i)
  await expect(select).toBeVisible()
  const options = await select.locator('option').allInnerTexts()
  const match = options.find((t) => re.test(t))
  expect(match, `no preset option matching ${re}`).toBeTruthy()
  await select.selectOption({ label: match as string })
}

const showResultsTable = async (page: Page) => {
  const toggle = page.getByRole('checkbox', { name: /show as table/i })
  await expect(toggle).toBeVisible()
  if (!(await toggle.isChecked())) await toggle.check()
}

test.describe('circuit simulator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/simulator', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /quantum circuit simulator/i })).toBeVisible()
    // Presets, Clear and Import are client-controlled: acting on the
    // server-rendered markup before hydration silently drops the interaction.
    await waitForHydration(page)
  })

  test('runs the Bell preset and only measures 00 and 11', async ({ page }) => {
    await selectPreset(page, /bell/i)

    await page.getByRole('button', { name: /^run$/i }).click()

    await showResultsTable(page)

    const results = page
      .locator('section')
      .filter({ hasText: /measurement outcomes/i })
      .last()
    const cells = results.locator('table tbody tr th:first-child')
    await expect.poll(async () => cells.count()).toBeGreaterThan(0)

    const labels = (await cells.allInnerTexts()).map((t) => t.replace(/[|⟩\s]/g, ''))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(['00', '11']).toContain(label)
    }
  })

  test('exports the Bell circuit as OpenQASM', async ({ page }) => {
    await selectPreset(page, /bell/i)

    const qasm = qasmExport(page)
    await expect(qasm).toContainText('OPENQASM 3.0;')
    await expect(qasm).toContainText('h q[0];')
    await expect(qasm).toContainText('cx q[0], q[1];')
  })

  test('reports both qubits as entangled', async ({ page }) => {
    await selectPreset(page, /bell/i)

    const inspector = page
      .locator('section')
      .filter({ hasText: /state inspector/i })
      .first()
    // The per-qubit pills read "entangled · 1.00" / "separable · 0.00".
    const entangled = inspector.getByText(/^entangled ·/i)
    // The inspector recomputes reduced density matrices after the preset
    // loads; under a fully-parallel run of ~300 tests that can lag past the
    // default poll window. Passes 5/5 in isolation in under 2s — this is
    // headroom for a loaded machine, not a slow feature.
    await expect.poll(async () => entangled.count(), { timeout: 20_000 }).toBe(2)
  })

  test('places a gate by clicking a wire', async ({ page }) => {
    await page.getByRole('button', { name: /^clear$/i }).click()

    const qasm = qasmExport(page)
    await expect(qasm).not.toContainText('h q[0];')

    await page.getByRole('button', { name: /^H gate$/i }).click()

    // The wire click strips live inside the circuit SVG; q0 is the top wire.
    // role="group", not role="img" — see circuitSvg in helpers.ts.
    const svg = page.getByRole('group', { name: /quantum circuit/i })
    await expect(svg).toBeVisible()
    const box = await svg.boundingBox()
    expect(box).not.toBeNull()
    await svg.click({ position: { x: Math.min(120, box!.width - 10), y: 46 } })

    await expect(qasm).toContainText('h q[0];')
  })

  test('imports a QASM circuit', async ({ page }) => {
    await page.getByRole('button', { name: /^clear$/i }).click()

    const source = ['qubit[2] q;', 'h q[1];', 'cx q[1], q[0];'].join('\n')
    const textarea = page.getByLabel(/openqasm source to import/i)
    await textarea.fill(source)
    await page.getByRole('button', { name: /^import$/i }).click()

    const qasm = qasmExport(page)
    await expect(qasm).toContainText('h q[1];')
    await expect(qasm).toContainText('cx q[1], q[0];')
  })
})
