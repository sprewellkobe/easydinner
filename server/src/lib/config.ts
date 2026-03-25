// 统一配置管理 - 所有可配置项从环境变量读取，提供默认值

// ---------- 辅助函数 ----------
function envStr(key: string, defaultVal: string): string {
  return process.env[key] || defaultVal;
}
function envNum(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const num = parseFloat(val);
  return isNaN(num) ? defaultVal : num;
}

// ---------- 服务端口 ----------
export const PORT = envNum('PORT', 8001);

// ---------- 高德地图 ----------
export const AMAP_API_KEY = envStr('AMAP_API_KEY', '');
export const AMAP_BASE_URL = envStr('AMAP_BASE_URL', 'https://restapi.amap.com/v3');

// ---------- CORS 配置 ----------
export const CORS_ALLOW_ORIGIN = envStr('CORS_ALLOW_ORIGIN', '*');
export const CORS_ALLOW_METHODS = envStr('CORS_ALLOW_METHODS', 'GET, POST, PUT, DELETE, OPTIONS');
export const CORS_ALLOW_HEADERS = envStr('CORS_ALLOW_HEADERS', 'Content-Type, Authorization');
export const CORS_MAX_AGE = envStr('CORS_MAX_AGE', '86400');

// ---------- 请求超时（毫秒） ----------
export const AMAP_REQUEST_TIMEOUT = envNum('AMAP_REQUEST_TIMEOUT', 8000);
export const PHOTON_REQUEST_TIMEOUT = envNum('PHOTON_REQUEST_TIMEOUT', 8000);
export const BIGDATACLOUD_REQUEST_TIMEOUT = envNum('BIGDATACLOUD_REQUEST_TIMEOUT', 5000);

// ---------- 第三方 API 地址 ----------
export const PHOTON_API_URL = envStr('PHOTON_API_URL', 'https://photon.komoot.io/reverse');
export const BIGDATACLOUD_API_URL = envStr('BIGDATACLOUD_API_URL', 'https://api.bigdatacloud.net/data/reverse-geocode-client');

// ---------- 默认坐标 ----------
export const DEFAULT_CENTER_LNG = envNum('DEFAULT_CENTER_LNG', 116.397428);
export const DEFAULT_CENTER_LAT = envNum('DEFAULT_CENTER_LAT', 39.90923);

// ---------- POI 搜索参数 ----------
export const NEARBY_POI_RADIUS = envNum('NEARBY_POI_RADIUS', 1000);
export const NEARBY_POI_PAGE_SIZE = envNum('NEARBY_POI_PAGE_SIZE', 20);
export const NEARBY_POI_MAX_RESULTS = envNum('NEARBY_POI_MAX_RESULTS', 15);
export const SEARCH_POI_PAGE_SIZE = envNum('SEARCH_POI_PAGE_SIZE', 10);
export const SEARCH_POI_MAX_RESULTS = envNum('SEARCH_POI_MAX_RESULTS', 10);
export const RECOMMEND_BASE_RADIUS = envNum('RECOMMEND_BASE_RADIUS', 3000);
export const RECOMMEND_PAGE_SIZE = envNum('RECOMMEND_PAGE_SIZE', 50);
export const RECOMMEND_MAX_RESULTS = envNum('RECOMMEND_MAX_RESULTS', 10);
export const RECOMMEND_MIN_RESULTS = envNum('RECOMMEND_MIN_RESULTS', 5);
export const FORMAL_MIN_RATING = envNum('FORMAL_MIN_RATING', 4.0);

// ---------- 餐厅详情参数 ----------
export const RESTAURANT_DETAIL_RADIUS = envNum('RESTAURANT_DETAIL_RADIUS', 200);
export const RESTAURANT_DETAIL_FALLBACK_RADIUS = envNum('RESTAURANT_DETAIL_FALLBACK_RADIUS', 50);
export const RESTAURANT_MAX_PHOTOS = envNum('RESTAURANT_MAX_PHOTOS', 4);
export const RESTAURANT_MAX_TAGS = envNum('RESTAURANT_MAX_TAGS', 3);

// ---------- 交通查询参数 ----------
export const SUBWAY_SEARCH_RADIUS = envNum('SUBWAY_SEARCH_RADIUS', 1000);
export const BUS_SEARCH_RADIUS = envNum('BUS_SEARCH_RADIUS', 500);

// ---------- 推荐算法参数（多数人优先策略） ----------
// 中位数距离权重：越高越偏向"对大多数人近"的餐厅（不受离群远的人影响）
export const SCORE_AVG_DISTANCE_WEIGHT = envNum('SCORE_AVG_DISTANCE_WEIGHT', 0.7);
// 平均距离权重：保留一定的整体考量
export const SCORE_MAX_DISTANCE_WEIGHT = envNum('SCORE_MAX_DISTANCE_WEIGHT', 0.3);
