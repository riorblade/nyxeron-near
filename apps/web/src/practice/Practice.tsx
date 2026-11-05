// Practice: the game screen, laid out like the course prototype (Desain Game): the club fills the screen and the HUD
// floats over it. Title → the day (pick the venue, set the menu and the DJ) → the night → the night report.
// No login, no wallet, play money; the rules are @nyxeron/game's, this file only shows them and sends actions.
import './game.css'
import {
  appeal,
  type Genre,
  happyHourOn,
  MAX_MARKUP,
  type Night,
  type NightEvent,
  type NightReport,
  priceNow,
  report,
  rules,
  SHARES_PER_UNIT,
  type TokenId,
  tokenIds,
  tokens,
  venueFor,
} from '@nyxeron/game'
import { Component, type CSSProperties, lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { clock, pct, usd } from '../format.ts'
import { navigate } from '../router.tsx'
import { Icon, Mark, Star } from './icons.tsx'
import { type Career, usePractice } from './usePractice.ts'

// three.js is big: the club loads with this screen, not with the landing page.
const Venue = lazy(() => import('../venue/Venue.tsx').then((m) => ({ default: m.Venue })))

// No WebGL, or the 3D chunk failed to load: the game still runs over a plain background.
class NoVenue extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const VENUES = rules.VENUES
const GENRES = Object.keys(rules.DJ_ENERGY) as Genre[]
const GENRE_COLOR: Record<Genre, string> = {
  house: '#4cc9f0',
  techno: '#9b7bff',
  hiphop: '#ff7a45',
  pop: '#f25cc1',
  lounge: '#3fd98a',
}
const GENRE_NAME: Record<Genre, string> = {
  house: 'House',
  techno: 'Techno',
  hiphop: 'Hip-hop',
  pop: 'Pop',
  lounge: 'Lounge',
}
const DRINK_COLOR = [
  '#ffcc33',
  '#4cc0ff',
  '#ff6fae',
  '#3fd98a',
  '#8f6bff',
  '#ff7a45',
  '#bfe9ff',
  '#f25cc1',
  '#c9813a',
  '#9b7bff',
]
const drinkColor = (id: TokenId) => DRINK_COLOR[tokenIds.indexOf(id) % DRINK_COLOR.length]!
const levelOf = (capacity: number) => VENUES.find((v) => v.capacity === capacity)?.level ?? 1
const nextVenue = (reputation: number) => VENUES.find((v) => v.reputation > reputation)

type Win = 'menu' | 'dj' | null

export function Practice() {
  const p = usePractice()
  const { night, source, career } = p
  const unlocked = venueFor(career.reputation).level
  const [screen, setScreen] = useState<'title' | 'game'>('title')
  const [level, setLevel] = useState<number>(unlocked)
  const [win, setWin] = useState<Win>(null)
  useEffect(() => setLevel(unlocked), [unlocked])

  if (!night || !source)
    return (
      <div className="game">
        <p className="dim" style={{ padding: 24 }}>
          Opening the club…
        </p>
      </div>
    )

  const live = p.phase === 'party'
  const shownLevel = p.phase === 'club' ? level : levelOf(night.capacity)
  const world = (
    <div
      className={`world ${win || p.phase === 'report' || p.week || (p.phase === 'club' && level > unlocked) ? 'dim' : ''}`}
    >
      <NoVenue>
        <Suspense fallback={null}>
          <Venue level={shownLevel} night={live ? night : null} />
        </Suspense>
      </NoVenue>
    </div>
  )

  return (
    <div className="game">
      {world}
      <div className="ui">
        {screen === 'title' ? (
          <Title career={career} onPlay={() => setScreen('game')} onReset={p.resetCareer} />
        ) : (
          <>
            <Hud career={career} night={night} live={live} level={shownLevel} unlocked={unlocked} />
            {p.phase === 'club' && (
              <Day
                night={night}
                career={career}
                level={level}
                unlocked={unlocked}
                sampleMarket={!source.live}
                setLevel={setLevel}
                openWin={setWin}
                onOpen={() => p.open(level)}
                onWeek={p.previewWeek}
              />
            )}
            {p.phase === 'party' && (
              <NightView
                night={night}
                speed={p.speed}
                setSpeed={p.setSpeed}
                happyHour={p.happyHour}
                finish={p.finishNight}
              />
            )}
            {p.phase === 'report' && <Report night={night} nights={career.nights} onNext={p.nextNight} />}
            {win && (
              <Window kind={win} onClose={() => setWin(null)} onTab={setWin}>
                {win === 'menu' ? <MenuView night={night} onPrice={p.price} /> : <DjView night={night} onDj={p.dj} />}
              </Window>
            )}
            {p.week && <WeekResult reports={p.week} onClose={p.closeWeek} />}
          </>
        )}
      </div>
      {p.refusal && (
        <div className="toast err" role="status">
          <Icon k="alert" />
          {p.refusal}
        </div>
      )}
    </div>
  )
}

// ---------- HUD ----------

function Gem({ k, c }: { k: string; c: string }) {
  return (
    <span className="gem" style={{ '--c': c } as CSSProperties}>
      <Icon k={k} />
    </span>
  )
}

function Hud(props: { career: Career; night: Night; live: boolean; level: number; unlocked: number }) {
  const { career, night, live } = props
  const tonight = Object.values(night.sales).reduce((a, s) => a + s.margin, 0)
  const next = nextVenue(career.reputation)
  const toNext = next ? Math.min(100, (career.reputation / next.reputation) * 100) : 100
  return (
    <div className="hud">
      <div className="res">
        <div className="pill" title="Your margin, all nights (play money)">
          <Gem k="coin" c="var(--yellow)" />
          <div>
            <div className="k">Margin</div>
            <div className="v">{usd(career.margin + (live ? tonight : 0))}</div>
          </div>
        </div>
        <div
          className="pill"
          title={next ? `Reach ${next.reputation} to unlock venue level ${next.level}` : 'Top venue'}
        >
          <Gem k="star" c="var(--hiphop)" />
          <div>
            <div className="k">Rep{next ? ` · L${next.level} at ${next.reputation}` : ''}</div>
            <div className="row" style={{ gap: 6 }}>
              <span className="v">{Math.round(career.reputation)}</span>
              <span className="meter" style={{ '--c': 'var(--hiphop)' } as CSSProperties}>
                <i style={{ width: `${toNext}%` }} />
              </span>
            </div>
          </div>
        </div>
        {live && (
          <div className="pill" title="Crowd energy">
            <Gem k="flame" c="var(--edm)" />
            <div>
              <div className="k">Energy</div>
              <div className="v">{Math.round(night.energy)}</div>
            </div>
          </div>
        )}
        <div className="pill" title="Guests inside / room">
          <Gem k="users" c="var(--house)" />
          <div>
            <div className="k">{live ? 'Inside' : 'Room'}</div>
            <div className="v">
              {live ? `${night.guests.length}/${night.capacity}` : VENUES[props.level - 1]!.capacity}
            </div>
          </div>
        </div>
      </div>
      <div className="center">
        <div className={`ribbon ${live ? 'clock' : 'day'}`}>
          {live ? (
            <>
              <b>{clock(night.minute)}</b>
              <small>Night {career.nights + 1}</small>
            </>
          ) : (
            <>
              <b>Night {career.nights + 1} · The Basement</b>
              <small>Venue level {props.level}</small>
            </>
          )}
          <div className="weekdots">
            {VENUES.map((v) => (
              <i
                key={v.level}
                className={v.level === props.level ? 'now' : v.level <= props.unlocked ? 'done' : ''}
                title={`Level ${v.level}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="sys">
        <button
          className="btn dark round"
          aria-label="Leave to the home page"
          title="Home"
          onClick={() => navigate('/')}
        >
          <Icon k="door" />
        </button>
      </div>
    </div>
  )
}

// ---------- Title ----------

function Title({ career, onPlay, onReset }: { career: Career; onPlay: () => void; onReset: () => void }) {
  return (
    <section className="title">
      <div className="in">
        <div className="logo">
          <Mark />
          <h1>NYXERON</h1>
        </div>
        <div className="sub">Nightlife Empire · The Basement</div>
        <p>
          You run a nightclub where every drink is a real stock: a Tesla is 0.001 of a Tesla share. Set the prices, pick
          the DJ, and grow The Basement from a 30-guest room to a 150-guest club.
        </p>
        <div className="goals frame">
          <div>
            <Gem k="glass" c="var(--yellow)" />
            Price every stock drink between its cost and 3×
          </div>
          <div>
            <Gem k="phones" c="var(--house)" />
            Pick a DJ that keeps the crowd's energy up
          </div>
          <div>
            <Gem k="cocktail" c="var(--edm)" />
            One happy hour a night: use it when the room is slow
          </div>
          <div>
            <Gem k="star" c="var(--hiphop)" />
            Earn reputation to unlock bigger rooms
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <button className="btn xl yellow pulse" onClick={onPlay}>
            <Icon k="play" />
            {career.nights ? `Continue · night ${career.nights + 1}` : 'Play'}
          </button>
          {career.nights > 0 && (
            <button
              className="btn"
              onClick={() => {
                onReset()
                onPlay()
              }}
            >
              New career
            </button>
          )}
          <button className="btn dark" onClick={() => navigate('/')}>
            Home
          </button>
        </div>
        <p className="credits">
          Practice club · play money · no sign-in. The City plays the same game with real shares.
        </p>
      </div>
    </section>
  )
}

// ---------- Day ----------

function Day(props: {
  night: Night
  career: Career
  level: number
  unlocked: number
  sampleMarket: boolean
  setLevel: (l: number) => void
  openWin: (w: Win) => void
  onOpen: () => void
  onWeek: () => void
}) {
  const { night, career, level, unlocked } = props
  const venue = VENUES[level - 1]!
  const locked = level > unlocked
  const ids = tokenIds.filter((id) => night.menu[id])
  const best = ids.length
    ? ids.reduce((a, b) => ((appeal(night, b)?.value ?? 0) > (appeal(night, a)?.value ?? 0) ? b : a))
    : null
  const markups = ids.map((id) => night.menu[id]!.price / night.menu[id]!.wholesale)
  const avgMarkup = markups.reduce((a, m) => a + m, 0) / Math.max(1, markups.length)
  const next = nextVenue(career.reputation)
  const todo: { level: 'ok' | 'warn' | 'bad'; text: string; win?: Win }[] = [
    { level: 'ok', text: `DJ: ${GENRE_NAME[night.dj]} (crowd energy ${rules.DJ_ENERGY[night.dj]})`, win: 'dj' },
    {
      level: avgMarkup > 2.2 ? 'warn' : 'ok',
      text: `Menu at ${avgMarkup.toFixed(2)}× on average${avgMarkup > 2.2 ? ': steep, fewer will buy' : ''}`,
      win: 'menu',
    },
    { level: 'warn', text: 'Save happy hour for a slow moment' },
    next
      ? { level: 'bad', text: `Reach reputation ${next.reputation} to unlock level ${next.level}` }
      : { level: 'ok', text: 'Every room unlocked' },
  ]
  const mark = { ok: 'check', warn: 'alert', bad: 'lock' } as const
  const go = (d: number) => props.setLevel(Math.min(VENUES.length, Math.max(1, level + d)))

  return (
    <>
      <aside className="quest frame">
        <span className="tagline">The Basement · tonight</span>
        <h2>Venue level {level}</h2>
        <p>
          {venue.capacity} guests at most. Every drink you sell is 0.001 of a real share: the cost buys the share, the
          rest is your margin.
        </p>
        <ul className="todo">
          {todo.map((t) => (
            <li
              key={t.text}
              className={`slot ${t.level}`}
              style={t.win ? { cursor: 'pointer' } : undefined}
              onClick={t.win ? () => props.openWin(t.win!) : undefined}
            >
              <span className="box">
                <Icon k={mark[t.level]} />
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      </aside>

      <aside className="tonight frame">
        <h3>Tonight's forecast</h3>
        <div className="kv">
          <span>Room</span>
          <b>{venue.capacity} guests</b>
        </div>
        <div className="kv">
          <span>DJ</span>
          <b style={{ color: GENRE_COLOR[night.dj] }}>{GENRE_NAME[night.dj]}</b>
        </div>
        <div className="kv">
          <span>Most wanted</span>
          <b className="gold">{best ? tokens[best].ticker : '—'}</b>
        </div>
        <div className="kv">
          <span>Stock prices</span>
          <b className={props.sampleMarket ? 'gold' : 'good'}>{props.sampleMarket ? 'sample (5 Nov)' : 'live'}</b>
        </div>
        <span className="dim" style={{ fontSize: 12, marginTop: 2 }}>
          Today's market
        </span>
        <div className="legend">
          {ids.slice(0, 6).map((id) => {
            const c = night.market[id]?.change24h ?? 0
            return (
              <span key={id}>
                <i className="dot" style={{ '--c': c >= 0 ? 'var(--green)' : 'var(--red)' } as CSSProperties} />
                {tokens[id].ticker} <span className={c >= 0 ? 'good' : 'bad'}>{pct(c)}</span>
              </span>
            )
          })}
        </div>
      </aside>

      {/* The venue carousel: ← → over the club, a padlock on rooms the reputation hasn't opened. */}
      <button
        className="btn dark round"
        style={{ position: 'fixed', left: 336, top: '50%' }}
        aria-label="Previous venue"
        disabled={level === 1}
        onClick={() => go(-1)}
      >
        ←
      </button>
      <button
        className="btn dark round"
        style={{ position: 'fixed', right: 316, top: '50%' }}
        aria-label="Next venue"
        disabled={level === VENUES.length}
        onClick={() => go(1)}
      >
        →
      </button>
      {locked && (
        <div
          className="frame"
          style={{
            position: 'fixed',
            left: '50%',
            top: '42%',
            transform: 'translate(-50%,-50%)',
            padding: '18px 26px',
            textAlign: 'center',
            background: 'var(--win)',
          }}
        >
          <div style={{ width: 44, height: 44, margin: '0 auto 6px', color: 'var(--yellow)' }}>
            <Icon k="lock" />
          </div>
          <h2 className="d" style={{ fontSize: 26 }}>
            Locked
          </h2>
          <p className="dim">
            Reach reputation {venue.reputation} to open venue level {level}
          </p>
        </div>
      )}

      <nav className="dock frame" aria-label="Office">
        <button
          className="dockbtn"
          style={{ '--c': 'var(--yellow)' } as CSSProperties}
          onClick={() => props.openWin('menu')}
        >
          <Icon k="glass" />
          Menu
        </button>
        <button
          className="dockbtn"
          style={{ '--c': 'var(--house)' } as CSSProperties}
          onClick={() => props.openWin('dj')}
        >
          <Icon k="phones" />
          DJ
        </button>
        <button className="dockbtn" style={{ '--c': 'var(--purple)' } as CSSProperties} onClick={props.onWeek}>
          <Icon k="zap" />
          Week
        </button>
      </nav>

      <div className="opengo">
        <small>{locked ? `Locked · reputation ${venue.reputation}` : 'Doors at 22:00'}</small>
        <button className={`btn xl ${locked ? '' : 'yellow pulse'}`} disabled={locked} onClick={props.onOpen}>
          <Icon k={locked ? 'lock' : 'door'} />
          Open club
        </button>
      </div>
    </>
  )
}

const WINDOWS: Record<Exclude<Win, null>, { name: string; desc: string; icon: string; c: string }> = {
  menu: {
    name: 'Menu',
    desc: 'Every drink is 0.001 of a share. Price it from its cost up to 3×.',
    icon: 'glass',
    c: 'var(--yellow)',
  },
  dj: { name: 'DJ', desc: 'The genre sets the energy the crowd settles at.', icon: 'phones', c: 'var(--house)' },
}

function Window(props: {
  kind: Exclude<Win, null>
  onClose: () => void
  onTab: (w: Win) => void
  children: ReactNode
}) {
  const T = WINDOWS[props.kind]
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        className="window frame"
        style={{ '--c': T.c } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label={T.name}
      >
        <header>
          <span className="ic" style={{ color: T.c }}>
            <Icon k={T.icon} />
          </span>
          <div className="grow">
            <h2>{T.name}</h2>
            <p>{T.desc}</p>
          </div>
          <button className="btn round red" aria-label="Close" onClick={props.onClose}>
            <Icon k="x" />
          </button>
        </header>
        <div className="tabs" role="tablist">
          {(Object.keys(WINDOWS) as Exclude<Win, null>[]).map((k) => (
            <button key={k} role="tab" aria-selected={props.kind === k} onClick={() => props.onTab(k)}>
              {WINDOWS[k].name}
            </button>
          ))}
        </div>
        <div className="body">{props.children}</div>
      </div>
    </div>
  )
}

function Bottle({ c }: { c: string }) {
  return (
    <span className="bottle" style={{ '--c': c } as CSSProperties}>
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
        <path d="M6 4h12l-1.5 15a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z" fill={c} />
        <path d="M6.6 9h10.8" stroke="#fff" strokeOpacity=".7" strokeWidth="1.5" />
        <path d="M8.5 11.5v6" stroke="#fff" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  )
}

// A price is sent to the game when the slider is let go, so dragging doesn't flood the night with changes.
function MenuRow({ night, id, onPrice }: { night: Night; id: TokenId; onPrice: (id: TokenId, micro: number) => void }) {
  const item = night.menu[id]!
  const [draft, setDraft] = useState<number>()
  const value = draft ?? item.price
  const change = night.market[id]?.change24h ?? 0
  const commit = () => {
    if (draft !== undefined && draft !== item.price) onPrice(id, draft)
    setDraft(undefined)
  }
  return (
    <div className="drink slot">
      <Bottle c={drinkColor(id)} />
      <div className="nm">
        <b>{tokens[id].ticker}</b>
        <small className={change >= 0 ? 'good' : 'bad'}>
          {tokens[id].name} {pct(change)}
        </small>
      </div>
      <div className="gauge">
        <span>
          {(value / item.wholesale).toFixed(2)}× · cost {usd(item.wholesale)}
        </span>
        <input
          type="range"
          aria-label={`${tokens[id].name} price`}
          style={{ width: '100%', accentColor: 'var(--yellow)' }}
          min={item.wholesale}
          max={item.wholesale * MAX_MARKUP}
          step={10_000}
          value={value}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
      <div className="unit">
        {usd(value)}
        <small>a drink</small>
      </div>
    </div>
  )
}

function MenuView({ night, onPrice }: { night: Night; onPrice: (id: TokenId, micro: number) => void }) {
  return (
    <div className="stack">
      {tokenIds
        .filter((id) => night.menu[id])
        .map((id) => (
          <MenuRow key={id} night={night} id={id} onPrice={onPrice} />
        ))}
      <p className="dim" style={{ fontSize: 12.5 }}>
        Cheaper drinks sell more often; a stock that is up today sells better.
      </p>
    </div>
  )
}

function DjView({ night, onDj }: { night: Night; onDj: (g: Genre) => void }) {
  return (
    <div className="djs">
      {GENRES.map((g) => {
        const on = night.dj === g
        const c = GENRE_COLOR[g]
        const stars = Math.round(rules.DJ_ENERGY[g] / 20)
        return (
          <article key={g} className={`dj ${on ? 'on' : ''}`} style={{ '--c': c } as CSSProperties}>
            <div className="flags">
              <span className="chip" style={{ '--c': c } as CSSProperties}>
                {GENRE_NAME[g]}
              </span>
              {on && <span className="chip green">Playing</span>}
            </div>
            <div className="stagelight" style={{ color: c, display: 'grid', placeItems: 'center' }}>
              <div style={{ width: 56, height: 56 }}>
                <Icon k="phones" />
              </div>
            </div>
            <div className="info">
              <h3>{GENRE_NAME[g]}</h3>
              <div className="stars" title={`Crowd energy ${rules.DJ_ENERGY[g]}`}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} on={i < stars} />
                ))}
              </div>
              <div className="kv">
                <span>Crowd energy</span>
                <b className="gold">{rules.DJ_ENERGY[g]}</b>
              </div>
              {on ? (
                <button className="btn sm dark" disabled>
                  <Icon k="check" />
                  Playing
                </button>
              ) : (
                <button className="btn sm yellow" onClick={() => onDj(g)}>
                  Book
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ---------- Night ----------

function eventText(e: NightEvent): [string, string] {
  switch (e.kind) {
    case 'buy':
      return ['good', `Guest ${e.guest} bought ${tokens[e.token].ticker} for ${usd(e.price)}: ${e.reason}`]
    case 'pass':
      return ['warn', `Guest ${e.guest} passed: ${e.reason}`]
    case 'arrive':
      return ['', `Guest ${e.guest} came in`]
    case 'leave':
      return ['bad', `Guest ${e.guest} left: ${e.reason}`]
    case 'ceo':
      return ['warn', e.reason]
  }
}

function NightView(props: {
  night: Night
  speed: number
  setSpeed: (s: number) => void
  happyHour: () => void
  finish: () => void
}) {
  const n = props.night
  const sales = Object.values(n.sales)
  const revenue = sales.reduce((a, s) => a + s.revenue, 0)
  const ids = tokenIds.filter((id) => n.menu[id])
  const most = Math.max(1, ...ids.map((id) => n.sales[id]?.units ?? 0))
  const passed = n.log.filter((e) => e.kind === 'pass').length
  const used = n.happyHourFrom !== null
  const goals: [string, boolean][] = [
    [`Serve 80% of guests (${n.served}/${n.came})`, n.came > 0 && n.served / n.came >= 0.8],
    ['Keep energy at 60+', n.energy >= 60],
    ['Make a margin tonight', sales.some((s) => s.margin > 0)],
    ['Fill the room', n.guests.length >= n.capacity],
  ]
  const recent = n.log.slice(-3).reverse()
  return (
    <>
      <aside className="monitors">
        <div className="mon frame">
          <h3>Bar {happyHourOn(n) && <span className="chip yellow">Happy hour</span>}</h3>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span className="bigv">{n.served}</span>
            <span className="dim">guests served</span>
          </div>
          <div className="kv">
            <span>Came in</span>
            <b>{n.came}</b>
          </div>
          <div className="kv">
            <span>Passed on a drink</span>
            <b className={passed ? 'gold' : ''}>{passed}</b>
          </div>
        </div>
        <div className="mon frame">
          <h3>Goals</h3>
          <ul className="objs">
            {goals.map(([t, done]) => (
              <li key={t} className={done ? 'done' : ''}>
                <span className="box">{done && <Icon k="check" />}</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="mon frame shelfmon">
          <h3>
            Menu · {n.guests.length}/{n.capacity} inside
          </h3>
          <div className="shelf">
            {ids.map((id) => {
              const units = n.sales[id]?.units ?? 0
              return (
                <div className="s" key={id}>
                  <span>{tokens[id].ticker}</span>
                  <span className="tube">
                    <i style={{ width: `${(units / most) * 100}%`, '--c': drinkColor(id) } as CSSProperties} />
                  </span>
                  <b>{usd(priceNow(n, id) ?? 0)}</b>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      <div className="ticker">
        {recent.map((e, i) => {
          const [k, msg] = eventText(e)
          return (
            <div key={`${e.minute}-${i}`} className={k ? `k-${k}` : ''}>
              <span className="t">{clock(e.minute)}</span>
              <span>{msg}</span>
            </div>
          )
        })}
      </div>

      <nav className="dock frame" aria-label="Night controls">
        <div className="speed">
          {[1, 5, 20].map((s) => (
            <button
              key={s}
              className={`btn sm ${props.speed === s ? 'blue' : 'dark'}`}
              onClick={() => props.setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="sep" />
        <div className="ability">
          <button
            className={`btn ${used ? '' : 'purple'}`}
            disabled={used}
            aria-label="Happy hour"
            onClick={props.happyHour}
          >
            <Icon k="cocktail" />
          </button>
          Happy hour
        </div>
        <div className="ability">
          <button className="btn red" aria-label="Skip to closing" onClick={props.finish}>
            <Icon k="zap" />
          </button>
          Skip
        </div>
        <span className="sep" />
        <div className="nowplay" style={{ '--c': GENRE_COLOR[n.dj] } as CSSProperties}>
          <span className="face icon">
            <Icon k="phones" />
          </span>
          <div>
            <b>DJ</b>
            <small>{GENRE_NAME[n.dj]}</small>
          </div>
        </div>
        <span className="sep" />
        <div className="cash">
          <b>{usd(revenue)}</b>
          <small>takings tonight</small>
        </div>
      </nav>
    </>
  )
}

// ---------- Results ----------

function goalsOf(r: NightReport): [string, boolean][] {
  return [
    [
      `Serve 80% of guests (${r.guestsServed}/${r.guestsCame})`,
      r.guestsCame > 0 && r.guestsServed / r.guestsCame >= 0.8,
    ],
    [`Average energy 60+ (${r.avgEnergy.toFixed(0)})`, r.avgEnergy >= 60],
    [`Make a margin (${usd(r.margin)})`, r.margin > 0],
    ['Gain reputation', r.reputationAfter > r.reputationBefore],
  ]
}
const starsFor = (done: number) => (done >= 4 ? 3 : done === 3 ? 2 : done === 2 ? 1 : 0)

function Report({ night, nights, onNext }: { night: Night; nights: number; onNext: () => void }) {
  const r = report(night)
  const goals = goalsOf(r)
  const stars = starsFor(goals.filter(([, d]) => d).length)
  const head = stars === 3 ? 'What a night!' : r.margin > 0 ? 'Night complete' : 'Rough night'
  const delta = r.reputationAfter - r.reputationBefore
  const lines = tokenIds.flatMap((id) => {
    const s = r.sales[id]
    return s ? [[`${tokens[id].ticker} × ${s.units}`, s.revenue] as const] : []
  })
  const why = [
    r.bestSeller && `${tokens[r.bestSeller].ticker} sold best tonight.`,
    `The crowd averaged ${r.avgEnergy.toFixed(0)} energy (peak ${r.peakEnergy.toFixed(0)}). Energy brings orders.`,
    `${r.guestsServed} of ${r.guestsCame} guests got a drink; reputation follows energy and how many were served.`,
    `In the City these ${r.units} drinks would be ${(r.units * SHARES_PER_UNIT).toFixed(3)} real shares, collected by the guests.`,
    r.levelAfter > levelOf(night.capacity) && `Venue level ${r.levelAfter} is open now.`,
  ].filter(Boolean) as string[]
  return (
    <div className="results">
      <section
        className="resultcard frame"
        style={{ '--c': stars >= 2 ? 'var(--yellow)' : r.margin > 0 ? 'var(--purple)' : 'var(--red)' } as CSSProperties}
      >
        <header>
          <small>
            Night {nights + 1} · venue level {levelOf(night.capacity)}
          </small>
          <h1>{head}</h1>
          <div className="bigstars">
            {[0, 1, 2].map((i) => (
              <Star key={i} on={i < stars} />
            ))}
          </div>
        </header>
        <div className="tiles">
          <div className="slot">
            <small>Margin</small>
            <b className={r.margin > 0 ? 'gold' : 'bad'}>{usd(r.margin)}</b>
            <small>{usd(r.revenue)} in sales</small>
          </div>
          <div className="slot">
            <small>Reputation</small>
            <b className={delta >= 0 ? 'good' : 'bad'}>
              {delta >= 0 ? '+' : '−'}
              {Math.abs(delta).toFixed(1)}
            </b>
            <small>now {r.reputationAfter.toFixed(0)}</small>
          </div>
          <div className="slot">
            <small>Guests</small>
            <b>{r.guestsCame}</b>
            <small>{r.units} drinks</small>
          </div>
        </div>
        <div className="sec">
          <h3>Goals</h3>
          <ul className="objs">
            {goals.map(([t, done]) => (
              <li key={t} className={done ? 'done' : ''}>
                <span className="box">{done && <Icon k="check" />}</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="sec">
          <h3>Why it went this way</h3>
          <ul className="why">
            {why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
        <div className="cta">
          <button className="btn xl yellow pulse" onClick={onNext}>
            <Icon k="play" />
            Next night
          </button>
        </div>
      </section>
      <aside className="receipt" aria-label="Money breakdown">
        <div className="hd">
          <b>THE BASEMENT</b>
          Practice club
          <br />
          Night {nights + 1}
        </div>
        <hr />
        {lines.map(([k, v]) => (
          <div className="ln" key={k}>
            <span>{k}</span>
            <span>+{usd(v).slice(1)}</span>
          </div>
        ))}
        <div className="ln minus">
          <span>Shares bought (cost)</span>
          <span>{usd(-r.wholesale)}</span>
        </div>
        <hr />
        <div className="ln tot">
          <span>Margin</span>
          <span>{usd(r.margin)}</span>
        </div>
        <div className="ft">
          {r.guestsCame} guests, {r.units} drinks
          <br />
          Thank you, come again
        </div>
      </aside>
    </div>
  )
}

function WeekResult({ reports, onClose }: { reports: NightReport[]; onClose: () => void }) {
  const total = reports.reduce((a, r) => a + r.margin, 0)
  const max = Math.max(1, ...reports.map((r) => Math.abs(r.margin)))
  const last = reports.at(-1)!
  return (
    <div className="results" style={{ alignItems: 'center', zIndex: 40 }}>
      <section className="resultcard frame" style={{ '--c': 'var(--house)' } as CSSProperties}>
        <header>
          <small>Fast-forward · 7 nights with this menu</small>
          <h1>A week at The Basement</h1>
        </header>
        <div className="tiles">
          <div className="slot">
            <small>Reputation</small>
            <b>{last.reputationAfter.toFixed(0)}</b>
            <small>from {reports[0]!.reputationBefore.toFixed(0)}</small>
          </div>
          <div className="slot">
            <small>Week margin</small>
            <b className={total > 0 ? 'gold' : 'bad'}>{usd(total)}</b>
            <small>{reports.reduce((a, r) => a + r.units, 0)} drinks</small>
          </div>
          <div className="slot">
            <small>Venue</small>
            <b>L{last.levelAfter}</b>
            <small>by the end</small>
          </div>
        </div>
        <div className="sec">
          <h3>Margin per night</h3>
        </div>
        <div className="chart slot">
          {reports.map((r, i) => (
            <div key={i}>
              <span>{usd(r.margin)}</span>
              <i
                className={r.margin < 0 ? 'neg' : ''}
                style={{ height: Math.round((Math.abs(r.margin) / max) * 84) }}
              />
              <span>N{i + 1}</span>
            </div>
          ))}
        </div>
        <div className="cta">
          <button className="btn xl yellow" onClick={onClose}>
            Back to the club
          </button>
        </div>
      </section>
    </div>
  )
}
