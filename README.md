# 🍽️ 约饭 - 让约饭更简单

朋友聚餐组织工具，微信小程序 + 后端 API 一体化项目。

发起饭局 → 朋友加入 → 智能推荐餐厅 → 投票确认，一站式解决「今天吃什么、去哪吃」的问题。

## ✨ 核心功能

- **创建饭局** — 填写标题、日期、餐段（午饭/晚饭）、聚餐类型（轻餐/正餐/夜宵），分享给朋友
- **位置收集** — 每位参与者选择自己的出发位置
- **智能推荐** — 基于所有人位置计算地理中心，调用高德地图 API 推荐附近餐厅，按距离公平性评分排序
- **餐厅详情** — 查看评分、人均消费、到每个人的距离、交通信息（地铁/公交/打车）
- **投票选餐厅** — 参与者对推荐餐厅投票，创建者确认最终选择
- **地图展示** — 在地图上查看餐厅和所有参与者的位置分布

## 🏗️ 项目结构

```
yuefan-app/
├── package.json           # 根目录统一脚本
├── server/                # 后端服务（Next.js API Routes）
│   ├── src/
│   │   ├── app/api/       # API 路由
│   │   │   ├── gatherings/            # 饭局 CRUD
│   │   │   │   ├── route.ts           # POST 创建饭局
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts       # GET 饭局详情
│   │   │   │       ├── join/          # POST 加入饭局
│   │   │   │       ├── recommend/     # GET 智能推荐餐厅
│   │   │   │       ├── vote/          # GET/POST 投票
│   │   │   │       ├── confirm/       # POST 确认餐厅
│   │   │   │       └── delete/        # POST 删除饭局
│   │   │   ├── nearby-poi/            # 附近 POI 搜索
│   │   │   ├── search-poi/            # POI 关键词搜索
│   │   │   ├── reverse-geocode/       # 逆地理编码
│   │   │   └── restaurant-detail/     # 餐厅详情
│   │   ├── lib/
│   │   │   ├── db.ts      # 数据模型 + JSON 文件持久化
│   │   │   └── config.ts  # 统一配置管理（环境变量）
│   │   └── middleware.ts  # CORS 中间件
│   └── data/              # 数据存储目录（自动创建）
│       └── gatherings.json
│
└── weapp/                 # 微信小程序（Taro + React）
    ├── config/
    │   └── index.ts       # Taro 构建配置
    ├── src/
    │   ├── app.config.ts  # 小程序应用配置
    │   ├── pages/
    │   │   ├── index/     # 首页（我的饭局列表 / 创建饭局）
    │   │   └── gathering/ # 饭局详情页（加入/推荐/投票/确认）
    │   ├── components/
    │   │   ├── LocationPicker  # 位置选择器组件
    │   │   └── RestaurantMap   # 餐厅地图组件
    │   └── utils/
    │       ├── api.ts     # API 封装（请求/重试/存储）
    │       └── types.ts   # 前端类型定义
    └── dist/              # 编译产物（已 gitignore）
```

## 🛠️ 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| **后端** | Next.js (App Router API Routes) | 16.1.6 |
| **前端** | Taro + React + SCSS | Taro 4.1.11 / React 18 |
| **数据存储** | JSON 文件持久化 | — |
| **地图服务** | 高德地图 API | v3 |
| **语言** | TypeScript | 5.x |
| **部署** | PM2 | — |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- [高德地图 API Key](https://lbs.amap.com/)（Web 服务类型）

### 1. 安装依赖

```bash
# 一键安装所有依赖
npm run install:all

# 或分别安装
npm run server:install
npm run weapp:install
```

### 2. 配置环境变量

在 `server/` 目录下创建 `.env.local`：

```bash
# 必填 - 高德地图 API Key
AMAP_API_KEY=你的高德地图API_KEY

# 可选 - 服务端口（默认 8001）
PORT=8001

# 可选 - CORS 允许的域名（默认 *）
CORS_ALLOW_ORIGIN=*
```

> 完整的可配置项参见 `server/src/lib/config.ts`，包括搜索半径、推荐算法权重等。

### 3. 启动后端

```bash
npm run server:dev
# 或
cd server && npm run dev
```

服务运行在 `http://localhost:8001`

### 4. 启动小程序

```bash
npm run weapp:dev
# 或
cd weapp && npm run dev:weapp
```

然后在微信开发者工具中导入 `weapp/` 目录，即可预览。

> 小程序默认连接 `https://www.kobesoft.top` 后端。开发时可通过环境变量切换：
> ```bash
> API_BASE_URL=http://localhost:8001 npm run weapp:dev
> ```

## 📦 构建部署

### 后端

```bash
npm run server:build
npm run server:start
```

推荐使用 PM2 管理进程：

```bash
cd server
pm2 start npm --name yuefan-server -- start
```

### 小程序

```bash
npm run weapp:build
```

在微信开发者工具中上传 `weapp/dist/weapp/` 目录。

## 📡 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/gatherings` | 创建饭局 |
| `GET` | `/api/gatherings/:id` | 获取饭局详情 |
| `POST` | `/api/gatherings/:id/join` | 加入饭局 |
| `GET` | `/api/gatherings/:id/recommend` | 智能推荐餐厅 |
| `GET` | `/api/gatherings/:id/vote` | 获取投票数据 |
| `POST` | `/api/gatherings/:id/vote` | 投票 |
| `POST` | `/api/gatherings/:id/confirm` | 确认餐厅 |
| `POST` | `/api/gatherings/:id/delete` | 删除饭局 |
| `GET` | `/api/search-poi?keyword=xxx` | POI 搜索 |
| `GET` | `/api/nearby-poi?lat=x&lng=y` | 附近 POI |
| `GET` | `/api/reverse-geocode?lng=x&lat=y` | 逆地理编码 |
| `GET` | `/api/restaurant-detail?id=x&name=x&lng=x&lat=x` | 餐厅详情 |

## 🧠 推荐算法

餐厅推荐基于**距离公平性评分**：

```
score = avgDistance × 0.7 + maxDistance × 0.3
```

- **avgDistance（70%）**：餐厅到所有参与者的平均距离，越小越好
- **maxDistance（30%）**：餐厅到最远参与者的距离，兼顾公平性

算法流程：
1. 计算所有参与者的地理中心点
2. 以中心点为圆心、3km 为半径搜索餐厅（无结果时自动扩大）
3. 根据聚餐类型过滤（轻餐/正餐/夜宵）
4. 计算每家餐厅到每个人的距离，按评分排序
5. 返回 Top 5 推荐，附带交通信息

## 📋 配置参数

所有参数均可通过环境变量覆盖（见 `server/src/lib/config.ts`）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `RECOMMEND_BASE_RADIUS` | 3000m | 推荐搜索半径 |
| `RECOMMEND_MAX_RESULTS` | 5 | 最大推荐数量 |
| `SCORE_AVG_DISTANCE_WEIGHT` | 0.7 | 平均距离权重 |
| `SCORE_MAX_DISTANCE_WEIGHT` | 0.3 | 最远距离权重 |
| `FORMAL_MIN_RATING` | 4.0 | 正餐最低评分 |
| `NEARBY_POI_RADIUS` | 1000m | 附近 POI 搜索半径 |

## 📄 License

Private project.
