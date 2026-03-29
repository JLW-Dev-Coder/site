import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PATHS = [
  '/dashboard',
  '/account',
  '/analytics',
  '/calendar',
  '/onboarding',
  '/support',
  '/token-usage',
  '/receipts',
  '/profile',
  '/messaging',
  '/transcripts',
  '/tools',
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
    '/onboarding/:path*',
    '/support/:path*',
    '/token-usage/:path*',
    '/receipts/:path*',
    '/profile/:path*',
    '/messaging/:path*',
    '/transcripts/:path*',
    '/tools/:path*',
  ],
}
