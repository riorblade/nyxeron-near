// The Basement: one club that grows with the venue level (rules.ts VENUES: 30 → 60 → 100 → 150 guests). Metres on
// a grid: x across, y from the back wall (DJ) to the entrance. The bar runs along the left wall, as in the course
// prototype; each level pushes the walls out and opens a new corner.

export type ZoneKind = 'bar' | 'dj' | 'dance' | 'vip' | 'tables' | 'stock' | 'office' | 'wc' | 'entrance' | 'stage'
export type Zone = { kind: ZoneKind; x: number; y: number; w: number; h: number; label?: string }
export type Layout = { level: number; w: number; h: number; zones: Zone[] }

export function basement(level: number): Layout {
  const L = Math.min(4, Math.max(1, Math.round(level)))
  const w = [12, 15, 18, 20][L - 1]!
  const h = [9, 11, 13, 15][L - 1]!
  const floorW = [4, 5, 6, 7][L - 1]!
  const floorH = [3, 4, 5, 6][L - 1]!
  const fx = Math.round((w - floorW) / 2) + 1 // dance floor, nudged off the bar
  const zones: Zone[] = [
    { kind: 'bar', x: 0, y: 2, w: 2, h: Math.min(8, h - 5), label: 'BAR' },
    { kind: 'dj', x: fx, y: 0, w: floorW >= 6 ? 3 : 2, h: 1.5, label: 'DJ' },
    { kind: 'dance', x: fx, y: 2, w: floorW, h: floorH, label: 'DANCE FLOOR' },
    { kind: 'stock', x: 0, y: h - 3, w: 3, h: 3, label: 'STOCK' },
    { kind: 'wc', x: w - 3, y: h - 2.5, w: 3, h: 2.5, label: 'WC' },
    { kind: 'entrance', x: Math.round(w / 2) - 1.5, y: h - 1.5, w: 3, h: 1.5, label: 'ENTRANCE' },
  ]
  if (L >= 2) zones.push({ kind: 'tables', x: w - 4, y: 2, w: 3, h: Math.min(5, h - 6), label: 'TABLES' })
  if (L >= 3) {
    zones.push({ kind: 'vip', x: w - 5, y: 0, w: 5, h: 2, label: 'VIP' })
    zones.push({ kind: 'office', x: 0, y: 0, w: 3, h: 1.6, label: 'OFFICE' })
  }
  if (L >= 4) {
    zones.push({ kind: 'stage', x: fx + 3.5, y: 0, w: 3, h: 1.5, label: 'STAGE' })
    zones.push({ kind: 'vip', x: fx, y: 2 + floorH + 1, w: floorW, h: 1.5, label: 'VIP · FRONT ROW' })
  }
  return { level: L, w, h, zones }
}

/** The first zone of a kind (every layout has bar, dj, dance and entrance). */
export const zone = (l: Layout, kind: ZoneKind) => l.zones.find((z) => z.kind === kind)!
