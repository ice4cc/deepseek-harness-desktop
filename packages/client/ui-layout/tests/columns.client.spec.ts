import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, DOC_DEFAULT, DOC_MIN,
  SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('step 1: everything fits at preferred widths', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 480 - 360, docPanel: 480, details: 360 })
  })

  it('closed doc panel and details contribute zero width; closed sidebar keeps its compact rail', () => {
    expect(computeColumns(1920, closed(300), closed(480), closed(360)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, docPanel: 0, details: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(1920, open(9999), open(1), open(1))
    expect(cols.sidebar).toBe(420)
    expect(cols.docPanel).toBe(DOC_MIN)
    expect(cols.details).toBe(DETAILS_MIN)
    expect(computeColumns(1920, open(1), closed(480), open(DETAILS_DEFAULT)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: details shrinks first (before the doc panel), center pinned at min', () => {
    // 280 + 480 + 360 + 640 = 1760 > 1700; details concedes to 1700-280-480-640 = 300.
    const cols = computeColumns(1700, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, docPanel: 480, details: DETAILS_MIN })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(300 + 400 + 360 + CENTER_MIN, open(300), open(400), open(360))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, docPanel: 400, details: 360 })
    const one = computeColumns(300 + 400 + 360 + CENTER_MIN - 1, open(300), open(400), open(360))
    expect(one).toEqual({ sidebar: 300, center: CENTER_MIN, docPanel: 400, details: 359 })
  })

  it('step 3: details auto-closes when its min still starves center — doc panel keeps its width', () => {
    // 280 + 480 + 300 + 640 = 1700 > 1650 → details 0; docPanel untouched: center = 1650-280-480 = 890.
    const cols = computeColumns(1650, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 890, docPanel: 480, details: 0 })
  })

  it('step 4: the doc panel shrinks toward its minimum after details auto-closes', () => {
    // 280 + 480 + 640 = 1400 > 1350 → details already 0; docPanel concedes to 1350-280-640 = 430.
    const cols = computeColumns(1350, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, docPanel: 430, details: 0 })
  })

  it('step 5: the doc panel auto-closes when its min still starves center — preferences untouched', () => {
    // 280 + 320 + 640 = 1240 > 1200 → both right columns derived-0; center = 1200-280 = 920.
    const cols = computeColumns(1200, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), closed(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 920, docPanel: 0, details: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 700 < 280+640: sidebar keeps 280, center takes 420 < CENTER_MIN.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(480), closed(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, docPanel: 0, details: 0 })
  })

  it('sidebar-closed narrow window: doc panel concedes then auto-closes', () => {
    const fits = computeColumns(SIDEBAR_COLLAPSED + DOC_MIN + CENTER_MIN, closed(300), open(DOC_DEFAULT), closed(DETAILS_DEFAULT))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, docPanel: DOC_MIN, details: 0 })
    const starved = computeColumns(SIDEBAR_COLLAPSED + DOC_MIN + CENTER_MIN - 1, closed(300), open(DOC_DEFAULT), closed(DETAILS_DEFAULT))
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: DOC_MIN + CENTER_MIN - 1,
      docPanel: 0,
      details: 0,
    })
  })

  it('tiny viewport: both right columns close, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols.docPanel).toBe(0)
    expect(cols.details).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), open(DETAILS_DEFAULT))
    expect(squeezed.docPanel).toBe(0)
    expect(squeezed.details).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DOC_DEFAULT), open(DETAILS_DEFAULT))
    expect(restored.docPanel).toBe(DOC_DEFAULT)
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('with the doc panel closed the chain matches the pre-doc-panel behavior', () => {
    // Step-2 squeeze: details concedes, center pinned at min.
    const squeezed = computeColumns(1250, open(SIDEBAR_DEFAULT), closed(480), open(DETAILS_DEFAULT))
    expect(squeezed).toEqual({ sidebar: 280, center: CENTER_MIN, docPanel: 0, details: 330 })
    // Step-3 auto-close: details 0, center absorbs.
    const starved = computeColumns(1210, open(SIDEBAR_DEFAULT), closed(480), open(DETAILS_DEFAULT))
    expect(starved).toEqual({ sidebar: 280, center: 930, docPanel: 0, details: 0 })
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: right columns auto-close, center takes the rest', () => {
    // Reaches the auto-close steps with the compact rail sidebar.
    expect(computeColumns(500, closed(300), open(DOC_DEFAULT), open(DETAILS_DEFAULT)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, docPanel: 0, details: 0 })
  })
})
