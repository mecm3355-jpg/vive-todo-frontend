const DEFAULT_BACKEND_ROOT =
  'https://vive-todo-backend-0e9305a7ff26.herokuapp.com'

const REQUEST_HEADERS_TO_REMOVE = [
  'accept-encoding',
  'connection',
  'content-length',
  'host',
  'origin',
  'referer',
  'transfer-encoding',
]

const RESPONSE_HEADERS_TO_REMOVE = [
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
]

async function proxy(request) {
  try {
    const requestUrl = new URL(request.url)
    const proxyPath = requestUrl.searchParams.get('path')

    if (!proxyPath) {
      return Response.json({ message: 'API 경로가 필요합니다.' }, { status: 400 })
    }

    requestUrl.searchParams.delete('path')

    const backendRoot = (
      process.env.BACKEND_API_ROOT || DEFAULT_BACKEND_ROOT
    ).replace(/\/+$/, '')
    const upstreamUrl = new URL(
      `${backendRoot}/${proxyPath.replace(/^\/+/, '')}`,
    )

    for (const [key, value] of requestUrl.searchParams) {
      upstreamUrl.searchParams.append(key, value)
    }

    const requestHeaders = new Headers(request.headers)
    for (const header of REQUEST_HEADERS_TO_REMOVE) {
      requestHeaders.delete(header)
    }

    const fetchOptions = {
      method: request.method,
      headers: requestHeaders,
      redirect: 'manual',
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = await request.arrayBuffer()
    }

    const upstreamResponse = await fetch(upstreamUrl, fetchOptions)
    const responseHeaders = new Headers(upstreamResponse.headers)

    for (const header of RESPONSE_HEADERS_TO_REMOVE) {
      responseHeaders.delete(header)
    }

    responseHeaders.set('cache-control', 'no-store')

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('API proxy request failed:', error)
    return Response.json(
      { message: '백엔드 서버 요청을 처리하지 못했습니다.' },
      { status: 502 },
    )
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
