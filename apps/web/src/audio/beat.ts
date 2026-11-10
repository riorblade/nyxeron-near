// Reads the kick out of the music, so the club's lights, dancers and pyro move on the real beat.
// Pure: feed it the bass and loudness of each frame (0–1) and the time in ms.

export class BeatTracker {
  /** Time of the last kick (ms); -Infinity before the first. */
  lastKick = -Infinity
  /** Loudness now vs the last ~10 s: > 1.12 is a peak, < 0.85 a breakdown. */
  intensity = 1
  /** Changes when the beat drops back in after a breakdown (the venue fires everything at once). */
  dropAt = -1
  private prevBass = 0
  private avgFlux = 0.02
  private fast = 0
  private slow = 0
  private broke = false
  private lastDrop = -Infinity

  update(bass: number, loud: number, t: number) {
    const flux = Math.max(0, bass - this.prevBass)
    this.prevBass = bass
    // A kick: the bass jumps well above its usual rise, at most ~4 a second.
    if (flux > Math.max(0.04, this.avgFlux * 2.2) && t - this.lastKick > 250) this.lastKick = t
    this.avgFlux += (flux - this.avgFlux) * 0.05
    this.fast += (loud - this.fast) * 0.05
    this.slow += (loud - this.slow) * (this.slow ? 0.003 : 1)
    this.intensity = this.slow > 0.01 ? this.fast / this.slow : 1
    if (this.intensity < 0.85) this.broke = true
    else if (this.broke && this.intensity > 1.05 && t - this.lastDrop > 15_000) {
      this.broke = false
      this.lastDrop = t
      this.dropAt = t
    }
  }

  /** 1 on the kick, fading to 0 over ~a beat. */
  pulse(t: number) {
    return Math.exp(-(t - this.lastKick) / 120)
  }
}
