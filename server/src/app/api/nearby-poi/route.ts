import { NextRequest, NextResponse } from 'next/server';
import {
  AMAP_API_KEY,
  AMAP_BASE_URL,
  AMAP_REQUEST_TIMEOUT,
  NEARBY_POI_RADIUS,
  NEARBY_POI_PAGE_SIZE,
  NEARBY_POI_MAX_RESULTS,
} from '@/lib/config';

/* eslint-disable @typescript-eslint/no-explicit-any */

// 附近 POI 搜索 API - 根据经纬度获取附近地点
// 使用高德地图 Web 服务「周边搜索」接口

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
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') || '');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: '缺少 lat/lng 参数' }, { status: 400 });
  }

  if (!AMAP_API_KEY) {
    console.error('[nearby-poi] AMAP_API_KEY not configured');
    return NextResponse.json({ results: [], error: '地图服务未配置' }, { status: 500 });
  }

  try {
    // 使用高德「周边搜索」接口，搜索附近地点
    // types 不传表示搜索全部类型 POI
    const params = new URLSearchParams({
      key: AMAP_API_KEY,
      location: `${lng},${lat}`,
      radius: String(NEARBY_POI_RADIUS),
      offset: String(NEARBY_POI_PAGE_SIZE),
      page: '1',
      output: 'json',
      extensions: 'base',
      sortrule: 'distance',  // 按距离排序
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AMAP_REQUEST_TIMEOUT);
    const res = await fetch(
      `${AMAP_BASE_URL}/place/around?${params.toString()}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    const data = await res.json();

    if (data.status === '1' && data.pois) {
      const results = data.pois
        .map((poi: any) => {
          const loc = parseLocation(poi.location);
          if (!loc) return null;
          return {
            name: poi.name || '',
            address: poi.address && poi.address !== '[]'
              ? poi.address
              : (poi.pname || '') + (poi.cityname || '') + (poi.adname || ''),
            lng: loc[0],
            lat: loc[1],
            distance: parseFloat(poi.distance) || 0,
          };
        })
        .filter(Boolean)
        .slice(0, NEARBY_POI_MAX_RESULTS);

      return NextResponse.json({ results });
    }

    return NextResponse.json({ results: [] });
  } catch (e) {
    console.error('[nearby-poi] failed:', (e as Error).message);
    return NextResponse.json({ results: [], error: '搜索附近地点失败' }, { status: 500 });
  }
}
