import type { ReactNode } from 'react'

interface HeroCardProps {
  children: ReactNode
  className?: string
}

export default function HeroCard({ children, className = '' }: HeroCardProps) {
  return (
    <div
      className={`rounded-xl border border-brand-orange/20 bg-gradient-to-br from-[--member-hero-bg] to-[--member-hero-bg-end] p-6 ${className}`}
    >
      {children}
    </div>
  )
}
