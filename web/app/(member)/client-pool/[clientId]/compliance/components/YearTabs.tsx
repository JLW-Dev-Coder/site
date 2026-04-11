'use client'

interface Props {
  selected: number
  onSelect: (year: number) => void
}

export default function YearTabs({ selected, onSelect }: Props) {
  const current = new Date().getFullYear()
  const years = Array.from({ length: 10 }, (_, i) => current - i)

  return (
    <div
      className="flex w-fit items-center gap-1 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] p-1"
      aria-label="Tax year tabs"
    >
      {years.map((year) => {
        const active = year === selected
        return (
          <button
            key={year}
            type="button"
            onClick={() => onSelect(year)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-brand-orange text-white'
                : 'bg-transparent text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            {year}
          </button>
        )
      })}
    </div>
  )
}
