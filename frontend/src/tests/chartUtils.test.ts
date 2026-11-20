import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  clampTooltipHorizontal,
  downsampleLTTB,
  findNearestIndexByX,
} from '../lib/chartUtils.ts'

interface SamplePoint {
  index: number
  value: number
}

function generateSeries(count: number): SamplePoint[] {
  const out: SamplePoint[] = []
  const peakIdx = Math.floor(count * 0.35)
  const valleyIdx = Math.floor(count * 0.7)
  for (let i = 0; i < count; i++) {
    // Deterministic smooth baseline (30..70) with one unmistakable global peak (180) and valley (-40)
    let value = 50 + Math.sin(i / 17) * 20
    if (count >= 100 && i === peakIdx) value = 180
    if (count >= 100 && i === valleyIdx) value = -40
    out.push({ index: i, value: Number(value.toFixed(2)) })
  }
  return out
}

test('downsampleLTTB: 0 data points returns empty array without mutating input', () => {
  const input: SamplePoint[] = []
  const result = downsampleLTTB(input, 50, (p) => p.value)
  assert.deepEqual(result, [])
  assert.notEqual(result, input)
})

test('downsampleLTTB: 1 data point preserves the point without mutating input', () => {
  const input: SamplePoint[] = [{ index: 0, value: 42 }]
  const snapshot = JSON.stringify(input)
  const result = downsampleLTTB(input, 50, (p) => p.value)
  assert.deepEqual(result, [{ index: 0, value: 42 }])
  assert.notEqual(result, input)
  assert.equal(JSON.stringify(input), snapshot)
})

test('downsampleLTTB: 10 data points preserves order, first/last, and input immutability', () => {
  const input = generateSeries(10)
  const snapshot = JSON.stringify(input)

  const passthrough = downsampleLTTB(input, 60, (p) => p.value)
  assert.equal(passthrough.length, 10)
  assert.deepEqual(passthrough[0], input[0])
  assert.deepEqual(passthrough[9], input[9])
  assert.notEqual(passthrough, input)

  const reduced = downsampleLTTB(input, 5, (p) => p.value)
  assert.equal(reduced.length, 5)
  assert.deepEqual(reduced[0], input[0])
  assert.deepEqual(reduced[4], input[9])
  assert.equal(JSON.stringify(input), snapshot)
})

test('downsampleLTTB: 500 data points preserves first, last, peak, valley, and ascending order', () => {
  const input = generateSeries(500)
  const snapshot = JSON.stringify(input)
  const peakIdx = Math.floor(500 * 0.35)
  const valleyIdx = Math.floor(500 * 0.7)

  const t0 = performance.now()
  const result = downsampleLTTB(input, 60, (p) => p.value)
  const elapsedMs = performance.now() - t0

  assert.equal(result.length, 60)
  assert.equal(result[0], input[0])
  assert.equal(result[result.length - 1], input[499])
  assert.ok(result.some((p) => p.index === peakIdx), 'major peak must be preserved')
  assert.ok(result.some((p) => p.index === valleyIdx), 'major valley must be preserved')
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i].index > result[i - 1].index, 'indices must stay strictly ascending')
  }
  assert.equal(JSON.stringify(input), snapshot)
  assert.ok(elapsedMs < 50, `expected < 50ms for 500 points, got ${elapsedMs.toFixed(2)}ms`)
})

test('downsampleLTTB: 10,000 data points reduces to 96 points quickly while preserving first, last, peak, and valley', () => {
  const input = generateSeries(10_000)
  const peakIdx = Math.floor(10_000 * 0.35)
  const valleyIdx = Math.floor(10_000 * 0.7)

  const t0 = performance.now()
  const result = downsampleLTTB(input, 96, (p) => p.value)
  const elapsedMs = performance.now() - t0

  assert.equal(result.length, 96)
  assert.equal(result[0], input[0])
  assert.equal(result[result.length - 1], input[9999])
  assert.ok(result.some((p) => p.index === peakIdx), 'major peak must be preserved')
  assert.ok(result.some((p) => p.index === valleyIdx), 'major valley must be preserved')
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i].index > result[i - 1].index)
  }
  assert.ok(elapsedMs < 100, `expected < 100ms for 10,000 points, got ${elapsedMs.toFixed(2)}ms`)
})

test('clampTooltipHorizontal: places right when space permits, flips left near right edge, and clamps on narrow screens', () => {
  const rightPos = clampTooltipHorizontal({
    anchorX: 120,
    containerWidth: 900,
    tooltipWidth: 216,
  })
  assert.equal(rightPos.placement, 'right')
  assert.equal(rightPos.leftPx, 134)

  const leftPos = clampTooltipHorizontal({
    anchorX: 860,
    containerWidth: 900,
    tooltipWidth: 216,
  })
  assert.equal(leftPos.placement, 'left')
  assert.equal(leftPos.leftPx, 630)
  assert.ok(leftPos.leftPx + 216 <= 892)

  const mobileLeft = clampTooltipHorizontal({
    anchorX: 4,
    containerWidth: 300,
    tooltipWidth: 216,
  })
  assert.ok(mobileLeft.leftPx >= 8)
  assert.ok(mobileLeft.leftPx + 216 <= 292)

  const mobileRight = clampTooltipHorizontal({
    anchorX: 296,
    containerWidth: 300,
    tooltipWidth: 216,
  })
  assert.ok(mobileRight.leftPx >= 8)
  assert.ok(mobileRight.leftPx + 216 <= 292)
})

test('findNearestIndexByX: binary search finds nearest coordinate accurately in O(log n)', () => {
  const xs = [10, 30, 50, 70, 90]
  assert.equal(findNearestIndexByX([], 50), -1)
  assert.equal(findNearestIndexByX([42], 10), 0)
  assert.equal(findNearestIndexByX(xs, 0), 0)
  assert.equal(findNearestIndexByX(xs, 100), 4)
  assert.equal(findNearestIndexByX(xs, 48), 2)
  assert.equal(findNearestIndexByX(xs, 61), 3)
})

test('Phase 5B price history: LTTB downsamples 365-day & 1,000-pt series to 24/18/12 bars preserving first, last, peak, and valley', () => {
  const makePriceSeries = (count: number) => {
    const peakIdx = Math.floor(count * 0.28)
    const valleyIdx = Math.floor(count * 0.66)
    const series: Array<{ id: string; price: number }> = []
    for (let i = 0; i < count; i++) {
      let price = Math.round(280 + Math.sin(i / 9) * 18)
      if (i === peakIdx) price = 440
      if (i === valleyIdx) price = 195
      series.push({ id: `p-${i}`, price })
    }
    return { series, peakIdx, valleyIdx }
  }

  for (const [count, targetBars] of [
    [365, 24],
    [365, 18],
    [365, 12],
    [1000, 24],
  ] as const) {
    const { series, peakIdx, valleyIdx } = makePriceSeries(count)
    const snapshot = JSON.stringify(series)

    const sampled = downsampleLTTB(series, targetBars, (p) => p.price)
    assert.equal(sampled.length, targetBars)
    assert.equal(sampled[0].id, series[0].id)
    assert.equal(sampled[sampled.length - 1].id, series[count - 1].id)
    assert.ok(sampled.some((p) => p.id === `p-${peakIdx}`), `peak preserved for ${count} -> ${targetBars}`)
    assert.ok(sampled.some((p) => p.id === `p-${valleyIdx}`), `valley preserved for ${count} -> ${targetBars}`)
    assert.equal(JSON.stringify(series), snapshot, 'input price array must not be mutated')
  }
})

test('Phase 5B price history: tooltip horizontal clamping stays inside bounds across 1440/1024/900/768/390/375px viewports', () => {
  const viewports = [
    { viewport: 1440, containerWidth: 1120, tooltipWidth: 196, padX: 18, bars: 12 },
    { viewport: 1024, containerWidth: 740, tooltipWidth: 196, padX: 18, bars: 12 },
    { viewport: 900, containerWidth: 820, tooltipWidth: 196, padX: 18, bars: 12 },
    { viewport: 768, containerWidth: 700, tooltipWidth: 196, padX: 14, bars: 12 },
    { viewport: 390, containerWidth: 342, tooltipWidth: 176, padX: 10, bars: 12 },
    { viewport: 375, containerWidth: 327, tooltipWidth: 176, padX: 10, bars: 12 },
  ] as const

  for (const vp of viewports) {
    const usableW = vp.containerWidth - vp.padX * 2
    for (const barIdx of [0, Math.floor(vp.bars / 2), vp.bars - 1]) {
      const anchorX = vp.padX + ((barIdx + 0.5) / vp.bars) * usableW
      const pos = clampTooltipHorizontal({
        anchorX,
        containerWidth: vp.containerWidth,
        tooltipWidth: vp.tooltipWidth,
        offset: 10,
        edgePadding: 8,
      })
      assert.ok(
        pos.leftPx >= 8,
        `viewport ${vp.viewport}px bar ${barIdx}: leftPx (${pos.leftPx}) must be >= 8`,
      )
      assert.ok(
        pos.leftPx + vp.tooltipWidth <= vp.containerWidth - 8,
        `viewport ${vp.viewport}px bar ${barIdx}: right edge (${pos.leftPx + vp.tooltipWidth}) must be <= ${vp.containerWidth - 8}`,
      )
    }
  }
})
