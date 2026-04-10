import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Tokens' }

export default function TokensPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Tokens</h1>
      <p className="mt-1 text-sm text-white/50">
        Monitor your token balance and usage.
      </p>
    </div>
  )
}
