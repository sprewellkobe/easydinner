import { NextRequest, NextResponse } from 'next/server';
import {
  AMAP_API_KEY,
  AMAP_BASE_URL,
  RESTAURANT_DETAIL_RADIUS,
  RESTAURANT_DETAIL_FALLBACK_RADIUS,
  RESTAURANT_MAX_PHOTOS,
  RESTAURANT_MAX_TAGS,
} from '@/lib/config';

// 高德 POI 搜索获取餐厅详情
async function fetchRestaurantDetail(name: string, lng: number, lat: number) {
  if (!AMAP_API_KEY) return null;

  try {
    // 使用关键字+坐标搜索获取详细信息
    const url = `${AMAP_BASE_URL}/place/around?key=${AMAP_API_KEY}&location=${lng},${lat}&keywords=${encodeURIComponent(name)}&radius=${RESTAURANT_DETAIL_RADIUS}&types=050000&offset=1&page=1&extensions=all`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status === '1' && data.pois && data.pois.length > 0) {
      return data.pois[0];
    }

    // 兜底：不带关键字，直接按坐标搜
    const url2 = `${AMAP_BASE_URL}/place/around?key=${AMAP_API_KEY}&location=${lng},${lat}&radius=${RESTAURANT_DETAIL_FALLBACK_RADIUS}&types=050000&offset=1&page=1&extensions=all`;
    const res2 = await fetch(url2);
    const data2 = await res2.json();

    if (data2.status === '1' && data2.pois && data2.pois.length > 0) {
      return data2.pois[0];
    }
  } catch (err) {
    console.error('查询餐厅详情失败:', err);
  }

  return null;
}

// 解析高德 biz_ext 字段
function parseBizExt(poi: Record<string, unknown>) {
  const bizExt = poi.biz_ext as Record<string, string> | undefined;
  if (!bizExt) return {};

  return {
    rating: bizExt.rating ? parseFloat(bizExt.rating) : undefined,
    cost: bizExt.cost ? parseFloat(bizExt.cost) : undefined, // 人均消费
    meal_ordering: bizExt.meal_ordering, // 是否可订餐
    opentime_today: bizExt.opentime_today, // 今日营业时间
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  const lng = parseFloat(searchParams.get('lng') || '0');
  const lat = parseFloat(searchParams.get('lat') || '0');

  if (!name || !lng || !lat) {
    return NextResponse.json({ error: '缺少参数' }, { status: 400 });
  }

  const poi = await fetchRestaurantDetail(name, lng, lat);

  if (!poi) {
    // 没有高德 API 或没找到，返回基于现有数据的信息
    return NextResponse.json({
      detail: {
        name,
        address: '',
        tel: '',
        rating: 0,
        cost: 0,
        openTime: '',
        photos: [],
        tags: [],
        tips: [],
      },
    });
  }

  // 提取有用信息
  const bizInfo = parseBizExt(poi);

  // 照片
  const photos: string[] = [];
  if (poi.photos && Array.isArray(poi.photos)) {
    for (const p of poi.photos.slice(0, RESTAURANT_MAX_PHOTOS)) {
      if (p.url) photos.push(p.url);
    }
  }

  // 从 type 解析标签
  const typeStr = (poi.type || '') as string;
  const tags = typeStr.split(';').filter(Boolean).slice(0, RESTAURANT_MAX_TAGS);

  // 构造返回数据
  const detail = {
    name: poi.name || name,
    address: poi.address || '',
    tel: poi.tel || '',
    rating: bizInfo.rating || 0,
    cost: bizInfo.cost || 0,
    openTime: bizInfo.opentime_today || '',
    photos,
    tags,
    // 基于类型和名称生成实用提示
    tips: generateTips(poi.name as string, typeStr, bizInfo),
  };

  return NextResponse.json({ detail });
}

// 基于餐厅信息生成实用提示
function generateTips(
  name: string,
  type: string,
  bizInfo: { rating?: number; cost?: number; opentime_today?: string }
): string[] {
  const tips: string[] = [];

  // 根据名称/类型推断
  const nameStr = (name || '').toLowerCase();
  const typeStr = (type || '').toLowerCase();

  // 排队提示
  if (
    nameStr.includes('海底捞') ||
    nameStr.includes('太二') ||
    nameStr.includes('外婆家') ||
    nameStr.includes('绿茶') ||
    nameStr.includes('鼎泰丰') ||
    nameStr.includes('喜茶')
  ) {
    tips.push('🔥 热门餐厅，建议提前到店或线上取号避免排队');
  }

  // 火锅类提示
  if (typeStr.includes('火锅') || nameStr.includes('火锅') || nameStr.includes('涮')) {
    tips.push('🍲 火锅类，用餐时间较长，建议预留 1.5-2 小时');
  }

  // 烧烤/烤鱼类
  if (typeStr.includes('烧烤') || nameStr.includes('烤') || nameStr.includes('烧烤') || nameStr.includes('探鱼')) {
    tips.push('🔥 烧烤/烤制类菜品，出菜需要时间，不着急慢慢享用');
  }

  // 人均消费提示
  if (bizInfo.cost && bizInfo.cost > 0) {
    if (bizInfo.cost > 200) {
      tips.push(`💰 人均 ¥${bizInfo.cost.toFixed(0)}，属于高端消费，建议提前预约`);
    } else if (bizInfo.cost > 100) {
      tips.push(`💰 人均 ¥${bizInfo.cost.toFixed(0)}，消费适中`);
    } else {
      tips.push(`💰 人均 ¥${bizInfo.cost.toFixed(0)}，性价比不错`);
    }
  }

  // 营业时间提示
  if (bizInfo.opentime_today) {
    tips.push(`🕐 今日营业: ${bizInfo.opentime_today}`);
  }

  // 评分提示
  if (bizInfo.rating && bizInfo.rating >= 4.5) {
    tips.push('⭐ 高分餐厅，口碑很好');
  }

  // 通用提示
  if (tips.length === 0) {
    tips.push('📱 建议提前查看是否需要排队或预约');
  }

  return tips;
}
