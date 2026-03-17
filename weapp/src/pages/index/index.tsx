import { View, Text, Input, Picker, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useMemo, useCallback } from 'react'
import LocationPicker from '../../components/LocationPicker'
import { createGathering, storage, getDefaultTitle, getTodayStr, getDateStr, getMyGatherings, saveMyGatheringId, deleteGatheringById, removeMyGatheringId } from '../../utils/api'
import type { Location, MealType, DiningType, Gathering } from '../../utils/types'
import './index.scss'

// 餐段选项
const MEAL_OPTIONS = [
  { type: 'lunch' as MealType, label: '午饭', emoji: '☀️', defaultHour: 12, defaultMinute: 0 },
  { type: 'dinner' as MealType, label: '晚饭', emoji: '🌅', defaultHour: 18, defaultMinute: 0 },
  { type: 'any' as MealType, label: '不限', emoji: '🕐', defaultHour: 15, defaultMinute: 0 },
]

// 聚餐类型选项
const DINING_OPTIONS = [
  { type: 'light' as DiningType, label: '轻餐', emoji: '☕', desc: '咖啡快餐' },
  { type: 'formal' as DiningType, label: '正餐', emoji: '🍽️', desc: '正式聚餐' },
  { type: 'late_night' as DiningType, label: '夜宵', emoji: '🍢', desc: '烧烤小酒' },
  { type: 'any' as DiningType, label: '不限', emoji: '🎲', desc: '看推荐' },
]

// 餐段 → 默认聚餐类型
const MEAL_DEFAULT_DINING: Record<MealType, DiningType> = {
  lunch: 'formal',
  dinner: 'formal',
  any: 'any',
}

// 各餐段的可选时间范围
const MEAL_TIME_RANGE: Record<MealType, { minHour: number; maxHour: number }> = {
  lunch:  { minHour: 11, maxHour: 14 },   // 午饭 11:00-14:00
  dinner: { minHour: 17, maxHour: 24 },   // 晚饭 17:00-24:00
  any:    { minHour: 0,  maxHour: 24 },   // 不限 全天
}

// 生成时间选项（如果是今天，过滤掉已过去的时间）
function generateTimeOptions(mealType: MealType, selectedDate: string): string[] {
  const { minHour, maxHour } = MEAL_TIME_RANGE[mealType]

  const slots: string[] = []
  for (let h = minHour; h < maxHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  // 添加最后一个整点（如 14:00、24:00 显示为 00:00）
  if (maxHour < 24) {
    slots.push(`${String(maxHour).padStart(2, '0')}:00`)
  }

  // 如果选的是今天，过滤掉已过去的时间
  if (selectedDate === getTodayStr()) {
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    return slots.filter(t => {
      const [hh, mm] = t.split(':').map(Number)
      return hh * 60 + mm > nowMinutes
    })
  }

  return slots
}

function getMealDefaultTime(mealType: MealType): string {
  const opt = MEAL_OPTIONS.find(o => o.type === mealType)!
  return `${String(opt.defaultHour).padStart(2, '0')}:${String(opt.defaultMinute).padStart(2, '0')}`
}

// 判断某餐段在指定日期是否还有可用时间
function isMealAvailable(mealType: MealType, selectedDate: string): boolean {
  return generateTimeOptions(mealType, selectedDate).length > 0
}

// 获取当前日期下第一个可用的餐段
function getAvailableMeal(selectedDate: string, preferredMeal: MealType): MealType {
  if (isMealAvailable(preferredMeal, selectedDate)) return preferredMeal
  // 按优先级尝试：dinner > lunch > any
  const fallbackOrder: MealType[] = ['dinner', 'lunch', 'any']
  for (const m of fallbackOrder) {
    if (isMealAvailable(m, selectedDate)) return m
  }
  return preferredMeal // 全部不可用时保持原样（明天的情况）
}

// 判断今天是否还有任何可约的时间段
function isTodayAvailable(): boolean {
  const today = getTodayStr()
  return MEAL_OPTIONS.some(opt => isMealAvailable(opt.type, today))
}

// 获取最早可选日期（如果今天已无可选时段则从明天开始）
function getEarliestDate(): string {
  return isTodayAvailable() ? getTodayStr() : getDateStr(1)
}

// 获取最晚可选日期（从今天起1个月内）
function getLatestDate(): string {
  return getDateStr(30)
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface DateOption {
  date: string      // YYYY-MM-DD
  label: string     // 今天 / 明天 / 后天 / 周X
  subLabel: string  // M/D
  isWeekend: boolean
}

// 生成可选日期列表
function generateDateOptions(): DateOption[] {
  const earliest = getEarliestDate()
  const today = getTodayStr()
  const options: DateOption[] = []

  for (let i = 0; i <= 30; i++) {
    const dateStr = getDateStr(i)
    if (dateStr < earliest) continue

    const d = new Date(dateStr + 'T00:00:00')
    const dayOfWeek = d.getDay()
    const month = d.getMonth() + 1
    const day = d.getDate()

    // 计算与今天的天数差
    const diffFromToday = Math.round((d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)

    let label: string
    if (diffFromToday === 0) label = '今天'
    else if (diffFromToday === 1) label = '明天'
    else if (diffFromToday === 2) label = '后天'
    else label = WEEKDAY_NAMES[dayOfWeek]

    options.push({
      date: dateStr,
      label,
      subLabel: `${month}/${day}`,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    })
  }
  return options
}

// 判断饭局是否过期超过N小时
function isExpiredByHours(gathering: Gathering, hours: number): boolean {
  const gatheringTime = new Date(`${gathering.date}T${gathering.time || '23:59'}:00`)
  return Date.now() > gatheringTime.getTime() + hours * 60 * 60 * 1000
}

// 判断饭局是否「活跃」（还没过期12小时 = 仍然存在）
// 不管是 open 还是 confirmed，只要没过期超12小时就算活跃
function isGatheringActive(gathering: Gathering): boolean {
  return !isExpiredByHours(gathering, 12)
}

// 格式化饭局状态标签
function getStatusInfo(gathering: Gathering): { label: string; color: string } {
  if (gathering.status === 'confirmed') {
    return { label: '已确认', color: '#16a34a' }
  }
  // 判断是否过期
  const gatheringTime = new Date(`${gathering.date}T${gathering.time || '23:59'}:00`)
  if (gatheringTime.getTime() < Date.now()) {
    return { label: '已过期', color: '#9ca3af' }
  }
  return { label: '进行中', color: '#f97316' }
}

// 格式化日期显示
function formatGatheringDate(date: string, time: string): string {
  const d = new Date(date + 'T00:00:00')
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const weekDay = weekDays[d.getDay()]
  return `${month}/${day} 周${weekDay} ${time}`
}

export default function Index() {
  const [step, setStep] = useState<'home' | 'create'>('home')
  const [title, setTitle] = useState(getDefaultTitle())
  const [isTitleManuallyEdited, setIsTitleManuallyEdited] = useState(false) // 标记用户是否手动修改过标题
  const [creatorName, setCreatorName] = useState(() => storage.get('yuefan_username') || '')
  const [date, setDate] = useState(() => getEarliestDate())
  const [meal, setMeal] = useState<MealType>(() => {
    const d = getEarliestDate()
    return getAvailableMeal(d, 'dinner')
  })
  const [timeStr, setTimeStr] = useState(() => {
    const d = getEarliestDate()
    const m = getAvailableMeal(d, 'dinner')
    const options = generateTimeOptions(m, d)
    const defaultTime = getMealDefaultTime(m)
    if (options.includes(defaultTime)) return defaultTime
    return options.length > 0 ? options[0] : defaultTime
  })
  const [diningType, setDiningType] = useState<DiningType>(() => {
    const d = getEarliestDate()
    const m = getAvailableMeal(d, 'dinner')
    return MEAL_DEFAULT_DINING[m]
  })
  const [location, setLocation] = useState<Location | null>(() => storage.getJSON<Location>('yuefan_location'))
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 我的饭局
  const [myGatherings, setMyGatherings] = useState<Gathering[]>([])
  const [loadingGatherings, setLoadingGatherings] = useState(false)

  // 每次页面显示时刷新我的饭局
  useDidShow(() => {
    if (step === 'home') {
      loadMyGatherings()
    }
  })

  const loadMyGatherings = useCallback(async () => {
    setLoadingGatherings(true)
    try {
      const list = await getMyGatherings()
      // 过滤掉过期超过12小时的饭局
      const visible = list.filter(g => !isExpiredByHours(g, 12))
      setMyGatherings(visible)
      // 清理过期超过12小时的本地ID
      const expiredIds = list.filter(g => isExpiredByHours(g, 12)).map(g => g.id)
      expiredIds.forEach(id => removeMyGatheringId(id))
    } catch (err) {
      console.error('获取我的饭局失败:', err)
    } finally {
      setLoadingGatherings(false)
    }
  }, [])

  const timeOptions = useMemo(() => generateTimeOptions(meal, date), [meal, date])
  const timeIndex = useMemo(() => {
    const idx = timeOptions.indexOf(timeStr)
    return idx >= 0 ? idx : 0
  }, [timeOptions, timeStr])

  const dateOptions = useMemo(() => generateDateOptions(), [])

  const handleDateSelect = useCallback((newDate: string) => {
    setDate(newDate)

    // 如果标题是系统默认的（未被用户手动修改），自动更新为新日期对应的"周X聚餐"
    if (!isTitleManuallyEdited) {
      const d = new Date(newDate + 'T00:00:00')
      const days = ['日', '一', '二', '三', '四', '五', '六']
      setTitle(`周${days[d.getDay()]}聚餐`)
    }

    // 日期变化后，检查当前餐段是否仍可用
    if (!isMealAvailable(meal, newDate)) {
      const newMeal = getAvailableMeal(newDate, meal)
      setMeal(newMeal)
      const options = generateTimeOptions(newMeal, newDate)
      const defaultTime = getMealDefaultTime(newMeal)
      setTimeStr(options.includes(defaultTime) ? defaultTime : (options[0] || defaultTime))
      setDiningType(MEAL_DEFAULT_DINING[newMeal])
    } else {
      // 餐段可用，但当前时间可能不在列表中
      const options = generateTimeOptions(meal, newDate)
      if (options.length > 0 && !options.includes(timeStr)) {
        setTimeStr(options[0])
      }
    }
  }, [meal, timeStr, isTitleManuallyEdited])

  const handleMealChange = useCallback((mealType: MealType) => {
    setMeal(mealType)
    const defaultTime = getMealDefaultTime(mealType)
    const options = generateTimeOptions(mealType, date)
    // 优先用默认时间，不可用则选第一个可用时间
    if (options.includes(defaultTime)) {
      setTimeStr(defaultTime)
    } else if (options.length > 0) {
      setTimeStr(options[0])
    } else {
      setTimeStr(defaultTime)
    }
    setDiningType(MEAL_DEFAULT_DINING[mealType])
  }, [date])

  const handleCreate = useCallback(async () => {
    if (!title.trim() || !creatorName.trim() || !location) {
      Taro.showToast({ title: '请填写完整信息', icon: 'none' })
      return
    }

    // 校验饭局时间不早于当前时间
    const [hh, mm] = timeStr.split(':').map(Number)
    const gatheringTime = new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`)
    if (gatheringTime.getTime() <= Date.now()) {
      Taro.showToast({ title: '饭局时间不能早于当前时间', icon: 'none' })
      return
    }

    setIsSubmitting(true)
    try {
      const mealLabel = MEAL_OPTIONS.find(m => m.type === meal)?.label || '晚饭'
      const data = await createGathering({
        title: title.trim(),
        creatorName: creatorName.trim(),
        date,
        time: timeStr,
        meal: mealLabel,
        diningType,
        location,
      })

      if (data.gathering) {
        storage.set('yuefan_username', creatorName.trim())
        storage.setJSON('yuefan_location', location)
        storage.set(`creator_${data.gathering.id}`, data.creatorId)
        storage.set(`participant_${data.gathering.id}`, data.creatorId)
        saveMyGatheringId(data.gathering.id)

        Taro.navigateTo({
          url: `/pages/gathering/index?id=${data.gathering.id}`,
        })
      }
    } catch (err) {
      console.error('创建失败:', err)
      Taro.showToast({ title: '创建失败，请重试', icon: 'none' })
    } finally {
      setIsSubmitting(false)
    }
  }, [title, creatorName, location, date, timeStr, meal, diningType])

  // =============== 首页 Hero ===============
  if (step === 'home') {
    return (
      <View className='page-home'>
        <View className='hero'>
          <View className='food-icons'>
            <Text className='food-sm'>🍲</Text>
            <Text className='food-lg'>🍖</Text>
            <Text className='food-xl'>🍜</Text>
            <Text className='food-md'>☕</Text>
            <Text className='food-sm'>🍰</Text>
          </View>
          <Text className='hero-title'>让约饭更简单</Text>
          <Text className='hero-desc'>一键觅得折中地，方寸图开会有期</Text>
        </View>

        <View className='features'>
          <View className='features-row'>
            <View className='feature-item'>
              <Text className='feature-emoji'>📍</Text>
              <Text className='feature-text'>各自选位置</Text>
            </View>
            <View className='step-connector'>
              <View className='connector-line' />
              <View className='connector-dot' />
            </View>
            <View className='feature-item'>
              <Text className='feature-emoji'>🧠</Text>
              <Text className='feature-text'>AI智能推荐</Text>
            </View>
          </View>
          <View className='step-connector-vertical'>
            <View className='connector-line-v' />
          </View>
          <View className='features-row'>
            <View className='feature-item'>
              <Text className='feature-emoji'>🗳️</Text>
              <Text className='feature-text'>投票参考</Text>
            </View>
            <View className='step-connector'>
              <View className='connector-line' />
              <View className='connector-dot' />
            </View>
            <View className='feature-item'>
              <Text className='feature-emoji'>👑</Text>
              <Text className='feature-text'>发起人决定</Text>
            </View>
          </View>
        </View>

        <View className='cta-btn' onClick={() => {
          // 检查是否已有自己创建的活跃饭局
          const myActiveGathering = myGatherings.find(g =>
            !!storage.get(`creator_${g.id}`) && isGatheringActive(g)
          )
          if (myActiveGathering) {
            Taro.showModal({
              title: '已有进行中的饭局',
              content: `你已创建了「${myActiveGathering.title}」，同一时间只能有一个活跃饭局。请先删除后再创建新的。`,
              confirmText: '去查看',
              cancelText: '知道了',
              success: (res) => {
                if (res.confirm) {
                  Taro.navigateTo({ url: `/pages/gathering/index?id=${myActiveGathering.id}` })
                }
              }
            })
            return
          }
          setStep('create')
        }}>
          <Text className='cta-text'>🎉 发起饭局</Text>
        </View>



        {/* 我的饭局列表 */}
        {(myGatherings.length > 0 || loadingGatherings) && (
          <View className='my-gatherings'>
            <View className='section-header'>
              <Text className='section-title'>📋 我的饭局</Text>
              <Text className='section-count'>{myGatherings.length}个</Text>
            </View>

            {loadingGatherings && myGatherings.length === 0 && (
              <View className='loading-hint'>
                <Text className='loading-text'>加载中...</Text>
              </View>
            )}

            {myGatherings.map(g => {
              const statusInfo = getStatusInfo(g)
              const isCreator = !!storage.get(`creator_${g.id}`)
              return (
                <View
                  key={g.id}
                  className='gathering-card'
                  onClick={() => Taro.navigateTo({ url: `/pages/gathering/index?dinnerID=${g.id}` })}
                >
                  <View className='gathering-header'>
                    <Text className='gathering-title'>{g.title}</Text>
                    <View className='status-badge' style={{ background: statusInfo.color }}>
                      <Text className='status-text'>{statusInfo.label}</Text>
                    </View>
                  </View>
                  <View className='gathering-info'>
                    <Text className='info-item'>🕐 {formatGatheringDate(g.date, g.time)}</Text>
                    <Text className='info-item'>👥 {g.participants.length}人</Text>
                    {isCreator && <Text className='creator-badge'>发起人</Text>}
                  </View>
                  {g.confirmedRestaurant && (
                    <View className='confirmed-restaurant'>
                      <Text className='restaurant-name'>📍 {g.confirmedRestaurant.name}</Text>
                    </View>
                  )}
                  {isCreator && (
                    <View
                      className='delete-btn'
                      onClick={(e) => {
                        e.stopPropagation()
                        Taro.showModal({
                          title: '确认删除',
                          content: `确定要删除「${g.title}」吗？删除后其他参与者也将无法查看。`,
                          confirmColor: '#ef4444',
                          success: async (res) => {
                            if (res.confirm) {
                              try {
                                const creatorId = storage.get(`creator_${g.id}`)
                                if (creatorId) {
                                  await deleteGatheringById(g.id, creatorId)
                                } else {
                                  removeMyGatheringId(g.id)
                                }
                                setMyGatherings(prev => prev.filter(item => item.id !== g.id))
                                Taro.showToast({ title: '已删除', icon: 'success' })
                              } catch {
                                Taro.showToast({ title: '删除失败', icon: 'none' })
                              }
                            }
                          }
                        })
                      }}
                    >
                      <Text className='delete-text'>删除</Text>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )}
      </View>
    )
  }

  // =============== 创建饭局表单 ===============
  return (
    <View className='page-create'>
      <View className='top-bar'>
        <View className='back-btn' onClick={() => setStep('home')}>
          <Text className='back-arrow'>←</Text>
        </View>
        <Text className='top-title'>🎊 发起饭局</Text>
        <View className='top-placeholder' />
      </View>

      <View className='form-card'>
        {/* 饭局名称 */}
        <View className='form-group'>
          <Text className='form-label'>饭局名称 <Text className='required'>*</Text></Text>
          <Input
            className='form-input'
            value={title}
            onInput={(e) => {
              setTitle(e.detail.value)
              setIsTitleManuallyEdited(true)
            }}
            placeholder='例：周五庆功宴'
          />
        </View>

        {/* 你的名字 */}
        <View className='form-group'>
          <Text className='form-label'>你的名字 <Text className='required'>*</Text></Text>
          <Input
            className='form-input'
            value={creatorName}
            maxlength={8}
            onInput={(e) => setCreatorName(e.detail.value)}
            placeholder='输入你的名字（1-8字）'
          />
        </View>

        {/* 日期选择 - 横向滑动卡片 */}
        <View className='form-group'>
          <Text className='form-label'>日期</Text>
          <ScrollView scrollX className='date-scroll' enhanced showScrollbar={false}>
            <View className='date-list'>
              {dateOptions.map(opt => (
                <View
                  key={opt.date}
                  className={`date-card ${date === opt.date ? 'selected' : ''} ${opt.isWeekend ? 'weekend' : ''}`}
                  onClick={() => handleDateSelect(opt.date)}
                >
                  <Text className='date-label'>{opt.label}</Text>
                  <Text className='date-sub'>{opt.subLabel}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* 餐段选择 */}
        <View className='form-group'>
          <Text className='form-label'>时间</Text>
          <View className='option-grid cols-3'>
            {MEAL_OPTIONS.map(opt => {
              const isSelected = meal === opt.type
              const available = isMealAvailable(opt.type, date)
              return (
                <View
                  key={opt.type}
                  className={`option-card ${isSelected ? 'selected' : ''} ${!available ? 'disabled-card' : ''}`}
                  onClick={() => available && handleMealChange(opt.type)}
                >
                  <Text className='option-emoji'>{opt.emoji}</Text>
                  <Text className='option-label'>{opt.label}</Text>
                  <Text className='option-sub'>
                    {!available ? '已过' : (opt.type === 'any' ? '随时' : (isSelected ? timeStr : getMealDefaultTime(opt.type)))}
                  </Text>
                  {isSelected && available && <View className='check-badge'>✓</View>}
                </View>
              )
            })}
          </View>

          {/* 时间微调 */}
          <View className='time-adjust'>
            <Text className='time-label'>具体时间</Text>
            {timeOptions.length > 0 ? (
              <Picker
                mode='selector'
                range={timeOptions}
                value={timeIndex}
                onChange={(e) => setTimeStr(timeOptions[Number(e.detail.value)])}
              >
                <View className='time-picker'>
                  <Text>{timeStr}</Text>
                  <Text className='picker-arrow'>▼</Text>
                </View>
              </Picker>
            ) : (
              <View className='time-picker time-expired'>
                <Text>今天该时段已过，请选其他日期</Text>
              </View>
            )}
          </View>
        </View>

        {/* 类型 */}
        <View className='form-group'>
          <Text className='form-label'>类型</Text>
          <View className='option-grid cols-4'>
            {DINING_OPTIONS.map(opt => {
              const isSelected = diningType === opt.type
              return (
                <View
                  key={opt.type}
                  className={`option-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => setDiningType(opt.type)}
                >
                  <Text className='option-emoji'>{opt.emoji}</Text>
                  <Text className='option-label'>{opt.label}</Text>
                  <Text className='option-sub'>{opt.desc}</Text>
                  {isSelected && <View className='check-badge'>✓</View>}
                </View>
              )
            })}
          </View>
        </View>

        {/* 位置选择 */}
        <View className='form-group'>
          <Text className='form-label'>你希望在什么地点附近 <Text className='required'>*</Text></Text>
          <LocationPicker
            value={location}
            onChange={setLocation}
            placeholder='搜索你方便的地点'
            autoLocate={!location}
          />
        </View>

        {/* 缺失项提示 */}
        {(!title.trim() || !creatorName.trim() || !location) && (
          <View className='missing-hint'>
            <Text className='missing-text'>
              还需填写：
              {[
                !title.trim() && '饭局名称',
                !creatorName.trim() && '你的名字',
                !location && '地点',
              ].filter(Boolean).join('、')}
            </Text>
          </View>
        )}

        {/* 提交按钮 */}
        <View
          className={`submit-btn ${(!title.trim() || !creatorName.trim() || !location || isSubmitting || timeOptions.length === 0) ? 'disabled' : ''}`}
          onClick={handleCreate}
        >
          <Text className='submit-text'>
            {isSubmitting ? '创建中...' : '创建饭局 🎉'}
          </Text>
        </View>
      </View>
    </View>
  )
}
