import { View, Map, Text } from '@tarojs/components'
import { useMemo, useRef } from 'react'
import type { Restaurant, Participant } from '../utils/types'
import './RestaurantMap.scss'

// 图标路径 — 使用绝对路径（相对于小程序包根目录），不能 import（会被转 base64，Map marker 不支持）
const markerRestaurant = '/assets/marker-restaurant.png'
const markerBlue = '/assets/marker-person-blue.png'
const markerPurple = '/assets/marker-person-purple.png'
const markerAmber = '/assets/marker-person-amber.png'
const markerGreen = '/assets/marker-person-green.png'
const markerCyan = '/assets/marker-person-cyan.png'
const markerOrange = '/assets/marker-person-orange.png'
const markerPink = '/assets/marker-person-pink.png'
const markerRed = '/assets/marker-person-red.png'
const markerLime = '/assets/marker-person-lime.png'
const markerIndigo = '/assets/marker-person-indigo.png'

interface RestaurantMapProps {
  restaurant: Restaurant
  participants: Participant[]
  /** 紧凑模式：地图高度更小 */
  compact?: boolean
}

// 参与者颜色和对应图标
const PERSON_STYLES = [
  { hex: '#3b82f6', icon: markerBlue },
  { hex: '#8b5cf6', icon: markerPurple },
  { hex: '#f59e0b', icon: markerAmber },
  { hex: '#10b981', icon: markerGreen },
  { hex: '#06b6d4', icon: markerCyan },
  { hex: '#f97316', icon: markerOrange },
  { hex: '#ec4899', icon: markerPink },
  { hex: '#ef4444', icon: markerRed },
  { hex: '#84cc16', icon: markerLime },
  { hex: '#6366f1', icon: markerIndigo },
]

function getPersonStyle(index: number) {
  return PERSON_STYLES[index % PERSON_STYLES.length]
}

let _mapIdCounter = 0

export default function RestaurantMap({ restaurant, participants, centerOnRestaurant = false, compact = false }: RestaurantMapProps) {
  const mapIdRef = useRef(`restaurant-map-${_mapIdCounter++}`)

  // 构建 markers
  const markers = useMemo(() => {
    const list: any[] = []

    // 餐厅标记 — 红色圆点 + label 显示名称
    list.push({
      id: 0,
      latitude: restaurant.lat,
      longitude: restaurant.lng,
      iconPath: markerRestaurant,
      width: 24,
      height: 24,
      anchor: { x: 0.5, y: 0.5 },
      label: {
        content: restaurant.name,
        color: '#dc2626',
        fontSize: 11,
        fontWeight: 'bold' as any,
        bgColor: '#ffffffee',
        borderRadius: 4,
        padding: 4,
        anchorX: 0,
        anchorY: -38,
        textAlign: 'center',
      },
    })

    // 参与者标记 — 每人不同颜色
    participants.forEach((p, i) => {
      const style = getPersonStyle(i)
      list.push({
        id: i + 1,
        latitude: p.location.lat,
        longitude: p.location.lng,
        iconPath: style.icon,
        width: 20,
        height: 20,
        anchor: { x: 0.5, y: 0.5 },
        label: {
          content: p.name,
          color: style.hex,
          fontSize: 10,
          fontWeight: 'bold' as any,
          bgColor: '#ffffffee',
          borderRadius: 4,
          padding: 3,
          anchorX: 0,
          anchorY: -32,
          textAlign: 'center',
        },
      })
    })

    return list
  }, [restaurant, participants])

  // 连线 — 颜色与参与者对应
  const polyline = useMemo(() => {
    return participants.map((p, i) => {
      const style = getPersonStyle(i)
      return {
        points: [
          { latitude: p.location.lat, longitude: p.location.lng },
          { latitude: restaurant.lat, longitude: restaurant.lng },
        ],
        color: style.hex + '60',
        width: 1,
        dottedLine: true,
      }
    })
  }, [restaurant, participants])

  // 手动计算地图中心和缩放级别（最可靠，一步到位无跳动）
  const { center, scale } = useMemo(() => {
    const allLats = [restaurant.lat, ...participants.map(p => p.location.lat)]
    const allLngs = [restaurant.lng, ...participants.map(p => p.location.lng)]

    const minLat = Math.min(...allLats)
    const maxLat = Math.max(...allLats)
    const minLng = Math.min(...allLngs)
    const maxLng = Math.max(...allLngs)

    const centerLat = (minLat + maxLat) / 2
    const centerLng = (minLng + maxLng) / 2

    // 计算跨度（公里）
    const latSpanKm = (maxLat - minLat) * 111
    const lngSpanKm = (maxLng - minLng) * 111 * Math.cos(centerLat * Math.PI / 180)
    const maxSpanKm = Math.max(latSpanKm, lngSpanKm, 0.5) // 至少 0.5km

    // 用数学公式精确计算 scale
    // 微信 map 的 scale 等同于标准瓦片 zoom level（基于逻辑像素）
    // 公式：可视宽度(m) = C × cos(lat) × screenPt / 2^(zoom+8)
    // 目标：标记点跨度占可视宽度的 ~75%（留 25% 边距给标签和边缘）
    const C = 40075016.686 // 地球赤道周长（米）
    const cosLat = Math.cos(centerLat * Math.PI / 180)
    const screenPt = 375 // iPhone 逻辑像素宽度（微信 map 基于此渲染）
    const idealZoom = Math.log2(C * cosLat * screenPt / (maxSpanKm * 1000 / 0.75)) - 8
    const s = Math.max(5, Math.min(18, Math.floor(idealZoom)))

    return {
      center: { latitude: centerLat, longitude: centerLng },
      scale: s,
    }
  }, [restaurant, participants])

  const mapHeight = compact ? '600rpx' : '560rpx'

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
        enable3D={false}
        enableZoom
        enableScroll
        style={{ width: '100%', height: mapHeight }}
      />

      {/* 图例 — 颜色与地图标记一致 */}
      <View className='legend'>
        <View className='legend-item'>
          <View className='legend-dot legend-dot--restaurant' />
          <Text className='legend-text'>餐厅</Text>
        </View>
        {participants.map((p, i) => {
          const style = getPersonStyle(i)
          return (
            <View key={p.id} className='legend-item'>
              <View className='legend-dot' style={{ background: style.hex }} />
              <Text className='legend-text'>{p.name}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
