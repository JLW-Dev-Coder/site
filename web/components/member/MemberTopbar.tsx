'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, Bell, HelpCircle, Settings, LogOut } from 'lucide-react'

export default function MemberTopbar() {
  const [email, setEmail] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('https://api.virtuallaunch.pro/v1/auth/session', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const e = d.session?.email ?? d.email
        if (e) setEmail(e)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  async function handleSignOut() {
    await fetch('https://api.virtuallaunch.pro/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})
    window.location.href = '/sign-in'
  }

  return (
    <header className="flex h-20 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0a0e27]/80 px-6 backdrop-blur">
      {/* Search */}
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          placeholder="Search..."
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white placeholder-white/30 outline-none transition focus:border-brand-orange/40 focus:bg-white/[0.06]"
        />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <Link
          href="/notifications"
          className="relative rounded-lg p-2.5 text-white/40 transition hover:bg-white/[0.04] hover:text-white"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </Link>

        <Link
          href="/help"
          className="rounded-lg p-2.5 text-white/40 transition hover:bg-white/[0.04] hover:text-white"
          aria-label="Help Center"
        >
          <HelpCircle className="h-5 w-5" />
        </Link>

        {/* Gear icon + dropdown */}
        <div className="relative ml-2" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            aria-label="Account menu"
          >
            <Settings className="h-5 w-5" />
          </button>

          {open && (
            <div className="absolute right-0 top-full z-50 mt-2 min-w-52 rounded-xl border border-white/[0.08] bg-[#0f1333] p-2 shadow-2xl">
              {email && (
                <div className="truncate px-3 py-2 text-xs text-white/40">{email}</div>
              )}
              <div className="my-1 border-t border-white/[0.06]" />
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400/70 transition hover:bg-red-900/20"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
