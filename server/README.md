# 约饭 - 后端服务

基于 Next.js 16 App Router 的 API 服务，为约饭小程序提供后端接口。

## 技术栈

- **Next.js 16** — App Router API Routes
- **TypeScript 5**
- **JSON 文件持久化** — 无需数据库依赖
- **高德地图 API** — POI 搜索、逆地理编码、交通查询

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/gatherings` | 创建饭局 |
| `GET` | `/api/gatherings/:id` | 获取饭局详情 |
| `POST` | `/api/gatherings/:id/join` | 加入饭局 |
| `GET` | `/api/gatherings/:id/recommend` | 智能推荐餐厅（Top 10） |
| `GET/POST` | `/api/gatherings/:id/vote` | 获取/提交投票 |
| `POST` | `/api/gatherings/:id/confirm` | 确认餐厅 |
| `POST` | `/api/gatherings/:id/delete` | 删除饭局 |
| `POST` | `/api/gatherings/batch` | 批量获取饭局详情 |
| `GET` | `/api/search-poi` | POI 关键词搜索 |
| `GET` | `/api/nearby-poi` | 附近 POI 搜索 |
| `GET` | `/api/reverse-geocode` | 逆地理编码 |
| `GET` | `/api/restaurant-detail` | 餐厅详情 |

## 核心模块

| 文件 | 说明 |
|------|------|
| `src/lib/config.ts` | 统一配置管理（所有参数可通过环境变量覆盖） |
| `src/lib/db.ts` | 数据模型 + JSON 文件持久化（临时文件 + rename 防损坏） |
| `src/lib/geo.ts` | 地理计算：Haversine 距离、中心点、距离公平性评分 |
| `src/middleware.ts` | CORS 中间件 |

## 开发

```bash
npm install
npm run dev    # 默认端口 8001
```

## 构建部署

```bash
npm run build
npm start
```

## 环境变量

在 `.env.local` 中配置：

```bash
AMAP_API_KEY=你的高德地图Key    # 必填
PORT=8001                       # 可选
CORS_ALLOW_ORIGIN=*             # 可选
```

完整配置项参见 `src/lib/config.ts`。

## 数据存储

数据以 JSON 格式存储在 `data/gatherings.json`，写入采用临时文件 + rename 策略防止数据损坏。饭局过期后（12 小时）自动清理。
