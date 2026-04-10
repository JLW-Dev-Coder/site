import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Notifications' }

export default function NotificationsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Notifications</h1>
      <p className="mt-1 text-sm text-white/50">
        Stay up to date on activity.
      </p>
    </div>
  )
}
