/**
 * Shared pure chart utilities for Phase 5 visualization performance and UX.
 * - Zero React/DOM dependencies so utilities remain fast, deterministic, and directly unit-testable.
 * - Never mutates caller input arrays.
 */

export interface ClampedTooltipPosition {
  /** Clamped left coordinate in pixels relative to the chart container */
  leftPx: number
  /** Clamped left coordinate as a percentage (0–100) of container width */
  leftPercent: number
  /** Preferred side relative to the anchor point */
  placement: 'left' | 'right'
}

export interface ClampTooltipOptions {
  /** Horizontal X coordinate of the active data point in pixels relative to container left */
  anchorX: number
  /** Width of the chart container in pixels */
  containerWidth: number
  /** Estimated or measured width of the tooltip box in pixels */
  tooltipWidth: number
  /** Horizontal gap between the anchor crosshair and tooltip edge (default 14px) */
  offset?: number
  /** Minimum safe margin from container left/right edges (default 8px) */
  edgePadding?: number
}

function toFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling for time-series data.
 *
 * Guarantees:
 * - Does NOT mutate the original input array.
 * - Always preserves the original first (`data[0]`) and last (`data[n - 1]`) points when `targetCount >= 2`.
 * - Maximizes triangular area per bucket to preserve visual peaks and valleys.
 * - Runs in linear O(n) time and O(targetCount) output space.
 */
export function downsampleLTTB<T>(
  data: readonly T[],
  targetCount: number,
  getY: (item: T, index: number) => number,
): T[] {
  const n = data.length
  const threshold = Math.floor(targetCount)

  if (n === 0 || threshold <= 0) return []
  if (threshold === 1) return [data[0]]
  if (n <= threshold) return data.slice()
  if (threshold === 2) return [data[0], data[n - 1]]

  const sampled: T[] = new Array<T>(threshold)
  let sampledIndex = 0

  // Bucket size excludes first and last points, which are always kept verbatim
  const bucketSize = (n - 2) / (threshold - 2)

  let prevSelectedIdx = 0
  sampled[sampledIndex++] = data[0]

  for (let i = 0; i < threshold - 2; i++) {
    // Compute average point of the NEXT bucket (for triangle apex)
    let avgRangeStart = Math.floor((i + 1) * bucketSize) + 1
    let avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1
    if (avgRangeEnd > n) avgRangeEnd = n

    let avgX = 0
    let avgY = 0
    const avgRangeLength = avgRangeEnd - avgRangeStart

    if (avgRangeLength > 0) {
      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        avgX += j
        avgY += toFiniteNumber(getY(data[j], j))
      }
      avgX /= avgRangeLength
      avgY /= avgRangeLength
    } else {
      avgX = n - 1
      avgY = toFiniteNumber(getY(data[n - 1], n - 1))
    }

    // Current bucket bounds
    const rangeOffs = Math.floor(i * bucketSize) + 1
    const rangeTo = Math.min(n - 1, Math.floor((i + 1) * bucketSize) + 1)

    const pointAX = prevSelectedIdx
    const pointAY = toFiniteNumber(getY(data[prevSelectedIdx], prevSelectedIdx))

    let maxArea = -1
    let nextSelectedIdx = rangeOffs

    for (let j = rangeOffs; j < rangeTo; j++) {
      const pointBY = toFiniteNumber(getY(data[j], j))
      const area = Math.abs(
        (pointAX - avgX) * (pointBY - pointAY) - (pointAX - j) * (avgY - pointAY),
      ) * 0.5

      if (area > maxArea) {
        maxArea = area
        nextSelectedIdx = j
      }
    }

    sampled[sampledIndex++] = data[nextSelectedIdx]
    prevSelectedIdx = nextSelectedIdx
  }

  // Always preserve the original final data point
  sampled[sampledIndex] = data[n - 1]
  return sampled
}

/**
 * Compute a horizontally clamped tooltip position so floating chart tooltips
 * never overflow the left or right boundary of their container (including mobile).
 */
export function clampTooltipHorizontal({
  anchorX,
  containerWidth,
  tooltipWidth,
  offset = 14,
  edgePadding = 8,
}: ClampTooltipOptions): ClampedTooltipPosition {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { leftPx: edgePadding, leftPercent: 0, placement: 'right' }
  }

  const safeTooltipW = Math.max(0, Math.min(tooltipWidth, containerWidth - edgePadding * 2))
  const safeAnchorX = Math.max(0, Math.min(containerWidth, toFiniteNumber(anchorX)))
  const minLeft = edgePadding
  const maxLeft = Math.max(edgePadding, containerWidth - safeTooltipW - edgePadding)

  const rightCandidate = safeAnchorX + offset
  const leftCandidate = safeAnchorX - offset - safeTooltipW

  let placement: 'left' | 'right' = 'right'
  let rawLeft = rightCandidate

  if (rightCandidate > maxLeft) {
    if (leftCandidate >= minLeft) {
      placement = 'left'
      rawLeft = leftCandidate
    } else {
      // Narrow viewport where neither side fits cleanly: pick side with more room, then clamp
      placement = safeAnchorX > containerWidth / 2 ? 'left' : 'right'
      rawLeft = placement === 'left' ? leftCandidate : rightCandidate
    }
  }

  const leftPx = Math.max(minLeft, Math.min(maxLeft, rawLeft))
  const leftPercent = Number(((leftPx / containerWidth) * 100).toFixed(2))

  return { leftPx, leftPercent, placement }
}

/**
 * Binary search for the nearest index in a sorted ascending array of X coordinates.
 * Runs in O(log n) for fast pointer scrubbing.
 */
export function findNearestIndexByX(xs: readonly number[], targetX: number): number {
  const n = xs.length
  if (n === 0) return -1
  if (n === 1) return 0
  if (targetX <= xs[0]) return 0
  if (targetX >= xs[n - 1]) return n - 1

  let lo = 0
  let hi = n - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (xs[mid] === targetX) return mid
    if (xs[mid] < targetX) lo = mid + 1
    else hi = mid - 1
  }

  const leftIdx = Math.max(0, hi)
  const rightIdx = Math.min(n - 1, lo)
  return Math.abs(xs[leftIdx] - targetX) <= Math.abs(xs[rightIdx] - targetX)
    ? leftIdx
    : rightIdx
}

