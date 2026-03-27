import type { SegmentBreakKind } from './analysis.ts'
import { getEngineProfile } from './measurement.ts'

export type LineBreakCursor = {
  segmentIndex: number
  graphemeIndex: number
}

export type PreparedLineBreakData = {
  widths: number[]
  kinds: SegmentBreakKind[]
  breakableWidths: (number[] | null)[]
  discretionaryHyphenWidth: number
}

export type InternalLayoutLine = {
  startSegmentIndex: number
  startGraphemeIndex: number
  endSegmentIndex: number
  endGraphemeIndex: number
  width: number
}

function isCollapsibleSpaceKind(kind: SegmentBreakKind): boolean {
  return kind === 'space'
}

function fitSoftHyphenBreak(
  graphemeWidths: number[],
  initialWidth: number,
  maxWidth: number,
  lineFitEpsilon: number,
  discretionaryHyphenWidth: number,
): { fitCount: number, fittedWidth: number } {
  let fitCount = 0
  let fittedWidth = initialWidth

  while (fitCount < graphemeWidths.length) {
    const nextWidth = fittedWidth + graphemeWidths[fitCount]!
    const nextLineWidth =
      fitCount + 1 < graphemeWidths.length ? nextWidth + discretionaryHyphenWidth : nextWidth
    if (nextLineWidth > maxWidth + lineFitEpsilon) break
    fittedWidth = nextWidth
    fitCount++
  }

  return { fitCount, fittedWidth }
}

export function normalizeLineStart(
  prepared: PreparedLineBreakData,
  start: LineBreakCursor,
): LineBreakCursor | null {
  let segmentIndex = start.segmentIndex
  const graphemeIndex = start.graphemeIndex

  if (segmentIndex >= prepared.widths.length) return null
  if (graphemeIndex > 0) return start

  while (segmentIndex < prepared.widths.length) {
    const kind = prepared.kinds[segmentIndex]!
    if (kind !== 'space' && kind !== 'zero-width-break' && kind !== 'soft-hyphen') {
      break
    }
    segmentIndex++
  }

  if (segmentIndex >= prepared.widths.length) return null
  return { segmentIndex, graphemeIndex: 0 }
}

export function countPreparedLines(prepared: PreparedLineBreakData, maxWidth: number): number {
  const { widths, kinds, breakableWidths } = prepared
  if (widths.length === 0) return 0
  const lineFitEpsilon = getEngineProfile().lineFitEpsilon
  if (kinds.includes('soft-hyphen')) {
    return walkPreparedLines(prepared, maxWidth)
  }

  let lineCount = 0
  let lineW = 0
  let hasContent = false

  function appendBreakableSegmentCounting(segmentIndex: number): void {
    const gWidths = breakableWidths[segmentIndex]!

    for (let g = 0; g < gWidths.length; g++) {
      const gw = gWidths[g]!

      if (!hasContent) {
        lineW = gw
        lineCount++
        hasContent = true
        continue
      }

      if (lineW + gw > maxWidth + lineFitEpsilon) {
        lineCount++
        lineW = gw
      } else {
        lineW += gw
      }
    }
  }

  function placeOnFreshLine(segmentIndex: number): void {
    const w = widths[segmentIndex]!
    if (w > maxWidth && breakableWidths[segmentIndex] !== null) {
      appendBreakableSegmentCounting(segmentIndex)
    } else {
      lineW = w
      lineCount++
    }
    hasContent = true
  }

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i]!
    const kind = kinds[i]!

    if (!hasContent) {
      placeOnFreshLine(i)
      continue
    }

    const newW = lineW + w

    if (newW > maxWidth + lineFitEpsilon) {
      if (isCollapsibleSpaceKind(kind)) {
        continue
      }

      if (w > maxWidth && breakableWidths[i] !== null) {
        appendBreakableSegmentCounting(i)
      } else {
        lineW = 0
        hasContent = false
        placeOnFreshLine(i)
      }
    } else {
      lineW = newW
    }
  }

  if (!hasContent) {
    lineCount++
  }

  return lineCount
}

export function walkPreparedLines(
  prepared: PreparedLineBreakData,
  maxWidth: number,
  onLine?: (line: InternalLayoutLine) => void,
): number {
  const { widths, kinds, breakableWidths, discretionaryHyphenWidth } = prepared
  if (widths.length === 0) return 0
  const lineFitEpsilon = getEngineProfile().lineFitEpsilon

  let lineCount = 0
  let lineW = 0
  let hasContent = false
  let lineStartSegmentIndex = 0
  let lineStartGraphemeIndex = 0
  let lineEndSegmentIndex = 0
  let lineEndGraphemeIndex = 0
  let pendingSoftBreakSegmentIndex = -1
  let pendingSoftBreakWidth = 0

  function clearPendingSoftBreak(): void {
    pendingSoftBreakSegmentIndex = -1
    pendingSoftBreakWidth = 0
  }

  function emitCurrentLine(
    endSegmentIndex = lineEndSegmentIndex,
    endGraphemeIndex = lineEndGraphemeIndex,
    width = lineW,
  ): void {
    lineCount++
    onLine?.({
      startSegmentIndex: lineStartSegmentIndex,
      startGraphemeIndex: lineStartGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
      width,
    })
    lineW = 0
    hasContent = false
    clearPendingSoftBreak()
  }

  function startLineAtSegment(segmentIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = 0
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
    lineW = width
  }

  function startLineAtGrapheme(segmentIndex: number, graphemeIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = graphemeIndex
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = graphemeIndex + 1
    lineW = width
  }

  function appendWholeSegment(segmentIndex: number, width: number): void {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, width)
      return
    }
    lineW += width
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
  }

  function appendBreakableSegment(segmentIndex: number): void {
    appendBreakableSegmentFrom(segmentIndex, 0)
  }

  function appendBreakableSegmentFrom(segmentIndex: number, startGraphemeIndex: number): void {
    const gWidths = breakableWidths[segmentIndex]!
    for (let g = startGraphemeIndex; g < gWidths.length; g++) {
      const gw = gWidths[g]!

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, gw)
        continue
      }

      if (lineW + gw > maxWidth + lineFitEpsilon) {
        emitCurrentLine()
        startLineAtGrapheme(segmentIndex, g, gw)
      } else {
        lineW += gw
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
      }
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
  }

  function continueSoftHyphenBreakableSegment(segmentIndex: number): boolean {
    const gWidths = breakableWidths[segmentIndex]!
    if (gWidths === null) return false

    const { fitCount, fittedWidth } = fitSoftHyphenBreak(
      gWidths,
      lineW,
      maxWidth,
      lineFitEpsilon,
      discretionaryHyphenWidth,
    )
    if (fitCount === 0) return false

    lineW = fittedWidth
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = fitCount
    clearPendingSoftBreak()

    if (fitCount === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
      return true
    }

    emitCurrentLine(segmentIndex, fitCount, fittedWidth + discretionaryHyphenWidth)
    appendBreakableSegmentFrom(segmentIndex, fitCount)
    return true
  }

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i]!
    const kind = kinds[i]!

    if (kind === 'soft-hyphen') {
      if (hasContent) {
        lineEndSegmentIndex = i + 1
        lineEndGraphemeIndex = 0
        pendingSoftBreakSegmentIndex = i + 1
        pendingSoftBreakWidth = lineW + discretionaryHyphenWidth
      }
      continue
    }

    if (!hasContent) {
      if (w > maxWidth && breakableWidths[i] !== null) {
        appendBreakableSegment(i)
      } else {
        startLineAtSegment(i, w)
      }
      if (kind === 'space' || kind === 'zero-width-break') {
        clearPendingSoftBreak()
      }
      continue
    }

    const newW = lineW + w

    if (newW > maxWidth + lineFitEpsilon) {
      if (isCollapsibleSpaceKind(kind)) {
        clearPendingSoftBreak()
        continue
      }

      if (pendingSoftBreakSegmentIndex >= 0 && continueSoftHyphenBreakableSegment(i)) {
        continue
      }

      if (pendingSoftBreakSegmentIndex >= 0 && pendingSoftBreakWidth <= maxWidth + lineFitEpsilon) {
        emitCurrentLine(pendingSoftBreakSegmentIndex, 0, pendingSoftBreakWidth)
        if (w > maxWidth && breakableWidths[i] !== null) {
          appendBreakableSegment(i)
        } else {
          startLineAtSegment(i, w)
        }
        if (kind === 'space' || kind === 'zero-width-break') {
          clearPendingSoftBreak()
        }
        continue
      }

      if (w > maxWidth && breakableWidths[i] !== null) {
        appendBreakableSegment(i)
      } else {
        emitCurrentLine()
        startLineAtSegment(i, w)
      }
    } else {
      appendWholeSegment(i, w)
      if (kind === 'space' || kind === 'zero-width-break') {
        clearPendingSoftBreak()
      }
    }
  }

  if (hasContent) {
    emitCurrentLine()
  }

  return lineCount
}

export function layoutNextLineRange(
  prepared: PreparedLineBreakData,
  start: LineBreakCursor,
  maxWidth: number,
): InternalLayoutLine | null {
  const normalizedStart = normalizeLineStart(prepared, start)
  if (normalizedStart === null) return null

  const { widths, kinds, breakableWidths, discretionaryHyphenWidth } = prepared
  const lineFitEpsilon = getEngineProfile().lineFitEpsilon

  let lineW = 0
  let hasContent = false
  const lineStartSegmentIndex = normalizedStart.segmentIndex
  const lineStartGraphemeIndex = normalizedStart.graphemeIndex
  let lineEndSegmentIndex = lineStartSegmentIndex
  let lineEndGraphemeIndex = lineStartGraphemeIndex
  let pendingSoftBreakSegmentIndex = -1
  let pendingSoftBreakWidth = 0

  function clearPendingSoftBreak(): void {
    pendingSoftBreakSegmentIndex = -1
    pendingSoftBreakWidth = 0
  }

  function finishLine(
    endSegmentIndex = lineEndSegmentIndex,
    endGraphemeIndex = lineEndGraphemeIndex,
    width = lineW,
  ): InternalLayoutLine | null {
    if (!hasContent) return null

    return {
      startSegmentIndex: lineStartSegmentIndex,
      startGraphemeIndex: lineStartGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
      width,
    }
  }

  function startLineAtSegment(segmentIndex: number, width: number): void {
    hasContent = true
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
    lineW = width
  }

  function startLineAtGrapheme(segmentIndex: number, graphemeIndex: number, width: number): void {
    hasContent = true
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = graphemeIndex + 1
    lineW = width
  }

  function appendWholeSegment(segmentIndex: number, width: number): void {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, width)
      return
    }
    lineW += width
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
  }

  function appendBreakableSegmentFrom(segmentIndex: number, startGraphemeIndex: number): InternalLayoutLine | null {
    const gWidths = breakableWidths[segmentIndex]!
    for (let g = startGraphemeIndex; g < gWidths.length; g++) {
      const gw = gWidths[g]!

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, gw)
        continue
      }

      if (lineW + gw > maxWidth + lineFitEpsilon) {
        return finishLine()
      }

      lineW += gw
      lineEndSegmentIndex = segmentIndex
      lineEndGraphemeIndex = g + 1
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
    return null
  }

  function maybeFinishAtSoftHyphen(segmentIndex: number): InternalLayoutLine | null {
    if (pendingSoftBreakSegmentIndex < 0) return null

    const gWidths = breakableWidths[segmentIndex] ?? null
    if (gWidths !== null) {
      const { fitCount, fittedWidth } = fitSoftHyphenBreak(
        gWidths,
        lineW,
        maxWidth,
        lineFitEpsilon,
        discretionaryHyphenWidth,
      )

      if (fitCount === gWidths.length) {
        lineW = fittedWidth
        lineEndSegmentIndex = segmentIndex + 1
        lineEndGraphemeIndex = 0
        clearPendingSoftBreak()
        return null
      }

      if (fitCount > 0) {
        return finishLine(segmentIndex, fitCount, fittedWidth + discretionaryHyphenWidth)
      }
    }

    if (pendingSoftBreakWidth <= maxWidth + lineFitEpsilon) {
      return finishLine(pendingSoftBreakSegmentIndex, 0, pendingSoftBreakWidth)
    }

    return null
  }

  for (let i = normalizedStart.segmentIndex; i < widths.length; i++) {
    const w = widths[i]!
    const kind = kinds[i]!
    const startGraphemeIndex = i === normalizedStart.segmentIndex ? normalizedStart.graphemeIndex : 0

    if (kind === 'soft-hyphen' && startGraphemeIndex === 0) {
      if (hasContent) {
        lineEndSegmentIndex = i + 1
        lineEndGraphemeIndex = 0
        pendingSoftBreakSegmentIndex = i + 1
        pendingSoftBreakWidth = lineW + discretionaryHyphenWidth
      }
      continue
    }

    if (!hasContent) {
      if (startGraphemeIndex > 0) {
        const line = appendBreakableSegmentFrom(i, startGraphemeIndex)
        if (line !== null) return line
      } else if (w > maxWidth && breakableWidths[i] !== null) {
        const line = appendBreakableSegmentFrom(i, 0)
        if (line !== null) return line
      } else {
        startLineAtSegment(i, w)
      }
      if (kind === 'space' || kind === 'zero-width-break') {
        clearPendingSoftBreak()
      }
      continue
    }

    const newW = lineW + w
    if (newW > maxWidth + lineFitEpsilon) {
      if (isCollapsibleSpaceKind(kind)) {
        clearPendingSoftBreak()
        continue
      }

      const softBreakLine = maybeFinishAtSoftHyphen(i)
      if (softBreakLine !== null) return softBreakLine

      if (w > maxWidth && breakableWidths[i] !== null) {
        const line = appendBreakableSegmentFrom(i, 0)
        if (line !== null) return line
      }

      return finishLine()
    }

    appendWholeSegment(i, w)
    if (kind === 'space' || kind === 'zero-width-break') {
      clearPendingSoftBreak()
    }
  }

  return finishLine()
}
