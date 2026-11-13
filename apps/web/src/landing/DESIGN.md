# Landing (nyxeron.xyz): design notes

The decisions behind `Landing.tsx`, `landing.css` and `motion.ts`, so later passes stay consistent (#126).

## Concept

```
Idea:        Scrolling the page is one night out: in from the street, down the stairs, onto the floor,
             to the bar, and out at closing time, when the shares go home.
Metaphor:    a night at the club, with its clock (doors 22:00, closing 04:00).
Signature:   the street-to-stairs clip scrubbed by scroll (the frame follows the scroll position, never
             plays), with the night's beats scrolling up the door's axis and the clock in the top bar.
Emotion:     standing at the door of a club at night, about to go in.
Motion verb: go down and light up: things descend into place and switch on like a neon tube.
Screenshot:  the lit doorway in the rain with NYXERON across the bottom of the frame.
```

Anchor: a NYXERON party has a start and an end, and the shares are delivered when it ends. The clock is
real information about the story (where in the night each part sits), not decoration.

## References

- MotionSites **Freight Scroll Hero**: a sticky clip scrubbed by `currentTime`, content scrolling over it
  on the clip's centre axis, beats mirrored left and right of that axis.
- MotionSites **Cinematic Landing Page** (#116): the dance floor clip behind big type.
- Our earlier NYXERON landing (`nyxeron/apps/web/src/screens/Landing.tsx`): scroll-scrubbed hero with an
  eased seek, the lounge track starting on the first tap.
- The anatomy skill's isometric figures (github.com/wheresryan22/anatomy, MIT): Fig 1, the bar, is drawn with its
  kit (`scripts/iso/`, `iso.css`).

## System

- **Palette** (from `index.css`, unchanged): ground `night #0b0614`, panel `#160d26`, line `#2c1f47`, ink
  `#f3ecff`, muted `#a597c2`, accent `neon #ff2bd6` (the one thing that is on), `gold #f5c451` for the
  primary action only.
- **Type:** Big Shoulders Display (condensed club signage) for display, weight 800 to 900, tracking
  negative at size; Nunito for body (the game's own UI face), 17 px / 1.55; IBM Plex Mono for the clock,
  times and tech labels.
- **Grid:** 12 columns, 24 px gutter, 16 px side margin on phones, 5vw on desktop. Sections alternate
  layout families: sticky stage, full-bleed media with a numbers row, asymmetric sticky split, index
  list, two-column FAQ, full-bleed last call, wordmark footer.
- **Shape:** one radius, 999 px for buttons and pills; everything else square.
- **Motion:** one clock (`gsap.ticker`), Lenis smooth scroll, one ease (`expo.out` for reveals, 0.9 s;
  0.5 s for hovers). Reveals rise 24 px and switch on (opacity, a short neon flicker on display type).
- **Hovers:** primary buttons fill from the pointer's side; index rows slide their title and show the
  screen behind that door under the pointer; nav and footer links draw an underline.
- **Idle:** the scrubbed clip breathes a few frames around the scroll position (the smoke in the doorway
  keeps moving), the floor and bar clips loop, the footer sign hums. All of it stops under reduced
  motion.

## Sections

```
[top bar]  mark NYXERON          22:00 Doors open          ♪ NYXERON Lounge  [Launch app]
1 descent  sticky stairs clip ─ wordmark + line + CTAs ─ beats mirrored on the door axis ─ into light
2 floor    full-bleed floor clip, big line top left, four numbers along the bottom
3 flow     title and lede | Fig 1 (sticky) left, four stops right; the stop being read plays on the figure
4 doors    index list: Practice / City / Proof, screen preview under the pointer, inline on touch
5 faq      sticky title left | questions right (details/summary)
6 last     full-bleed bar clip, "Last call." and the two actions
  footer   links, facts, and NYXERON across the whole width like the club's sign
```

Fig 1, the bar (`scripts/bar-figure.mjs`, `BarFigure.tsx`): a counter with a card reader (sign in), a coin
terminal (order), a splitter feeding the host's jar and the treasury safe (split), and a tap that drops a share chip
onto the guest's stack (settle). What moves is what happens at that stop; the readout names the NEAR part. The SVG
(about 24 KB gzipped) loads only when the section comes near. Under reduced motion it rests in its last pose.

Every part of the page carries its time in the night (`data-at`, `data-label`, shown as a stamp); the clock in the top
bar reads the stamp of the part being read.

Genericness check: the three card grids from #116 are gone (Kiel: "reads like a template"); the NEAR
features live in the flow as captions on what each step really does, not as a feature grid.
