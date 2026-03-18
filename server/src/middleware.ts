import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  CORS_ALLOW_ORIGIN,
  CORS_ALLOW_METHODS,
  CORS_ALLOW_HEADERS,
  CORS_MAX_AGE,
} from '@/lib/config'

// 解析允许的 Origin 列表（支持逗号分隔多个域名）
function isOriginAllowed(origin: string | null): string {
  if (!origin) return CORS_ALLOW_ORIGIN
  if (CORS_ALLOW_ORIGIN === '*') return '*'

  const allowedOrigins = CORS_ALLOW_ORIGIN.split(',').map(o => o.trim())
  if (allowedOrigins.includes(origin)) return origin
  return '' // 不在白名单中
}

export function middleware(request: NextRequest) {
  // 只对 API 路由添加 CORS
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin')
    const allowedOrigin = isOriginAllowed(origin)

    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin || '*',
          'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
          'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
          'Access-Control-Max-Age': CORS_MAX_AGE,
        },
      })
    }

    // 保护 GET /api/gatherings —— 禁止外部枚举所有饭局数据
    if (request.nextUrl.pathname === '/api/gatherings' && request.method === 'GET') {
      // 只允许服务端内部调用（无 Origin）或白名单来源
      if (origin && !allowedOrigin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }
    }

    // 正常请求：克隆 response 并添加 CORS 头
    const response = NextResponse.next()
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin || '*')
    response.headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS)
    response.headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
