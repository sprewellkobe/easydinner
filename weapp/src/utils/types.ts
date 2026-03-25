/** 位置信息 */
export interface Location {
  name: string
  lng: number
  lat: number
}

/** 参与者 */
export interface Participant {
  id: string
  name: string
  location: Location
  joinedAt: string
}

/** 每个参与者到餐厅的距离信息 */
export interface ParticipantDistance {
  participantId: string
  participantName: string
  distance: number
  drivingTime?: number   // 驾车时间（分钟）
  transitTime?: number   // 公交时间（分钟）
}

/** 交通信息 */
export interface Transportation {
  subway?: {
    station: string
    line: string
    distance: number
  }
  taxi?: {
    estimatedCost: number
    estimatedTime: number
  }
  bus?: {
    routes: number
    nearestStop: string
    distance: number
  }
}

/** 餐厅 */
export interface Restaurant {
  id: string
  name: string
  address: string
  lng: number
  lat: number
  category: string
  rating?: number
  avgPrice?: number
  distance?: number
  avgDistance?: number
  distanceToParticipants?: ParticipantDistance[]
  transportation?: Transportation
  photos?: string[]
  openingHours?: string
  phone?: string
  tags?: string[]
  tips?: string[]
}

/** 聚餐类型 */
export type DiningType = 'light' | 'formal' | 'nightsnack' | 'late_night' | 'any'

/** 餐段 */
export type MealType = 'lunch' | 'dinner' | 'any'

/** 饭局 */
export interface Gathering {
  id: string
  title: string
  creatorId: string
  creatorName: string
  date: string
  time: string
  meal?: string
  diningType?: DiningType
  participants: Participant[]
  recommendedRestaurants: Restaurant[]
  confirmedRestaurant: Restaurant | null
  status: 'open' | 'confirmed'
  votes?: Record<string, string[]>
  createdAt: string
  lastRecommendParticipantIds?: string[]
  lastRecommendDiningType?: string
}
