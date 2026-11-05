// The Basement in 3D. Reads a Night from @nyxeron/game and never changes it: guests come in at the entrance, dance,
// walk to the bar when the simulation says they bought, and leave. Orbit camera, voxel characters (rig.ts).
import { happyHourOn, type Night, type TokenId, tokens } from '@nyxeron/game'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { basement, type Layout, type Zone, zone } from './layout.ts'
import { applyMove, danceAt, type Move } from './moves.ts'
import { buildRig, type Look, lookFor, type Rig } from './rig.ts'

const WALL_H = 3.2
const PERSON = 1.15 // a character's height in metres
const WALK = 1.7 // m/s
const NEON = [0xff2bd6, 0x22d3ee, 0xa855f7, 0xf5c451]
const BPM: Record<string, number> = { house: 124, techno: 132, hiphop: 94, pop: 116, lounge: 100 }
const PREVIEW_CROWD = 10

type Person = {
  rig: Rig
  x: number
  z: number
  home: [number, number]
  to: [number, number]
  /** What they do when they get there. */
  then: 'dance' | 'idle' | 'order' | 'leave'
  wait: number
  seed: number
}

export class VenueScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200)
  private controls: OrbitControls
  private room = new THREE.Group()
  private layout: Layout = basement(1)
  private people = new Map<number, Person>()
  private staff: { rig: Rig; move: Move; seed: number }[] = []
  private floor: THREE.Mesh[] = []
  private lights: THREE.SpotLight[] = []
  private floats: { sprite: THREE.Sprite; age: number }[] = []
  private board?: { mesh: THREE.Mesh; key: string }
  private eq?: THREE.Texture
  private seen = new Set<string>()
  private minute = -1
  /** Game minutes per real second, measured: the crowd moves faster when the night is fast-forwarded. */
  private pace = 1
  private paceAt = performance.now()
  private energy = 0.6
  private bpm = BPM.house!
  private happy = false
  private frame = 0
  private last = performance.now()
  private resize = new ResizeObserver(() => this.fit())

  private host: HTMLElement

  constructor(host: HTMLElement) {
    this.host = host
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = false
    host.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(0x0b0614)
    this.scene.fog = new THREE.Fog(0x0b0614, 30, 70)
    this.scene.add(new THREE.HemisphereLight(0x8b7cff, 0x1a0b2e, 1.6), this.room)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = 1.25 // never under the floor
    this.controls.minPolarAngle = 0.35
    this.controls.minDistance = 8
    this.controls.maxDistance = 45
    this.controls.enablePan = false
    this.resize.observe(host)
    this.fit()
    this.setLevel(1)
    this.loop()
  }

  /** Rebuilds the room for a venue level (1–4). */
  setLevel(level: number) {
    if (this.layout.level === level && this.room.children.length) return
    this.layout = basement(level)
    this.clearRoom()
    this.build()
    this.frameCamera()
    for (const p of this.people.values()) this.place(p, this.entrance())
  }

  /** Follows the night: who is inside, who bought what, the crowd's energy, the DJ. `null` = a lively preview. */
  update(night: Night | null) {
    if (!night) return this.preview()
    if (night.minute < this.minute) this.clearPeople() // a new night started
    if (night.minute > this.minute && this.minute >= 0) {
      const now = performance.now()
      const perSecond = ((night.minute - this.minute) * 1000) / Math.max(1, now - this.paceAt)
      this.pace = Math.min(4, Math.max(1, this.pace * 0.7 + perSecond * 0.3))
      this.paceAt = now
    }
    this.minute = night.minute
    this.energy = night.energy / 100
    this.bpm = BPM[night.dj] ?? 120
    this.happy = happyHourOn(night)
    this.setBoard(Object.entries(night.menu).map(([id, m]) => [id as TokenId, m!.price]))
    const inside = new Set(night.guests.map((g) => g.id))
    for (const g of night.guests) if (!this.people.has(g.id)) this.spawn(g.id)
    for (const [id, p] of this.people) if (!inside.has(id) && p.then !== 'leave') this.walk(p, this.entrance(), 'leave')
    for (const e of night.log) {
      if (e.kind !== 'buy') continue
      const key = `${e.minute}:${e.guest}:${e.token}`
      if (this.seen.has(key) || e.minute < night.minute - 3) continue
      this.seen.add(key)
      const p = this.people.get(e.guest)
      if (!p) continue
      // Every buy shows; one in three walks up to the bar, or the whole room would be queueing (guests buy often).
      if (p.then === 'dance' && (e.minute + e.guest) % 3 === 0) this.walk(p, this.barSpot(e.guest), 'order')
      this.float(p, `${tokens[e.token].ticker} $${(e.price / 1e6).toFixed(2)}`)
    }
    if (this.seen.size > 2000) this.seen.clear()
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.resize.disconnect()
    this.controls.dispose()
    this.clearPeople()
    this.clearRoom()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ---- room ----

  private build() {
    const { w, h } = this.layout
    const room = this.room
    const floorTex = gridTexture()
    floorTex.repeat.set(w, h)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshLambertMaterial({ color: 0x2a1d45, map: floorTex }),
    )
    ground.rotation.x = -Math.PI / 2
    room.add(ground)
    // Back and left walls full height, front and right a low curb: a dollhouse cut so the camera sees in.
    const wall = new THREE.MeshLambertMaterial({ color: 0x241638 })
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, m: THREE.Material = wall) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      room.add(mesh)
      return mesh
    }
    add(new THREE.BoxGeometry(w + 0.3, WALL_H, 0.3), 0, WALL_H / 2, -h / 2 - 0.15)
    add(new THREE.BoxGeometry(0.3, WALL_H, h), -w / 2 - 0.15, WALL_H / 2, 0)
    add(new THREE.BoxGeometry(w + 0.3, 0.35, 0.3), 0, 0.175, h / 2 + 0.15)
    add(new THREE.BoxGeometry(0.3, 0.35, h), w / 2 + 0.15, 0.175, 0)
    // Neon trim along the top of the tall walls.
    const trim = new THREE.MeshBasicMaterial({ color: NEON[0] })
    add(new THREE.BoxGeometry(w, 0.06, 0.06), 0, WALL_H - 0.25, -h / 2 + 0.02, trim)
    add(
      new THREE.BoxGeometry(0.06, 0.06, h),
      -w / 2 + 0.02,
      WALL_H - 0.25,
      0,
      new THREE.MeshBasicMaterial({ color: NEON[1] }),
    )
    // The club's name on the back wall.
    const sign = textPlane('NYXERON', {
      w: 4,
      h: 0.9,
      color: '#ffffff',
      glow: '#ff2bd6',
      font: 'bold 140px sans-serif',
    })
    sign.position.set(w / 2 - 2.3, WALL_H - 0.9, -h / 2 + 0.02)
    room.add(sign)

    for (const z of this.layout.zones) this.buildZone(z)
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SpotLight(NEON[i], 30, 18, 0.45, 0.6)
      const d = zone(this.layout, 'dance')
      s.position.set(this.x(d.x + d.w / 2), WALL_H + 1, this.z(d.y + d.h / 2))
      s.target.position.set(this.x(d.x + d.w / 2), 0, this.z(d.y + d.h / 2))
      room.add(s, s.target)
      this.lights.push(s)
    }
    for (const [x, y] of [
      [0.6, this.layout.h - 3.6],
      [this.layout.w - 0.6, 1.2 + (this.layout.level >= 3 ? 1.4 : 0)],
      [this.layout.w - 0.6, this.layout.h - 3.2],
    ] as const)
      room.add(plant(this.x(x), this.z(y)))
  }

  private buildZone(z: Zone) {
    const cx = this.x(z.x + z.w / 2)
    const cz = this.z(z.y + z.h / 2)
    const box = (w: number, hgt: number, d: number, color: number, x = cx, zz = cz, y = hgt / 2) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), new THREE.MeshLambertMaterial({ color }))
      m.position.set(x, y, zz)
      this.room.add(m)
      return m
    }
    const label = (text: string, y = 0.02, size = 0.55) => {
      const p = textPlane(text, { w: Math.min(z.w, text.length * size * 0.75), h: size, color: '#cbbcf0' })
      p.rotation.x = -Math.PI / 2
      p.position.set(cx, y, cz)
      this.room.add(p)
    }
    switch (z.kind) {
      case 'bar': {
        // Counter, back shelf with bottles, two bartenders between them.
        const counterX = this.x(z.x + 1.5)
        box(0.6, 1.05, z.h, 0x5a3a22, counterX)
        box(0.66, 0.05, z.h + 0.06, 0x7a5232, counterX, cz, 1.08)
        box(0.03, 0.04, z.h, 0x22d3ee, counterX + 0.32, cz, 0.9) // neon strip on the guests' side
        box(0.35, 2.1, z.h, 0x1a1028, this.x(0.2), cz, 1.05)
        for (let i = 0; i < z.h * 4; i++) {
          const b = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.06, 0.28, 6),
            new THREE.MeshBasicMaterial({ color: NEON[i % 4] }),
          )
          b.position.set(this.x(0.42), 1.25 + (i % 2) * 0.55, this.z(z.y + 0.15 + (i / 4) * 1))
          this.room.add(b)
        }
        for (let i = 0; i < 2; i++)
          this.addStaff(this.x(z.x + 0.85), this.z(z.y + 1 + i * (z.h - 2)), 'idle', Math.PI / 2, 900 + i)
        break
      }
      case 'dj': {
        box(z.w, 1, z.h, 0x2c1f47)
        box(z.w * 0.8, 0.12, 0.6, 0x111111, cx, cz + 0.1, 1.06)
        this.addStaff(cx, cz - 0.3, 'pump', 0, 950, 0.95)
        this.eq = barsTexture()
        const screen = new THREE.Mesh(
          new THREE.PlaneGeometry(z.w + 0.5, 1.3),
          new THREE.MeshBasicMaterial({ map: this.eq }),
        )
        screen.position.set(cx, 2.1, this.z(0) + 0.02)
        this.room.add(screen)
        break
      }
      case 'dance': {
        // Tiles light up with the beat; brighter when the crowd is hot, gold in happy hour.
        for (let i = 0; i < z.w; i++)
          for (let j = 0; j < z.h; j++) {
            const t = new THREE.Mesh(
              new THREE.BoxGeometry(0.96, 0.04, 0.96),
              new THREE.MeshBasicMaterial({ color: NEON[(i + j) % 4] }),
            )
            t.position.set(this.x(z.x + i + 0.5), 0.02, this.z(z.y + j + 0.5))
            t.userData.phase = (i * 7 + j * 3) % 4
            this.floor.push(t)
            this.room.add(t)
          }
        break
      }
      case 'stock':
      case 'office':
      case 'wc':
        box(z.w, 0.9, z.h, 0x2c1f47)
        label(z.label!, 0.92, 0.6)
        break
      case 'stage':
        box(z.w, 0.6, z.h, 0x3a2a5c)
        label(z.label!, 0.62, 0.45)
        break
      case 'vip':
        // Sofas facing the room, low tables, a gold rope line.
        for (let i = 0; i + 1.6 <= z.w; i += 2) {
          box(1.5, 0.45, 0.6, 0x6b21a8, this.x(z.x + i + 1), this.z(z.y + 0.4))
          box(0.7, 0.35, 0.5, 0x1f1433, this.x(z.x + i + 1), this.z(z.y + 1.2))
        }
        label(z.label!, 0.02, 0.4)
        break
      case 'tables':
        for (let j = 0; j + 1.4 <= z.h; j += 1.8) {
          const t = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.35, 0.9, 12),
            new THREE.MeshLambertMaterial({ color: 0x3a2a5c }),
          )
          t.position.set(cx, 0.45, this.z(z.y + j + 0.8))
          this.room.add(t)
        }
        break
      case 'entrance':
        label(z.label!, 0.02, 0.4)
        this.addStaff(this.x(z.x - 0.4), this.z(z.y + 0.6), 'idle', 0.4, 990)
        break
    }
  }

  /** The price board over the bar: every drink on tonight's menu is a stock. */
  private setBoard(menu: [TokenId, number][]) {
    const key = menu.map(([t, p]) => `${t}${p}`).join()
    if (this.board?.key === key) return
    if (this.board) dispose(this.board.mesh)
    const bar = zone(this.layout, 'bar')
    const lines = menu.slice(0, 8).map(([t, p]) => `${tokens[t].ticker.padEnd(5)} $${(p / 1e6).toFixed(2)}`)
    const mesh = boardPlane(lines, bar.h)
    mesh.rotation.y = Math.PI / 2
    mesh.position.set(this.x(0) + 0.03, 2.55, this.z(bar.y + bar.h / 2))
    this.room.add(mesh)
    this.board = { mesh, key }
  }

  // ---- people ----

  private preview() {
    if (this.people.size >= PREVIEW_CROWD) return
    for (let i = this.people.size; i < PREVIEW_CROWD; i++) {
      const p = this.spawn(10_000 + i)
      this.place(p, p.home)
      p.then = 'dance'
    }
    this.setBoard([
      ['tsla', 620_000],
      ['nvda', 320_000],
      ['spy', 920_000],
    ])
  }

  private spawn(id: number): Person {
    const look: Look = lookFor(id)
    const rig = buildRig(look)
    rig.mesh.scale.setScalar(PERSON)
    this.scene.add(rig.mesh)
    const home = this.homeSpot(id)
    const p: Person = { rig, x: 0, z: 0, home, to: home, then: 'dance', wait: 0, seed: id }
    this.place(p, this.entrance())
    this.walk(p, home, this.inDance(home) ? 'dance' : 'idle')
    this.people.set(id, p)
    return p
  }

  private addStaff(x: number, z: number, move: Move, facing: number, seed: number, scale = 1) {
    const rig = buildRig({
      ...lookFor(seed),
      shirt: seed === 990 ? '#0a0a0a' : '#f4f4f5',
      shirtStyle: 'tee',
      hat: undefined,
    })
    rig.mesh.scale.setScalar(PERSON * scale)
    rig.mesh.position.set(x, move === 'pump' ? 1 : 0, z)
    rig.mesh.rotation.y = facing
    this.room.add(rig.mesh)
    this.staff.push({ rig, move, seed })
  }

  // Where a guest hangs out: most on the dance floor, some at the tables or in VIP when the venue has them.
  private homeSpot(id: number): [number, number] {
    const r = (n: number) => {
      const x = Math.sin(id * 12.9898 + n * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    const sit = this.layout.zones.filter((z) => z.kind === 'tables' || z.kind === 'vip')
    const z = sit.length && r(1) < 0.3 ? sit[Math.floor(r(2) * sit.length)]! : zone(this.layout, 'dance')
    return [z.x + 0.4 + r(3) * (z.w - 0.8), z.y + 0.4 + r(4) * (z.h - 0.8)]
  }

  private inDance([x, y]: [number, number]) {
    const d = zone(this.layout, 'dance')
    return x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h
  }

  private barSpot(id: number): [number, number] {
    const b = zone(this.layout, 'bar')
    return [b.x + 2.35, b.y + 0.4 + ((id * 0.618) % 1) * (b.h - 0.8)]
  }

  private entrance(): [number, number] {
    const e = zone(this.layout, 'entrance')
    return [e.x + e.w / 2, e.y + e.h - 0.3]
  }

  private place(p: Person, [x, y]: [number, number]) {
    p.x = x
    p.z = y
  }

  private walk(p: Person, to: [number, number], then: Person['then']) {
    p.to = to
    p.then = then
    p.wait = then === 'order' ? 2 / this.pace : 0
  }

  private float(p: Person, text: string) {
    if (this.floats.length >= 4) return // a fast night would bury the room in labels
    const tex = textTexture(text, { color: '#f5c451', font: 'bold 52px sans-serif' })
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
    sprite.scale.set(1.8, 0.45, 1)
    sprite.position.set(this.x(p.x), PERSON + 0.5, this.z(p.z))
    this.scene.add(sprite)
    this.floats.push({ sprite, age: 0 })
  }

  // ---- loop ----

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const beat = (now / 60000) * this.bpm
    const pulse = (1 - Math.cos(beat * Math.PI * 2)) / 2
    for (const [id, p] of this.people) {
      const dx = p.to[0] - p.x
      const dz = p.to[1] - p.z
      const dist = Math.hypot(dx, dz)
      const mesh = p.rig.mesh
      if (dist > 0.05) {
        const step = Math.min(dist, WALK * this.pace * dt)
        p.x += (dx / dist) * step
        p.z += (dz / dist) * step
        mesh.rotation.y = Math.atan2(dx, dz)
        applyMove(p.rig, 'walk', now / 450 + p.seed)
      } else if (p.then === 'leave') {
        this.scene.remove(mesh)
        p.rig.dispose()
        this.people.delete(id)
        continue
      } else if (p.then === 'order') {
        mesh.rotation.y = -Math.PI / 2 // facing the bar
        applyMove(p.rig, 'idle', beat / 2 + p.seed)
        if ((p.wait -= dt) <= 0) this.walk(p, p.home, this.inDance(p.home) ? 'dance' : 'idle')
      } else if (p.then === 'dance') {
        const d = danceAt(p.seed, beat)
        applyMove(p.rig, d.move, d.beat, d.energy * (0.4 + this.energy))
      } else {
        applyMove(p.rig, 'idle', beat / 2 + p.seed)
      }
      mesh.position.set(this.x(p.x), 0, this.z(p.z))
    }
    for (const s of this.staff) applyMove(s.rig, s.move, s.move === 'idle' ? beat / 2 + s.seed : beat, 0.8)
    for (const t of this.floor) {
      const on = (Math.floor(beat) + (t.userData.phase as number)) % 4 === 0
      const m = t.material as THREE.MeshBasicMaterial
      const base = this.happy ? 0xf5c451 : NEON[(t.userData.phase as number) % 4]!
      m.color.setHex(base).multiplyScalar(on ? 0.5 + this.energy * 0.6 : 0.12 + this.energy * 0.15)
    }
    this.lights.forEach((l, i) => {
      const a = beat * 0.25 + (i * Math.PI) / 2
      const d = zone(this.layout, 'dance')
      l.target.position.set(
        this.x(d.x + d.w / 2 + Math.cos(a) * d.w * 0.35),
        0,
        this.z(d.y + d.h / 2 + Math.sin(a) * d.h * 0.35),
      )
      l.intensity = (10 + 40 * this.energy) * (0.6 + 0.4 * pulse)
    })
    if (this.eq) this.eq.offset.x = (beat * 0.05) % 1
    this.floats = this.floats.filter((f) => {
      f.age += dt
      f.sprite.position.y += dt * 0.6
      ;(f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - f.age / 1.8)
      if (f.age < 1.8) return true
      this.scene.remove(f.sprite)
      dispose(f.sprite)
      return false
    })
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  // ---- helpers ----

  private x = (gx: number) => gx - this.layout.w / 2
  private z = (gy: number) => gy - this.layout.h / 2

  private frameCamera() {
    const { w, h } = this.layout
    const r = Math.max(w, h)
    this.camera.position.set(r * 0.85, r * 0.95, r * 1.15)
    this.controls.target.set(0, 0, 0.5)
    this.controls.update()
  }

  private fit() {
    const { clientWidth: w, clientHeight: h } = this.host
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private clearPeople() {
    for (const p of this.people.values()) {
      this.scene.remove(p.rig.mesh)
      p.rig.dispose()
    }
    this.people.clear()
    this.seen.clear()
    this.minute = -1
  }

  private clearRoom() {
    for (const s of this.staff) s.rig.dispose()
    this.staff = []
    this.floor = []
    this.lights = []
    this.board = undefined
    this.eq = undefined
    for (const o of [...this.room.children]) {
      this.room.remove(o)
      dispose(o)
    }
  }
}

// ---- textures and props ----

function dispose(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh
    m.geometry?.dispose()
    if ((c as THREE.SkinnedMesh).isSkinnedMesh) return // characters share one material (rig.ts)
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) {
      ;(mat as THREE.MeshBasicMaterial).map?.dispose()
      mat.dispose()
    }
  })
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

function textTexture(text: string, o: { color: string; font: string; glow?: string; w?: number; h?: number }) {
  const [c, g] = canvas(o.w ?? 512, o.h ?? 128)
  g.font = o.font
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (o.glow) {
    g.shadowColor = o.glow
    g.shadowBlur = 30
  }
  g.fillStyle = o.color
  g.fillText(text, c.width / 2, c.height / 2, c.width - 20)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function textPlane(text: string, o: { w: number; h: number; color: string; glow?: string; font?: string }) {
  const tex = textTexture(text, {
    color: o.color,
    glow: o.glow,
    font: o.font ?? 'bold 90px sans-serif',
    w: 1024,
    h: Math.round((1024 * o.h) / o.w),
  })
  return new THREE.Mesh(
    new THREE.PlaneGeometry(o.w, o.h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  )
}

function boardPlane(lines: string[], width: number) {
  const [c, g] = canvas(1024, 512)
  g.fillStyle = '#0d0818'
  g.fillRect(0, 0, 1024, 512)
  g.strokeStyle = '#ff2bd6'
  g.lineWidth = 10
  g.strokeRect(5, 5, 1014, 502)
  g.font = 'bold 54px ui-monospace, monospace'
  g.textBaseline = 'middle'
  const cols = lines.length > 4 ? 2 : 1
  lines.forEach((l, i) => {
    const col = Math.floor(i / 4)
    g.fillStyle = ['#f5c451', '#22d3ee', '#ff2bd6', '#3ee08f'][i % 4]!
    g.fillText(l, 40 + col * (1024 / cols), 80 + (i % 4) * 110)
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width, 6), 1.2), new THREE.MeshBasicMaterial({ map: t }))
}

function gridTexture() {
  const [c, g] = canvas(64, 64)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#c9bde6'
  g.fillRect(0, 0, 64, 2)
  g.fillRect(0, 0, 2, 64)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// An equaliser for the screen behind the DJ; it scrolls with the beat.
function barsTexture() {
  const [c, g] = canvas(512, 128)
  g.fillStyle = '#0d0818'
  g.fillRect(0, 0, 512, 128)
  for (let i = 0; i < 32; i++) {
    const h = 20 + ((Math.sin(i * 1.7) + 1) / 2) * 100
    g.fillStyle = ['#ff2bd6', '#22d3ee', '#a855f7', '#f5c451'][i % 4]!
    g.fillRect(i * 16 + 3, 128 - h, 10, h)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function plant(x: number, z: number) {
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), new THREE.MeshLambertMaterial({ color: 0x14532d }))
  pot.position.y = 0.25
  const leaves = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x22a06b }),
  )
  leaves.position.y = 0.95
  g.add(pot, leaves)
  g.position.set(x, 0, z)
  return g
}
