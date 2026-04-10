import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Profile' }

export default function ProfilePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Profile</h1>
      <p className="mt-1 text-sm text-white/50">
        Your public directory profile.
      </p>
    </div>
  )
}
