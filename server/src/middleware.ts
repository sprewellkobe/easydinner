import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  CORS_ALLOW_ORIGIN,
  CORS_ALLOW_METHODS,
  CORS_ALLOW_HEADERS,
  CORS_MAX_AGE,
} from '@/lib/config'

export function middleware(request: NextRequest) {
  // 只对 API 路由添加 CORS
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': CORS_ALLOW_ORIGIN,
          'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
          'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
          'Access-Control-Max-Age': CORS_MAX_AGE,
        },
      })
    }

    // 正常请求：克隆 response 并添加 CORS 头
    const response = NextResponse.next()
    response.headers.set('Access-Control-Allow-Origin', CORS_ALLOW_ORIGIN)
    response.headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS)
    response.headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
