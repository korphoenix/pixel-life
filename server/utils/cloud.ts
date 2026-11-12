import { createClient } from '@supabase/supabase-js'
import { createError, getHeader, type H3Event } from 'h3'

export async function authenticatedCloud(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (!config.public.supabaseUrl || !config.public.supabaseAnonKey) {
    throw createError({ statusCode: 503, data: { message: '請先設定 Supabase 連線與資料表。' } })
  }
  const authorization = getHeader(event, 'authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, data: { message: '請先登入，再生成圖片。' } })
  }
  const cloud = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const { data, error } = await cloud.auth.getUser(authorization.slice(7))
  if (error || !data.user) throw createError({ statusCode: 401, data: { message: '登入已失效，請重新登入。' } })
  if (!data.user.email || data.user.is_anonymous) throw createError({ statusCode: 403, data: { message: '請使用信箱與密碼註冊的帳號登入。' } })
  return { cloud, user: data.user }
}
