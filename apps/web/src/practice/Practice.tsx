// Practice: the game screen. The club fills the screen and the HUD floats over it, like a desktop party game.
// Title → the day (pick the venue, set the menu and the DJ) → the night → the night report.
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
  staffCost,
  SHARES_PER_UNIT,
  type TokenId,
  tokenIds,
  tokens,
  venueFor,
} from '@nyxeron/game'
import {
  Component,
  type CSSProperties,
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react'
import { audio, useMusic } from '../audio/music.ts'
import { clock, pct, usd } from '../format.ts'
import { navigate } from '../router.tsx'
import { StockLogo } from '../stock/StockLogo.tsx'
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
// The resident behind each genre: the same booking the 3D booth shows (venue/legacy.ts DJ_FOR).
const GENRE_DJ: Record<Genre, { id: string; name: string }> = {
  house: { id: 'mira', name: 'Mira' },
  techno: { id: 'nova', name: 'Nova' },
  hiphop: { id: 'kalu', name: 'Kalu' },
  pop: { id: 'lux', name: 'Lux' },
  lounge: { id: 'jax', name: 'Jax' },
}
const djArt = (g: Genre) => `/venue/sprites/deck-${GENRE_DJ[g].id}.webp`
/** Levels 1–3 are The Basement growing; the top level is the two-floor superclub with the pool. */
const venueName = (level: number) => (level >= VENUES.length ? 'The Superclub' : 'The Basement')
const levelOf = (capacity: number) => VENUES.find((v) => v.capacity === capacity)?.level ?? 1
const nextVenue = (reputation: number) => VENUES.find((v) => v.reputation > reputation)
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** The kick of whatever is playing, as a CSS variable the screen breathes with; still when there is no sound. */
function useBeat(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (still()) return
    let raf = 0
    let level = 0
    const tick = () => {
      level = Math.max(audio.pulse(), level * 0.86)
      ref.current?.style.setProperty('--beat', level.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ref])
}

/** A number that runs up to `to` once, for the reward screens. Lands straight away when motion is reduced. */
function useCountUp(to: number, ms = 1200, delay = 0) {
  const [v, setV] = useState(() => (still() ? to : 0))
  useEffect(() => {
    if (still()) return setV(to)
    let raf = 0
    const t0 = performance.now() + delay
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms))
      setV(to * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, ms, delay])
  return v
}

/** Esc and number keys for the open panel; ignored while typing or with a modifier held. */
function useKeys(handler: (key: string) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLInputElement && e.key !== 'Escape') return
      ref.current(e.key)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
}

type Win = 'menu' | 'dj' | 'staff' | null

export function Practice() {
  const p = usePractice()
  const { night, source, career } = p
  const root = useRef<HTMLDivElement>(null)
  const unlocked = venueFor(career.reputation).level
  const [screen, setScreen] = useState<'title' | 'game'>('title')
  const [level, setLevel] = useState<number>(unlocked)
  const [win, setWin] = useState<Win>(null)
  useEffect(() => setLevel(unlocked), [unlocked])
  useMusic(p.phase === 'party' ? 'club' : 'lounge')
  useBeat(root)

  if (!night || !source)
    return (
      <div className="game">
        <p className="loading">Opening the club</p>
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
    <div className="game" ref={root}>
      {world}
      <div className="ui">
        {screen === 'title' ? (
          <Title career={career} night={night} onPlay={() => setScreen('game')} onReset={p.resetCareer} />
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
                busy={Boolean(win || p.week)}
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
                {win === 'menu' ? (
                  <MenuView night={night} onPrice={p.price} />
                ) : win === 'dj' ? (
                  <DjView night={night} onDj={p.dj} />
                ) : (
                  <StaffView night={night} onStaff={p.staff} />
                )}
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
        <div className="pill money" title="Your margin, all nights (play money)">
          <Gem k="coin" c="var(--gold)" />
          <div>
            <div className="k">Margin</div>
            <div className="v">{usd(career.margin + (live ? tonight : 0))}</div>
          </div>
        </div>
        <div
          className="pill"
          title={next ? `Reach ${next.reputation} to unlock venue level ${next.level}` : 'Top venue'}
        >
          <Gem k="star" c="var(--violet)" />
          <div>
            <div className="k">Rep{next ? ` · L${next.level} at ${next.reputation}` : ''}</div>
            <div className="row" style={{ gap: 6 }}>
              <span className="v">{Math.round(career.reputation)}</span>
              <span className="meter" style={{ '--c': 'var(--violet)' } as CSSProperties}>
                <i style={{ width: `${toNext}%` }} />
              </span>
            </div>
          </div>
        </div>
        {live && (
          <div className="pill" title="Crowd energy">
            <Gem k="flame" c="var(--neon)" />
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
        <div className={`ribbon ${live ? 'night' : 'day'}`}>
          {live ? (
            <>
              <b>{clock(night.minute)}</b>
              <small>Night {career.nights + 1}</small>
            </>
          ) : (
            <>
              <b>{venueName(props.level)}</b>
              <small>
                Night {career.nights + 1} · level {props.level}
              </small>
            </>
          )}
          <div className="weekdots" aria-label={`Venue level ${props.level} of ${VENUES.length}`}>
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

function Title(props: { career: Career; night: Night; onPlay: () => void; onReset: () => void }) {
  const { career, night, onPlay } = props
  const ids = tokenIds.filter((id) => night.menu[id])
  const saved = career.nights > 0
  useKeys((k) => {
    if (k === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) onPlay()
  })
  const steps = [
    {
      n: '1',
      name: 'Price the bar',
      line: 'Every drink is a slice of a real stock',
      art: (
        <span className="t-fan">
          {ids.slice(0, 4).map((id) => (
            <StockLogo key={id} id={id} size={58} />
          ))}
        </span>
      ),
    },
    {
      n: '2',
      name: 'Book the DJ',
      line: 'Energy sells drinks',
      art: <img className="t-dj" src={djArt(night.dj)} alt="" />,
    },
    {
      n: '3',
      name: 'Open the doors',
      line: 'Earn rep, grow the club',
      art: <img className="t-door" src="/landing/stairs.webp" alt="" />,
    },
  ]
  return (
    <section className="title">
      <header className="t-top">
        <a href="/" className="t-brand" onClick={(e) => (e.preventDefault(), navigate('/'))}>
          <Mark />
          <span>Nyxeron</span>
        </a>
        <span className="t-mode">Practice · play money · no sign-in</span>
      </header>

      <div className="t-sign">
        <h1>The Basement</h1>
        <p>Run the club. Every drink holds 0.001 of a real share.</p>
      </div>

      <ol className="t-steps" aria-label="How a night works">
        {steps.map((s) => (
          <li key={s.n} className="t-step">
            <span className="t-art">{s.art}</span>
            <span className="t-n">{s.n}</span>
            <b>{s.name}</b>
            <span>{s.line}</span>
          </li>
        ))}
      </ol>

      <div className="t-foot">
        <div className="t-side">
          {saved && (
            <div className="t-save">
              <small>Saved career</small>
              <span>
                Night {career.nights + 1} · rep {Math.round(career.reputation)} ·{' '}
                <b className="gold">{usd(career.margin)}</b>
              </span>
            </div>
          )}
          <div className="row">
            {saved && (
              <button
                className="btn dark"
                onClick={() => {
                  props.onReset()
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
        </div>
        <button className="btn xl yellow go" onClick={onPlay}>
          {saved ? `Continue · night ${career.nights + 1}` : 'Play'}
          <kbd aria-hidden>↵</kbd>
        </button>
      </div>

      {ids.length > 0 && (
        <div className="t-ticker" aria-label="Today's stock prices">
          <div className="t-run">
            {[0, 1].map((copy) => (
              <span key={copy} className="t-set" aria-hidden={copy === 1}>
                {ids.map((id) => {
                  const q = night.market[id]
                  if (!q) return null
                  return (
                    <span key={id} className="t-q">
                      <StockLogo id={id} size={20} />
                      <b>{tokens[id].ticker}</b> ${q.priceUsd.toFixed(2)}{' '}
                      <i className={q.change24h >= 0 ? 'good' : 'bad'}>{pct(q.change24h)}</i>
                    </span>
                  )
                })}
              </span>
            ))}
          </div>
        </div>
      )}
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
  busy: boolean
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
    {
      level: 'ok',
      text: `DJ ${GENRE_DJ[night.dj].name}: ${GENRE_NAME[night.dj]}, energy ${rules.DJ_ENERGY[night.dj]}`,
      win: 'dj',
    },
    {
      level: avgMarkup > 2.2 ? 'warn' : 'ok',
      text: `Menu at ${avgMarkup.toFixed(2)}× on average${avgMarkup > 2.2 ? ': steep, fewer will buy' : ''}`,
      win: 'menu',
    },
    { level: 'warn', text: 'Save happy hour for a slow moment' },
    next
      ? { level: 'bad', text: `Reputation ${next.reputation} opens level ${next.level}` }
      : { level: 'ok', text: 'Every room unlocked' },
  ]
  const mark = { ok: 'check', warn: 'alert', bad: 'lock' } as const
  const go = (d: number) => props.setLevel(Math.min(VENUES.length, Math.max(1, level + d)))
  useKeys((k) => {
    if (props.busy) return
    if (k === '1') props.openWin('menu')
    else if (k === '2') props.openWin('dj')
    else if (k === '3') props.openWin('staff')
    else if (k === '4') props.onWeek()
    else if (k === 'ArrowLeft') go(-1)
    else if (k === 'ArrowRight') go(1)
    else if (k === 'Enter' && !locked && !(document.activeElement instanceof HTMLButtonElement)) props.onOpen()
  })

  return (
    <>
      <aside className="quest frame">
        <span className="tagline">Tonight · {venueName(level)}</span>
        <h2>Venue level {level}</h2>
        <p>{venue.capacity} guests at most. The cost buys the share, the rest is your margin.</p>
        <ul className="todo">
          {todo.map((t) =>
            t.win ? (
              <li key={t.text}>
                <button className={`slot ${t.level}`} onClick={() => props.openWin(t.win!)}>
                  <span className="box">
                    <Icon k={mark[t.level]} />
                  </span>
                  {t.text}
                </button>
              </li>
            ) : (
              <li key={t.text} className={`slot ${t.level}`}>
                <span className="box">
                  <Icon k={mark[t.level]} />
                </span>
                {t.text}
              </li>
            ),
          )}
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
          <b style={{ color: GENRE_COLOR[night.dj] }}>
            {GENRE_DJ[night.dj].name} · {GENRE_NAME[night.dj]}
          </b>
        </div>
        {best && (
          <div className="wanted slot">
            <StockLogo id={best} size={40} />
            <div>
              <small>Most wanted</small>
              <b>{tokens[best].ticker}</b>
            </div>
          </div>
        )}
        <div className="kv">
          <span>Stock prices</span>
          <b>{props.sampleMarket ? 'Sample, 5 Nov' : 'Live'}</b>
        </div>
        <div className="legend">
          {ids.slice(0, 6).map((id) => {
            const c = night.market[id]?.change24h ?? 0
            return (
              <span key={id}>
                <StockLogo id={id} size={16} />
                {tokens[id].ticker} <span className={c >= 0 ? 'good' : 'bad'}>{pct(c)}</span>
              </span>
            )
          })}
        </div>
      </aside>

      {/* The venue carousel: ← → over the club, a padlock on rooms the reputation hasn't opened. */}
      <button
        className="btn dark round venuenav prev"
        aria-label="Previous venue"
        disabled={level === 1}
        onClick={() => go(-1)}
      >
        ←
      </button>
      <button
        className="btn dark round venuenav next"
        aria-label="Next venue"
        disabled={level === VENUES.length}
        onClick={() => go(1)}
      >
        →
      </button>
      {locked && (
        <div className="lockcard frame">
          <span className="lk">
            <Icon k="lock" />
          </span>
          <h2>Locked</h2>
          <p className="dim">
            Reputation {venue.reputation} opens level {level}
          </p>
        </div>
      )}

      <nav className="dock frame" aria-label="Office">
        <button
          className="dockbtn"
          style={{ '--c': 'var(--neon)' } as CSSProperties}
          onClick={() => props.openWin('menu')}
        >
          <kbd>1</kbd>
          <Icon k="glass" />
          Menu
        </button>
        <button
          className="dockbtn"
          style={{ '--c': 'var(--house)' } as CSSProperties}
          onClick={() => props.openWin('dj')}
        >
          <kbd>2</kbd>
          <Icon k="phones" />
          DJ
        </button>
        <button
          className="dockbtn"
          style={{ '--c': 'var(--gold)' } as CSSProperties}
          onClick={() => props.openWin('staff')}
        >
          <kbd>3</kbd>
          <Icon k="door" />
          Staff
        </button>
        <button className="dockbtn" style={{ '--c': 'var(--violet)' } as CSSProperties} onClick={props.onWeek}>
          <kbd>4</kbd>
          <Icon k="zap" />
          Week
        </button>
      </nav>

      <div className="opengo">
        <small>{locked ? `Locked · reputation ${venue.reputation}` : 'Doors at 22:00'}</small>
        <button className={`btn xl ${locked ? '' : 'yellow go'}`} disabled={locked} onClick={props.onOpen}>
          <Icon k={locked ? 'lock' : 'door'} />
          Open club
          {!locked && <kbd aria-hidden>↵</kbd>}
        </button>
      </div>
    </>
  )
}

const WINDOWS: Record<Exclude<Win, null>, { name: string; desc: string; icon: string; c: string; key: string }> = {
  menu: {
    name: 'The bar',
    desc: 'Every drink is 0.001 of a share. Price it from its cost up to 3×.',
    icon: 'glass',
    c: 'var(--neon)',
    key: '1',
  },
  dj: {
    name: 'The booth',
    desc: 'Pick who plays tonight. The genre sets the energy the crowd settles at.',
    icon: 'phones',
    c: 'var(--house)',
    key: '2',
  },
  staff: {
    name: 'The crew',
    desc: 'Bartenders pour the drinks, security works the door. More hands, more sales, more wages.',
    icon: 'door',
    c: 'var(--gold)',
    key: '3',
  },
}

function Window(props: {
  kind: Exclude<Win, null>
  onClose: () => void
  onTab: (w: Win) => void
  children: ReactNode
}) {
  const T = WINDOWS[props.kind]
  useKeys((k) => {
    if (k === 'Escape') props.onClose()
    else if (k === '1') props.onTab('menu')
    else if (k === '2') props.onTab('dj')
    else if (k === '3') props.onTab('staff')
  })
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        className={`window frame w-${props.kind}`}
        style={{ '--c': T.c } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label={T.name}
      >
        <header>
          <div className="tabs" role="tablist">
            {(Object.keys(WINDOWS) as Exclude<Win, null>[]).map((k) => (
              <button key={k} role="tab" aria-selected={props.kind === k} onClick={() => props.onTab(k)}>
                <Icon k={WINDOWS[k].icon} />
                {WINDOWS[k].name}
                <kbd aria-hidden>{WINDOWS[k].key}</kbd>
              </button>
            ))}
          </div>
          <button className="btn round dark" aria-label="Close" title="Close (Esc)" onClick={props.onClose}>
            <Icon k="x" />
          </button>
        </header>
        <p className="wdesc">{T.desc}</p>
        <div className="body">{props.children}</div>
      </div>
    </div>
  )
}

// A price is sent to the game when the slider is let go, so dragging doesn't flood the night with changes.
function DrinkCard({
  night,
  id,
  onPrice,
}: {
  night: Night
  id: TokenId
  onPrice: (id: TokenId, micro: number) => void
}) {
  const item = night.menu[id]!
  const [draft, setDraft] = useState<number>()
  const value = draft ?? item.price
  const change = night.market[id]?.change24h ?? 0
  const markup = value / item.wholesale
  const commit = () => {
    if (draft !== undefined && draft !== item.price) onPrice(id, draft)
    setDraft(undefined)
  }
  return (
    <div className="drink" style={{ '--fill': `${((markup - 1) / (MAX_MARKUP - 1)) * 100}%` } as CSSProperties}>
      <div className="dk-top">
        <StockLogo id={id} size={44} />
        <div className="nm">
          <b>{tokens[id].ticker}</b>
          <small>{tokens[id].name}</small>
        </div>
        <span className={`chg ${change >= 0 ? 'good' : 'bad'}`}>{pct(change)}</span>
      </div>
      <div className="dk-price">
        <b>{usd(value)}</b>
        <span className="mk">{markup.toFixed(2)}×</span>
      </div>
      <input
        type="range"
        aria-label={`${tokens[id].name} price`}
        min={item.wholesale}
        max={item.wholesale * MAX_MARKUP}
        step={10_000}
        value={value}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <div className="dk-foot">
        <span>cost {usd(item.wholesale)}</span>
        <span className="gold">+{usd(value - item.wholesale).slice(1)} yours</span>
      </div>
    </div>
  )
}

function MenuView({ night, onPrice }: { night: Night; onPrice: (id: TokenId, micro: number) => void }) {
  return (
    <>
      <div className="drinks">
        {tokenIds
          .filter((id) => night.menu[id])
          .map((id) => (
            <DrinkCard key={id} night={night} id={id} onPrice={onPrice} />
          ))}
      </div>
      <p className="hint">Cheaper drinks sell more often. A stock that is up today sells better.</p>
    </>
  )
}

function DjView({ night, onDj }: { night: Night; onDj: (g: Genre) => void }) {
  return (
    <div className="djs">
      {GENRES.map((g) => {
        const on = night.dj === g
        const energy = rules.DJ_ENERGY[g]
        return (
          <button
            key={g}
            className={`dj ${on ? 'on' : ''}`}
            style={{ '--c': GENRE_COLOR[g] } as CSSProperties}
            aria-pressed={on}
            onClick={() => !on && onDj(g)}
          >
            <span className="stagelight">
              <img src={djArt(g)} alt="" />
            </span>
            {on && <span className="ondeck">On deck</span>}
            <span className="info">
              <span className="genre">{GENRE_NAME[g]}</span>
              <b>{GENRE_DJ[g].name}</b>
              <span className="energy" title={`Crowd energy ${energy}`}>
                <span className="bar-e">
                  <i style={{ width: `${energy}%` }} />
                </span>
                <small>{energy}</small>
              </span>
              <span className="act">{on ? 'Playing tonight' : 'Book'}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

const CREW = {
  bartender: { name: 'Bartenders', line: 'drinks poured a minute' },
  security: { name: 'Security', line: 'guests let in a minute' },
} as const

/** Hire the night's crew: a stepper per role, with what it does and what it costs. */
function StaffView({ night, onStaff }: { night: Night; onStaff: (s: Night['staff']) => void }) {
  return (
    <div className="crew">
      {(['bartender', 'security'] as const).map((k) => {
        const r = rules.STAFF[k]
        const n = night.staff[k]
        const set = (v: number) => onStaff({ ...night.staff, [k]: Math.min(r.max, Math.max(r.min, v)) })
        return (
          <div key={k} className="crewrow">
            <div className="crewname">
              <b>{CREW[k].name}</b>
              <small>
                {n * r.perMinute} {CREW[k].line} · {usd(n * r.wageUsd * 1_000_000)} a night
              </small>
            </div>
            <div className="stepper" role="group" aria-label={CREW[k].name}>
              <button
                aria-label={`Fewer ${CREW[k].name.toLowerCase()}`}
                disabled={n <= r.min}
                onClick={() => set(n - 1)}
              >
                −
              </button>
              <output aria-live="polite">{n}</output>
              <button
                aria-label={`More ${CREW[k].name.toLowerCase()}`}
                disabled={n >= r.max}
                onClick={() => set(n + 1)}
              >
                +
              </button>
            </div>
          </div>
        )
      })}
      <p className="crewtotal">
        Wages tonight: <b>{usd(staffCost(night.staff))}</b>, paid out of the margin
      </p>
    </div>
  )
}

// ---------- Night ----------

function EventLine({ e }: { e: NightEvent }) {
  switch (e.kind) {
    case 'buy':
      return (
        <>
          Guest {e.guest} bought <StockLogo id={e.token} size={16} />
          <b>{tokens[e.token].ticker}</b> <b className="gold">{usd(e.price)}</b>
        </>
      )
    case 'pass':
      return (
        <>
          Guest {e.guest} passed{e.token && <StockLogo id={e.token} size={16} />}
          <span className="why-t">{e.reason}</span>
        </>
      )
    case 'arrive':
      return <>Guest {e.guest} came in</>
    case 'leave':
      return (
        <>
          Guest {e.guest} left <span className="why-t">{e.reason}</span>
        </>
      )
    case 'ceo':
      return <>{e.reason}</>
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
  const hh = happyHourOn(n)
  const goals: [string, boolean][] = [
    [`Serve 80% of guests (${n.served}/${n.came})`, n.came > 0 && n.served / n.came >= 0.8],
    ['Keep energy at 60+', n.energy >= 60],
    ['Make a margin tonight', sales.some((s) => s.margin > 0)],
    ['Fill the room', n.guests.length >= n.capacity],
  ]
  const recent = n.log.slice(-4).reverse()
  const dj = GENRE_DJ[n.dj]
  useKeys((k) => {
    if (k === '1' || k === '2' || k === '3') props.setSpeed([1, 5, 20][Number(k) - 1]!)
    else if (k === 'h' && !used) props.happyHour()
  })
  return (
    <>
      <aside className="monitors">
        <div className="mon frame">
          <h3>Bar</h3>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span className="bigv">{n.served}</span>
            <span className="dim">served</span>
          </div>
          <div className="kv">
            <span>Came in</span>
            <b>{n.came}</b>
          </div>
          <div className="kv">
            <span>Passed on a drink</span>
            <b>{passed}</b>
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
            Menu
            <small>sold</small>
          </h3>
          <div className="shelf">
            {ids.map((id) => {
              const units = n.sales[id]?.units ?? 0
              return (
                <div className="s" key={id}>
                  <span className="tk">
                    <StockLogo id={id} size={18} />
                    {tokens[id].ticker}
                  </span>
                  <span className="tube">
                    <i style={{ width: `${(units / most) * 100}%` }} />
                  </span>
                  <span className="u">{units}</span>
                  <b>{usd(priceNow(n, id) ?? 0)}</b>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      <div className="ticker" aria-live="off">
        {recent.map((e, i) => (
          <div key={`${e.minute}-${i}`} className={`k-${e.kind}`}>
            <span className="t">{clock(e.minute)}</span>
            <span className="m">
              <EventLine e={e} />
            </span>
          </div>
        ))}
      </div>

      <nav className="dock frame nightdock" aria-label="Night controls">
        <div className="speed" role="group" aria-label="Speed">
          {[1, 5, 20].map((s, i) => (
            <button
              key={s}
              className={props.speed === s ? 'on' : ''}
              aria-pressed={props.speed === s}
              title={`Speed ${s}× (${i + 1})`}
              onClick={() => props.setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="sep" />
        <button
          className={`hh ${hh ? 'lit' : used ? 'spent' : ''}`}
          disabled={used}
          title="Happy hour (H)"
          onClick={props.happyHour}
        >
          <span className="tube">Happy hour</span>
          <small>{hh ? 'On now' : used ? 'Used tonight' : 'Once a night'}</small>
        </button>
        <button className="skipbtn" aria-label="Skip to closing" title="Skip to closing" onClick={props.finish}>
          <Icon k="zap" />
          <span>Skip</span>
        </button>
        <span className="sep" />
        <div className="nowplay" style={{ '--c': GENRE_COLOR[n.dj] } as CSSProperties}>
          <span className="face">
            <img src={djArt(n.dj)} alt="" />
          </span>
          <div>
            <b>{dj.name}</b>
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
    [`Serve 80% (${r.guestsServed}/${r.guestsCame})`, r.guestsCame > 0 && r.guestsServed / r.guestsCame >= 0.8],
    [`Energy 60+ (${r.avgEnergy.toFixed(0)})`, r.avgEnergy >= 60],
    ['Make a margin', r.margin > 0],
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
  const shares = r.units * SHARES_PER_UNIT
  const sold = tokenIds.filter((id) => r.sales[id]?.units)
  const level = levelOf(night.capacity)
  const opened = r.levelAfter > level
  const margin = useCountUp(r.margin, 1400, 250)
  const rep = useCountUp(delta, 1100, 600)
  const drinks = useCountUp(r.units, 1100, 450)
  const shareCount = useCountUp(shares, 1300, 700)
  const best = r.bestSeller
  // One register blip as the screen lands (the club track is still the mode for this first frame).
  useEffect(() => audio.cash(), [])
  useKeys((k) => k === 'Enter' && !(document.activeElement instanceof HTMLButtonElement) && onNext())
  const lines = tokenIds.flatMap((id) => {
    const s = r.sales[id]
    return s ? [{ id, units: s.units, revenue: s.revenue }] : []
  })
  return (
    <div className="results">
      <section className={`resultcard frame ${stars === 3 ? 'big' : ''}`}>
        <header>
          <small>
            Night {nights + 1} · {venueName(level)}
          </small>
          <h1>{head}</h1>
          <div className="bigstars" aria-label={`${stars} of 3 stars`}>
            {[0, 1, 2].map((i) => (
              <Star key={i} on={i < stars} />
            ))}
          </div>
        </header>

        <div className="hero">
          <small>Margin tonight</small>
          <b className={r.margin >= 0 ? 'gold' : 'bad'}>{usd(Math.round(margin))}</b>
          <span>{usd(r.revenue)} in sales</span>
        </div>

        {opened && (
          <div className="unlock">
            <Icon k="door" />
            Venue level {r.levelAfter} is open
          </div>
        )}

        <div className="tiles">
          <div className="slot best">
            {best ? (
              <>
                <StockLogo id={best} size={52} />
                <div>
                  <small>Best seller</small>
                  <b>{tokens[best].ticker}</b>
                  <small>× {r.sales[best]?.units ?? 0}</small>
                </div>
              </>
            ) : (
              <div>
                <small>Best seller</small>
                <b>None</b>
              </div>
            )}
          </div>
          <div className="slot">
            <small>Reputation</small>
            <b className={delta >= 0 ? '' : 'bad'}>
              {delta >= 0 ? '+' : '−'}
              {Math.abs(rep).toFixed(1)}
            </b>
            <small>now {r.reputationAfter.toFixed(0)}</small>
          </div>
          <div className="slot">
            <small>Drinks</small>
            <b>{Math.round(drinks)}</b>
            <small>{r.guestsCame} guests</small>
          </div>
        </div>

        <div className="shares">
          <span className="logos">
            {sold.slice(0, 6).map((id) => (
              <StockLogo key={id} id={id} size={30} />
            ))}
          </span>
          <span>
            In the City that's <b>{shareCount.toFixed(3)}</b> real shares, kept by the guests
          </span>
        </div>

        <ul className="objs goals4">
          {goals.map(([t, done]) => (
            <li key={t} className={done ? 'done' : ''}>
              <span className="box">{done && <Icon k="check" />}</span>
              {t}
            </li>
          ))}
        </ul>

        <div className="rc-foot">
          <p className="dim">
            Crowd averaged {r.avgEnergy.toFixed(0)} energy (peak {r.peakEnergy.toFixed(0)}). Energy brings orders.
          </p>
          <button className="btn xl yellow go" onClick={onNext}>
            Next night
            <kbd aria-hidden>↵</kbd>
          </button>
        </div>
      </section>
      <aside className="receipt" aria-label="Money breakdown">
        <div className="hd">
          <b>{venueName(level).toUpperCase()}</b>
          Practice club
          <br />
          Night {nights + 1}
        </div>
        <hr />
        {lines.map((l) => (
          <div className="ln" key={l.id}>
            <span>
              <StockLogo id={l.id} size={14} />
              {tokens[l.id].ticker} × {l.units}
            </span>
            <span>+{usd(l.revenue).slice(1)}</span>
          </div>
        ))}
        <div className="ln minus">
          <span>Shares bought (cost)</span>
          <span>{usd(-r.wholesale)}</span>
        </div>
        <div className="ln">
          <span>Margin</span>
          <span>{usd(r.margin)}</span>
        </div>
        <div className="ln minus">
          <span>Staff wages</span>
          <span>{usd(-r.staffCost)}</span>
        </div>
        <hr />
        <div className="ln tot">
          <span>Profit</span>
          <span>{usd(r.profit)}</span>
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
  const units = reports.reduce((a, r) => a + r.units, 0)
  const max = Math.max(1, ...reports.map((r) => Math.abs(r.margin)))
  const last = reports.at(-1)!
  const money = useCountUp(total, 1500, 300)
  const rep = useCountUp(last.reputationAfter, 1200, 300)
  useKeys(
    (k) => (k === 'Escape' || (k === 'Enter' && !(document.activeElement instanceof HTMLButtonElement))) && onClose(),
  )
  return (
    <div className="results week">
      <section className="resultcard frame">
        <header>
          <small>Fast-forward · 7 nights with this menu</small>
          <h1>A week at the club</h1>
        </header>
        <div className="hero">
          <small>Week margin</small>
          <b className={total >= 0 ? 'gold' : 'bad'}>{usd(Math.round(money))}</b>
          <span>{units} drinks</span>
        </div>
        <div className="tiles">
          <div className="slot">
            <small>Reputation</small>
            <b>{rep.toFixed(0)}</b>
            <small>from {reports[0]!.reputationBefore.toFixed(0)}</small>
          </div>
          <div className="slot">
            <small>Venue</small>
            <b>Level {last.levelAfter}</b>
            <small>{venueName(last.levelAfter)}</small>
          </div>
          <div className="slot">
            <small>Best night</small>
            <b>{usd(Math.max(...reports.map((r) => r.margin)))}</b>
            <small>margin</small>
          </div>
        </div>
        <div className="chart slot" aria-label="Margin per night">
          {reports.map((r, i) => (
            <div key={i}>
              <span>{usd(r.margin)}</span>
              <i
                className={r.margin < 0 ? 'neg' : ''}
                style={{ height: Math.round((Math.abs(r.margin) / max) * 96), animationDelay: `${0.3 + i * 0.08}s` }}
              />
              <span>N{i + 1}</span>
            </div>
          ))}
        </div>
        <div className="rc-foot">
          <p className="dim">A preview: your career is unchanged.</p>
          <button className="btn xl yellow go" onClick={onClose}>
            Back to the club
            <kbd aria-hidden>↵</kbd>
          </button>
        </div>
      </section>
    </div>
  )
}
