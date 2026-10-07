// Card colors per deck card. Paper, unless the card is a night creature.

export interface Palette {
  bg: string
  ink: string
  accent: string
  muted: string
}

export const PALETTES: Record<string, Palette> = {
  editor: { bg: '#fbfaf7', ink: '#0b0b0a', accent: '#e0531f', muted: '#d8d5cc' },
  delegator: { bg: '#f2f7f2', ink: '#0f1a12', accent: '#1f7a45', muted: '#c9d6cb' },
  architect: { bg: '#f1f5fb', ink: '#0d1424', accent: '#2f5fb3', muted: '#c8d1e2' },
  sniper: { bg: '#fdfaf6', ink: '#0b0b0a', accent: '#d2491c', muted: '#ddd5ca' },
  night: { bg: '#0c0f20', ink: '#eef0ff', accent: '#9aacff', muted: '#2a3156' },
  day: { bg: '#fcf6e8', ink: '#1d1708', accent: '#c98500', muted: '#e6dbbd' },
  conductor: { bg: '#f7f5fd', ink: '#0d0b14', accent: '#6a3fd6', muted: '#d8d1ec' },
  loyalist: { bg: '#fcf4f1', ink: '#200d06', accent: '#c7343f', muted: '#ecd5cd' },
  marathoner: { bg: '#f0f7f6', ink: '#08201f', accent: '#0f8a83', muted: '#c4dad7' },
  sprinter: { bg: '#fdf6f9', ink: '#0b0b0a', accent: '#d4317a', muted: '#ecd2de' },
  volcano: { bg: '#120c09', ink: '#fbeee6', accent: '#ff5b1f', muted: '#3d2c23' },
  monk: { bg: '#f4f5ef', ink: '#1a1a16', accent: '#5f7a45', muted: '#d6d9ca' },
  foreman: { bg: '#141413', ink: '#f2f2ee', accent: '#f5b301', muted: '#3a3a36' },
  pair: { bg: '#f6f9fe', ink: '#0b0b0a', accent: '#2f5fb3', muted: '#d0d9ea' },
}
