import { MICRO_USDC_PER_USD, rules } from '@nyxeron/game'

/** micro-USDC → "$4.10". Players see dollars, never "USDC". */
export function usd(micro: number): string {
  const sign = micro < 0 ? '−' : ''
  return `${sign}$${(Math.abs(micro) / MICRO_USDC_PER_USD).toFixed(2)}`
}

/** Game minute → wall clock of the night, "22:00" … "03:00". */
export function clock(minute: number): string {
  const t = (rules.NIGHT_STARTS_AT + minute) % (24 * 60)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** +4.1 % / −2.0 % */
export function pct(change: number): string {
  return `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} %`
}
