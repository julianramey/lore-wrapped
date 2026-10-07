import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import type { EvidenceRef, EvidenceView, Example } from '../../src/report-types.ts'
import { api } from './api.ts'
import { fmtDate, SOURCE_LABEL, sourceVar } from './format.ts'

export const EvidenceContext = createContext<(ref: EvidenceRef) => void>(() => {})
export const useEvidence = () => useContext(EvidenceContext)

/** A real message from your history, with where it came from and a way back to it. */
export function Quote({ ex, loud }: { ex: Example; loud?: boolean }) {
  const open = useEvidence()
  return (
    <figure class={`quote ${loud ? 'loud' : ''}`}>
      <blockquote>{ex.safe ? `“${ex.text}”` : <span class="muted">Hidden here: contains a slur. Open it to read in context.</span>}</blockquote>
      <figcaption class="meta">
        <i class="dot" style={{ background: sourceVar(ex.source) }} />
        <span>{ex.project}</span>
        <span>·</span>
        <span>{fmtDate(ex.at)}</span>
        <button class="show" onClick={() => open(ex.ref)}>
          in context →
        </button>
      </figcaption>
    </figure>
  )
}

export function EvidenceDrawer({ refv, onClose }: { refv: EvidenceRef; onClose: () => void }) {
  const [view, setView] = useState<EvidenceView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setView(null)
    setErr(null)
    api.evidence(refv.thread, refv.ev).then(setView, (e) => setErr(String(e.message || e)))
  }, [refv.thread, refv.ev])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (view) document.getElementById(`ev-${view.focus}`)?.scrollIntoView({ block: 'center' })
  }, [view])

  return (
    <>
      <div class="scrim" onClick={onClose} />
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Source excerpt">
        <div class="drawer-head">
          <div class="row">
            <div>
              <span class="label">from your history</span>
              <h3>{view?.title || view?.project || '…'}</h3>
            </div>
            <button class="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          {view && (
            <div class="m">
              <span>{view.project}</span>
              <span>·</span>
              <span>{SOURCE_LABEL[view.source]}</span>
              <span>·</span>
              <span title={view.file}>
                {view.file.split(/[\\/]/).slice(-1)[0]}:{view.events.find((e) => e.idx === view.focus)?.ln}
              </span>
              <button class="btn small ghost" onClick={() => api.reveal(view.thread)}>
                reveal file
              </button>
            </div>
          )}
        </div>
        <div class="drawer-body">
          {err && <div class="empty">{err}</div>}
          {!view && !err && (
            <div class="empty">
              <span class="spinner" />
            </div>
          )}
          {view?.events.map((e) => (
            <div id={`ev-${e.idx}`} class={`turn ${e.k === 'a' ? 'agent' : ''} ${e.idx === view.focus ? 'focus' : ''}`}>
              <div class="who">
                {e.k === 'h' ? 'you' : 'agent'}
                {e.k === 'h' && e.kind && (
                  <span class={`kind ${e.kind}`} title={e.rule}>
                    {e.kind === 'followup' ? 'follow-up' : e.kind}
                  </span>
                )}
                {e.afterInterrupt && <span class="kind">after interrupt</span>}
                {e.k === 'a' && e.tools ? <span>· {e.tools} actions</span> : null}
                <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
                  {new Date(e.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div class="bubble">{e.text || <span class="muted">(no visible text — tool actions only)</span>}</div>
            </div>
          ))}
          {view && <p class="note">Up to three messages either side. Agent text is shown head and tail when long; hidden reasoning is never read. Hover a label to see which rule fired.</p>}
        </div>
      </div>
    </>
  )
}
