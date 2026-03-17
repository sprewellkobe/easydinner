# 约饭 - 后端服务

基于 Next.js 16 App Router 的 API 服务，为约饭小程序提供后端接口。

## 技术栈

- **Next.js 16** — App Router API Routes
- **TypeScript 5**
- **JSON 文件持久化** — 无需数据库依赖
- **高德地图 API** — POI 搜索、逆地理编码、交通查询

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
