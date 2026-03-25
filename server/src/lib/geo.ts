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

// 计算简单几何中心（用于辅助计算）
function simpleCenter(points: Point[]): Point {
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

  return {
    lng: toDeg(Math.atan2(y, x)),
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
  };
}

// 计算"多数人优先"的加权中心点
// 策略：识别并降低离群点的权重，让中心偏向人数密集区域
// 例如 7 人聚餐，6 人住很近只有 1 人远 → 中心几乎在那 6 人附近
export function calculateCenter(points: Point[]): Point {
  if (points.length === 0) return { lng: DEFAULT_CENTER_LNG, lat: DEFAULT_CENTER_LAT };
  if (points.length === 1) return points[0];
  if (points.length === 2) return simpleCenter(points);

  // 第一步：先算简单几何中心
  const naive = simpleCenter(points);

  // 第二步：计算每个人到简单中心的距离
  const distances = points.map(p => haversineDistance(p, naive));

  // 第三步：用中位数距离识别离群点
  const sorted = [...distances].sort((a, b) => a - b);
  const medianDist = sorted[Math.floor(sorted.length / 2)];

  // 第四步：基于距离分配权重
  // 距离 <= 中位数的人：权重 1（多数人）
  // 距离 > 中位数的人：权重随距离衰减（离得越远权重越低）
  // 衰减公式: weight = medianDist / distance，最低 0.1
  const weights = distances.map(d => {
    if (medianDist === 0) return 1; // 所有人在同一点
    if (d <= medianDist * 1.5) return 1; // 在中位数 1.5 倍内的视为正常
    return Math.max(0.1, medianDist / d); // 超出的按距离反比衰减
  });

  // 第五步：用权重计算加权中心
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  let x = 0, y = 0, z = 0, totalWeight = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const w = weights[i];
    const latRad = toRad(p.lat);
    const lngRad = toRad(p.lng);
    x += w * Math.cos(latRad) * Math.cos(lngRad);
    y += w * Math.cos(latRad) * Math.sin(lngRad);
    z += w * Math.sin(latRad);
    totalWeight += w;
  }

  x /= totalWeight;
  y /= totalWeight;
  z /= totalWeight;

  const center = {
    lng: toDeg(Math.atan2(y, x)),
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
  };

  // 日志：打印权重分布便于调试
  const outlierCount = weights.filter(w => w < 1).length;
  if (outlierCount > 0) {
    console.log(`[geo] 多数人优先中心: ${points.length}人中${outlierCount}人为离群点, 权重=${weights.map(w => w.toFixed(2)).join(',')}`);
  }

  return center;
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

// 计算每个候选点到所有人的中位数距离
export function calculateMedianDistance(candidate: Point, participants: Point[]): number {
  if (participants.length === 0) return 0;
  const dists = participants.map(p => haversineDistance(candidate, p)).sort((a, b) => a - b);
  const mid = Math.floor(dists.length / 2);
  return dists.length % 2 === 0 ? (dists[mid - 1] + dists[mid]) / 2 : dists[mid];
}

// 综合评分（多数人优先策略）
// - 中位数距离（权重 0.7）：对大多数人近的餐厅得分高，不受 1 个远的人影响
// - 平均距离（权重 0.3）：保留一定的整体公平性考量
// 这样 6 近 1 远的场景下，餐厅会优先选在 6 人附近
export function calculateScore(candidate: Point, participants: Point[]): number {
  const medianDist = calculateMedianDistance(candidate, participants);
  const avgDist = calculateAvgDistance(candidate, participants);
  // 中位数距离权重更高 → 多数人近的地方得分低（好）
  return medianDist * SCORE_AVG_DISTANCE_WEIGHT + avgDist * SCORE_MAX_DISTANCE_WEIGHT;
}

// 格式化距离显示
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}
