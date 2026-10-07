// A lore deck card as DOM: the object, drawn like a spec sheet. Used by the report's
// reveal and the homepage deck. The icon renders lazily, once the card is on screen.

import { icon } from './icons/render.ts'
import { OBJECTS } from './icons/scenes.ts'
import { PALETTES } from './palettes.ts'

export interface DeckCardData {
  key: string
  numeral: string
  name: string
  tagline: string
  /** Four-letter code chips; the first is highlighted. */
  code?: { letter: string; word: string }[]
  /** One measured callout pointing at the object: [label, value]. */
  callout?: [string, string]
  /** A line under the name, e.g. the rule that deals this card. */
  foot?: string
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const DIAL = (() => {
  let ticks = ''
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const r1 = i % 12 === 0 ? 36.5 : i % 4 === 0 ? 38 : 38.8
    ticks += `<line x1="${(50 + Math.cos(a) * r1).toFixed(2)}" y1="${(50 + Math.sin(a) * r1).toFixed(2)}" x2="${(50 + Math.cos(a) * 40).toFixed(2)}" y2="${(50 + Math.sin(a) * 40).toFixed(2)}"/>`
  }
  return `<svg class="lc-dial" viewBox="0 0 100 100" aria-hidden="true">
    <line class="lc-cross" x1="0" y1="50" x2="100" y2="50"/><line class="lc-cross" x1="50" y1="0" x2="50" y2="100"/>
    <circle cx="50" cy="50" r="40"/><circle class="lc-inner" cx="50" cy="50" r="27"/>
    <g>${ticks}</g>
  </svg>`
})()

export function deckCardEl(d: DeckCardData): HTMLElement {
  const p = PALETTES[d.key] || PALETTES.editor
  const el = document.createElement('div')
  el.className = 'lcard'
  el.style.setProperty('--c-bg', p.bg)
  el.style.setProperty('--c-ink', p.ink)
  el.style.setProperty('--c-accent', p.accent)
  el.style.setProperty('--c-muted', p.muted)
  el.innerHTML = `<div class="lc-in">
    <div class="lc-top"><span>The lore deck</span><span>№ ${esc(d.numeral)}</span></div>
    <div class="lc-fig">
      ${DIAL}
      <div class="lc-icon"></div>
      ${
        d.callout
          ? `<div class="lc-call"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,100 30,40 100,40"/></svg><span>${esc(d.callout[0])}</span><b>${esc(d.callout[1])}</b></div>`
          : ''
      }
      <span class="lc-figcap">fig. ${esc(d.numeral)} — ${esc(OBJECTS[d.key] || d.key)}</span>
    </div>
    <div class="lc-name${d.name.length > 15 ? ' long' : ''}">${esc(d.name)}</div>
    <div class="lc-tag">${esc(d.tagline)}</div>
    <div class="lc-foot">${
      d.code
        ? `<span class="lc-code">${d.code.map((c, i) => `<span class="${i === 0 ? 'on' : ''}" title="${esc(c.word)}">${esc(c.letter)}</span>`).join('')}</span><span class="lc-words">${esc(d.code.map((c) => c.word).join(' · '))}</span>`
        : `<span class="lc-words">${esc(d.foot || '')}</span>`
    }</div></div>`
  mountIcon(el, d.key)
  return el
}

/** One icon at a time, in idle moments, so a page full of cards never stalls a scroll. */
const queue: (() => Promise<void>)[] = []
let running = false
function enqueue(job: () => Promise<void>) {
  queue.push(job)
  if (running) return
  running = true
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? (window as any).requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 16))
  const next = () => {
    const j = queue.shift()
    if (!j) return void (running = false)
    idle(() => j().finally(next))
  }
  next()
}

/** Renders the object well before the card scrolls into view, at its on-screen size. */
function mountIcon(card: HTMLElement, key: string) {
  const host = card.querySelector('.lc-icon') as HTMLElement
  const go = () =>
    enqueue(async () => {
      const w = host.getBoundingClientRect().width || 240
      const px = Math.min(960, Math.ceil((w * (window.devicePixelRatio || 1)) / 120) * 120)
      const c = await icon(key, px)
      const img = c.cloneNode() as HTMLCanvasElement
      img.getContext('2d')!.drawImage(c, 0, 0)
      host.replaceChildren(img)
      card.classList.add('lit')
    })
  if (!('IntersectionObserver' in window)) return go()
  const io = new IntersectionObserver(
    (es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect()
        go()
      }
    },
    { rootMargin: '1500px 0px' },
  )
  io.observe(card)
}
