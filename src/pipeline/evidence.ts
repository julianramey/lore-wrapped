import type { EvidenceView } from '../report-types.ts'
import type { ClassifiedThread } from './classify.ts'

/** Up to three messages either side of one event, with the rule that classified each prompt. */
export function evidenceView(ct: ClassifiedThread, ev: number): EvidenceView {
  const t = ct.thread
  const kinds = new Map(ct.humans.map((h) => [h.idx, h.c]))
  const from = Math.max(0, ev - 3)
  const to = Math.min(t.events.length, ev + 4)
  return {
    thread: `${t.source}:${t.id}`,
    title: t.title || '',
    project: t.project,
    source: t.source,
    file: t.file,
    focus: ev,
    events: t.events.slice(from, to).map((e, i) => {
      const idx = from + i
      if (e.k === 'h') return { idx, k: 'h', t: e.t, text: e.text, ln: e.ln, afterInterrupt: e.afterInterrupt, kind: kinds.get(idx)?.kind, rule: kinds.get(idx)?.rule }
      return { idx, k: 'a', t: e.t, text: e.text, ln: e.ln, tools: e.tools, toolNames: [...new Set(e.toolNames)].slice(0, 8) }
    }),
  }
}
