import { useEffect, useState } from 'preact/hooks'
import type { Report } from '../../src/report-types.ts'
import { asText, availableCards, CARD_LABELS, cardImage, storyImage, type CardKind } from './cards.ts'

export function ShareModal({ report, initial = 'type', onClose, toast }: { report: Report; initial?: string; onClose: () => void; toast: (m: string, err?: boolean) => void }) {
  const kinds = availableCards(report)
  const [kind, setKind] = useState<CardKind>((kinds.includes(initial as CardKind) ? initial : 'type') as CardKind)
  const [format, setFormat] = useState<'post' | 'story'>('post')
  const [url, setUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)

  useEffect(() => {
    let live = true
    setUrl(null)
    ;(format === 'story' ? storyImage : cardImage)(kind, report).then((img) => {
      if (!live) return
      setUrl(img.url)
      setBlob(img.blob)
    })
    return () => {
      live = false
    }
  }, [kind, report, format])
  const size = format === 'story' ? '1080×1920' : '1080×1350'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob! })])
      toast('Card copied')
    } catch {
      toast('Copy isn’t available here — download it instead', true)
    }
  }

  return (
    <div class="modal-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Share cards">
        <div class={`preview ${format}`}>{url ? <img src={url} alt={CARD_LABELS[kind]} /> : <span class="spinner" />}</div>
        <div class="side">
          <span class="label">share</span>
          <h3>
            {report.archetype.name} · <span class="mono">{report.archetype.code}</span>
          </h3>
          <div class="seg" role="group" aria-label="Format">
            <button class={format === 'post' ? 'on' : ''} aria-pressed={format === 'post'} onClick={() => setFormat('post')}>
              Post 4:5
            </button>
            <button class={format === 'story' ? 'on' : ''} aria-pressed={format === 'story'} onClick={() => setFormat('story')}>
              Story 9:16
            </button>
          </div>
          <div class="card-picker">
            {kinds.map((k) => (
              <button aria-pressed={k === kind} onClick={() => setKind(k)}>
                {CARD_LABELS[k]}
                <span>{size}</span>
              </button>
            ))}
          </div>
          <ul class="check-list">
            <li>Counts, your card and its object only</li>
            <li>No project names, quotes, paths or code</li>
            <li>Nothing is uploaded; posting it is up to you</li>
          </ul>
          <div style={{ display: 'flex', gap: '8px' }}>
            <a class="btn primary" href={url || '#'} download={`lore-${kind}${format === 'story' ? '-story' : ''}.png`}>
              Download PNG
            </a>
            <button class="btn" onClick={copy} disabled={!blob}>
              Copy
            </button>
          </div>
          <button
            class="btn ghost"
            title="For Reddit, Hacker News and chat, where images read like ads"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(asText(report))
                toast('Copied as text')
              } catch {
                toast('Copy isn’t available here', true)
              }
            }}
          >
            Copy as text
          </button>
          <button class="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
