export interface TreemapItem {
  key: string
  size: number
}

export interface TreemapRect<T extends TreemapItem> {
  item: T
  x: number
  y: number
  w: number
  h: number
}

function worstRatio(row: TreemapItem[], shortSide: number, total: number): number {
  const areas = row.map((e) => e.size / total)
  const rowArea = areas.reduce((a, b) => a + b, 0)
  const s2 = rowArea * shortSide * (rowArea * shortSide)
  let max = -Infinity
  let min = Infinity
  areas.forEach((a) => {
    max = Math.max(max, a)
    min = Math.min(min, a)
  })
  return Math.max((s2 * max) / (rowArea * rowArea), (rowArea * rowArea) / (s2 * min))
}

/** Squarified treemap layout (Bruls et al.) — same algorithm WinDirStat/ncdu use. */
export function squarify<T extends TreemapItem>(items: T[], x: number, y: number, w: number, h: number, out: TreemapRect<T>[]): void {
  if (items.length === 0 || w <= 0 || h <= 0) return
  if (items.length === 1) {
    out.push({ item: items[0], x, y, w, h })
    return
  }
  const total = items.reduce((s, i) => s + i.size, 0)
  const shortSide = Math.min(w, h)
  let split = 1
  for (; split <= items.length; split++) {
    const worstNow = worstRatio(items.slice(0, split), shortSide, total)
    const worstNext = split < items.length ? worstRatio(items.slice(0, split + 1), shortSide, total) : Infinity
    if (split < items.length && worstNext <= worstNow) continue
    break
  }
  const row = items.slice(0, split)
  const rest = items.slice(split)
  const rowTotal = row.reduce((s, e) => s + e.size, 0)
  const rowArea = w * h * (rowTotal / total)

  if (w >= h) {
    const rowW = rowArea / h
    let cy = y
    row.forEach((e) => {
      const rh = h * (e.size / rowTotal)
      out.push({ item: e, x, y: cy, w: rowW, h: rh })
      cy += rh
    })
    squarify(rest, x + rowW, y, w - rowW, h, out)
  } else {
    const rowH = rowArea / w
    let cx = x
    row.forEach((e) => {
      const rw = w * (e.size / rowTotal)
      out.push({ item: e, x: cx, y, w: rw, h: rowH })
      cx += rw
    })
    squarify(rest, x, y + rowH, w, h - rowH, out)
  }
}
