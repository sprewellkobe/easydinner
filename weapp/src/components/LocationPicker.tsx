import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback, useRef, useEffect } from 'react'
import type { Location } from '../utils/types'
import './LocationPicker.scss'

interface LocationPickerProps {
  value: Location | null
  onChange: (location: Location) => void
  placeholder?: string
  /** 是否在组件挂载时自动获取当前定位 */
  autoLocate?: boolean
}

export default function LocationPicker({ value, onChange, placeholder = '点击选择地点', autoLocate = false }: LocationPickerProps) {
  const [locating, setLocating] = useState(false)
  const autoLocatedRef = useRef(false)

  // 自动定位：组件挂载时如果没有 value 且开启 autoLocate，则自动获取当前位置
  useEffect(() => {
    if (!autoLocate || value || autoLocatedRef.current) return
    autoLocatedRef.current = true

    setLocating(true)
    Taro.getLocation({
      type: 'gcj02',
      success: (res) => {
        onChange({
          name: '当前位置',
          lng: res.longitude,
          lat: res.latitude,
        })
        setLocating(false)
      },
      fail: (err) => {
        console.log('自动定位失败:', err.errMsg)
        setLocating(false)
      },
    })
  }, [autoLocate, value, onChange])

  // 打开微信原生位置选择器
  // 如果已有选中位置，传入其经纬度让地图以当前地址为中心
  const handleChooseLocation = useCallback(() => {
    const opts: Parameters<typeof Taro.chooseLocation>[0] = {
      success: (res) => {
        if (res.name || res.address) {
          onChange({
            name: res.name || res.address,
            lng: res.longitude,
            lat: res.latitude,
          })
        }
      },
      fail: (err) => {
        if (err.errMsg?.includes('cancel')) return
        console.error('选择位置失败:', err)
      },
    }

    // 已有位置时，以当前地址为中心打开地图
    if (value) {
      opts.latitude = value.lat
      opts.longitude = value.lng
    }

    Taro.chooseLocation(opts)
  }, [onChange, value])

  return (
    <View className='location-picker'>
      {/* 已选位置 */}
      {value && (
        <View className='selected-location' onClick={handleChooseLocation}>
          <Text className='selected-icon'>📍</Text>
          <Text className='selected-name'>{value.name}</Text>
          <Text className='selected-change'>更换</Text>
        </View>
      )}

      {/* 未选择时显示选择按钮 */}
      {!value && (
        <View className='search-section'>
          {locating ? (
            <View className='locating-hint'>
              <Text className='locating-icon'>📡</Text>
              <Text className='locating-text'>正在获取当前位置...</Text>
            </View>
          ) : (
            <View className='choose-location-btn' onClick={handleChooseLocation}>
              <Text className='choose-icon'>🗺️</Text>
              <Text className='choose-text'>{placeholder}</Text>
              <Text className='choose-arrow'>›</Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}
