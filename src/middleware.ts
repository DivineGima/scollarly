import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Locale routing is scaffolded for future activation when French translations are ready.
// When French is activated: restructure app/ to [locale] segments and replace this
// with createMiddleware from 'next-intl/middleware'.
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
