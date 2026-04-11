'use client'

import { useEffect, useState } from 'react'
import {
  Ticket,
  CalendarCheck,
  UserCog,
  Coins,
  Bell,
  AlertCircle,
  Clock,
} from 'lucide-react'
import ActivityItem from '../components/ActivityItem'
import { getDashboard } from '@/lib/api/dashboard'
import type { DashboardPayload } from '@/lib/api/types'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dashboard: DashboardPayload }

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

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const now = Date.now()
  const diffMs = now - then
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function dotForActivity(type: string): string {
  if (type === 'report') return 'bg-emerald-400'
  if (type === 'booking') return 'bg-blue-400'
  if (type === 'support') return 'bg-brand-orange'
  return 'bg-white/30'
}

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

export default function NotificationsClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    getDashboard()
      .then((dashboard) => {
        if (!cancelled) setState({ status: 'ready', dashboard })
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load notifications',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <NotificationsSkeleton />
  if (state.status === 'error') return <NotificationsFallback message={state.message} />

  const { dashboard } = state

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Notifications</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage notification preferences and view recent alerts.
        </p>
      </div>

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Notification Settings</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            <Clock className="h-3 w-3" />
            Live data coming soon
          </span>
        </div>
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

      <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-white/30" />
          <h3 className="text-xs uppercase tracking-widest text-white/40">Recent Activity</h3>
        </div>
        {dashboard.activity.length === 0 ? (
          <p className="mt-6 text-sm text-white/40">No recent activity to show.</p>
        ) : (
          <div className="mt-4 divide-y divide-[--member-border]">
            {dashboard.activity.map((n, i) => (
              <ActivityItem
                key={i}
                title={n.title}
                timestamp={formatRelative(n.timestamp)}
                dotColor={dotForActivity(n.type)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NotificationsSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Notifications</h1>
        <p className="mt-1 text-sm text-white/50">Loading…</p>
      </div>
      <div className="h-56 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
      <div className="h-56 animate-pulse rounded-xl border border-[--member-border] bg-[--member-card]" />
    </div>
  )
}

function NotificationsFallback({ message }: { message: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Notifications</h1>
        <p className="mt-1 text-sm text-white/50">
          Manage notification preferences and view recent alerts.
        </p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Could not load live data</p>
          <p className="mt-1 text-amber-200/70">{message}</p>
        </div>
      </div>
    </div>
  )
}
