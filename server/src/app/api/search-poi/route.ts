import { NextRequest, NextResponse } from 'next/server';
import {
  AMAP_API_KEY as AMAP_KEY,
  AMAP_BASE_URL,
  AMAP_REQUEST_TIMEOUT,
  SEARCH_POI_PAGE_SIZE,
  SEARCH_POI_MAX_RESULTS,
  DEFAULT_CENTER_LAT,
  DEFAULT_CENTER_LNG,
} from '@/lib/config';

/* eslint-disable @typescript-eslint/no-explicit-any */

// POI 搜索 API - 使用高德地图 Web 服务
// 同时调用「关键字搜索」和「输入提示」两个接口，合并去重，精度可达小区/门牌号

// 高德 POI 关键字搜索
async function amapPlaceSearch(keyword: string, city?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      key: AMAP_KEY,
      keywords: keyword,
      offset: '10',
      output: 'json',
    });
    if (city) params.set('city', city);
    // 不限定城市范围，允许搜到全国
    params.set('citylimit', 'false');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://restapi.amap.com/v3/place/text?${params.toString()}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === '1' && data.pois) {
      return data.pois;
    }
    return [];
  } catch (e) {
    console.error('[amap] place search failed:', (e as Error).message);
    return [];
  }
}

// 高德输入提示 (更擅长模糊匹配和地址补全)
async function amapInputTips(keyword: string, city?: string, location?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      key: AMAP_KEY,
      keywords: keyword,
      output: 'json',
    });
    if (city) params.set('city', city);
    if (location) params.set('location', location);
    // datatype: all (POI + 公交站 + 地址)
    params.set('datatype', 'all');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://restapi.amap.com/v3/assistant/inputtips?${params.toString()}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === '1' && data.tips) {
      return data.tips;
    }
    return [];
  } catch (e) {
    console.error('[amap] input tips failed:', (e as Error).message);
    return [];
  }
}

// 解析高德坐标字符串 "116.123,39.456" -> [lng, lat]
function parseLocation(loc: string): [number, number] | null {
  if (!loc || typeof loc !== 'string' || !loc.includes(',')) return null;
  const parts = loc.split(',');
  const lng = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  if (isNaN(lng) || isNaN(lat)) return null;
  return [lng, lat];
}

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword') || '';
  const userLat = parseFloat(request.nextUrl.searchParams.get('lat') || '39.9042');
  const userLng = parseFloat(request.nextUrl.searchParams.get('lng') || '116.4074');

  if (!keyword.trim()) {
    return NextResponse.json({ results: [] });
  }

  if (!AMAP_KEY) {
    console.error('[search-poi] AMAP_API_KEY not configured');
    return NextResponse.json({ results: [], error: '地图服务未配置' }, { status: 500 });
  }

  const locationStr = `${userLng},${userLat}`;

  // 同时调用两个接口，最大化搜索覆盖度
  const [pois, tips] = await Promise.all([
    amapPlaceSearch(keyword),
    amapInputTips(keyword, undefined, locationStr),
  ]);

  // 统一结果格式
  const resultMap = new Map<string, { name: string; address: string; lng: number; lat: number }>();

  // 处理 POI 搜索结果
  for (const poi of pois) {
    const loc = parseLocation(poi.location);
    if (!loc) continue;
    const key = `${loc[0].toFixed(5)},${loc[1].toFixed(5)}`;
    if (!resultMap.has(key)) {
      resultMap.set(key, {
        name: poi.name || '',
        address: poi.address && poi.address !== '[]' ? poi.address : (poi.cityname || '') + (poi.adname || ''),
        lng: loc[0],
        lat: loc[1],
      });
    }
  }

  // 处理输入提示结果
  for (const tip of tips) {
    const loc = parseLocation(tip.location);
    if (!loc) continue;
    const key = `${loc[0].toFixed(5)},${loc[1].toFixed(5)}`;
    if (!resultMap.has(key)) {
      resultMap.set(key, {
        name: tip.name || '',
        address: tip.address && tip.address !== '[]' ? tip.address : (tip.district || ''),
        lng: loc[0],
        lat: loc[1],
      });
    }
  }

  const results = Array.from(resultMap.values()).slice(0, SEARCH_POI_MAX_RESULTS);
  return NextResponse.json({ results });
}
