import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PATHS = [
  '/dashboard',
  '/account',
  '/analytics',
  '/calendar',
  '/inquiries',
  '/reports',
  '/tokens',
  '/affiliate',
  '/client-pool',
  '/payouts',
  '/profile',
  '/support',
  '/usage',
  '/notifications',
  '/help',
  '/scale',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + '/')
  )

  if (!isProtected) return NextResponse.next()

  const session = request.cookies.get('vlp_session')

  if (!session) {
    const signInUrl = new URL('/sign-in', request.url)
    signInUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/account/:path*',
    '/analytics/:path*',
    '/calendar/:path*',
    '/inquiries/:path*',
    '/reports/:path*',
    '/tokens/:path*',
    '/affiliate/:path*',
    '/client-pool/:path*',
    '/payouts/:path*',
    '/profile/:path*',
    '/support/:path*',
    '/usage/:path*',
    '/notifications/:path*',
    '/help/:path*',
    '/scale/:path*',
  ],
}
