// A menu stock as a drink's face: a rounded tile in the brand's colour with its glyph, or a ticker badge where no free
// glyph exists (ETFs, and companies Simple Icons doesn't carry).
import './stock.css'
import { tokens, type TokenId } from '@nyxeron/game'
import { GLYPHS } from './glyphs.ts'

type Look = { bg: string; fg: string; glyph?: keyof typeof GLYPHS; squares?: true; badge?: string }

const LOOKS: Record<TokenId, Look> = {
  tsla: { bg: '#cc0000', fg: '#ffffff', glyph: 'tesla' },
  nvda: { bg: '#76b900', fg: '#ffffff', glyph: 'nvidia' },
  aapl: { bg: '#1d1d1f', fg: '#ffffff', glyph: 'apple' },
  googl: { bg: '#ffffff', fg: '#4285f4', glyph: 'google' },
  meta: { bg: '#0467df', fg: '#ffffff', glyph: 'meta' },
  msft: { bg: '#ffffff', fg: '#ffffff', squares: true },
  spy: { bg: '#1f4e9c', fg: '#ffffff', badge: 'S&P' },
  qqq: { bg: '#2b2f8f', fg: '#ffffff', badge: 'QQQ' },
  crcl: { bg: '#1b6bff', fg: '#ffffff', badge: 'CRCL' },
  mstr: { bg: '#f7931a', fg: '#1a1004', badge: 'MSTR' },
}

/** `size` in px; the tile keeps its shape at any size. */
export function StockLogo({ id, size = 28, className }: { id: string; size?: number; className?: string }) {
  const look = LOOKS[id as TokenId]
  const name = tokens[id as TokenId]?.name ?? id.toUpperCase()
  if (!look) return null
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={name}
      style={{ flex: 'none', borderRadius: size * 0.28 }}
    >
      <rect width="32" height="32" rx="9" fill={look.bg} />
      {look.glyph && (
        <g transform="translate(6 6) scale(0.8333)">
          <path d={GLYPHS[look.glyph]} fill={look.fg} />
        </g>
      )}
      {look.squares && (
        <g>
          <rect x="6.5" y="6.5" width="9" height="9" fill="#f25022" />
          <rect x="16.5" y="6.5" width="9" height="9" fill="#7fba00" />
          <rect x="6.5" y="16.5" width="9" height="9" fill="#00a4ef" />
          <rect x="16.5" y="16.5" width="9" height="9" fill="#ffb900" />
        </g>
      )}
      {look.badge && (
        <text
          x="16"
          y="20.5"
          textAnchor="middle"
          fill={look.fg}
          fontFamily="'NX Display', 'Arial Narrow', sans-serif"
          fontWeight="900"
          fontSize={look.badge.length > 3 ? 10.5 : 12.5}
          letterSpacing="0.3"
        >
          {look.badge}
        </text>
      )}
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="rgba(255,255,255,.18)" />
    </svg>
  )
}
