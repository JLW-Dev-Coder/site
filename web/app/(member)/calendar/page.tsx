import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Calendar' }

export default function CalendarPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Calendar</h1>
      <p className="mt-1 text-sm text-white/50">
        View and manage your schedule.
      </p>
    </div>
  )
}
