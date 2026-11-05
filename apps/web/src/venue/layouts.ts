import type { GuestState, Level } from './legacy'

export type ZoneId =
  | 'queue'
  | 'entrance'
  | 'counter'
  | 'backbar'
  | 'barFront'
  | 'dance'
  | 'dj'
  | 'stage'
  | 'seating'
  | 'stock'
  | 'vip'
  | 'restroom'
  | 'office'
  | 'pool'
  | 'deck'

/** How the default furniture fills a seating area. */
export type FurnitureStyle =
  | 'lounge' // sofa + low table + chairs
  | 'vip' // sofa booths facing the DJ
  | 'high' // high tables (near the dance floor)
  | 'tables' // table + chairs (edges and corners)
  | 'cabana' // daybeds around the pool

export interface Zone {
  id: ZoneId
  x: number
  y: number
  w: number
  h: number
  label?: string
  /** Drawn as a raised block (counters, booths) instead of floor. */
  solid?: boolean
  outside?: boolean
  /** Raised floor (mezzanine / balcony) at this height, with railing and stairs. */
  elevation?: number
  furniture?: FurnitureStyle
}

/**
 * A landscape video screen on a wall. `at` = centre along the wall (x for n/s walls, z for w/e walls).
 * clip = dancer clips / club footage, ad = sponsor slot. Clip screens are 3 wide, ads 2.6.
 */
export interface ScreenSlot {
  wall: 'n' | 'w' | 'e' | 's'
  at: number
  kind: 'clip' | 'ad'
}

export interface Layout {
  /** Key for the player's saved furniture arrangement. */
  name: 'basement-1' | 'basement-2' | 'basement-3' | 'club'
  w: number
  h: number
  /** Indoor hall depth when the rest (south) is an open-air deck; walls stop there. */
  hall?: number
  /** Wall height (default 3.2); a superclub has a double-height hall. */
  wallHeight?: number
  /** Span of the concert screen behind the DJ along the back wall (default: over the stage + DJ booth). */
  mainScreen?: { from: number; to: number }
  zones: Zone[]
  screens: ScreenSlot[]
}

/**
 * The Basement at levels 1–3: the level-4 club below, smaller. Same plan (bar on the west wall, DJ on the north wall,
 * the floor in the middle, the door in the south wall), each level pushing the walls out and opening a corner.
 */
const basement1: Layout = {
  name: 'basement-1',
  w: 12,
  h: 9,
  screens: [
    { wall: 'n', at: 10.5, kind: 'clip' },
    { wall: 'w', at: 8, kind: 'clip' },
    { wall: 'e', at: 4, kind: 'clip' },
    { wall: 's', at: 2, kind: 'ad' },
  ],
  zones: [
    { id: 'dj', x: 5, y: 0, w: 3, h: 2, label: 'DJ BOOTH', solid: true },
    { id: 'backbar', x: 0, y: 1, w: 1, h: 6 },
    { id: 'counter', x: 1, y: 1, w: 1, h: 6, label: 'BAR', solid: true },
    { id: 'barFront', x: 2, y: 1, w: 2, h: 6 },
    { id: 'dance', x: 5, y: 3, w: 5, h: 4, label: 'DANCE FLOOR' },
    { id: 'seating', x: 10, y: 1, w: 2, h: 6, furniture: 'high' },
    { id: 'stock', x: 0, y: 7, w: 3, h: 2, label: 'STOCK ROOM' },
    { id: 'restroom', x: 10, y: 7, w: 2, h: 2, label: 'WC' },
    { id: 'entrance', x: 5, y: 8, w: 3, h: 1, label: 'ENTRANCE' },
    { id: 'queue', x: 5, y: 9, w: 3, h: 4, label: 'STREET · QUEUE', outside: true },
  ],
}

const basement2: Layout = {
  name: 'basement-2',
  w: 15,
  h: 11,
  screens: [
    { wall: 'n', at: 1.5, kind: 'clip' },
    { wall: 'n', at: 13.5, kind: 'ad' },
    { wall: 'w', at: 9.5, kind: 'clip' },
    { wall: 'e', at: 4, kind: 'clip' },
    { wall: 's', at: 3, kind: 'clip' },
  ],
  zones: [
    { id: 'office', x: 0, y: 0, w: 3, h: 2, label: 'CEO OFFICE' },
    { id: 'dj', x: 6, y: 0, w: 4, h: 2, label: 'DJ BOOTH', solid: true },
    { id: 'backbar', x: 0, y: 3, w: 1, h: 6 },
    { id: 'counter', x: 1, y: 3, w: 1, h: 6, label: 'BAR', solid: true },
    { id: 'barFront', x: 2, y: 3, w: 2, h: 6 },
    { id: 'seating', x: 4, y: 3, w: 2, h: 6, furniture: 'high' },
    { id: 'dance', x: 6, y: 3, w: 6, h: 5, label: 'DANCE FLOOR' },
    { id: 'seating', x: 12, y: 2, w: 3, h: 7, label: 'TABLES', furniture: 'tables' },
    { id: 'stock', x: 0, y: 9, w: 3, h: 2, label: 'STOCK ROOM' },
    { id: 'restroom', x: 12, y: 9, w: 3, h: 2, label: 'RESTROOMS' },
    { id: 'entrance', x: 6, y: 10, w: 3, h: 1, label: 'ENTRANCE · ID CHECK' },
    { id: 'queue', x: 6, y: 11, w: 3, h: 4, label: 'STREET · QUEUE', outside: true },
  ],
}

const basement3: Layout = {
  name: 'basement-3',
  w: 18,
  h: 13,
  screens: [
    { wall: 'n', at: 12, kind: 'clip' },
    { wall: 'w', at: 1.3, kind: 'clip' },
    { wall: 'w', at: 11.5, kind: 'clip' },
    { wall: 'e', at: 5, kind: 'clip' },
    { wall: 'e', at: 9, kind: 'ad' },
    { wall: 's', at: 4, kind: 'clip' },
  ],
  zones: [
    { id: 'office', x: 0, y: 0, w: 3, h: 2, label: 'CEO OFFICE' },
    { id: 'vip', x: 3, y: 0, w: 4, h: 3, label: 'VIP', furniture: 'vip' },
    { id: 'dj', x: 7, y: 0, w: 4, h: 2, label: 'DJ BOOTH', solid: true },
    { id: 'vip', x: 13, y: 0, w: 5, h: 3, label: 'VIP', furniture: 'vip' },
    { id: 'backbar', x: 0, y: 3, w: 1, h: 7 },
    { id: 'counter', x: 1, y: 3, w: 1, h: 7, label: 'BAR', solid: true },
    { id: 'barFront', x: 2, y: 3, w: 2, h: 7 },
    { id: 'seating', x: 4, y: 3, w: 3, h: 6, furniture: 'high' },
    { id: 'dance', x: 7, y: 3, w: 6, h: 5, label: 'DANCE FLOOR' },
    { id: 'seating', x: 13, y: 3, w: 2, h: 6, furniture: 'high' },
    { id: 'seating', x: 15, y: 3, w: 3, h: 7, label: 'TABLES', furniture: 'tables' },
    { id: 'stock', x: 0, y: 10, w: 3, h: 3, label: 'STOCK ROOM' },
    { id: 'seating', x: 3, y: 10, w: 4, h: 3, label: 'TABLES', furniture: 'tables' },
    { id: 'restroom', x: 15, y: 10, w: 3, h: 3, label: 'RESTROOMS' },
    { id: 'entrance', x: 7, y: 11, w: 4, h: 2, label: 'ENTRANCE · ID CHECK' },
    { id: 'queue', x: 7, y: 13, w: 4, h: 5, label: 'STREET · QUEUE', outside: true },
  ],
}

/**
 * Level 4: The Basement at full size. VIP booths flank the DJ (side view) and face it across the floor (front view);
 * high tables ring the dance floor, plain tables on the edges and corners, stools along the bar.
 */
const club: Layout = {
  name: 'club',
  w: 20,
  h: 15,
  screens: [
    { wall: 'n', at: 1.5, kind: 'clip' },
    { wall: 'n', at: 17.5, kind: 'ad' },
    { wall: 'w', at: 1.3, kind: 'clip' },
    { wall: 'w', at: 13, kind: 'clip' },
    { wall: 'e', at: 5, kind: 'clip' },
    { wall: 'e', at: 8.4, kind: 'clip' },
    { wall: 'e', at: 12.3, kind: 'ad' },
    { wall: 's', at: 4, kind: 'clip' },
    { wall: 's', at: 16, kind: 'ad' },
  ],
  zones: [
    { id: 'office', x: 0, y: 0, w: 3, h: 2, label: 'CEO OFFICE' },
    { id: 'vip', x: 3, y: 0, w: 5, h: 3, label: 'VIP', furniture: 'vip' },
    { id: 'dj', x: 8, y: 0, w: 4, h: 2, label: 'DJ BOOTH', solid: true },
    { id: 'stage', x: 12, y: 0, w: 3, h: 2, label: 'STAGE', solid: true },
    { id: 'vip', x: 15, y: 0, w: 5, h: 3, label: 'VIP', furniture: 'vip' },
    { id: 'backbar', x: 0, y: 3, w: 1, h: 8 },
    { id: 'counter', x: 1, y: 3, w: 1, h: 8, label: 'BAR', solid: true },
    { id: 'barFront', x: 2, y: 3, w: 2, h: 8 },
    { id: 'seating', x: 4, y: 3, w: 3, h: 7, furniture: 'high' },
    { id: 'dance', x: 7, y: 3, w: 7, h: 6, label: 'DANCE FLOOR' },
    { id: 'seating', x: 14, y: 3, w: 3, h: 7, furniture: 'high' },
    {
      id: 'seating',
      x: 17,
      y: 3,
      w: 3,
      h: 9,
      label: 'TABLES',
      furniture: 'tables',
    },
    {
      id: 'vip',
      x: 7,
      y: 10,
      w: 7,
      h: 2,
      label: 'VIP · FRONT ROW',
      furniture: 'vip',
    },
    { id: 'stock', x: 0, y: 11, w: 3, h: 4, label: 'STOCK ROOM' },
    {
      id: 'seating',
      x: 3,
      y: 11,
      w: 4,
      h: 4,
      label: 'TABLES',
      furniture: 'tables',
    },
    { id: 'restroom', x: 17, y: 12, w: 3, h: 3, label: 'RESTROOMS' },
    { id: 'entrance', x: 8, y: 13, w: 4, h: 2, label: 'ENTRANCE · ID CHECK' },
    {
      id: 'queue',
      x: 8,
      y: 15,
      w: 4,
      h: 5,
      label: 'STREET · QUEUE',
      outside: true,
    },
  ],
}

export const layoutFor = (level: Level): Layout =>
  [basement1, basement2, basement3, club][Math.min(4, Math.max(1, level)) - 1]!

/** Where a guest in a given state stands. */
export const zoneFor: Record<GuestState, ZoneId> = {
  pending: 'queue',
  queue: 'queue',
  idle: 'seating',
  bar: 'barFront',
  dance: 'dance',
  left: 'entrance',
}
