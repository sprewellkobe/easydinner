import { View, Map, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useMemo, useRef } from 'react'
import type { Restaurant, Participant } from '../utils/types'
import './RestaurantMap.scss'

interface RestaurantMapProps {
  restaurant: Restaurant
  participants: Participant[]
  /** 是否以餐厅为中心（推荐列表展开地图用） */
  centerOnRestaurant?: boolean
  /** 紧凑模式：地图高度更小 */
  compact?: boolean
}

// 参与者颜色列表 — 优先使用与红色餐厅标记差异大的冷色调
const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#14b8a6', '#ec4899', '#f59e0b', '#f97316', '#ef4444']

// 全局递增 ID，确保每个 RestaurantMap 实例有唯一的 map id
let _mapIdCounter = 0

/**
 * 用代码生成纯色圆点 PNG 并写入临时文件，返回临时路径。
 * 不依赖任何外部图片，真机 100% 兼容。
 *
 * 生成一个 24x24 像素的圆点 PNG（RGBA），圆形区域填充指定颜色，背景透明。
 */
const _iconCache: Record<string, string> = {}

function generateDotIcon(color: string): string {
  const key = color
  if (_iconCache[key]) return _iconCache[key]

  // 解析 hex 颜色
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  const size = 24
  const center = size / 2
  const radius = size / 2 - 1 // 留 1px 边距

  // 构建原始 RGBA 像素数据
  const rawPixels: number[] = []
  for (let y = 0; y < size; y++) {
    rawPixels.push(0) // filter byte: None
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5
      const dy = y - center + 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= radius) {
        // 边缘抗锯齿
        const alpha = dist > radius - 1 ? Math.round((radius - dist) * 255) : 255
        rawPixels.push(r, g, b, alpha)
      } else {
        rawPixels.push(0, 0, 0, 0) // 透明
      }
    }
  }

  // 简单的无压缩 PNG 编码（使用 store 方式的 zlib，不需要 deflate）
  const rawData = new Uint8Array(rawPixels)

  // zlib store: header(2) + block(5 + rawData.length) + adler32(4)
  const zlibLen = 2 + 5 + rawData.length + 4
  const zlib = new Uint8Array(zlibLen)
  zlib[0] = 0x78 // CMF
  zlib[1] = 0x01 // FLG
  // BFINAL=1, BTYPE=00 (no compression)
  zlib[2] = 0x01
  const len = rawData.length
  zlib[3] = len & 0xff
  zlib[4] = (len >> 8) & 0xff
  zlib[5] = (~len) & 0xff
  zlib[6] = (~len >> 8) & 0xff
  zlib.set(rawData, 7)

  // Adler-32 checksum
  let s1 = 1, s2 = 0
  for (let i = 0; i < rawData.length; i++) {
    s1 = (s1 + rawData[i]) % 65521
    s2 = (s2 + s1) % 65521
  }
  const adler = (s2 << 16) | s1
  const adlerOff = 7 + rawData.length
  zlib[adlerOff] = (adler >> 24) & 0xff
  zlib[adlerOff + 1] = (adler >> 16) & 0xff
  zlib[adlerOff + 2] = (adler >> 8) & 0xff
  zlib[adlerOff + 3] = adler & 0xff

  // CRC32 表
  const crcTable: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c
  }
  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }

  function writeUint32(arr: number[], val: number) {
    arr.push((val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff)
  }

  function makeChunk(type: string, data: Uint8Array): number[] {
    const chunk: number[] = []
    writeUint32(chunk, data.length)
    const typeBytes = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]
    chunk.push(...typeBytes)
    for (let i = 0; i < data.length; i++) chunk.push(data[i])
    // CRC over type + data
    const crcData = new Uint8Array(4 + data.length)
    crcData.set(typeBytes)
    crcData.set(data, 4)
    writeUint32(chunk, crc32(crcData))
    return chunk
  }

  const png: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] // PNG signature

  // IHDR
  const ihdr = new Uint8Array(13)
  ihdr[0] = 0; ihdr[1] = 0; ihdr[2] = 0; ihdr[3] = size // width
  ihdr[4] = 0; ihdr[5] = 0; ihdr[6] = 0; ihdr[7] = size // height
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type: RGBA
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace
  png.push(...makeChunk('IHDR', ihdr))

  // IDAT
  png.push(...makeChunk('IDAT', zlib))

  // IEND
  png.push(...makeChunk('IEND', new Uint8Array(0)))

  const pngArray = new Uint8Array(png)

  // 写入临时文件
  try {
    const fs = Taro.getFileSystemManager()
    const tempPath = `${Taro.env.USER_DATA_PATH}/marker_${color.replace('#', '')}.png`
    fs.writeFileSync(tempPath, pngArray.buffer, 'binary')
    _iconCache[key] = tempPath
    return tempPath
  } catch (e) {
    console.error('[RestaurantMap] 生成图标失败:', e)
    return ''
  }
}

export default function RestaurantMap({ restaurant, participants, centerOnRestaurant = false, compact = false }: RestaurantMapProps) {
  // 每个实例分配唯一 mapId
  const mapIdRef = useRef(`restaurant-map-${_mapIdCounter++}`)

  const markers = useMemo(() => {
    const restaurantIcon = generateDotIcon('#dc2626') // 红色圆点：餐厅
    if (!restaurantIcon) return []

    const list: {
      id: number
      latitude: number
      longitude: number
      title: string
      iconPath: string
      width: number
      height: number
      callout?: {
        content: string
        color: string
        fontSize: number
        borderRadius: number
        bgColor: string
        padding: number
        display: string
      }
    }[] = []

    // 餐厅标记
    list.push({
      id: 0,
      latitude: restaurant.lat,
      longitude: restaurant.lng,
      title: restaurant.name,
      iconPath: restaurantIcon,
      width: 28,
      height: 28,
      callout: {
        content: restaurant.name,
        color: '#dc2626',
        fontSize: 13,
        borderRadius: 8,
        bgColor: '#ffffff',
        padding: 6,
        display: 'ALWAYS',
      },
    })

    // 参与者标记 — 每人用不同颜色的圆点
    participants.forEach((p, i) => {
      const color = COLORS[i % COLORS.length]
      const personIcon = generateDotIcon(color)
      if (!personIcon) return

      list.push({
        id: i + 1,
        latitude: p.location.lat,
        longitude: p.location.lng,
        title: `${p.name} - ${p.location.name}`,
        iconPath: personIcon,
        width: 24,
        height: 24,
        callout: {
          content: p.name,
          color: color,
          fontSize: 12,
          borderRadius: 6,
          bgColor: '#ffffff',
          padding: 4,
          display: 'ALWAYS',
        },
      })
    })

    return list
  }, [restaurant, participants])

  // 连线（参与者到餐厅）
  const polyline = useMemo(() => {
    return participants.map((p, i) => ({
      points: [
        { latitude: p.location.lat, longitude: p.location.lng },
        { latitude: restaurant.lat, longitude: restaurant.lng },
      ],
      color: COLORS[i % COLORS.length] + '80',
      width: 2,
      dottedLine: true,
    }))
  }, [restaurant, participants])

  // 计算地图中心 + 合适的 scale（缩放级别），确保所有点在视野内
  // 不依赖 includePoints（真机上经常不生效），直接算 scale
  const { center, scale } = useMemo(() => {
    const allLats = [restaurant.lat, ...participants.map(p => p.location.lat)]
    const allLngs = [restaurant.lng, ...participants.map(p => p.location.lng)]

    const minLat = Math.min(...allLats)
    const maxLat = Math.max(...allLats)
    const minLng = Math.min(...allLngs)
    const maxLng = Math.max(...allLngs)

    // 地图中心取所有点的几何中心
    const centerLat = (minLat + maxLat) / 2
    const centerLng = (minLng + maxLng) / 2

    // 计算跨度（加 20% 余量，让点不贴边）
    const latSpan = (maxLat - minLat) * 1.4 || 0.01
    const lngSpan = (maxLng - minLng) * 1.4 || 0.01

    // 根据经纬度跨度计算合适的缩放级别
    // 微信小程序 scale: 3-20，对应 360° 到 ~0.01° 的视野
    // scale = log2(360 / span) ≈ 正确关系，微信地图每增加 1 级视野减半
    const latScale = Math.log2(180 / latSpan)
    const lngScale = Math.log2(360 / lngSpan)
    // 取较小值保证两个方向都能覆盖，并限制在 3~18 范围
    const autoScale = Math.max(3, Math.min(18, Math.floor(Math.min(latScale, lngScale))))

    return {
      center: { latitude: centerLat, longitude: centerLng },
      scale: autoScale,
    }
  }, [restaurant, participants])

  // compact=300px（已确认卡片内），默认=280px（推荐列表展开）
  const mapHeight = compact ? '300px' : '280px'

  return (
    <View className='restaurant-map'>
      <Map
        id={mapIdRef.current}
        className='map'
        latitude={center.latitude}
        longitude={center.longitude}
        scale={scale}
        markers={markers}
        polyline={polyline}
        showLocation={false}
        enableZoom
        enableScroll
        style={{ width: '100%', height: mapHeight }}
      />

      {/* 图例 */}
      <View className='legend'>
        <View className='legend-item'>
          <View className='legend-dot' style={{ background: '#dc2626' }} />
          <Text className='legend-text'>餐厅</Text>
        </View>
        {participants.map((p, i) => (
          <View key={p.id} className='legend-item'>
            <View className='legend-dot' style={{ background: COLORS[i % COLORS.length] }} />
            <Text className='legend-text'>{p.name}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
