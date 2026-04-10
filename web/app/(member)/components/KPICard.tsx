import { ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react'

interface KPICardProps {
  label: string
  value: string
  change?: string
  trend?: 'up' | 'down' | 'neutral'
  icon?: LucideIcon
}

export default function KPICard({ label, value, change, trend = 'neutral', icon: Icon }: KPICardProps) {
  return (
    <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-5 transition hover:bg-[--member-card-hover]">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-white/40">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-white/30" />}
      </div>
      <p className="mt-3 text-3xl font-semibold text-brand-orange">{value}</p>
      {change && (
        <div className="mt-2 flex items-center gap-1">
          {trend === 'up' && <ArrowUp className="h-3.5 w-3.5 text-emerald-400" />}
          {trend === 'down' && <ArrowDown className="h-3.5 w-3.5 text-red-400" />}
          <span
            className={`text-xs ${
              trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-white/40'
            }`}
          >
            {change}
          </span>
        </div>
      )}
    </div>
  )
}
