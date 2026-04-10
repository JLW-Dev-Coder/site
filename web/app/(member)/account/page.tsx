import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Account' }

export default function AccountPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Account</h1>
      <p className="mt-1 text-sm text-white/50">
        Manage your account settings.
      </p>
    </div>
  )
}
