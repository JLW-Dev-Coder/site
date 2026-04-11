'use client'

import { ReactNode } from 'react'

const baseInputClass =
  'w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 transition focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 disabled:opacity-60'

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-white/50">
      {children}
    </label>
  )
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
) {
  const { mono, className = '', ...rest } = props
  return (
    <input
      type="text"
      className={`${baseInputClass} ${mono ? 'font-mono' : ''} ${className}`}
      {...rest}
    />
  )
}

export function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return (
    <input
      type="date"
      className={`${baseInputClass} ${className} [color-scheme:dark]`}
      {...rest}
    />
  )
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & {
    options: readonly string[] | readonly { value: string; label: string }[]
    placeholder?: string
  }
) {
  const { options, placeholder = 'Select...', className = '', ...rest } = props
  return (
    <select className={`${baseInputClass} ${className}`} {...rest}>
      <option value="">{placeholder}</option>
      {options.map((opt) => {
        const value = typeof opt === 'string' ? opt : opt.value
        const label = typeof opt === 'string' ? opt : opt.label
        return (
          <option key={value} value={value}>
            {label}
          </option>
        )
      })}
    </select>
  )
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', rows = 3, ...rest } = props
  return <textarea rows={rows} className={`${baseInputClass} resize-none ${className}`} {...rest} />
}

export function Field({
  label,
  children,
  span = 1,
}: {
  label: string
  children: ReactNode
  span?: 1 | 2
}) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
}

export function Checkbox({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  sub?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-3 transition hover:bg-white/[0.07]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 text-brand-orange accent-brand-orange focus:ring-brand-orange/20"
      />
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {sub ? <p className="text-xs text-white/40">{sub}</p> : null}
      </div>
    </label>
  )
}

export function Pill({
  children,
  tone,
}: {
  children: ReactNode
  tone: 'green' | 'amber' | 'red' | 'orange' | 'neutral'
}) {
  const tones: Record<string, string> = {
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
    orange: 'bg-brand-orange/20 text-brand-orange border-brand-orange/30',
    neutral: 'bg-white/10 text-white/60 border-white/10',
  }
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium border ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
