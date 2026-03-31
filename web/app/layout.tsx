export const runtime = 'edge'

import type { Metadata } from 'next'
import { Raleway } from 'next/font/google'
import './globals.css'

const raleway = Raleway({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-raleway',
})

export const metadata: Metadata = {
  title: {
    default: 'Virtual Launch Pro',
    template: '%s | Virtual Launch Pro',
  },
  description: 'Calm launch systems for tax professionals.',
  icons: {
    icon: [
      { url: '/assets/favicon.ico', type: 'image/x-icon' },
      { url: '/assets/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/assets/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={raleway.variable}>
      <body className="antialiased">{children}</body>
    </html>
  )
}
