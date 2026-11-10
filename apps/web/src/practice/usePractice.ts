// Practice mode state: a career kept in this browser, and one night at a time run by @nyxeron/game. The UI only calls
// the game's actions; when one refuses, its reason is shown and the night stays as it was.
import {
  fastForward,
  MAX_MARKUP,
  type Genre,
  type Night,
  type NightReport,
  type Refusal,
  report,
  type Result,
  rules,
  setDj,
  setPrice,
  startHappyHour,
  startNight,
  tick,
  type TokenId,
  tokenIds,
} from '@nyxeron/game'
import { useCallback, useEffect, useState } from 'react'
import { loadMarket, type MarketSource } from './market.ts'

export type Career = { reputation: number; nights: number; margin: number; markups: Partial<Record<TokenId, number>> }
export type Phase = 'club' | 'party' | 'report'

const CAREER_KEY = 'nyxeron.practice.v1'
const NEW_CAREER: Career = { reputation: 10, nights: 0, margin: 0, markups: {} }

export const REFUSALS: Record<Refusal, string> = {
  unknown_token: "That drink isn't on tonight's menu.",
  below_wholesale: "You can't sell below what the share costs.",
  above_cap: 'Three times wholesale is the most you can charge.',
  already_used: 'Happy hour is once a night.',
  night_over: 'The night is over.',
}

function loadCareer(): Career {
  try {
    const raw = localStorage.getItem(CAREER_KEY)
    return raw ? { ...NEW_CAREER, ...(JSON.parse(raw) as Career) } : NEW_CAREER
  } catch {
    return NEW_CAREER
  }
}

function saveCareer(c: Career) {
  try {
    localStorage.setItem(CAREER_KEY, JSON.stringify(c))
  } catch {
    // Private mode or storage full: the career just doesn't survive a reload.
  }
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

/** A fresh night with the CEO's saved markups and DJ applied through the game's own actions. */
function openingNight(source: MarketSource, career: Career, dj: Genre, level?: number): Night {
  let n = startNight({ seed: newSeed(), reputation: career.reputation, market: source.market, dj, level })
  for (const id of tokenIds) {
    const item = n.menu[id]
    const markup = career.markups[id]
    if (!item || markup === undefined) continue
    const price = Math.min(item.wholesale * MAX_MARKUP, Math.max(item.wholesale, Math.round(item.wholesale * markup)))
    const r = setPrice(n, id, price)
    if (r.ok) n = r.night
  }
  n.log = [] // the opening menu isn't news
  return n
}

export function usePractice() {
  const [source, setSource] = useState<MarketSource>()
  const [career, setCareer] = useState<Career>(loadCareer)
  const [night, setNight] = useState<Night>()
  const [phase, setPhase] = useState<Phase>('club')
  const [speed, setSpeed] = useState(1)
  const [refusal, setRefusal] = useState<string>()
  const [week, setWeek] = useState<NightReport[]>()

  useEffect(() => {
    void loadMarket().then((s) => {
      setSource(s)
      setNight(openingNight(s, loadCareer(), 'house'))
    })
  }, [])

  // One game minute per second (or faster) while the party is on.
  useEffect(() => {
    if (phase !== 'party') return
    const id = setInterval(() => setNight((n) => (n ? tick(n) : n)), 1000 / speed)
    return () => clearInterval(id)
  }, [phase, speed])

  useEffect(() => {
    if (phase === 'party' && night && night.minute >= rules.NIGHT_MINUTES) setPhase('report')
  }, [phase, night])

  const apply = useCallback((r: Result) => {
    if (r.ok) {
      setNight(r.night)
      setRefusal(undefined)
    } else setRefusal(REFUSALS[r.reason])
    return r.ok
  }, [])

  const price = (token: TokenId, micro: number) => {
    if (!night) return
    if (apply(setPrice(night, token, micro))) {
      const wholesale = night.menu[token]!.wholesale
      setCareer((c) => ({ ...c, markups: { ...c.markups, [token]: micro / wholesale } }))
    }
  }

  const finishNight = () => {
    setNight((n) => {
      let cur = n
      while (cur && cur.minute < rules.NIGHT_MINUTES) cur = tick(cur)
      return cur
    })
  }

  const nextNight = () => {
    if (!night || !source) return
    const r = report(night)
    const next = {
      ...career,
      reputation: r.reputationAfter,
      nights: career.nights + 1,
      margin: career.margin + r.margin,
    }
    setCareer(next)
    saveCareer(next)
    setNight(openingNight(source, next, night.dj))
    setPhase('club')
  }

  const previewWeek = () => {
    if (!night || !source) return
    const prices = Object.fromEntries(tokenIds.flatMap((id) => (night.menu[id] ? [[id, night.menu[id].price]] : [])))
    setWeek(
      fastForward(
        { seed: newSeed(), reputation: career.reputation, market: source.market, nights: 7 },
        { prices, dj: night.dj },
      ),
    )
  }

  const resetCareer = () => {
    saveCareer(NEW_CAREER)
    setCareer(NEW_CAREER)
    if (source) setNight(openingNight(source, NEW_CAREER, 'house'))
    setPhase('club')
    setWeek(undefined)
  }

  useEffect(() => saveCareer(career), [career])

  return {
    source,
    career,
    night,
    phase,
    speed,
    refusal,
    week,
    setSpeed,
    price,
    dj: (g: Genre) => night && apply(setDj(night, g)),
    happyHour: () => night && apply(startHappyHour(night)),
    // Doors open in the venue the CEO picked (the game caps it at what the reputation unlocked).
    open: (level: number) => {
      if (night && source) setNight(openingNight(source, career, night.dj, level))
      setPhase('party')
    },
    finishNight,
    nextNight,
    previewWeek,
    closeWeek: () => setWeek(undefined),
    resetCareer,
  }
}
