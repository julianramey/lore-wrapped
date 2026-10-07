// The lore mark: a ring of bars around a point, their lengths one smooth waveform,
// the longest one in the accent. Shared by the report, the share cards, the site and
// the terminal so every surface draws the same geometry.

const N = 18
const R0 = 5.4
const MAX_R = 15.2

/** Bars in a 32×32 box: [x1, y1, x2, y2], and which one is the accent. */
export const MARK = (() => {
  const lens = Array.from({ length: N }, (_, i) => {
    const t = (2 * Math.PI * i) / N
    return 4.4 + 1.8 * Math.sin(2 * t + 0.9) + 1.1 * Math.sin(5 * t + 0.4)
  })
  const k = (MAX_R - R0) / Math.max(...lens)
  const accent = lens.indexOf(Math.max(...lens))
  const bars = lens.map((L, i) => {
    const a = ((-90 + (i * 360) / N) * Math.PI) / 180
    const r2 = R0 + L * k
    return [16 + R0 * Math.cos(a), 16 + R0 * Math.sin(a), 16 + r2 * Math.cos(a), 16 + r2 * Math.sin(a)].map((v) => +v.toFixed(2)) as [number, number, number, number]
  })
  return { bars, accent, width: 1.8, dot: 2.4 }
})()

/** The mark as SVG markup; `ink` may be `currentColor`. */
export function markSvg(size: number, ink = 'currentColor', accent = 'var(--accent)', attrs = ''): string {
  const lines = MARK.bars
    .map(([x1, y1, x2, y2], i) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${i === MARK.accent ? accent : ink}"/>`)
    .join('')
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" ${attrs}><g stroke-width="${MARK.width}" stroke-linecap="round">${lines}</g><circle cx="16" cy="16" r="${MARK.dot}" fill="${ink}"/></svg>`
}

/** Draws the mark on a canvas, centered on (cx, cy), `size` pixels wide. */
export function drawMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ink: string, accent: string) {
  const s = size / 32
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(s, s)
  ctx.lineCap = 'round'
  ctx.lineWidth = MARK.width
  MARK.bars.forEach(([x1, y1, x2, y2], i) => {
    ctx.strokeStyle = i === MARK.accent ? accent : ink
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  })
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(16, 16, MARK.dot, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const BRAILLE = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

/**
 * The mark in braille: 16 columns × 8 rows, one dot per unit of the 32×32 box. At time t
 * (seconds) the bars breathe like a level meter; `energy` (0–1) swells them. Each row is
 * a list of [character, isAccent].
 */
export function markBraille(t = 0, energy = 0): [string, boolean][][] {
  const D = 32
  const on = new Uint8Array(D * D)
  const hot = new Uint8Array(D * D)
  const set = (x: number, y: number, a: boolean) => {
    const xi = Math.round(x), yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= D || yi >= D) return
    on[yi * D + xi] = 1
    if (a) hot[yi * D + xi] = 1
  }
  const N = MARK.bars.length
  MARK.bars.forEach(([x1, y1, x2, y2], i) => {
    const a = Math.atan2(y2 - y1, x2 - x1)
    const r0 = Math.hypot(x1 - 16, y1 - 16)
    const len = Math.hypot(x2 - x1, y2 - y1)
    const th = (2 * Math.PI * i) / N
    const wave = t ? 1 + 0.18 * Math.sin(2 * th + t * 1.6) + 0.12 * Math.sin(5 * th - t * 2.4) + energy * 0.22 * Math.sin(9 * th + t * 7) : 1
    const r2 = Math.min(15.6, r0 + len * wave)
    for (let r = r0; r <= r2; r += 0.35) set(16 + Math.cos(a) * r, 16 + Math.sin(a) * r, i === MARK.accent)
  })
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) set(16 + x, 16 + y, false)
  const rows: [string, boolean][][] = []
  for (let cy = 0; cy < D / 4; cy++) {
    const row: [string, boolean][] = []
    for (let cx = 0; cx < D / 2; cx++) {
      let code = 0x2800
      let a = false
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i = (cy * 4 + dy) * D + cx * 2 + dx
          if (on[i]) code |= BRAILLE[dy][dx]
          if (hot[i]) a = true
        }
      row.push([String.fromCharCode(code), a])
    }
    rows.push(row)
  }
  return rows
}
