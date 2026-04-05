'use client'

import { useState } from 'react'

/* ---------- Calculator ---------- */

interface CalculatorField {
  id: string
  label: string
  type: string
  min: number
  max: number
  default: number
  step?: number
}

interface CalculatorProps {
  fields: CalculatorField[]
  resultTemplate: string
}

function Calculator({ fields, resultTemplate }: CalculatorProps) {
  const clientsField = fields.find(f => f.id === 'newClients')!
  const valueField = fields.find(f => f.id === 'engValue')!

  const [clients, setClients] = useState(clientsField.default)
  const [engValue, setEngValue] = useState(valueField.default)

  const annual = clients * engValue * 12
  const resultText = resultTemplate
    .replace('{newClients}', String(clients))
    .replace('${engValue}', `$${engValue.toLocaleString()}`)

  return (
    <section className="pb-16">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-[var(--fg)] md:text-3xl">
          Your practice capacity
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[var(--muted)]">
          Slide to match your situation. The numbers update in real time.
        </p>
      </div>

      <div className="mx-auto mt-10 max-w-2xl space-y-8">
        {/* New clients slider */}
        <div>
          <label className="mb-2 flex items-center justify-between text-sm text-[var(--fg)]">
            <span>{clientsField.label}</span>
            <span className="font-semibold text-brand-orange">{clients}</span>
          </label>
          <input
            type="range"
            min={clientsField.min}
            max={clientsField.max}
            step={1}
            value={clients}
            onChange={e => setClients(Number(e.target.value))}
            className="w-full accent-[#f97316]"
          />
          <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
            <span>{clientsField.min}</span>
            <span>{clientsField.max}</span>
          </div>
        </div>

        {/* Engagement value slider */}
        <div>
          <label className="mb-2 flex items-center justify-between text-sm text-[var(--fg)]">
            <span>{valueField.label}</span>
            <span className="font-semibold text-brand-orange">${engValue.toLocaleString()}</span>
          </label>
          <input
            type="range"
            min={valueField.min}
            max={valueField.max}
            step={valueField.step ?? 100}
            value={engValue}
            onChange={e => setEngValue(Number(e.target.value))}
            className="w-full accent-[#f97316]"
          />
          <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
            <span>${valueField.min.toLocaleString()}</span>
            <span>${valueField.max.toLocaleString()}</span>
          </div>
        </div>

        {/* Result box */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 backdrop-blur"
             style={{ borderLeft: '4px solid #f97316' }}>
          <p className="text-3xl font-bold text-brand-orange md:text-4xl">
            ${annual.toLocaleString()} per year
          </p>
          <p className="mt-3 leading-relaxed text-[var(--muted)]">
            {resultText}
          </p>
        </div>
      </div>
    </section>
  )
}

/* ---------- Qualifying Questions ---------- */

interface Question {
  text: string
  detail: string
}

function QualifyingQuestions({ questions }: { questions: Question[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <section className="pb-16">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-[var(--fg)] md:text-3xl">
          Which of these would help your practice?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[var(--muted)]">
          Select any that apply. These shape what your membership should include.
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {questions.map((q, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggle(i)}
            className={`cursor-pointer rounded-xl border-2 p-6 text-left transition-colors backdrop-blur ${
              selected.has(i)
                ? 'border-[#f97316] bg-[#f97316]/5'
                : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--muted)]'
            }`}
          >
            <h3 className="text-lg font-semibold text-[var(--fg)]">{q.text}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{q.detail}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ---------- Exported wrapper ---------- */

export interface AssetInteractiveProps {
  calculator: {
    fields: CalculatorField[]
    result_template: string
  }
  qualifying_questions: Question[]
}

export default function AssetInteractive({ calculator, qualifying_questions }: AssetInteractiveProps) {
  return (
    <>
      <Calculator fields={calculator.fields} resultTemplate={calculator.result_template} />
      <QualifyingQuestions questions={qualifying_questions} />
    </>
  )
}
