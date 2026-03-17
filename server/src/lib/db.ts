// 持久化数据库 - JSON 文件存储
import * as fs from 'fs';
import * as path from 'path';

export interface Participant {
  id: string;
  name: string;
  location: {
    name: string;
    lng: number;
    lat: number;
  };
  joinedAt: string;
}

// 每个参与者到餐厅的距离信息
export interface ParticipantDistance {
  participantId: string;
  participantName: string;
  distance: number; // 米
}

// 交通便利度
export interface Transportation {
  subway?: {
    station: string;
    line: string;
    distance: number;
  };
  taxi?: {
    estimatedCost: number;
    estimatedTime: number;
  };
  bus?: {
    routes: number;
    nearestStop: string;
    distance: number;
  };
}

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  category: string;
  rating?: number;
  avgPrice?: number; // 人均消费(元)
  distance?: number; // 到中心点的距离(米)
  avgDistance?: number; // 到所有人的平均距离(米)
  distanceToParticipants?: ParticipantDistance[]; // 到每个参与者的距离
  transportation?: Transportation; // 交通便利度
}

// 聚餐类型
export type DiningType = 'light' | 'formal' | 'nightsnack' | 'late_night' | 'any';

export interface Gathering {
  id: string;
  title: string;
  creatorId: string;
  creatorName: string;
  date: string;
  time: string;
  meal?: string; // 午饭 / 晚饭 / 夜宵
  diningType?: DiningType; // 聚餐类型：轻餐 / 正餐 / 夜宵 / 不限
  participants: Participant[];
  recommendedRestaurants: Restaurant[];
  confirmedRestaurant: Restaurant | null;
  status: 'open' | 'confirmed';
  createdAt: string;
  // 缓存：上次推荐时的参与者 ID 列表和聚餐类型（用于判断是否需要重新计算）
  lastRecommendParticipantIds?: string[];
  lastRecommendDiningType?: string;
  // 投票：餐厅 ID → 投票者 participant ID 数组
  votes?: Record<string, string[]>;
}

// ================ JSON 文件持久化 ================

// 数据文件路径：与项目同级的 data 目录
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'gatherings.json');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[DB] 创建数据目录: ${DATA_DIR}`);
  }
}

// 从文件加载数据到内存
function loadFromFile(): Map<string, Gathering> {
  ensureDataDir();
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const arr: Gathering[] = JSON.parse(raw);
      const map = new Map<string, Gathering>();
      for (const g of arr) {
        map.set(g.id, g);
      }
      console.log(`[DB] 从文件加载了 ${map.size} 个饭局`);
      return map;
    }
  } catch (err) {
    console.error('[DB] 加载数据文件失败:', err);
  }
  return new Map<string, Gathering>();
}

// 保存内存数据到文件
function saveToFile() {
  ensureDataDir();
  try {
    const arr = Array.from(gatherings.values());
    const json = JSON.stringify(arr, null, 2);
    // 先写临时文件再 rename，防止写入中途崩溃导致文件损坏
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, json, 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('[DB] 保存数据文件失败:', err);
  }
}

// 使用 globalThis 确保 Next.js 热更新时不重复加载
const globalForDb = globalThis as unknown as {
  gatherings: Map<string, Gathering> | undefined;
  dbInitialized: boolean | undefined;
};

const gatherings = globalForDb.gatherings ?? loadFromFile();
globalForDb.gatherings = gatherings;

if (!globalForDb.dbInitialized) {
  globalForDb.dbInitialized = true;
  console.log(`[DB] 数据库初始化完成，数据文件: ${DB_FILE}`);
}

// ================ CRUD 操作（每次写操作后自动持久化） ================

export function createGathering(gathering: Gathering): Gathering {
  gatherings.set(gathering.id, gathering);
  saveToFile();
  return gathering;
}

export function getGathering(id: string): Gathering | undefined {
  return gatherings.get(id);
}

export function updateGathering(id: string, updates: Partial<Gathering>): Gathering | undefined {
  const gathering = gatherings.get(id);
  if (!gathering) return undefined;
  const updated = { ...gathering, ...updates };
  gatherings.set(id, updated);
  saveToFile();
  return updated;
}

export function addParticipant(gatheringId: string, participant: Participant): Gathering | undefined {
  const gathering = gatherings.get(gatheringId);
  if (!gathering) return undefined;
  if (gathering.status === 'confirmed') return undefined;

  // 检查是否已存在
  const existIdx = gathering.participants.findIndex(p => p.id === participant.id);
  if (existIdx >= 0) {
    gathering.participants[existIdx] = participant;
  } else {
    gathering.participants.push(participant);
  }

  gatherings.set(gatheringId, gathering);
  saveToFile();
  return gathering;
}

export function confirmGathering(gatheringId: string, restaurant: Restaurant): Gathering | undefined {
  const gathering = gatherings.get(gatheringId);
  if (!gathering) return undefined;
  gathering.confirmedRestaurant = restaurant;
  gathering.status = 'confirmed';
  gatherings.set(gatheringId, gathering);
  saveToFile();
  return gathering;
}

// 投票/取消投票（toggle）
export function voteRestaurant(gatheringId: string, restaurantId: string, participantId: string): { gathering: Gathering; voted: boolean } | undefined {
  const gathering = gatherings.get(gatheringId);
  if (!gathering) return undefined;
  if (gathering.status === 'confirmed') return undefined;

  // 确认是参与者
  const isParticipant = gathering.participants.some(p => p.id === participantId);
  if (!isParticipant) return undefined;

  // 初始化 votes
  if (!gathering.votes) gathering.votes = {};
  if (!gathering.votes[restaurantId]) gathering.votes[restaurantId] = [];

  const voters = gathering.votes[restaurantId];
  const existIdx = voters.indexOf(participantId);

  let voted: boolean;
  if (existIdx >= 0) {
    // 已投过 → 取消投票
    voters.splice(existIdx, 1);
    voted = false;
  } else {
    // 新投票
    voters.push(participantId);
    voted = true;
  }

  gatherings.set(gatheringId, gathering);
  saveToFile();
  return { gathering, voted };
}

// 删除饭局（仅创建人可删除）
export function deleteGathering(gatheringId: string, creatorId: string): boolean {
  const gathering = gatherings.get(gatheringId);
  if (!gathering) return false;
  if (gathering.creatorId !== creatorId) return false;
  gatherings.delete(gatheringId);
  saveToFile();
  return true;
}

// 判断饭局是否已过期超过12小时
export function isGatheringExpired(gathering: Gathering, hoursAfter: number = 12): boolean {
  const gatheringTime = new Date(`${gathering.date}T${gathering.time || '23:59'}:00`);
  const expireTime = gatheringTime.getTime() + hoursAfter * 60 * 60 * 1000;
  return Date.now() > expireTime;
}

// 清理过期超过12小时的饭局
export function cleanupExpiredGatherings(): number {
  let count = 0;
  for (const [id, gathering] of gatherings) {
    if (isGatheringExpired(gathering)) {
      gatherings.delete(id);
      count++;
    }
  }
  if (count > 0) {
    saveToFile();
    console.log(`[DB] 清理了 ${count} 个过期饭局`);
  }
  return count;
}

export function getAllGatherings(): Gathering[] {
  return Array.from(gatherings.values());
}
