import { NextRequest, NextResponse } from 'next/server';
import { getGathering, updateGathering, type Restaurant, type ParticipantDistance, type Transportation, type DiningType } from '@/lib/db';
import { calculateCenter, calculateAvgDistance, calculateScore, haversineDistance, type Point } from '@/lib/geo';
import {
  AMAP_API_KEY,
  AMAP_BASE_URL,
  RECOMMEND_BASE_RADIUS,
  RECOMMEND_PAGE_SIZE,
  RECOMMEND_MAX_RESULTS,
  RECOMMEND_MIN_RESULTS,
  FORMAL_MIN_RATING,
  SUBWAY_SEARCH_RADIUS,
  BUS_SEARCH_RADIUS,
} from '@/lib/config';

const amapKey = AMAP_API_KEY;

// 夜宵白名单关键词（POI 名称或类型中需要包含其中之一才保留）
const NIGHTSNACK_WHITELIST = /烧烤|烤串|烤肉|串串|串吧|撸串|小龙虾|龙虾|大排档|夜宵|居酒屋|酒馆|酒吧|啤酒|火锅|烤鱼|烤羊|羊肉串|炸鸡|麻辣烫|冒菜|烫|炒|档口|排挡/i;

// 一线城市列表（正餐时过滤低价餐厅）
const TIER1_CITIES = ['北京', '北京市', '上海', '上海市', '广州', '广州市', '深圳', '深圳市'];
const TIER1_FORMAL_MIN_PRICE = 40; // 一线城市正餐最低人均

// 判断饭局时间是否在餐厅营业时间范围内
// open_time 格式示例: "09:00-19:00", "11:00-02:00"（跨午夜）, "09:00-21:00"
// gatheringTime 格式: "HH:MM"，如 "23:00"
function isOpenAtTime(openTime: unknown, gatheringTime: string): boolean {
  if (!openTime || typeof openTime !== 'string' || !gatheringTime) return true; // 无数据或非字符串时默认营业

  // 解析时间为分钟数（方便比较）
  function toMinutes(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return -1;
    return h * 60 + m;
  }

  // 尝试匹配 "HH:MM-HH:MM" 格式（可能有多段，如 "09:00-14:00 17:00-22:00"）
  const segments = openTime.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g);
  if (!segments || segments.length === 0) return true; // 格式无法解析时默认营业

  const target = toMinutes(gatheringTime);
  if (target < 0) return true;

  for (const seg of segments) {
    const match = seg.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!match) continue;
    const start = toMinutes(match[1]);
    const end = toMinutes(match[2]);
    if (start < 0 || end < 0) continue;

    if (end > start) {
      // 正常时段，如 09:00-21:00
      if (target >= start && target <= end) return true;
    } else {
      // 跨午夜时段，如 18:00-02:00
      if (target >= start || target <= end) return true;
    }
  }

  return false;
}

// 根据聚餐类型获取高德 POI 搜索参数
function getDiningSearchParams(diningType?: DiningType): {
  types: string;
  keywords?: string;
  excludePatterns?: RegExp;
  whitelistPatterns?: RegExp;  // 白名单：POI 名称或类型需匹配才保留
} {
  switch (diningType) {
    case 'light':
      // 轻餐：咖啡厅、快餐、面包甜点、饮品店
      return {
        // 高德 types 多值用竖线 | 分隔（逗号会被当作坐标分隔符）
        types: '050301|050302|050303|050304|050500',
      };
    case 'formal':
      // 正餐：中餐厅、火锅、日韩料理等正式餐厅
      return {
        types: '050100|050200',
        excludePatterns: new RegExp([
          // 快餐简餐
          '快餐|简餐|便当|外卖|速食|轻食',
          // 饮品甜点
          '咖啡|奶茶|蛋糕|甜心|甜品|甜点|西点|糕点|糕饼|面包|烘焙|茶点',
          // 烧烤小吃
          '烧烤|串|撸串|大排档|小吃',
          // 国际快餐
          '麦当劳|肯德基|必胜客|汉堡|和合谷|KFC|达美乐|Pizza Hut',
          // 基础餐饮
          '食堂|档口|小卖部|便利店|超市',
          // 面点饼类
          '饼铺|饼店|肉饼|馅饼|煎饼|烙饼|包子|饺子馆|馄饨|炒肝|灌汤包|水煎包',
          // 主食类
          '粥|拉面|刀削面|小面|面馆|米线|米粉|炒面|盖饭|盖浇饭|卤肉饭|拌饭',
          // 特色小吃
          '麻辣烫|冒菜|黄焖鸡|沙县|兰州|酸辣粉|凉皮|煎饼果子|串串|卤煮',
          // 酒饮场所
          '酒馆|酒吧|清吧|pub|bar|啤酒|精酿|居酒屋|酒坊|酒铺',
        ].join('|'), 'i'),
      };
    case 'nightsnack':
    case 'late_night':
      // 夜宵：用全餐饮搜索，但通过白名单只保留夜宵类餐厅
      return {
        types: '050000',
        whitelistPatterns: NIGHTSNACK_WHITELIST,
      };
    case 'any':
    default:
      // 不限：所有餐饮
      return { types: '050000' };
  }
}

// 查询某个坐标点附近的地铁站和公交信息
// 返回格式与前端 Transportation 接口对齐：{ subway?, taxi?, bus? }
async function queryTransportation(lng: number, lat: number): Promise<Transportation> {
  const result: Transportation = {};

  if (!amapKey) return result;

  try {
    // 同时查附近地铁站（150500/150501=地铁站）和公交站（150700=公交站）
    const [subwayRes, busRes] = await Promise.all([
      fetch(`https://restapi.amap.com/v3/place/around?key=${amapKey}&location=${lng},${lat}&radius=1000&types=150500|150501&offset=3&page=1`),
      fetch(`https://restapi.amap.com/v3/place/around?key=${amapKey}&location=${lng},${lat}&radius=500&types=150700&offset=20&page=1`),
    ]);

    const [subwayData, busData] = await Promise.all([subwayRes.json(), busRes.json()]);

    // 地铁信息
    let hasSubway = false;
    if (subwayData.status === '1' && subwayData.pois && subwayData.pois.length > 0) {
      const nearest = subwayData.pois[0];
      hasSubway = true;
      result.subway = {
        station: nearest.name,
        line: '',
        distance: parseFloat(nearest.distance) || 0,
      };
    }

    // 公交线路数 - 通过公交站数量估算
    let busCount = 0;
    if (busData.status === '1' && busData.pois) {
      busCount = busData.pois.length;
      if (busCount > 0) {
        const nearestBus = busData.pois[0];
        result.bus = {
          routes: busCount,
          nearestStop: nearestBus.name,
          distance: parseFloat(nearestBus.distance) || 0,
        };
      }
    }

    // 打车便利度 - 根据地铁和公交综合判断估算费用
    // 有地铁+公交多 => 交通发达区域，打车也方便（估算费用低）
    // 有地铁或公交较多 => 中等
    // 都没有 => 偏远
    if (hasSubway && busCount >= 3) {
      result.taxi = { estimatedCost: 12, estimatedTime: 10 };
    } else if (hasSubway || busCount >= 2) {
      result.taxi = { estimatedCost: 18, estimatedTime: 15 };
    } else {
      result.taxi = { estimatedCost: 30, estimatedTime: 25 };
    }
  } catch (err) {
    console.error('查询交通信息失败:', err);
  }

  return result;
}

// GET - 获取餐厅推荐
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gathering = getGathering(id);

    if (!gathering) {
      return NextResponse.json({ error: '饭局不存在' }, { status: 404 });
    }

    const participants = gathering.participants;
    const participantPoints: Point[] = participants.map(p => ({
      lng: p.location.lng,
      lat: p.location.lat,
    }));

    // 缓存判断：参与者和聚餐类型都没变化时，直接返回上次的推荐结果
    const currentParticipantIds = participants.map(p => p.id).sort().join(',');
    const lastParticipantIds = (gathering.lastRecommendParticipantIds || []).sort().join(',');
    const currentDiningType = gathering.diningType || 'any';
    const lastDiningType = gathering.lastRecommendDiningType || '';

    if (
      currentParticipantIds === lastParticipantIds &&
      currentDiningType === lastDiningType &&
      gathering.recommendedRestaurants &&
      gathering.recommendedRestaurants.length > 0
    ) {
      const center = calculateCenter(participantPoints);
      return NextResponse.json({
        center,
        restaurants: gathering.recommendedRestaurants,
      });
    }

    // 计算所有人位置的中心点
    const center = calculateCenter(participantPoints);

    let restaurants: Restaurant[] = [];
    let allClosedByTime = false; // 标记是否所有餐厅都因营业时间被过滤

    if (amapKey) {
      // 根据聚餐类型确定搜索参数
      const diningType = gathering.diningType || 'any';
      const searchParams = getDiningSearchParams(diningType);
      // 使用高德地图 Web 服务 API
      const baseRadius = 3000; // 初始 3km 搜索半径
      
      // 可能需要多次搜索（如果过滤后结果不够）
      for (const searchRadius of [baseRadius, baseRadius * 2, baseRadius * 3]) {
        const url = `https://restapi.amap.com/v3/place/around?key=${amapKey}&location=${center.lng},${center.lat}&radius=${searchRadius}&types=${searchParams.types}&offset=50&page=1&extensions=all`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.status === '1' && data.pois) {
          restaurants = data.pois.map((poi: Record<string, string>) => {
            const [lng, lat] = poi.location.split(',').map(Number);
            const point: Point = { lng, lat };

            // 计算到每个参与者的距离
            const distanceToParticipants: ParticipantDistance[] = participants.map(p => ({
              participantId: p.id,
              participantName: p.name,
              distance: haversineDistance(point, { lng: p.location.lng, lat: p.location.lat }),
            }));

            const fullType = poi.type || '';
            const bizExt = poi.biz_ext ? JSON.parse(JSON.stringify(poi.biz_ext)) : {};
            return {
              id: poi.id,
              name: poi.name,
              address: poi.address || poi.pname + poi.cityname + poi.adname,
              lng,
              lat,
              category: fullType.split(';')[0] || '餐饮',
              rating: bizExt.rating ? parseFloat(bizExt.rating) : undefined,
              avgPrice: bizExt.cost ? parseFloat(bizExt.cost) || undefined : undefined,
              distance: parseFloat(poi.distance) || 0,
              avgDistance: calculateAvgDistance(point, participantPoints),
              distanceToParticipants,
              _fullType: fullType,  // 临时保留完整类型用于过滤
              _cityName: poi.cityname || '',  // 临时保留城市名用于一线城市判断
              _openTime: typeof bizExt.open_time === 'string' ? bizExt.open_time : '',  // 临时保留营业时间用于过滤
            } as Restaurant & { _fullType: string; _cityName: string; _openTime: string };
          });

          // 根据聚餐类型过滤
          const beforeFilterCount = restaurants.length;
          // 白名单模式（夜宵）：只保留名称/类型匹配白名单的
          if (searchParams.whitelistPatterns) {
            const pattern = searchParams.whitelistPatterns;
            restaurants = (restaurants as (Restaurant & { _fullType?: string; _cityName?: string })[]).filter(r => {
              const fullType = r._fullType || '';
              return pattern.test(r.name) || pattern.test(r.category) || pattern.test(fullType);
            }) as Restaurant[];
          }
          // 黑名单模式（正餐）：排除匹配排除规则的
          if (searchParams.excludePatterns) {
            const pattern = searchParams.excludePatterns;
            restaurants = (restaurants as (Restaurant & { _fullType?: string; _cityName?: string })[]).filter(r => {
              const fullType = r._fullType || '';
              return !pattern.test(r.name) && !pattern.test(r.category) && !pattern.test(fullType);
            }) as Restaurant[];
          }
          // 正餐模式：额外过滤掉评分低于 4.0 的（保证推荐品质）
          if (diningType === 'formal') {
            restaurants = restaurants.filter(r => !r.rating || r.rating >= 4.0);

            // 一线城市正餐：过滤掉人均低于40元的餐厅（有价格数据且低于阈值的才过滤，没有价格数据的保留）
            const isTier1 = (restaurants as (Restaurant & { _cityName?: string })[]).some(r =>
              TIER1_CITIES.includes(r._cityName || '')
            );
            if (isTier1) {
              const beforePriceFilter = restaurants.length;
              restaurants = restaurants.filter(r => !r.avgPrice || r.avgPrice >= TIER1_FORMAL_MIN_PRICE);
              console.log(`[recommend] 一线城市正餐价格过滤: ${beforePriceFilter} → ${restaurants.length} (过滤人均<${TIER1_FORMAL_MIN_PRICE}元)`);
            }
          }
          console.log(`[recommend] diningType=${diningType} | POI total=${beforeFilterCount} → filtered=${restaurants.length}`);

          // 营业时间过滤：如果饭局有约定时间，过滤掉在该时间不营业的餐厅
          const gatheringTime = gathering.time; // 格式 "HH:MM"，如 "23:00"
          if (gatheringTime) {
            const beforeTimeFilter = restaurants.length;
            restaurants = (restaurants as (Restaurant & { _openTime?: string })[]).filter(r => {
              return isOpenAtTime(r._openTime || '', gatheringTime);
            }) as Restaurant[];
            if (beforeTimeFilter !== restaurants.length) {
              console.log(`[recommend] 营业时间过滤(${gatheringTime}): ${beforeTimeFilter} → ${restaurants.length}`);
            }
            // 如果过滤前有餐厅但全部因营业时间被过滤掉了，标记一下
            if (beforeTimeFilter > 0 && restaurants.length === 0) {
              allClosedByTime = true;
            }
          }

          // 清理临时字段
          restaurants.forEach(r => {
            delete (r as unknown as Record<string, unknown>)._fullType;
            delete (r as unknown as Record<string, unknown>)._cityName;
            delete (r as unknown as Record<string, unknown>)._openTime;
          });

          // 如果过滤后有足够结果（>=20，多备选以便多样性筛选），就不需要扩大搜索了
          if (restaurants.length >= 20) break;
        }
      }
    }

    // 如果所有餐厅都因营业时间被过滤掉了，返回特定提示
    if (restaurants.length === 0 && allClosedByTime) {
      console.log(`[recommend] 所有餐厅因营业时间(${gathering.time})被过滤，返回 all_closed 提示`);
      return NextResponse.json({
        center,
        restaurants: [],
        reason: 'all_closed',
        message: `${gathering.time} 附近的餐厅都打烊了`,
      });
    }

    // 如果没有高德 API key 或搜索无结果，生成模拟数据
    if (restaurants.length === 0) {
      restaurants = await generateMockRestaurants(center, participants, gathering.diningType);
    }

    // 按综合评分排序（距离大家都近且公平）
    restaurants.sort((a, b) => {
      const scoreA = calculateScore({ lng: a.lng, lat: a.lat }, participantPoints);
      const scoreB = calculateScore({ lng: b.lng, lat: b.lat }, participantPoints);
      return scoreA - scoreB;
    });

    // 多样性选择：从候选池中选 10 个，兼顾距离评分和品类/价格多样性
    const topRestaurants = selectDiverseRestaurants(restaurants, 10, participantPoints);

    // 并发查询前 10 个餐厅的交通便利度
    const transportResults = await Promise.all(
      topRestaurants.map(r => queryTransportation(r.lng, r.lat))
    );

    topRestaurants.forEach((r, i) => {
      r.transportation = transportResults[i];
    });

    // 更新饭局的推荐餐厅、参与者快照和聚餐类型快照
    // 餐厅列表变化时清空旧投票（旧投票对应的餐厅已不存在）
    const oldIds = (gathering.recommendedRestaurants || []).map(r => r.id).sort().join(',');
    const newIds = topRestaurants.map(r => r.id).sort().join(',');
    const shouldClearVotes = oldIds !== newIds;

    updateGathering(id, {
      recommendedRestaurants: topRestaurants,
      lastRecommendParticipantIds: participants.map(p => p.id),
      lastRecommendDiningType: currentDiningType,
      ...(shouldClearVotes ? { votes: {} } : {}),
    });

    if (shouldClearVotes) {
      console.log(`[recommend] 餐厅列表变更，已清空旧投票 (old: [${oldIds}] → new: [${newIds}])`);
    }

    return NextResponse.json({
      center,
      restaurants: topRestaurants,
    });
  } catch (err) {
    console.error('[recommend] 推荐失败:', err);
    return NextResponse.json({ error: '获取推荐失败' }, { status: 500 });
  }
}

// 多样性选择算法：从候选池中选出 N 个餐厅，兼顾距离评分和品类/价格多样性
function selectDiverseRestaurants(
  candidates: Restaurant[],
  count: number,
  _participantPoints: Point[]
): Restaurant[] {
  if (candidates.length <= count) return candidates;

  // 将餐厅按品类分组（归一化大类）
  function getCuisineGroup(r: Restaurant): string {
    const name = r.name || '';
    const cat = r.category || '';
    const text = name + cat;
    if (/火锅|涮/.test(text)) return '火锅';
    if (/烤鸭|烤肉|烧烤|烤/.test(text)) return '烧烤烤肉';
    if (/日本|日料|日式|寿司|刺身|居酒屋/.test(text)) return '日料';
    if (/韩国|韩式|石锅|部队/.test(text)) return '韩餐';
    if (/西餐|意大利|法国|牛排|披萨|pasta|steak/i.test(text)) return '西餐';
    if (/泰国|泰式|东南亚|越南/i.test(text)) return '东南亚';
    if (/川菜|湘菜|麻辣|酸菜鱼/.test(text)) return '川湘菜';
    if (/粤菜|广东|茶餐厅|港式|早茶/.test(text)) return '粤菜';
    if (/浙菜|杭帮|江浙|淮扬|苏菜/.test(text)) return '江浙菜';
    if (/东北|铁锅|炖/.test(text)) return '东北菜';
    if (/西北|新疆|羊|清真/.test(text)) return '西北菜';
    if (/海鲜|鱼|虾|蟹/.test(text)) return '海鲜';
    if (/自助|buffet/i.test(text)) return '自助餐';
    return '中餐其他';
  }

  // 将餐厅按价格分档
  function getPriceGroup(r: Restaurant): string {
    const price = r.avgPrice || 0;
    if (price <= 0) return '未知';
    if (price <= 50) return '实惠';
    if (price <= 100) return '中等';
    if (price <= 200) return '较高';
    return '高档';
  }

  // 第一步：按距离评分排序取前 30 个候选（保证基本的距离质量）
  const pool = candidates.slice(0, Math.min(30, candidates.length));

  // 第二步：贪心多样性选择
  const selected: Restaurant[] = [];
  const usedCuisine = new Map<string, number>(); // 品类 → 已选数量
  const usedPrice = new Map<string, number>();    // 价格档 → 已选数量

  // 先选评分最高的（距离最优的第1个）
  selected.push(pool[0]);
  const cg0 = getCuisineGroup(pool[0]);
  const pg0 = getPriceGroup(pool[0]);
  usedCuisine.set(cg0, 1);
  usedPrice.set(pg0, 1);

  const remaining = pool.slice(1);

  while (selected.length < count && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const cuisine = getCuisineGroup(r);
      const price = getPriceGroup(r);

      // 距离排名分（越靠前越好，线性衰减）
      const rankScore = 1 - (i / remaining.length);

      // 品类多样性加分（未出现过的品类得满分，出现越多扣分越多）
      const cuisineCount = usedCuisine.get(cuisine) || 0;
      const cuisineDiversity = cuisineCount === 0 ? 1.0 : 1.0 / (1 + cuisineCount * 2);

      // 价格多样性加分
      const priceCount = usedPrice.get(price) || 0;
      const priceDiversity = priceCount === 0 ? 1.0 : 1.0 / (1 + priceCount);

      // 综合得分：距离占40%，品类多样性占40%，价格多样性占20%
      const totalScore = rankScore * 0.4 + cuisineDiversity * 0.4 + priceDiversity * 0.2;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const chosen = remaining[bestIdx];
    selected.push(chosen);

    const cuisine = getCuisineGroup(chosen);
    const price = getPriceGroup(chosen);
    usedCuisine.set(cuisine, (usedCuisine.get(cuisine) || 0) + 1);
    usedPrice.set(price, (usedPrice.get(price) || 0) + 1);

    remaining.splice(bestIdx, 1);
  }

  console.log(`[recommend] 多样性选择: ${selected.length}/${candidates.length} 个, 品类分布: ${JSON.stringify(Object.fromEntries(usedCuisine))}, 价格分布: ${JSON.stringify(Object.fromEntries(usedPrice))}`);

  return selected;
}

// 生成模拟餐厅数据（当没有高德 API key 时）
async function generateMockRestaurants(center: Point, participants: { id: string; name: string; location: { lng: number; lat: number } }[], diningType?: DiningType): Promise<Restaurant[]> {
  const mockData: Record<string, { name: string; category: string }[]> = {
    light: [
      { name: '星巴克', category: '咖啡厅' },
      { name: '瑞幸咖啡', category: '咖啡厅' },
      { name: '麦当劳', category: '快餐' },
      { name: '肯德基', category: '快餐' },
      { name: '必胜客', category: '西式快餐' },
      { name: 'Manner咖啡', category: '咖啡厅' },
      { name: '奈雪的茶', category: '饮品' },
      { name: 'Tim Hortons', category: '咖啡厅' },
      { name: 'Costa咖啡', category: '咖啡厅' },
      { name: '喜茶', category: '饮品' },
    ],
    formal: [
      { name: '鼎泰丰', category: '台湾菜' },
      { name: '海底捞火锅', category: '火锅' },
      { name: '外婆家', category: '浙菜' },
      { name: '大董烤鸭', category: '烤鸭' },
      { name: '西贝莜面村', category: '西北菜' },
      { name: '绿茶餐厅', category: '浙菜' },
      { name: '太二酸菜鱼', category: '川菜' },
      { name: '老北京涮肉', category: '火锅' },
      { name: '南京大牌档', category: '淮扬菜' },
      { name: '全聚德', category: '烤鸭' },
    ],
    nightsnack: [
      { name: '木屋烧烤', category: '烧烤' },
      { name: '很久以前羊肉串', category: '烧烤' },
      { name: '丰茂烤串', category: '烧烤' },
      { name: '胡大饭馆', category: '小龙虾' },
      { name: '串亭烧烤居酒屋', category: '居酒屋' },
      { name: '望京小腰', category: '烧烤' },
      { name: '海盗虾饭', category: '小龙虾' },
      { name: '聚点串吧', category: '串串' },
      { name: '烤肉季', category: '烧烤' },
      { name: '大排档', category: '夜宵' },
    ],
    any: [
      { name: '海底捞火锅', category: '火锅' },
      { name: '外婆家', category: '浙菜' },
      { name: '西贝莜面村', category: '西北菜' },
      { name: '绿茶餐厅', category: '浙菜' },
      { name: '大董烤鸭', category: '烤鸭' },
      { name: '鼎泰丰', category: '台湾菜' },
      { name: '太二酸菜鱼', category: '川菜' },
      { name: '木屋烧烤', category: '烧烤' },
      { name: '星巴克', category: '咖啡厅' },
      { name: '探鱼', category: '烤鱼' },
    ],
  };

  const mockNames = mockData[diningType || 'any'] || mockData.any;

  const participantPoints: Point[] = participants.map(p => ({
    lng: p.location.lng,
    lat: p.location.lat,
  }));

  const mockRestaurants = mockNames.map((item, index) => {
    const offsetLng = (Math.random() - 0.5) * 0.02;
    const offsetLat = (Math.random() - 0.5) * 0.02;
    const lng = center.lng + offsetLng;
    const lat = center.lat + offsetLat;
    const point: Point = { lng, lat };

    const distanceToParticipants: ParticipantDistance[] = participants.map(p => ({
      participantId: p.id,
      participantName: p.name,
      distance: haversineDistance(point, { lng: p.location.lng, lat: p.location.lat }),
    }));

    return {
      id: `mock_${index}`,
      name: item.name,
      address: '',  // 后面用逆地理编码填充
      lng,
      lat,
      category: item.category,
      rating: 4 + Math.random(),
      distance: 0,
      avgDistance: calculateAvgDistance(point, participantPoints),
      distanceToParticipants,
      transportation: {
        ...(Math.random() > 0.3 ? {
          subway: {
            station: '附近地铁站',
            line: '',
            distance: Math.floor(Math.random() * 800) + 100,
          },
        } : {}),
        taxi: {
          estimatedCost: Math.floor(Math.random() * 20) + 10,
          estimatedTime: Math.floor(Math.random() * 15) + 5,
        },
        bus: {
          routes: Math.floor(Math.random() * 10) + 1,
          nearestStop: '附近公交站',
          distance: Math.floor(Math.random() * 300) + 50,
        },
      },
    };
  });

  // 用高德逆地理编码批量获取真实地址
  if (amapKey) {
    await Promise.all(
      mockRestaurants.map(async (r) => {
        try {
          const res = await fetch(`${AMAP_BASE_URL}/geocode/regeo?key=${amapKey}&location=${r.lng},${r.lat}`);
          const data = await res.json();
          if (data.status === '1' && data.regeocode) {
            const addr = data.regeocode.formatted_address || '';
            // 去掉省市前缀，只保留区+街道+门牌号
            r.address = addr.replace(/^.*?(省|市|自治区|特别行政区)/, '').replace(/^.*?市/, '') || addr;
          }
        } catch { /* ignore */ }
      })
    );
  }

  // 如果逆地理编码失败或没有 key，用备用地址
  mockRestaurants.forEach((r, index) => {
    if (!r.address) {
      r.address = `附近${index + 1}号`;
    }
  });

  return mockRestaurants;
}
