import { NextRequest, NextResponse } from 'next/server';
import {
  PHOTON_API_URL,
  PHOTON_REQUEST_TIMEOUT,
  BIGDATACLOUD_API_URL,
  BIGDATACLOUD_REQUEST_TIMEOUT,
} from '@/lib/config';

/* eslint-disable @typescript-eslint/no-explicit-any */

// 逆地理编码 API - 根据坐标获取地址名称
// 使用 Photon (Komoot/OpenStreetMap) + BigDataCloud 做降级

export async function GET(request: NextRequest) {
  const lng = request.nextUrl.searchParams.get('lng');
  const lat = request.nextUrl.searchParams.get('lat');

  if (!lng || !lat) {
    return NextResponse.json({ address: '' }, { status: 400 });
  }

  const lngNum = parseFloat(lng);
  const latNum = parseFloat(lat);

  // 方案1: Photon API (Komoot, 基于 OpenStreetMap, 免费无需 Key, 支持中文)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PHOTON_REQUEST_TIMEOUT);
    const res = await fetch(
      `${PHOTON_API_URL}?lat=${latNum}&lon=${lngNum}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await res.json();

    if (data.features?.length > 0) {
      const props = data.features[0].properties;

      // 优先返回具体 POI 名称 + 街道（更实用）
      // 如: "金融街购物中心" 比 "北京市西城区金城坊东街丰融园8号楼" 更好
      const shortParts: string[] = [];
      const fullParts: string[] = [];

      if (props.city) fullParts.push(props.city);
      // 避免 locality 包含 city 名 (如 "北京金融街" 包含 "北京")
      if (props.locality && props.locality !== props.city && !props.locality.startsWith(props.city)) {
        fullParts.push(props.locality);
        shortParts.push(props.locality);
      } else if (props.district && props.district !== props.city) {
        fullParts.push(props.district);
      }
      if (props.street) {
        fullParts.push(props.street);
        shortParts.push(props.street);
      }
      if (props.name && props.name !== props.street && props.name !== props.locality && props.name !== props.city) {
        shortParts.push(props.name);
        fullParts.push(props.name);
      }

      // 优先返回短地址（更实用），如果太短则用全地址
      const address = shortParts.length > 0
        ? (shortParts.join('').length > 3 ? shortParts.join('') : fullParts.join(''))
        : fullParts.join('');

      if (address) {
        return NextResponse.json({ address });
      }
    }
  } catch (e) {
    console.log('Photon reverse geocode failed:', (e as Error).message);
  }

  // 方案2: BigDataCloud (免费，无需 Key)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BIGDATACLOUD_REQUEST_TIMEOUT);
    const res = await fetch(
      `${BIGDATACLOUD_API_URL}?latitude=${latNum}&longitude=${lngNum}&localityLanguage=zh`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await res.json();

    const parts: string[] = [];
    if (data.city) parts.push(data.city);
    if (data.locality) parts.push(data.locality);
    if (parts.length > 0) {
      return NextResponse.json({ address: parts.join('') });
    }
  } catch (e) {
    console.log('BigDataCloud failed:', (e as Error).message);
  }

  // 都失败了，返回坐标
  return NextResponse.json({ address: `${lngNum.toFixed(4)}, ${latNum.toFixed(4)}` });
}
