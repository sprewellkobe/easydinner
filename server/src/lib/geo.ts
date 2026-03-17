// 地理计算工具函数
import {
  DEFAULT_CENTER_LNG,
  DEFAULT_CENTER_LAT,
  SCORE_AVG_DISTANCE_WEIGHT,
  SCORE_MAX_DISTANCE_WEIGHT,
} from './config';

export interface Point {
  lng: number;
  lat: number;
}

// Haversine 公式计算两点间的距离（米）
export function haversineDistance(p1: Point, p2: Point): number {
  const R = 6371000; // 地球半径（米）
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 计算加权中心点（所有人位置的几何中心）
export function calculateCenter(points: Point[]): Point {
  if (points.length === 0) return { lng: DEFAULT_CENTER_LNG, lat: DEFAULT_CENTER_LAT }; // 默认坐标
  if (points.length === 1) return points[0];

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  let x = 0, y = 0, z = 0;

  for (const p of points) {
    const latRad = toRad(p.lat);
    const lngRad = toRad(p.lng);
    x += Math.cos(latRad) * Math.cos(lngRad);
    y += Math.cos(latRad) * Math.sin(lngRad);
    z += Math.sin(latRad);
  }

  x /= points.length;
  y /= points.length;
  z /= points.length;

  const lng = toDeg(Math.atan2(y, x));
  const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));

  return { lng, lat };
}

// 计算每个候选点到所有人的平均距离
export function calculateAvgDistance(candidate: Point, participants: Point[]): number {
  if (participants.length === 0) return 0;
  const totalDist = participants.reduce((sum, p) => sum + haversineDistance(candidate, p), 0);
  return totalDist / participants.length;
}

// 计算每个候选点到所有人的最大距离
export function calculateMaxDistance(candidate: Point, participants: Point[]): number {
  if (participants.length === 0) return 0;
  return Math.max(...participants.map(p => haversineDistance(candidate, p)));
}

// 综合评分（平均距离越小越好，最大距离越小越好，说明对大家都公平）
export function calculateScore(candidate: Point, participants: Point[]): number {
  const avgDist = calculateAvgDistance(candidate, participants);
  const maxDist = calculateMaxDistance(candidate, participants);
  // 权重：平均距离 + 最大距离（公平性）
  return avgDist * SCORE_AVG_DISTANCE_WEIGHT + maxDist * SCORE_MAX_DISTANCE_WEIGHT;
}

// 格式化距离显示
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}
