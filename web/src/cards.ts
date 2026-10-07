// Share cards, drawn on canvas at 1080×1350. Counts, your card and its object only:
// no project names, quotes, paths or code. Every card carries the mark and your code.

import { prettyModel } from '../../src/pipeline/modelName.ts'
import { SOURCE_KEYS, sourceLabel } from '../../src/sources/registry.ts'
import type { Report } from '../../src/report-types.ts'
import { icon } from './icons/render.ts'
import { OBJECTS } from './icons/scenes.ts'
import { drawMark } from './mark.ts'
import { about, period } from './format.ts'
import { vsCode } from '../../src/pipeline/versus.ts'
import { PALETTES, type Palette } from './palettes.ts'

export const W = 1080
export const H = 1350
const SANS = '"Plex Sans", ui-sans-serif, system-ui, sans-serif'
const MONO = '"Plex Mono", ui-monospace, Menlo, monospace'

export type CardKind = 'type' | 'grid' | 'numbers' | 'model' | 'bill' | 'words' | 'overtime' | 'swear' | 'said' | 'steer' | 'limits' | 'babysitter' | 'forgot'

export const CARD_LABELS: Record<CardKind, string> = {
  type: 'Your card',
  grid: 'All my cards',
  model: 'My model',
  words: 'In my words',
  numbers: 'The year',
  overtime: 'Overtime',
  swear: 'Swear jar',
  said: 'What they said back',
  steer: 'How you steer',
  bill: 'The bill',
  limits: 'Limit breaker',
  babysitter: 'Babysitter',
  forgot: 'Things I forgot',
}

/** Which cards this history can fill. Loud cards only appear when the number is worth saying. */
export function availableCards(r: Report): CardKind[] {
  const d = r.deep
  const out: CardKind[] = ['type', 'numbers']
  if (r.favoriteModels.length >= 2) out.push('model')
  if (r.spend.totalUsd >= 20) out.push('bill')
  if (r.topWords.length >= 6) out.push('words')
  if (d.swear.prompts > 0) out.push('swear')
  if ((r.extras?.catchphrases[0]?.count ?? 0) >= 5) out.push('said')
  out.push('overtime')
  if (d.limits && d.limits.windowsAtLimit > 0) out.push('limits')
  if (d.steeringByModel.length >= 3) out.push('babysitter')
  if (forgotLines(r).length >= 3) out.push('forgot')
  out.push('steer')
  // the grid: up to nine of the above in one image
  if (out.length >= 4) out.splice(1, 0, 'grid')
  return out
}

const big = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : Math.round(x).toLocaleString('en-US'))
/** Agent hours, with a + when some prompts have no agent time on record. */
const hours = (r: Report) => `${big(r.deep.work.agentHours)}${r.deep.work.agentHoursFloor ? '+' : ''}`
const pct = (x: number) => `${Math.round(x * 100)}%`

export async function fontsReady() {
  await Promise.all(['300 100px "Plex Sans"', '400 40px "Plex Sans"', '600 40px "Plex Sans"', 'italic 400 40px "Plex Sans"', '500 30px "Plex Mono"', '400 30px "Plex Mono"'].map((f) => document.fonts.load(f).catch(() => null)))
}

/** The one number that sums up each archetype. */
export function signature(r: Report): { value: string; label: string } {
  const d = r.deep
  switch (r.archetype.key) {
    case 'volcano': {
      const w = d.swear.words[0]
      return w ? { value: big(w.count), label: `times I said “${w.word}”` } : { value: big(d.swear.prompts), label: 'prompts with a swear' }
    }
    case 'monk':
      return { value: big(d.swear.prompts), label: 'swears, total' }
    case 'editor':
      return { value: pct(r.steering.rate), label: 'of follow-ups redirect' }
    case 'delegator':
      return { value: d.work.actionsPerPrompt.toFixed(1), label: 'agent actions per prompt' }
    case 'architect':
      return { value: String(r.style.medianWords), label: 'words per prompt' }
    case 'sniper':
      return { value: pct(r.style.oneLinerShare), label: 'one-line prompts' }
    case 'night':
      return { value: pct(r.rhythm.nightShare), label: 'after 10pm' }
    case 'conductor':
      return { value: String(r.projects.filter((p) => p.prompts >= 50).length), label: 'projects at once' }
    case 'marathoner':
      return { value: big(r.deepest[0]?.prompts ?? 0), label: 'prompts in one thread' }
    default:
      // without transcripts there are no turn timings; prompts are always on record
      return d.work.timedTurns ? { value: hours(r), label: d.work.agentHoursFloor ? 'hours of agent work, timed' : 'hours of agent work' } : { value: big(r.totals.prompts), label: 'prompts on record' }
  }
}

/** Lore facts that hold no names, paths or quotes. */
function forgotLines(r: Report): { big: string; small: string }[] {
  const out: { big: string; small: string }[] = []
  for (const e of r.lore) {
    if (e.key === 'latest') out.push({ big: e.title.split(',')[0], small: 'the latest I ever prompted' })
    if (e.key === 'marathon') out.push({ big: e.title.replace(' without a break', ''), small: 'one session, no break over 45 min' })
    if (e.key === 'quiet') out.push({ big: `${e.title.split(' ')[0]} days`, small: 'my longest break' })
    if (e.key === 'manners') out.push({ big: e.title.split(',')[0], small: 'times I said please' })
    if (e.key === 'job') out.push({ big: `${e.title.match(/[\d.]+ hours/)?.[0] ?? ''}`, small: 'one agent run, without me' })
  }
  return out.filter((x) => x.big).slice(0, 4)
}

// ───────────────────────── frame

const NEUTRAL: Palette = { bg: '#fbfaf7', ink: '#0b0b0a', accent: '#e0531f', muted: '#dedbd2' }
const DARK: Palette = { bg: '#110b08', ink: '#fbeee6', accent: '#ff5b1f', muted: '#3b2a21' }
const BLUE: Palette = { bg: '#f3f6fb', ink: '#0d1424', accent: '#e0531f', muted: '#d3d9e5' }

function frame(g: CanvasRenderingContext2D, r: Report, p: Palette, rightLabel?: string) {
  g.fillStyle = p.bg
  g.fillRect(0, 0, W, H)
  // dot grid, the page's texture
  g.fillStyle = p.muted
  g.globalAlpha = 0.5
  for (let x = 54; x < W - 40; x += 36) for (let y = 54; y < H - 40; y += 36) g.fillRect(x, y, 2, 2)
  g.globalAlpha = 1
  // inset hairline with + marks at the corners
  g.strokeStyle = p.muted
  g.lineWidth = 2
  g.strokeRect(40, 40, W - 80, H - 80)
  g.fillStyle = p.ink
  g.globalAlpha = 0.45
  g.font = `400 26px ${MONO}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const [x, y] of [[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]]) {
    g.fillStyle = p.bg
    g.fillRect(x - 10, y - 10, 20, 20)
    g.fillStyle = p.ink
    g.fillText('+', x, y + 1)
  }
  g.globalAlpha = 1
  g.textAlign = 'left'
  // header: mark + wordmark, and a mono label on the right
  drawMark(g, 100, 112, 44, p.ink, p.accent)
  g.fillStyle = p.ink
  g.font = `600 36px ${SANS}`
  ;(g as any).letterSpacing = '-1.5px'
  g.fillText('lore', 134, 113)
  ;(g as any).letterSpacing = '0px'
  g.textAlign = 'right'
  g.font = `400 22px ${MONO}`
  g.globalAlpha = 0.55
  spaced(g, (rightLabel ?? period(r)).toUpperCase(), W - 96, 113, 2)
  g.globalAlpha = 1
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
}

let ICON: HTMLCanvasElement | null = null

function footer(g: CanvasRenderingContext2D, r: Report, p: Palette, right = 'npx lore-wrapped') {
  const a = r.archetype
  const y = H - 112
  g.strokeStyle = p.muted
  g.lineWidth = 2
  g.setLineDash([4, 8])
  line(g, 96, y - 50, W - 96, y - 50)
  g.setLineDash([])
  if (ICON) g.drawImage(ICON, 70, y - 50, 100, 100)
  g.fillStyle = p.ink
  g.font = `500 24px ${SANS}`
  g.fillText(a.name, 176, y - 6)
  g.globalAlpha = 0.6
  g.font = `400 20px ${MONO}`
  spaced(g, `${a.numeral} · ${a.code}`, 176, y + 22, 2)
  g.globalAlpha = 1
  g.textAlign = 'right'
  g.font = `500 24px ${MONO}`
  g.fillText(right, W - 96, y + 8)
  g.textAlign = 'left'
}

/** Big statement lines; a segment can switch to the accent color. */
function statement(g: CanvasRenderingContext2D, p: Palette, lines: (string | [string, 'accent'])[][], y: number, size = 96, lh = 1.04) {
  for (const segs of lines) {
    let x = 92
    // shrink the line until it fits the frame
    let s = size
    const width = () => segs.reduce((w, seg) => (g.font = `300 ${s}px ${SANS}`, w + g.measureText(typeof seg === 'string' ? seg : seg[0]).width), 0)
    while (width() > W - 184 && s > 40) s -= 2
    g.font = `300 ${s}px ${SANS}`
    ;(g as any).letterSpacing = `${-s * 0.035}px`
    for (const seg of segs) {
      const text = typeof seg === 'string' ? seg : seg[0]
      g.fillStyle = typeof seg === 'string' ? p.ink : p.accent
      g.fillText(text, x, y)
      x += g.measureText(text).width
    }
    ;(g as any).letterSpacing = '0px'
    y += size * lh
  }
  return y
}

function stats(g: CanvasRenderingContext2D, p: Palette, items: { value: string; label: string; accent?: boolean }[], y: number) {
  const w = (W - 192) / items.length
  items.forEach((it, i) => {
    const x = 96 + i * w
    if (i) {
      g.strokeStyle = p.muted
      g.lineWidth = 2
      line(g, x - 2, y - 6, x - 2, y + 96)
    }
    const pad = i ? 26 : 0
    g.fillStyle = it.accent ? p.accent : p.ink
    fit(g, it.value, w - pad - 14, 64, 300, SANS)
    g.fillText(it.value, x + pad - 3, y + 52)
    g.fillStyle = p.ink
    g.globalAlpha = 0.6
    fit(g, it.label, w - pad - 14, 20, 400, MONO)
    g.fillText(it.label, x + pad, y + 88)
    g.globalAlpha = 1
  })
}

function label(g: CanvasRenderingContext2D, p: Palette, text: string, y: number) {
  g.fillStyle = p.ink
  g.globalAlpha = 0.55
  g.font = `500 20px ${MONO}`
  spaced(g, text.toUpperCase(), 96, y, 4)
  g.globalAlpha = 1
}

function bars(g: CanvasRenderingContext2D, p: Palette, rows: { label: string; value: number; display: string }[], y: number, rowH = 62) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value))
  // The columns fit what's in them: the bars start after the longest label ("you’re absolutely
  // right" runs past the usual 420) and end before the widest number, keeping a bar at least
  // 280 wide; a label longer than that shrinks, and past the smallest size, ends in an ellipsis.
  const GAP = 32
  g.font = `400 26px ${MONO}`
  const widest = (xs: string[]) => Math.max(0, ...xs.map((s) => g.measureText(s).width))
  const x1 = W - 96 - Math.max(120, widest(rows.map((r) => r.display)) + GAP)
  const x0 = Math.min(x1 - 280, Math.max(420, 96 + widest(rows.map((r) => r.label)) + GAP))
  const wMax = x1 - x0
  rows.forEach((r, i) => {
    const yy = y + i * rowH
    g.fillStyle = p.ink
    fit(g, r.label, x0 - 96 - GAP, 26, 400, MONO)
    let text = r.label
    while (text.length > 1 && g.measureText(text).width > x0 - 96 - GAP) text = `${text.slice(0, -2)}…`
    g.fillText(text, 96, yy + 22)
    g.font = `400 26px ${MONO}`
    g.fillStyle = p.muted
    roundRect(g, x0, yy + 4, wMax, 22, 4)
    g.fill()
    g.fillStyle = i === 0 ? p.accent : p.ink
    roundRect(g, x0, yy + 4, Math.max(6, (wMax * r.value) / max), 22, 4)
    g.fill()
    g.fillStyle = p.ink
    g.textAlign = 'right'
    g.fillText(r.display, W - 96, yy + 22)
    g.textAlign = 'left'
  })
}

// ───────────────────────── cards

const made = new Map<string, Promise<HTMLCanvasElement>>()

export function renderCard(kind: CardKind, r: Report): Promise<HTMLCanvasElement> {
  const id = `${r.generatedAt}:${kind}`
  if (!made.has(id)) made.set(id, draw(kind, r))
  return made.get(id)!
}

const images = new Map<string, Promise<{ blob: Blob; url: string }>>()

/** A card as a PNG blob and an object URL, encoded off the main thread. */
export function cardImage(kind: CardKind, r: Report): Promise<{ blob: Blob; url: string }> {
  const id = `${r.generatedAt}:${kind}`
  if (!images.has(id))
    images.set(
      id,
      renderCard(kind, r).then(
        (c) => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve({ blob: b, url: URL.createObjectURL(b) }) : reject(new Error('encode failed'))), 'image/png')),
      ),
    )
  return images.get(id)!
}

export const STORY_H = 1920
const stories = new Map<string, Promise<{ blob: Blob; url: string }>>()

/**
 * The same card for stories, 1080×1920: drawn at 88% between the bands Instagram and
 * TikTok cover with their own controls, on the card's own background, with the command
 * underneath so a story carries it without a link.
 */
export function storyImage(kind: CardKind, r: Report): Promise<{ blob: Blob; url: string }> {
  const id = `${r.generatedAt}:${kind}`
  if (!stories.has(id))
    stories.set(
      id,
      renderCard(kind, r).then((card) => {
        const c = document.createElement('canvas')
        c.width = W
        c.height = STORY_H
        const g = c.getContext('2d')!
        const [cr, cg, cb] = card.getContext('2d')!.getImageData(8, 8, 1, 1).data
        const dark = 0.299 * cr + 0.587 * cg + 0.114 * cb < 128
        const ink = dark ? '#f6f1e8' : '#0b0b0a'
        g.fillStyle = `rgb(${cr},${cg},${cb})`
        g.fillRect(0, 0, W, STORY_H)
        const s = 0.88
        const cw = W * s
        const ch = H * s
        const x = (W - cw) / 2
        const y = 330
        g.save()
        g.shadowColor = dark ? 'rgba(0,0,0,0.5)' : 'rgba(40,30,20,0.18)'
        g.shadowBlur = 70
        g.shadowOffsetY = 26
        g.fillStyle = `rgb(${cr},${cg},${cb})`
        roundRect(g, x, y, cw, ch, 30)
        g.fill()
        g.restore()
        g.save()
        roundRect(g, x, y, cw, ch, 30)
        g.clip()
        g.drawImage(card, x, y, cw, ch)
        g.restore()
        g.fillStyle = ink
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.globalAlpha = 0.6
        g.font = `400 26px ${MONO}`
        spaced(g, `MY ${period(r).toUpperCase()} WITH AGENTS`, W / 2, y - 64, 3)
        g.globalAlpha = 1
        g.font = `500 44px ${MONO}`
        g.fillText('npx lore-wrapped', W / 2, y + ch + 92)
        return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve({ blob: b, url: URL.createObjectURL(b) }) : reject(new Error('encode failed'))), 'image/png'))
      }),
    )
  return stories.get(id)!
}

async function draw(kind: CardKind, r: Report): Promise<HTMLCanvasElement> {
  await fontsReady()
  ICON = await icon(r.archetype.key, 840)
  const c = document.createElement('canvas')
  // the grid holds nine cards, so it's drawn at twice the size to keep each one legible
  const S = kind === 'grid' ? 2 : 1
  c.width = W * S
  c.height = H * S
  const g = c.getContext('2d')!
  if (kind === 'grid') {
    await gridCard(g, r, S)
    return c
  }
  const fn = { type: typeCard, numbers: numbersCard, model: modelCard, words: wordsCard, overtime: overtimeCard, swear: swearCard, said: saidCard, steer: steerCard, bill: billCard, limits: limitsCard, babysitter: babysitterCard, forgot: forgotCard }[kind]
  fn(g, r)
  return c
}

/** Nine cards in one image: 3 × 3 at the same 4:5 shape. */
async function gridCard(g: CanvasRenderingContext2D, r: Report, S: number) {
  const kinds = availableCards(r).filter((k) => k !== 'grid').slice(0, 9)
  const w = W * S
  const h = H * S
  const gap = 12 * S
  const cw = (w - gap * 4) / 3
  const ch = cw * (H / W)
  const top = (h - ch * 3 - gap * 2) / 2
  g.fillStyle = '#0b0b0a'
  g.fillRect(0, 0, w, h)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  for (let i = 0; i < 9; i++) {
    const x = gap + (i % 3) * (cw + gap)
    const y = top + Math.floor(i / 3) * (ch + gap)
    g.save()
    g.beginPath()
    g.roundRect(x, y, cw, ch, 12 * S)
    g.clip()
    if (kinds[i]) {
      // a macrotask between cells, so nine renders never block scrolling as one
      await new Promise((res) => setTimeout(res, 0))
      g.drawImage(await renderCard(kinds[i], r), x, y, cw, ch)
    } else {
      // an empty slot carries the mark and the invitation
      g.fillStyle = '#161513'
      g.fillRect(x, y, cw, ch)
      drawMark(g, x + cw / 2, y + ch / 2 - 24 * S, 96 * S, '#f6f1e8', '#ff6a2b')
      g.fillStyle = '#f6f1e8'
      g.globalAlpha = 0.7
      g.font = `500 ${18 * S}px ${MONO}`
      g.textAlign = 'center'
      g.fillText('npx lore-wrapped', x + cw / 2, y + ch / 2 + 62 * S)
      g.textAlign = 'left'
      g.globalAlpha = 1
    }
    g.restore()
  }
}

function modelCard(g: CanvasRenderingContext2D, r: Report) {
  const ms = r.favoriteModels
  const top = ms[0]
  const claude = top.source === 'claude-code'
  const p = claude ? { bg: '#fbf4ef', ink: '#1f0f08', accent: '#d4552a', muted: '#ecd9cd' } : { bg: '#f1f5fb', ink: '#0d1424', accent: '#2f5fb3', muted: '#d0d9ea' }
  frame(g, r, p)
  let y = statement(g, p, [['My model:'], [[top.label, 'accent']]], 300, 104)
  y += 10
  stats(
    g,
    p,
    [
      { value: pct(top.share), label: 'of every token', accent: true },
      { value: big(top.tokens), label: 'tokens it processed' },
      { value: top.usd != null ? `$${big(top.usd)}` : '—', label: 'API-equivalent' },
    ],
    y,
  )
  label(g, p, 'the runners-up', y + 200)
  bars(
    g,
    p,
    ms.slice(1, 6).map((m) => ({ label: m.label, value: m.share, display: pct(m.share) })),
    y + 240,
    58,
  )
  footer(g, r, p)
}

function wordsCard(g: CanvasRenderingContext2D, r: Report) {
  const p = { bg: '#f7f5ee', ink: '#14130f', accent: '#5f7a45', muted: '#dcdcce' }
  frame(g, r, p)
  const w = r.topWords[0]
  let y = statement(g, p, [['My most used word:'], [[`“${w.word}”`, 'accent']]], 300, 104)
  g.fillStyle = p.ink
  g.globalAlpha = 0.6
  g.font = `400 26px ${MONO}`
  g.fillText(`${big(w.count)} times, to an AI`, 96, y + 4)
  g.globalAlpha = 1
  label(g, p, 'and the rest of my vocabulary', y + 70)
  bars(
    g,
    p,
    r.topWords.slice(1, 9).map((x) => ({ label: x.word, value: x.count, display: big(x.count) })),
    y + 110,
    56,
  )
  footer(g, r, p)
}

function typeCard(g: CanvasRenderingContext2D, r: Report) {
  const a = r.archetype
  const p = PALETTES[a.key] || PALETTES.editor
  frame(g, r, p, `the lore deck · № ${a.numeral}`)
  // the figure: dial, crosshair, the object, its caption
  const S = 760
  const fx = (W - S) / 2
  const fy = 168
  const cx = W / 2
  const cy = fy + S / 2
  g.save()
  g.strokeStyle = p.muted
  g.lineWidth = 2
  g.setLineDash([3, 9])
  line(g, 96, cy, W - 96, cy)
  line(g, cx, fy - 10, cx, fy + S + 10)
  g.setLineDash([])
  g.beginPath()
  g.arc(cx, cy, S * 0.4, 0, Math.PI * 2)
  g.stroke()
  g.setLineDash([2, 7])
  g.beginPath()
  g.arc(cx, cy, S * 0.27, 0, Math.PI * 2)
  g.stroke()
  g.setLineDash([])
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2
    const r1 = S * (i % 12 === 0 ? 0.365 : i % 4 === 0 ? 0.38 : 0.388)
    line(g, cx + Math.cos(t) * r1, cy + Math.sin(t) * r1, cx + Math.cos(t) * S * 0.4, cy + Math.sin(t) * S * 0.4)
  }
  g.restore()
  if (ICON) g.drawImage(ICON, fx, fy, S, S)
  // the callout: the number that dealt this card
  const sig = signature(r)
  g.strokeStyle = p.ink
  g.globalAlpha = 0.35
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(cx + S * 0.2, cy - S * 0.2)
  g.lineTo(cx + S * 0.27, cy - S * 0.33)
  g.lineTo(W - 110, cy - S * 0.33)
  g.stroke()
  g.globalAlpha = 1
  g.textAlign = 'right'
  g.fillStyle = p.accent
  g.font = `500 64px ${SANS}`
  g.fillText(sig.value, W - 110, cy - S * 0.33 - 22)
  g.fillStyle = p.ink
  g.globalAlpha = 0.6
  g.font = `400 19px ${MONO}`
  spaced(g, sig.label.toUpperCase(), W - 110, cy - S * 0.33 + 34, 2)
  spaced(g, `FIG. ${a.numeral} — ${(OBJECTS[a.key] || a.key).toUpperCase()}`, W - 110, fy + S - 8, 2)
  g.globalAlpha = 1
  g.textAlign = 'left'
  // name, tagline
  g.fillStyle = p.ink
  fit(g, a.name, W - 192, 124, 300, SANS)
  ;(g as any).letterSpacing = '-5px'
  g.fillText(a.name, 90, 1052)
  ;(g as any).letterSpacing = '0px'
  g.globalAlpha = 0.75
  fit(g, a.tagline, W - 192, 36, 400, SANS, 'italic ')
  g.fillText(a.tagline, 96, 1100)
  g.globalAlpha = 1
  // Real people stay off share cards: a branded image that spreads lore shouldn't carry
  // anyone's name. The tech twin lives in the report.
  // the four letters and the invitation
  g.strokeStyle = p.muted
  g.lineWidth = 2
  g.setLineDash([4, 8])
  line(g, 96, 1164, W - 96, 1164)
  g.setLineDash([])
  a.codeLegend.forEach((l, i) => {
    const x = 96 + i * 82
    const y = 1190
    roundRect(g, x, y, 68, 68, 14)
    if (i === 0) {
      g.fillStyle = p.accent
      g.fill()
    } else {
      g.strokeStyle = p.muted
      g.stroke()
    }
    g.fillStyle = i === 0 ? p.bg : p.ink
    g.textAlign = 'center'
    g.font = `500 32px ${MONO}`
    g.fillText(l.letter, x + 34, y + 45)
    g.textAlign = 'left'
  })
  g.fillStyle = p.ink
  g.globalAlpha = 0.6
  g.font = `400 19px ${MONO}`
  spaced(g, a.codeLegend.map((l) => l.word.toUpperCase()).join(' · '), 440, 1218, 2)
  g.globalAlpha = 1
  g.font = `500 24px ${MONO}`
  g.fillText('npx lore-wrapped', 440, 1254)
  g.textAlign = 'right'
  g.globalAlpha = 0.55
  g.fillText('what’s your card?', W - 96, 1254)
  g.globalAlpha = 1
  g.textAlign = 'left'
}

function numbersCard(g: CanvasRenderingContext2D, r: Report) {
  const p = NEUTRAL
  frame(g, r, p)
  statement(g, p, [['My year'], [['with agents.', 'accent']]], 290, 104)
  const d = r.deep
  const cells = [
    { value: big(r.totals.prompts), label: 'prompts sent' },
    { value: big(r.totals.activeDays), label: 'days at it' },
    { value: hours(r), label: d.work.agentHoursFloor ? 'hours agents worked, timed' : 'hours agents worked' },
    { value: `+${big(d.work.linesAdded)}`, label: 'lines agents wrote' },
    { value: big(r.spend.tokens || d.tokens.input + d.tokens.cached + d.tokens.output), label: 'tokens' },
    { value: `${r.streak.days}d`, label: 'longest streak' },
  ]
  cells.forEach((cell, i) => {
    const x = 96 + (i % 2) * 460
    const y = 470 + Math.floor(i / 2) * 176
    g.strokeStyle = p.muted
    g.lineWidth = 2
    line(g, x, y, x + 420, y)
    g.fillStyle = p.ink
    fit(g, cell.value, 410, 92, 300, SANS)
    g.fillText(cell.value, x - 4, y + 98)
    g.globalAlpha = 0.6
    g.font = `400 21px ${MONO}`
    g.fillText(cell.label, x, y + 136)
    g.globalAlpha = 1
  })
  footer(g, r, p)
}

function overtimeCard(g: CanvasRenderingContext2D, r: Report) {
  const p = { bg: '#131312', ink: '#f2f2ee', accent: '#f5b301', muted: '#363633' }
  frame(g, r, p)
  const w = r.deep.work
  let y = statement(g, p, [['My agents worked'], [[`${hours(r)} hours`, 'accent']], ['for me.']], 290, 104)
  y += 30
  // a floor says so: what the untimed prompts would add, and the subagents' hours on top
  const est = w.agentHoursFloor && w.agentHoursEst >= w.agentHours * 1.05
  stats(
    g,
    p,
    [
      { value: w.longestTurn ? `${(w.longestTurn.min / 60).toFixed(1)}h` : '—', label: 'longest single run', accent: true },
      est ? { value: `${about(w.agentHoursEst)}h`, label: 'est. with untimed prompts' } : { value: `${w.agentMinutesPerPrompt.toFixed(1)}m`, label: 'agent time per prompt' },
      w.subagentHours >= 1 ? { value: `+${big(w.subagentHours)}h`, label: 'more in subagents' } : { value: big(w.commands.total), label: 'commands they ran' },
    ],
    y + 20,
  )
  label(g, p, w.agentHoursFloor ? `who did the hours · timed on ${Math.round((w.perPromptBasis.timed / w.perPromptBasis.prompts) * 100)}% of prompts` : 'who did the hours', y + 220)
  bars(
    g,
    p,
    SOURCE_KEYS.filter((s) => w.agentHoursBySource[s] > 0)
      .map((s) => ({ label: sourceLabel(s), value: w.agentHoursBySource[s], display: `${big(w.agentHoursBySource[s])}h` }))
      .sort((a, b) => b.value - a.value),
    y + 260,
  )
  footer(g, r, p)
}

function swearCard(g: CanvasRenderingContext2D, r: Report) {
  const p = DARK
  frame(g, r, p)
  const s = r.deep.swear
  const top = s.words[0]
  let y = 290
  if (top) {
    y = statement(g, p, [['I said'], [[`“${top.word}”`, 'accent']], [`to an AI ${big(top.count)} times.`]], y, 110)
  } else y = statement(g, p, [['Not one swear.'], ['Not even at Codex.']], y)
  bars(g, p, s.words.slice(0, 5).map((w) => ({ label: w.word, value: w.count, display: big(w.count) })), y + 20)
  stats(
    g,
    p,
    [
      { value: s.per100.toFixed(1), label: 'swears / 100 prompts' },
      { value: big(s.allCaps), label: 'messages in ALL CAPS' },
      { value: big(s.prompts), label: 'prompts with a swear', accent: true },
    ],
    H - 330,
  )
  footer(g, r, p, 'they said it first')
}

/** What the agents kept telling you: their words, never yours. */
function saidCard(g: CanvasRenderingContext2D, r: Report) {
  const p = BLUE
  frame(g, r, p)
  const e = r.extras
  const top = e.catchphrases[0]
  const y = statement(g, p, [['My agents told me'], [[`“${top.label}”`, 'accent']], [`${big(top.count)} times.`]], 290, 92)
  bars(g, p, e.catchphrases.slice(0, 5).map((c) => ({ label: c.label.toLowerCase(), value: c.count, display: big(c.count) })), y + 20, 58)
  const models = Object.entries(top.byModel).filter(([m]) => m !== 'unknown').sort((a, b) => b[1] - a[1])
  stats(
    g,
    p,
    [
      { value: big(e.replies), label: 'agent replies read' },
      ...(e.parallel ? [{ value: String(e.parallel.peak), label: 'agents at once, max' }] : []),
      ...(models[0] ? [{ value: prettyModel(models[0][0]).replace(/^Claude /, ''), label: 'said it most', accent: true }] : []),
    ],
    H - 330,
  )
  footer(g, r, p)
}

function steerCard(g: CanvasRenderingContext2D, r: Report) {
  const p = BLUE
  frame(g, r, p)
  const rate = r.steering.rate
  const k = rate > 0 ? Math.max(1, Math.round(1 / rate)) : 0
  const y = statement(g, p, [[k ? `1 in ${k} of my` : 'I almost never'], ['follow-ups'], [['redirect the agent.', 'accent']]], 290, 98)
  label(g, p, 'what I say most', y + 10)
  bars(g, p, r.steering.themes.slice(0, 5).map((t) => ({ label: t.label.toLowerCase(), value: t.count, display: big(t.count) })), y + 50, 58)
  stats(
    g,
    p,
    [
      { value: big(r.totals.steers), label: 'redirects' },
      { value: `${Math.round(r.deep.timeToSteer.medianSec)}s`, label: 'median time to redirect' },
      { value: String(r.deep.chains.longest), label: 'redirects in a row, max', accent: true },
    ],
    H - 330,
  )
  footer(g, r, p)
}

/** API-equivalent value as a multiple of plan cost: "17×", or a range when the tier is unknown. */
export function multiple(usd: number, lo: number, hi: number): string {
  const f = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''))
  return lo === hi || f(usd / hi) === f(usd / lo) ? `${f(usd / lo)}×` : `${f(usd / hi)}–${f(usd / lo)}×`
}

function billCard(g: CanvasRenderingContext2D, r: Report) {
  const p = { bg: '#e8e5dd', ink: '#16130e', accent: '#e0531f', muted: '#cfcabe' }
  frame(g, r, p, 'the bill')
  const sp = r.spend
  const usd = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`
  // the paper
  const x0 = 170
  const x1 = W - 170
  const top = 190
  const bottom = 1120
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.12)'
  g.shadowBlur = 30
  g.shadowOffsetY = 10
  g.fillStyle = '#fffdf8'
  g.beginPath()
  g.moveTo(x0, top)
  g.lineTo(x1, top)
  g.lineTo(x1, bottom)
  for (let x = x1; x > x0; x -= 24) {
    g.lineTo(x - 12, bottom + 14)
    g.lineTo(Math.max(x0, x - 24), bottom)
  }
  g.closePath()
  g.fill()
  g.restore()
  const L = x0 + 56
  const R = x1 - 56
  const row = (left: string, right: string, y: number, opts: { bold?: boolean; accent?: boolean; dim?: boolean; size?: number } = {}) => {
    g.fillStyle = opts.accent ? p.accent : p.ink
    g.globalAlpha = opts.dim ? 0.55 : 1
    g.font = `${opts.bold ? 500 : 400} ${opts.size ?? 24}px ${MONO}`
    g.textAlign = 'left'
    g.fillText(left, L, y)
    g.textAlign = 'right'
    g.fillText(right, R, y)
    g.textAlign = 'left'
    g.globalAlpha = 1
  }
  const rule = (y: number) => {
    g.strokeStyle = p.ink
    g.globalAlpha = 0.35
    g.lineWidth = 2
    g.setLineDash([6, 8])
    line(g, L, y, R, y)
    g.setLineDash([])
    g.globalAlpha = 1
  }
  g.fillStyle = p.ink
  g.textAlign = 'center'
  g.font = `500 30px ${MONO}`
  spaced(g, 'AGENTS, ITEMIZED', W / 2, top + 76, 6)
  g.globalAlpha = 0.55
  g.font = `400 20px ${MONO}`
  g.fillText(`${period(r)} · ${big(sp.tokens)} tokens`, W / 2, top + 114)
  g.globalAlpha = 1
  g.textAlign = 'left'
  rule(top + 150)
  let y = top + 200
  const items = sp.models.filter((m) => m.usd != null).slice(0, 8)
  for (const m of items) {
    row(m.model, usd(m.usd!), y)
    y += 44
  }
  const rest = sp.models.filter((m) => m.usd != null).slice(8).reduce((s, m) => s + (m.usd || 0), 0)
  if (rest > 0) {
    row(`${sp.models.filter((m) => m.usd != null).length - 8} more models`, usd(rest), y, { dim: true })
    y += 44
  }
  rule(y - 10)
  y += 40
  row('API-EQUIVALENT', usd(sp.totalUsd), y, { bold: true, size: 30 })
  y += 54
  const paid = sp.plans.filter((x) => x.paidUsd)
  if (paid.length) {
    const lo = paid.reduce((s, x) => s + x.paidUsd![0], 0)
    const hi = paid.reduce((s, x) => s + x.paidUsd![1], 0)
    row('PLANS, EST.', lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}`, y, { dim: true })
    y += 54
    row('ABSORBED', lo === hi ? usd(sp.totalUsd - lo) : `≈${usd(sp.totalUsd - hi)}+`, y, { bold: true, accent: true, size: 34 })
    y += 54
    row('WHAT I PAID, TIMES', multiple(sp.totalUsd, lo, hi), y, { bold: true, size: 30 })
    y += 30
  }
  g.globalAlpha = 0.5
  g.textAlign = 'center'
  g.font = `400 16px ${MONO}`
  g.fillText(`list API prices, ${sp.asOf} · an estimate, not a bill`, W / 2, bottom - 40)
  g.globalAlpha = 1
  g.textAlign = 'left'
  footer(g, r, p)
}

function limitsCard(g: CanvasRenderingContext2D, r: Report) {
  const p = { bg: '#fbf4f2', ink: '#1f0a06', accent: '#d6331f', muted: '#ead6d0' }
  frame(g, r, p)
  const l = r.deep.limits!
  const y = statement(g, p, [['I hit my'], ['Codex limit'], [[`${l.windowsAtLimit} times.`, 'accent']]], 290, 112)
  label(g, p, 'peak of each weekly window', y + 20)
  const weeks = l.weeklyPeaks.slice(-26)
  const x0 = 96
  const wAll = W - 192
  const bw = wAll / Math.max(1, weeks.length)
  const base = y + 360
  g.strokeStyle = p.accent
  g.setLineDash([6, 6])
  line(g, x0, base - 260, x0 + wAll, base - 260)
  g.setLineDash([])
  g.fillStyle = p.accent
  g.font = `400 18px ${MONO}`
  g.fillText('100%', x0, base - 272)
  weeks.forEach((w, i) => {
    const h = (Math.min(100, w.used) / 100) * 260
    g.fillStyle = w.used >= 100 ? p.accent : p.ink
    g.globalAlpha = w.used >= 100 ? 1 : 0.8
    roundRect(g, x0 + i * bw + 3, base - h, bw - 6, h, 4)
    g.fill()
    g.globalAlpha = 1
  })
  stats(
    g,
    p,
    [
      { value: String(l.weeksAtLimit), label: 'weeks maxed out', accent: true },
      { value: `${Math.max(...weeks.map((w) => w.used))}%`, label: 'highest weekly peak' },
      { value: l.plan || '—', label: 'plan' },
    ],
    H - 330,
  )
  footer(g, r, p)
}

function babysitterCard(g: CanvasRenderingContext2D, r: Report) {
  const p = NEUTRAL
  frame(g, r, p)
  const ms = r.deep.steeringByModel
  const top = ms[0]
  const y = statement(g, p, [[[top.model, 'accent']], ['needed the most'], ['babysitting.']], 290, 100)
  label(g, p, 'how often I redirected each model', y + 10)
  bars(g, p, ms.slice(0, 6).map((m) => ({ label: m.model, value: m.rate, display: pct(m.rate) })), y + 50, 58)
  g.fillStyle = p.ink
  g.globalAlpha = 0.55
  g.font = `400 20px ${MONO}`
  g.fillText('my history with each model, not a benchmark', 96, H - 190)
  g.globalAlpha = 1
  footer(g, r, p)
}

function forgotCard(g: CanvasRenderingContext2D, r: Report) {
  const p = { bg: '#f2f7f7', ink: '#08201f', accent: '#0f8a83', muted: '#d0dfdd' }
  frame(g, r, p)
  const y = statement(g, p, [['Things I forgot'], [['until lore found them.', 'accent']]], 290, 84)
  forgotLines(r).forEach((l, i) => {
    const yy = y + 40 + i * 168
    g.strokeStyle = p.muted
    g.lineWidth = 2
    line(g, 96, yy, W - 96, yy)
    g.fillStyle = p.ink
    fit(g, l.big, W - 200, 88, 300, SANS)
    g.fillText(l.big, 92, yy + 100)
    g.globalAlpha = 0.6
    g.font = `400 22px ${MONO}`
    g.fillText(l.small, 96, yy + 140)
    g.globalAlpha = 1
  })
  footer(g, r, p)
}

// ───────────────────────── helpers

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath()
  g.moveTo(x0, y0)
  g.lineTo(x1, y1)
  g.stroke()
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, Math.max(w, 2), h, r)
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) {
  ;(g as any).letterSpacing = `${px}px`
  g.fillText(text, x, y)
  ;(g as any).letterSpacing = '0px'
}

/** Shrinks the font until text fits the width; leaves g.font set. */
function fit(g: CanvasRenderingContext2D, text: string, width: number, size: number, weight: number, family: string, style = '') {
  let s = size
  g.font = `${style}${weight} ${s}px ${family}`
  while (g.measureText(text).width > width && s > 16) {
    s -= 2
    g.font = `${style}${weight} ${s}px ${family}`
  }
}

/**
 * The same story as plain text, for Reddit, Hacker News and chat, where an image reads
 * like an ad. Counts, the card and single words only, like the images.
 */
export function asText(r: Report): string {
  const a = r.archetype
  const sp = r.spend
  const tools = r.bySource.filter((s) => s.prompts > 0).map((s) => sourceLabel(s.source))
  const paid = sp.plans.filter((p) => p.paidUsd)
  const lo = paid.reduce((s, p) => s + p.paidUsd![0], 0)
  const hi = paid.reduce((s, p) => s + p.paidUsd![1], 0)
  const k = r.steering.rate > 0 ? Math.max(1, Math.round(1 / r.steering.rate)) : 0
  const said = r.extras?.catchphrases[0]
  const swear = r.deep.swear.words[0]
  const lines = [
    'my year with agents, counted by lore',
    `${a.name} · ${a.code}`,
    `${big(r.totals.prompts)} prompts across ${r.totals.activeDays} days, ${tools.join(' + ')}`,
    sp.totalUsd >= 1 ? `$${Math.round(sp.totalUsd).toLocaleString('en-US')} of agents at API prices${paid.length && sp.totalUsd > hi ? `, ${multiple(sp.totalUsd, lo, hi)} what I paid` : ''}` : '',
    k ? `1 in ${k} of my follow-ups redirect the agent` : '',
    said && said.count >= 5 ? `my agents told me “${said.label}” ${said.count} times` : '',
    swear ? `“${swear.word}” ×${swear.count.toLocaleString('en-US')} (they said it first)` : '',
    '',
    `my lore code: ${vsCode(a.key, a.spectra, r.totals.prompts)} (paste it into yours to compare)`,
    'npx lore-wrapped',
  ]
  return lines.filter((l, i) => l || (i > 0 && lines[i - 1])).join('\n')
}
