import { View, Text, Input, ScrollView, Button } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage, useShareTimeline, useDidShow, useDidHide } from '@tarojs/taro'
import { useState, useEffect, useCallback, useRef } from 'react'
import LocationPicker from '../../components/LocationPicker'
import RestaurantMap from '../../components/RestaurantMap'
import {
  getGathering, joinGathering, getRecommendations,
  confirmRestaurant, voteRestaurant, storage, saveMyGatheringId,
} from '../../utils/api'
import { formatDistance } from '../../utils/geo'
import type { Gathering, Restaurant, Location } from '../../utils/types'
import './index.scss'

const DINING_TYPE_LABELS: Record<string, { emoji: string; label: string }> = {
  light: { emoji: '☕', label: '轻餐' },
  formal: { emoji: '🍽️', label: '正餐' },
  late_night: { emoji: '🍢', label: '夜宵' },
  nightsnack: { emoji: '🍢', label: '夜宵' },
  any: { emoji: '🎲', label: '不限' },
}

export default function GatheringPage() {
  const router = useRouter()
  const gatheringId = router.params.id || router.params.dinnerID || ''

  const [gathering, setGathering] = useState<Gathering | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 加入饭局表单
  const [showJoinForm, setShowJoinForm] = useState(false)
  const [joinName, setJoinName] = useState(() => storage.get('yuefan_username') || '')
  const [joinLocation, setJoinLocation] = useState<Location | null>(() => storage.getJSON<Location>('yuefan_location'))
  const [isJoining, setIsJoining] = useState(false)

  // 展开地图的餐厅
  const [expandedMapId, setExpandedMapId] = useState<string | null>(null)

  // 确认
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmingRestaurantId, setConfirmingRestaurantId] = useState<string | null>(null)

  // 投票
  const [votes, setVotes] = useState<Record<string, string[]>>({})
  const [votingId, setVotingId] = useState<string | null>(null)

  // 加载推荐中
  const [loadingRec, setLoadingRec] = useState(false)
  // 推荐失败原因（空字符串=无错误，'all_closed'=餐厅全打烊，其他=通用错误）
  const [recError, setRecError] = useState('')

  const currentParticipantId = storage.get(`participant_${gatheringId}`) || ''
  const isCreator = !!storage.get(`creator_${gatheringId}`)
  const hasJoined = !!storage.get(`participant_${gatheringId}`)

  // ---- 微信分享 ----
  useShareAppMessage(() => {
    if (gathering?.status === 'confirmed' && gathering.confirmedRestaurant) {
      return {
        title: `「${gathering.title}」定了！📍 ${gathering.confirmedRestaurant.name}`,
        path: `/pages/gathering/index?dinnerID=${gatheringId}`,
      }
    }
    return {
      title: gathering ? `${gathering.creatorName}邀请你参加「${gathering.title}」` : '来约饭吧！',
      path: `/pages/gathering/index?dinnerID=${gatheringId}`,
    }
  })

  useShareTimeline(() => {
    if (gathering?.status === 'confirmed' && gathering.confirmedRestaurant) {
      return {
        title: `「${gathering.title}」定了！📍 ${gathering.confirmedRestaurant.name}`,
        path: `/pages/gathering/index?dinnerID=${gatheringId}`,
      }
    }
    return {
      title: gathering ? `${gathering.creatorName}邀请你参加「${gathering.title}」` : '来约饭吧！',
      path: `/pages/gathering/index?dinnerID=${gatheringId}`,
    }
  })

  // ---- 数据获取 ----
  const fetchGathering = useCallback(async () => {
    try {
      const data = await getGathering(gatheringId)
      setGathering(data.gathering)
      if (data.gathering.votes) {
        setVotes(data.gathering.votes)
      }
      // 只要能成功访问这个饭局，就保存到"我的饭局"列表
      saveMyGatheringId(gatheringId)
    } catch {
      setError('饭局不存在或已过期')
    } finally {
      setLoading(false)
    }
  }, [gatheringId])

  const fetchRecommendations = useCallback(async () => {
    setLoadingRec(true)
    setRecError('')
    try {
      const data = await getRecommendations(gatheringId)
      if (data.restaurants && data.restaurants.length > 0) {
        setRestaurants(data.restaurants)
      } else if ((data as Record<string, unknown>).reason === 'all_closed') {
        // 所有餐厅因营业时间被过滤
        setRecError('all_closed')
      }
    } catch (err) {
      console.error('获取推荐失败:', err)
      setRecError('error')
    } finally {
      setLoadingRec(false)
    }
  }, [gatheringId])

  useEffect(() => {
    fetchGathering()
  }, [fetchGathering])

  // 页面可见性：后台时暂停轮询，前台时恢复
  const isPageVisibleRef = useRef(true)
  useDidShow(() => { isPageVisibleRef.current = true })
  useDidHide(() => { isPageVisibleRef.current = false })

  // 页面加载时拉取推荐（gathering 首次加载后），以及参与者人数变化时重新拉取
  const prevParticipantCountRef = useRef(-1)
  useEffect(() => {
    if (!gathering || gathering.participants.length === 0 || gathering.status === 'confirmed') return

    const currentCount = gathering.participants.length
    // 首次加载或参与者人数变化时拉取推荐
    if (prevParticipantCountRef.current !== currentCount) {
      prevParticipantCountRef.current = currentCount
      fetchRecommendations()
    }
  }, [gathering?.participants.length, gathering?.status])

  // 轮询：每5秒检查一次，页面不可见时跳过
  const participantCountRef = useRef(0)
  const statusRef = useRef<string>('')

  useEffect(() => {
    if (gathering) {
      participantCountRef.current = gathering.participants.length
      statusRef.current = gathering.status
    }
  }, [gathering])

  useEffect(() => {
    if (statusRef.current === 'confirmed') return

    const timer = setInterval(async () => {
      // 页面不可见时跳过轮询，节省流量和电量
      if (!isPageVisibleRef.current) return

      if (statusRef.current === 'confirmed') {
        clearInterval(timer)
        return
      }
      try {
        const data = await getGathering(gatheringId)
        if (data.gathering) {
          const g = data.gathering
          if (g.votes) setVotes(g.votes)

          if (g.status === 'confirmed') {
            setGathering(g)
            statusRef.current = 'confirmed'
            clearInterval(timer)
            return
          }

          if (g.participants.length !== participantCountRef.current) {
            setGathering(g)
            participantCountRef.current = g.participants.length
          }
        }
      } catch { /* 静默 */ }
    }, 5000)

    return () => clearInterval(timer)
  }, [gatheringId])

  // ---- 操作 ----
  const handleJoin = useCallback(async () => {
    if (!joinName.trim() || !joinLocation) {
      Taro.showToast({ title: '请填写名字并选择位置', icon: 'none' })
      return
    }
    setIsJoining(true)
    try {
      const data = await joinGathering(gatheringId, {
        name: joinName.trim(),
        location: joinLocation,
      })
      if (data.gathering) {
        storage.set('yuefan_username', joinName.trim())
        storage.setJSON('yuefan_location', joinLocation)
        storage.set(`participant_${gatheringId}`, data.participantId)
        saveMyGatheringId(gatheringId)
        setGathering(data.gathering)
        setShowJoinForm(false)
        setTimeout(fetchRecommendations, 300)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加入失败'
      if (message.length > 15) {
        // 长文本用弹窗展示（如距离过远提示）
        Taro.showModal({ title: '提示', content: message, showCancel: false })
      } else {
        Taro.showToast({ title: message, icon: 'none' })
      }
    } finally {
      setIsJoining(false)
    }
  }, [joinName, joinLocation, gatheringId])

  const handleVote = useCallback(async (restaurantId: string) => {
    if (!currentParticipantId || votingId) return

    // 前端拦截：如果是新投票（非取消），检查已投数量
    const alreadyVoted = votes[restaurantId]?.includes(currentParticipantId) || false
    if (!alreadyVoted) {
      const myVoteCount = Object.values(votes).filter(
        voterList => voterList.includes(currentParticipantId)
      ).length
      if (myVoteCount >= 3) {
        Taro.showToast({ title: '每人最多投3家餐厅', icon: 'none' })
        return
      }
    }

    setVotingId(restaurantId)
    try {
      const data = await voteRestaurant(gatheringId, {
        restaurantId,
        participantId: currentParticipantId,
      })
      if (data.votes) setVotes(data.votes)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('不在推荐列表') || msg.includes('刷新')) {
        Taro.showToast({ title: '餐厅列表已更新，正在刷新…', icon: 'none' })
        fetchRecommendations()
        fetchGathering()
      } else if (msg.includes('最多投')) {
        Taro.showToast({ title: msg, icon: 'none' })
      }
    } finally {
      setVotingId(null)
    }
  }, [currentParticipantId, votingId, gatheringId, votes, fetchRecommendations, fetchGathering])

  const handleConfirm = useCallback(async (restaurant: Restaurant) => {
    if (!isCreator) return

    if (confirmingRestaurantId !== restaurant.id) {
      setConfirmingRestaurantId(restaurant.id)
      setTimeout(() => setConfirmingRestaurantId(prev => prev === restaurant.id ? null : prev), 5000)
      return
    }

    setIsConfirming(true)
    setConfirmingRestaurantId(null)
    try {
      const creatorId = storage.get(`creator_${gatheringId}`) || ''
      const data = await confirmRestaurant(gatheringId, {
        restaurantId: restaurant.id,
        creatorId,
      })
      if (data.gathering) setGathering(data.gathering)
    } catch {
      Taro.showToast({ title: '确认失败，请重试', icon: 'none' })
    } finally {
      setIsConfirming(false)
    }
  }, [isCreator, confirmingRestaurantId, gatheringId])

  // 复制餐厅名称
  const copyRestaurantName = useCallback((name: string) => {
    Taro.setClipboardData({
      data: name,
      success: () => {
        Taro.hideToast()
        Taro.showToast({ title: '餐厅名已复制，可到大众点评或美团搜索查看', icon: 'none', duration: 3000 })
      },
    })
  }, [])

  // 点击餐厅名称：弹出操作菜单
  const handleRestaurantTap = useCallback((restaurant: Restaurant) => {
    Taro.showActionSheet({
      itemList: ['📋 复制餐厅名（去点评/美团查看）', '🧭 导航前往'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 复制餐厅名，提示用户自行搜索
          copyRestaurantName(restaurant.name)
        } else if (res.tapIndex === 1) {
          // 导航前往
          Taro.openLocation({
            latitude: restaurant.lat,
            longitude: restaurant.lng,
            name: restaurant.name,
            address: restaurant.address,
            scale: 16,
          })
        }
      },
    })
  }, [copyRestaurantName])

  // ---- 渲染 ----
  if (loading) {
    return (
      <View className='loading-page'>
        <Text className='loading-emoji'>🍜</Text>
        <Text className='loading-text'>加载中...</Text>
      </View>
    )
  }

  if (error || !gathering) {
    return (
      <View className='error-page'>
        <Text className='error-emoji'>😅</Text>
        <Text className='error-title'>找不到这个饭局</Text>
        <Text className='error-desc'>{error || '饭局可能已过期或链接有误'}</Text>
        <View className='error-btn' onClick={() => Taro.navigateBack()}>
          <Text className='error-btn-text'>返回首页</Text>
        </View>
      </View>
    )
  }

  const isConfirmed = gathering.status === 'confirmed'

  // 按投票数排序餐厅
  const sortedRestaurants = [...restaurants].sort((a, b) => {
    const votesA = votes[a.id]?.length || 0
    const votesB = votes[b.id]?.length || 0
    if (votesB !== votesA) return votesB - votesA
    return (a.avgDistance || 0) - (b.avgDistance || 0)
  })

  return (
    <ScrollView scrollY className='gathering-page'>
      {/* ====== 头部信息 ====== */}
      <View className='header-card'>
        <View className='header-top'>
          <View className='header-info'>
            <View className='header-title-row'>
              <Text className='header-emoji'>🍽️</Text>
              <Text className='header-title'>{gathering.title}</Text>
            </View>
            <Text className='header-meta'>
              {gathering.creatorName} 发起 · {gathering.date}
              {gathering.meal ? ` ${gathering.meal}` : ''} {gathering.time || ''}
              {gathering.diningType && gathering.diningType !== 'any'
                ? ` · ${DINING_TYPE_LABELS[gathering.diningType]?.emoji || ''} ${DINING_TYPE_LABELS[gathering.diningType]?.label || ''}`
                : ''}
            </Text>
          </View>
          <View className={`status-badge ${isConfirmed ? 'confirmed' : 'active'}`}>
            <Text className='status-text'>{isConfirmed ? '✅ 已确认' : '🔥 进行中'}</Text>
          </View>
        </View>

        {/* 微信分享按钮 - 仅发起人可见 */}
        {!isConfirmed && isCreator && (
          <View className='share-btn-wrap'>
            <Button className='share-btn' openType='share'>
              <Text className='share-text'>📤 邀请好友加入饭局</Text>
            </Button>
          </View>
        )}
      </View>

      {/* ====== 已确认结果 ====== */}
      {isConfirmed && gathering.confirmedRestaurant && (
        <View className='confirmed-card'>
          <View className='confirmed-banner'>
            <Text className='confirmed-name'>{gathering.confirmedRestaurant.name}</Text>
            <Text className='confirmed-addr'>📍 {gathering.confirmedRestaurant.address}</Text>
          </View>

          {/* 地图 */}
          <View className='confirmed-map'>
            <RestaurantMap
              restaurant={gathering.confirmedRestaurant}
              participants={gathering.participants}
              compact
              centerOnRestaurant
            />
          </View>

          {/* 标签 + 导航按钮 合并一行 */}
          <View className='confirmed-action-row'>
            <View className='confirmed-tags-inline'>
              {gathering.confirmedRestaurant.rating && gathering.confirmedRestaurant.rating > 0 && (
                <Text className='tag-inline yellow'>⭐ {gathering.confirmedRestaurant.rating.toFixed(1)}</Text>
              )}
              {gathering.confirmedRestaurant.avgPrice && gathering.confirmedRestaurant.avgPrice > 0 && (
                <Text className='tag-inline'>💰 ¥{gathering.confirmedRestaurant.avgPrice}/人</Text>
              )}
              {gathering.confirmedRestaurant.avgDistance && (
                <Text className='tag-inline gray'>平均 {formatDistance(gathering.confirmedRestaurant.avgDistance)}</Text>
              )}
            </View>
            <View className='nav-btn-sm' onClick={() => handleRestaurantTap(gathering.confirmedRestaurant!)}>
              <Text className='nav-btn-sm-text'>🧭 导航 / 查看点评</Text>
            </View>
          </View>

          {/* 分享结论按钮 */}
          <View className='share-result-wrap'>
            <Button className='share-result-btn' openType='share'>
              <Text className='share-result-text'>📤 分享</Text>
            </Button>
          </View>
        </View>
      )}

      {/* ====== 参与者列表 ====== */}
      <View className='section-card'>
        <View className='section-header'>
          <Text className='section-title'>🍚 干饭人 ({gathering.participants.length})</Text>
        </View>

        {gathering.participants.map((p, i) => {
          // 已确认时，查找该参与者到餐厅的距离
          const distInfo = isConfirmed && gathering.confirmedRestaurant?.distanceToParticipants
            ? gathering.confirmedRestaurant.distanceToParticipants.find(d => d.participantId === p.id)
            : null
          const distColor = distInfo
            ? (distInfo.distance < 2000 ? '#22c55e' : distInfo.distance < 5000 ? '#f59e0b' : '#ef4444')
            : ''

          return (
            <View key={p.id} className='participant-row'>
              <View className='avatar' style={{ background: ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444'][i % 5] }}>
                <Text className='avatar-text'>{p.name[0]}</Text>
              </View>
              <View className='participant-info'>
                <View className='participant-name-row'>
                  <Text className='participant-name'>{p.name}</Text>
                  {p.id === gathering.creatorId && (
                    <View className='creator-badge'>
                      <Text className='creator-text'>发起人</Text>
                    </View>
                  )}
                </View>
                <Text className='participant-loc'>📍 {p.location.name}</Text>
              </View>
              {/* 已确认时显示到餐厅距离 */}
              {distInfo && (
                <View className='participant-distance'>
                  <Text className='participant-dist-value' style={{ color: distColor }}>
                    {formatDistance(distInfo.distance)}
                  </Text>
                  <View className='participant-dist-bar-bg'>
                    <View
                      className='participant-dist-bar'
                      style={{
                        width: `${Math.min(distInfo.distance / 10000, 1) * 100}%`,
                        background: distColor,
                      }}
                    />
                  </View>
                </View>
              )}
            </View>
          )
        })}

        {/* 加入按钮 / 表单 */}
        {!isConfirmed && !hasJoined && (
          <View className='join-section'>
            {!showJoinForm ? (
              <View className='join-trigger' onClick={() => setShowJoinForm(true)}>
                <Text className='join-trigger-text'>🙋 我也要参加</Text>
              </View>
            ) : (
              <View className='join-form'>
                <View className='form-group'>
                  <Text className='form-label'>你的名字</Text>
                  <Input
                    className='form-input'
                    value={joinName}
                    maxlength={-1}
                    onInput={(e) => {
                      const val = e.detail.value
                      setJoinName(val.length > 8 ? val.slice(0, 8) : val)
                    }}
                    placeholder='输入你的名字（1-8字）'
                  />
                </View>
                <View className='form-group'>
                  <Text className='form-label'>你方便的位置</Text>
                  <LocationPicker
                    value={joinLocation}
                    onChange={setJoinLocation}
                    placeholder='搜索你方便的地点'
                  />
                </View>
                <View className='join-actions'>
                  <View className='cancel-btn' onClick={() => setShowJoinForm(false)}>
                    <Text className='cancel-text'>取消</Text>
                  </View>
                  <View
                    className={`confirm-join-btn ${(!joinName.trim() || !joinLocation || isJoining) ? 'disabled' : ''}`}
                    onClick={handleJoin}
                  >
                    <Text className='confirm-join-text'>{isJoining ? '加入中...' : '加入饭局'}</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* ====== 餐厅推荐 ====== */}
      {!isConfirmed && gathering.participants.length > 0 && (
        <View className='section-card'>
          <View className='section-header'>
            <Text className='section-title'>🍴 推荐餐厅</Text>
            <Text className='section-hint'>👆 点击投票选出你中意的餐厅（每人最多3票）</Text>
          </View>

          {loadingRec && restaurants.length === 0 && (
            <View className='rec-loading'>
              <Text className='rec-loading-text'>🔍 正在搜索附近的餐厅...</Text>
            </View>
          )}

          {recError && restaurants.length === 0 && !loadingRec && (
            <View className='rec-error'>
              {recError === 'all_closed' ? (
                <>
                  <Text className='rec-error-text'>🌙 这个时间段附近的餐厅都打烊了</Text>
                  <Text className='rec-error-hint'>可以试试调整用餐时间，或换个时间段再看看</Text>
                </>
              ) : (
                <>
                  <Text className='rec-error-text'>😥 搜索餐厅失败</Text>
                  <View className='retry-btn' onClick={fetchRecommendations}>
                    <Text className='retry-text'>🔄 重新搜索</Text>
                  </View>
                </>
              )}
            </View>
          )}

          {sortedRestaurants.map((r, idx) => {
            const voteCount = votes[r.id]?.length || 0
            const hasVoted = votes[r.id]?.includes(currentParticipantId) || false

            return (
              <View key={r.id} className='restaurant-card'>
                {/* 排名标记 */}
                <View className='rank-badge'>
                  <Text className='rank-text'>{idx + 1}</Text>
                </View>

                {/* 名称行 + 投票 */}
                <View className='restaurant-header'>
                  <View className='restaurant-name-wrap' onClick={() => handleRestaurantTap(r)}>
                    <Text className='restaurant-name'>{r.name}</Text>
                    <Text className='nav-icon'>↗</Text>
                  </View>
                  <View className='vote-area'>
                    {hasJoined && (
                      <View
                        className={`vote-btn ${hasVoted ? 'voted' : ''} ${votingId === r.id ? 'voting' : ''}`}
                        onClick={() => handleVote(r.id)}
                      >
                        <Text className='vote-emoji'>{hasVoted ? '👍' : '👆'}</Text>
                        {voteCount > 0 && <Text className='vote-count'>{voteCount}</Text>}
                        <Text className='vote-label'>{hasVoted ? '已投' : '投票'}</Text>
                      </View>
                    )}
                    {!hasJoined && voteCount > 0 && (
                      <Text className='vote-only'>👍 {voteCount}票</Text>
                    )}
                  </View>
                </View>

                {/* 地址 */}
                <View className='restaurant-addr' onClick={() => setExpandedMapId(expandedMapId === r.id ? null : r.id)}>
                  <Text className='addr-icon'>📍</Text>
                  <Text className='addr-text'>{r.address}</Text>
                  <Text className={`addr-arrow ${expandedMapId === r.id ? 'open' : ''}`}>▼</Text>
                </View>

                {/* 标签行 + 确认按钮 */}
                <View className='restaurant-footer'>
                  <View className='restaurant-tags'>
                    {r.rating && r.rating > 0 && (
                      <Text className='tag-inline'>⭐ {r.rating.toFixed(1)}</Text>
                    )}
                    {r.avgPrice && r.avgPrice > 0 && (
                      <Text className='tag-inline'>💰 ¥{r.avgPrice}/人</Text>
                    )}
                    {r.avgDistance && (
                      <Text className='tag-inline gray'>平均 {formatDistance(r.avgDistance)}</Text>
                    )}
                  </View>

                  {isCreator && (
                    <View
                      className={`decide-btn ${confirmingRestaurantId === r.id ? 'confirming' : ''}`}
                      onClick={() => handleConfirm(r)}
                    >
                      <Text className='decide-text'>
                        {isConfirming ? '确认中...' : confirmingRestaurantId === r.id ? '确认？' : '就这了'}
                      </Text>
                    </View>
                  )}
                </View>

                {/* 交通信息 */}
                {r.transportation && (
                  <View className='transport-row'>
                    {r.transportation.subway && (
                      <Text className='transport-tag'>🚇 {r.transportation.subway.station} {r.transportation.subway.distance}m</Text>
                    )}
                    {r.transportation.taxi && (
                      <Text className='transport-tag'>
                        {r.transportation.taxi.estimatedCost <= 15 ? '🚕 好打车' : '🚕 较好打车'}
                      </Text>
                    )}
                    {r.transportation.bus && r.transportation.bus.routes > 0 && (
                      <Text className='transport-tag'>🚌 {r.transportation.bus.routes}条公交</Text>
                    )}
                  </View>
                )}

                {/* 展开地图 */}
                {expandedMapId === r.id && (
                  <View className='expanded-map'>
                    <RestaurantMap restaurant={r} participants={gathering.participants} centerOnRestaurant />
                  </View>
                )}

                {/* 每人距离 */}
                {r.distanceToParticipants && r.distanceToParticipants.length > 0 && (
                  <View className='mini-distances'>
                    <Text className='mini-dist-title'>各干饭人距离</Text>
                    {r.distanceToParticipants.map((d) => {
                      const ratio = Math.min(d.distance / 10000, 1)
                      const color = d.distance < 2000 ? '#22c55e' : d.distance < 5000 ? '#f59e0b' : '#ef4444'
                      return (
                        <View key={d.participantId} className='distance-row'>
                          <Text className='distance-name' style={{ color }}>{d.participantName}</Text>
                          <View className='distance-bar-bg'>
                            <View className='distance-bar' style={{ width: `${ratio * 100}%`, background: color }} />
                          </View>
                          <Text className='distance-value' style={{ color }}>{formatDistance(d.distance)}</Text>
                        </View>
                      )
                    })}
                  </View>
                )}
              </View>
            )
          })}
        </View>
      )}

      {/* 底部安全区 */}
      <View className='safe-area-bottom' style={{ height: '30px' }} />
    </ScrollView>
  )
}
