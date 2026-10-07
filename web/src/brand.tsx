import { MARK } from './mark.ts'

// lore's mark: a ring of bars, one waveform, its peak in the accent.
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg class="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g stroke-width={MARK.width} stroke-linecap="round">
        {MARK.bars.map(([x1, y1, x2, y2], i) => (
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={i === MARK.accent ? 'var(--accent)' : 'currentColor'} />
        ))}
      </g>
      <circle cx="16" cy="16" r={MARK.dot} fill="currentColor" />
    </svg>
  )
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span class="wordmark" style={{ fontSize: `${size}px` }}>
      <Mark size={Math.round(size * 1.1)} />
      lore
    </span>
  )
}
