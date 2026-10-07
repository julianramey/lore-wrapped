// The monthly nudge, as a calendar file the browser builds: lore schedules nothing and hears
// nothing back; the user's own calendar does the reminding.

/** An all-day event on the 1st of every month, starting next month, with a 9am alert. */
export function monthlyReminder(now: Date): string {
  const d = (y: number, m: number) => `${y}${String(m + 1).padStart(2, '0')}01`
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lore//lore-wrapped//EN',
    'BEGIN:VEVENT',
    `UID:monthly-${stamp}@lore-wrapped`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d(next.getFullYear(), next.getMonth())}`,
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=1',
    'SUMMARY:Your month with agents (lore)',
    'DESCRIPTION:Run npx lore-wrapped@latest in a terminal to see last month.',
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT9H',
    'DESCRIPTION:Your month with agents: npx lore-wrapped@latest',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}
