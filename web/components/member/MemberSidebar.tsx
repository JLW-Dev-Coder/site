'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  BarChart3,
  Calendar,
  MessageSquare,
  FileText,
  Coins,
  Link2,
  Users,
  User,
  Wallet,
  Settings,
  CreditCard,
  UserCircle,
  ClipboardList,
  Eye,
  HelpCircle,
  Activity,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  LogOut,
} from 'lucide-react'

type NavChild = { label: string; href: string; icon: React.ReactNode }
type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
  children?: NavChild[]
}
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'WORKSPACE',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
      { label: 'Analytics', href: '/analytics', icon: <BarChart3 className="h-5 w-5" /> },
      { label: 'Calendar', href: '/calendar', icon: <Calendar className="h-5 w-5" /> },
      { label: 'Inquiries', href: '/inquiries', icon: <MessageSquare className="h-5 w-5" /> },
      { label: 'Reports', href: '/reports', icon: <FileText className="h-5 w-5" /> },
      { label: 'Tokens', href: '/tokens', icon: <Coins className="h-5 w-5" /> },
    ],
  },
  {
    title: 'EARNINGS',
    items: [
      { label: 'Affiliate', href: '/affiliate', icon: <Link2 className="h-5 w-5" /> },
      {
        label: 'Client Pool',
        href: '/client-pool',
        icon: <Users className="h-5 w-5" />,
        children: [
          { label: 'Client Record', href: '/client-pool', icon: <User className="h-4 w-4" /> },
        ],
      },
      { label: 'Payouts', href: '/payouts', icon: <Wallet className="h-5 w-5" /> },
    ],
  },
  {
    title: 'SETUP',
    items: [
      {
        label: 'Account',
        href: '/account',
        icon: <Settings className="h-5 w-5" />,
        children: [
          { label: 'Payments', href: '/account/payments', icon: <CreditCard className="h-4 w-4" /> },
        ],
      },
      {
        label: 'Profile',
        href: '/profile',
        icon: <UserCircle className="h-5 w-5" />,
        children: [
          { label: 'Onboarding', href: '/profile/onboarding', icon: <ClipboardList className="h-4 w-4" /> },
          { label: 'Preview', href: '/profile/preview', icon: <Eye className="h-4 w-4" /> },
        ],
      },
      { label: 'Support', href: '/support', icon: <HelpCircle className="h-5 w-5" /> },
      { label: 'Usage', href: '/usage', icon: <Activity className="h-5 w-5" /> },
    ],
  },
]

export default function MemberSidebar() {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  function toggleExpand(href: string) {
    setExpanded((prev) => ({ ...prev, [href]: !prev[href] }))
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  async function handleSignOut() {
    await fetch('https://api.virtuallaunch.pro/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})
    window.location.href = '/sign-in'
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0a0e27]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-xs font-bold text-slate-950">
          VLP
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-white">
            Virtual Launch Pro
          </span>
          <span className="text-[11px] text-white/40">Member Dashboard</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-6">
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-white/30">
              {section.title}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href)
                const hasChildren = item.children && item.children.length > 0
                const isOpen =
                  expanded[item.href] ||
                  (hasChildren && item.children!.some((c) => isActive(c.href)))

                return (
                  <div key={item.href}>
                    <div className="flex items-center">
                      <Link
                        href={item.href}
                        className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          active
                            ? 'border-l-2 border-brand-orange bg-brand-orange/10 text-brand-orange'
                            : 'border-l-2 border-transparent text-white/60 hover:bg-white/[0.04] hover:text-white'
                        }`}
                      >
                        <span className={active ? 'text-brand-orange' : 'text-white/40'}>
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(item.href)}
                          className="mr-1 rounded p-1 text-white/30 transition hover:text-white/60"
                          aria-label={`Expand ${item.label}`}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                    {hasChildren && isOpen && (
                      <div className="ml-5 mt-0.5 space-y-0.5 border-l border-white/[0.06] pl-3">
                        {item.children!.map((child) => {
                          const childActive = isActive(child.href) && pathname !== item.href
                          return (
                            <Link
                              key={child.href + child.label}
                              href={child.href}
                              className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                                childActive
                                  ? 'text-brand-orange'
                                  : 'text-white/40 hover:text-white/70'
                              }`}
                            >
                              <span className={childActive ? 'text-brand-orange' : 'text-white/30'}>
                                {child.icon}
                              </span>
                              {child.label}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer — SETTINGS */}
      <div className="border-t border-white/[0.06] px-4 py-4">
        <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-white/30">
          Settings
        </div>
        <div className="space-y-1">
          <Link
            href="/account"
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-white/50 transition hover:text-white/80"
          >
            <Settings className="h-4 w-4" /> Account
          </Link>
          <Link
            href="/profile"
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-white/50 transition hover:text-white/80"
          >
            <UserCircle className="h-4 w-4" /> Profile
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-white/50 transition hover:text-white/80"
          >
            <ArrowLeft className="h-4 w-4" /> Back to site
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-red-400/70 transition hover:text-red-400"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
