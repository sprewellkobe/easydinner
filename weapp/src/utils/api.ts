import Taro from '@tarojs/taro'

/** 后端 API 基础地址（通过 Taro defineConstants 注入，可通过环境变量 API_BASE_URL 覆盖） */
declare const API_BASE_URL: string
const BASE_URL = API_BASE_URL

/** 单次请求 */
function doRequest<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST'
    data?: Record<string, unknown>
    timeout?: number
  } = {}
): Promise<T> {
  const { method = 'GET', data, timeout = 15000 } = options
  const fullUrl = `${BASE_URL}${url}`

  console.log(`[API] ${method} ${fullUrl}`, data ? JSON.stringify(data).slice(0, 200) : '')

  return new Promise((resolve, reject) => {
    Taro.request({
      url: fullUrl,
      method,
      data,
      timeout,
      header: {
        'Content-Type': 'application/json',
      },
      success: (res) => {
        console.log(`[API] 响应: HTTP ${res.statusCode}`)
        if (res.statusCode >= 400) {
          reject(new Error(res.data?.error || `请求失败: ${res.statusCode}`))
        } else {
          resolve(res.data as T)
        }
      },
      fail: (err) => {
        console.error(`[API] 请求失败:`, err.errMsg, `errno:`, err.errno)
        reject(err)
      },
    })
  })
}

/** 带重试的通用请求方法 */
async function request<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST'
    data?: Record<string, unknown>
    timeout?: number
  } = {}
): Promise<T> {
  const maxRetries = 2
  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[API] 第 ${attempt + 1} 次重试...`)
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
      return await doRequest<T>(url, options)
    } catch (err: any) {
      lastError = err
      const msg = err?.errMsg || err?.message || ''
      // 只对网络错误重试，业务错误不重试
      if (!msg.includes('ERR_CONNECTION') && !msg.includes('timeout') && !msg.includes('ECONNRESET')) {
        throw err
      }
      console.warn(`[API] 网络错误 (attempt ${attempt + 1}/${maxRetries + 1}):`, msg)
    }
  }

  throw lastError
}

/** 存储工具 */
export const storage = {
  get(key: string): string | null {
    return Taro.getStorageSync(key) || null
  },
  set(key: string, value: string) {
    Taro.setStorageSync(key, value)
  },
  getJSON<T>(key: string): T | null {
    const val = Taro.getStorageSync(key)
    if (!val) return null
    try {
      return typeof val === 'string' ? JSON.parse(val) : val
    } catch {
      return null
    }
  },
  setJSON(key: string, value: unknown) {
    Taro.setStorageSync(key, JSON.stringify(value))
  },
}

/** 日期/时间格式化 */
export function getDefaultTitle(): string {
  const days = ['日', '一', '二', '三', '四', '五', '六']
  const day = new Date().getDay()
  return `周${days[day]}聚餐`
}

export function getTodayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 获取从今天起偏移 offsetDays 天的日期字符串 (YYYY-MM-DD) */
export function getDateStr(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDateTime(date: string, time: string): string {
  const d = new Date(date)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const weekDay = weekDays[d.getDay()]
  return `${month}月${day}日 周${weekDay} ${time}`
}

// ================ API 接口 ================

import type { Gathering, Restaurant, Location } from './types'

/** 创建饭局 */
export async function createGathering(params: {
  title: string
  creatorName: string
  date: string
  time: string
  meal: string
  diningType: string
  location: Location
}): Promise<{ gathering: Gathering; creatorId: string }> {
  return request('/api/gatherings', {
    method: 'POST',
    data: params as unknown as Record<string, unknown>,
  })
}

/** 获取饭局详情 */
export async function getGathering(id: string): Promise<{ gathering: Gathering }> {
  return request(`/api/gatherings/${id}`)
}

/** 加入饭局 */
export async function joinGathering(
  id: string,
  params: { name: string; location: Location }
): Promise<{ gathering: Gathering; participantId: string }> {
  return request(`/api/gatherings/${id}/join`, {
    method: 'POST',
    data: params as unknown as Record<string, unknown>,
  })
}

/** 获取餐厅推荐 */
export async function getRecommendations(id: string): Promise<{ restaurants: Restaurant[] }> {
  return request(`/api/gatherings/${id}/recommend`)
}

/** 确认餐厅 */
export async function confirmRestaurant(
  id: string,
  params: { restaurantId: string; creatorId: string }
): Promise<{ gathering: Gathering }> {
  return request(`/api/gatherings/${id}/confirm`, {
    method: 'POST',
    data: params as unknown as Record<string, unknown>,
  })
}

/** 投票 */
export async function voteRestaurant(
  id: string,
  params: { restaurantId: string; participantId: string }
): Promise<{ votes: Record<string, string[]> }> {
  return request(`/api/gatherings/${id}/vote`, {
    method: 'POST',
    data: params as unknown as Record<string, unknown>,
  })
}

// ================ 我的饭局 ================

const MY_GATHERINGS_KEY = 'yuefan_my_gatherings'

/** 获取本地存储的饭局 ID 列表 */
export function getMyGatheringIds(): string[] {
  return storage.getJSON<string[]>(MY_GATHERINGS_KEY) || []
}

/** 保存饭局 ID 到本地（去重） */
export function saveMyGatheringId(id: string) {
  const ids = getMyGatheringIds()
  if (!ids.includes(id)) {
    ids.unshift(id) // 最新的排前面
    storage.setJSON(MY_GATHERINGS_KEY, ids)
  }
}

/** 从本地删除饭局 ID */
export function removeMyGatheringId(id: string) {
  const ids = getMyGatheringIds()
  const newIds = ids.filter(i => i !== id)
  storage.setJSON(MY_GATHERINGS_KEY, newIds)
}

/** 删除饭局（服务端 + 本地） */
export async function deleteGatheringById(id: string, creatorId: string): Promise<void> {
  await request(`/api/gatherings/${id}/delete`, {
    method: 'POST',
    data: { creatorId } as unknown as Record<string, unknown>,
  })
  removeMyGatheringId(id)
}

/** 批量获取我的饭局详情（使用 batch 接口，一次请求获取所有） */
export async function getMyGatherings(): Promise<Gathering[]> {
  const ids = getMyGatheringIds()
  if (ids.length === 0) return []

  try {
    const data = await request<{ gatherings: Gathering[] }>('/api/gatherings/batch', {
      method: 'POST',
      data: { ids } as unknown as Record<string, unknown>,
    })

    const results = data.gatherings || []

    // 清理已失效的 ID（服务端未找到的）
    const validIds = results.map(g => g.id)
    if (validIds.length !== ids.length) {
      // 保留顺序：按原 ids 顺序保留有效的
      const validSet = new Set(validIds)
      const orderedValidIds = ids.filter(id => validSet.has(id))
      storage.setJSON(MY_GATHERINGS_KEY, orderedValidIds)
    }

    return results
  } catch {
    // 批量接口失败时降级为逐个请求
    const results: Gathering[] = []
    const batchSize = 5
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const promises = batch.map(async (id) => {
        try {
          const res = await getGathering(id)
          return res.gathering
        } catch {
          return null
        }
      })
      const batchResults = await Promise.all(promises)
      results.push(...batchResults.filter((g): g is Gathering => g !== null))
    }

    const validIds = results.map(g => g.id)
    if (validIds.length !== ids.length) {
      storage.setJSON(MY_GATHERINGS_KEY, validIds)
    }

    return results
  }
}
