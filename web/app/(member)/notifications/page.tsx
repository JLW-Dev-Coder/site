import type { Metadata } from 'next'
import {
  Ticket,
  CalendarCheck,
  UserCog,
  Coins,
  Bell,
} from 'lucide-react'
import ActivityItem from '../components/ActivityItem'

export const metadata: Metadata = { title: 'Notifications' }

/* ── placeholder data ──────────────────────────────────────────── */

const notificationSettings = [
  {
    icon: Ticket,
    title: 'Support Tickets',
    description: 'Get notified when your tickets are updated or resolved',
    enabled: true,
  },
  {
    icon: CalendarCheck,
    title: 'Booking Reminders',
    description: 'Receive reminders before upcoming calendar bookings',
    enabled: true,
  },
  {
    icon: UserCog,
    title: 'Account Activity',
    description: 'Login alerts, password changes, and security events',
    enabled: false,
  },
  {
    icon: Coins,
    title: 'Token Usage Alerts',
    description: 'Alerts when your token balance is running low',
    enabled: true,
  },
]

const recentNotifications = [
  { title: 'Support ticket #TKT-0042 has been updated — awaiting your response', timestamp: '2 hours ago', dot: 'bg-brand-orange' },
  { title: 'Upcoming booking: Initial Consultation with David Chen tomorrow at 10:00 AM', timestamp: '5 hours ago', dot: 'bg-blue-400' },
  { title: 'Monthly token allocation added: +5 transcript tokens', timestamp: 'Apr 4, 2026', dot: 'bg-emerald-400' },
  { title: 'Your profile has been viewed 12 times this week', timestamp: 'Apr 3, 2026', dot: 'bg-brand-orange' },
  { title: 'New login detected from San Diego, CA (Chrome on Windows)', timestamp: 'Apr 2, 2026', dot: 'bg-white/30' },
]

/* ── toggle component ────────────────────────────────────────── */

function Toggle({ enabled }: { enabled: boolean }) {
  return (
    <button
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-brand-orange' : 'bg-white/10'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

/* ── page ──────────────────────────────────────────────────────── */

export default function NotificationsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Notifications</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage notification preferences and view recent alerts.
        </p>
      </div>

      {/* Notification Settings */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <h3 className="text-xs uppercase tracking-widest text-white/40">Notification Settings</h3>
        <div className="mt-5 divide-y divide-[--member-border]">
          {notificationSettings.map((setting) => {
            const Icon = setting.icon
            return (
              <div key={setting.title} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange/10">
                    <Icon className="h-4 w-4 text-brand-orange" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{setting.title}</p>
                    <p className="text-xs text-white/40">{setting.description}</p>
                  </div>
                </div>
                <Toggle enabled={setting.enabled} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent Notifications */}
      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-white/30" />
          <h3 className="text-xs uppercase tracking-widest text-white/40">Recent Notifications</h3>
        </div>
        <div className="mt-4 divide-y divide-[--member-border]">
          {recentNotifications.map((n, i) => (
            <ActivityItem key={i} title={n.title} timestamp={n.timestamp} dotColor={n.dot} />
          ))}
        </div>
      </div>
    </div>
  )
}
