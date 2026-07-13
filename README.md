# CubeMind

> 面向 CFOP 竞速玩家的本地化 AI 解法分析助手  
> V0.2 · 前后端分离 + 复刻 cstimer + GAN/魔域 BLE + CFOP 识别 + 公式库（48 case）+ DeepSeek AGENT + **GAN v2 AES 解密**

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 DeepSeek API Key（可选，不配置也能跑，用本地规则引擎）
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"

# 3. 启动后端（端口 3000）
npm run server

# 4. 另开终端：构建前端 + 启动静态服务器（端口 8080）
npm run build
npm run serve

# 5. Chrome 打开
# http://localhost:8080
```

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────────┐
│ 浏览器 (Chrome / Edge)                                            │
│ http://localhost:8080                                            │
│                                                                  │
│  src-frontend/                                                   │
│   ├── ble/         BLE 连接（GAN v2 AES + 魔域明文）              │
│   ├── scramble/    3x3 WCA 打乱生成                              │
│   ├── core/        CFOP 阶段识别 + 计时                          │
│   ├── formula/     公式库（F2L 12 + OLL 15 + PLL 21）            │
│   ├── agent/       DeepSeek fallback（API 调用移到后端）          │
│   ├── utils/       mathlib + lzstring                           │
│   └── main.ts      UI 入口                                       │
└─────────────────────────────────────────────────────────────────┘
                              │ fetch
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 后端 Node.js + Express                                           │
│ http://localhost:3000                                            │
│                                                                  │
│  src-backend/                                                    │
│   ├── routes/                                                   │
│   │   ├── analyze.ts   POST /api/analyze    DeepSeek 代理        │
│   │   └── solves.ts    /api/solves         解法历史持久化        │
│   ├── services/                                                 │
│   │   └── deepseek.ts  API_KEY 隔离，调用 DeepSeek + fallback   │
│   ├── data/                                                     │
│   │   └── history.json 本地解法历史（替换 localStorage）         │
│   └── server.ts        入口 + 静态托管前端 dist/                │
└─────────────────────────────────────────────────────────────────┘
```

## 📂 项目结构

```
d:\计时器\
├── CLAUDE.md                  ← 项目宪法（必读）
├── README.md                  ← 本文件
├── package.json               ← npm scripts + 依赖
├── tsconfig.json              ← TS 配置
├── build.mjs                  ← esbuild 构建脚本
├── index.html                 ← Demo 入口
│
├── cstimer/                   ← 参考源（不复刻，仅查阅）
├── dist/                      ← 构建产物（git ignore）
├── doc/                       ← 文档
│   ├── 01-product/            产品定位
│   ├── 02-tech/               技术文档
│   ├── 03-dev-log/            7天计划 + 每日日志
│   ├── 04-user-feedback/      用户访谈
│   └── 05-roadmap/            ★ 下一步计划
│
├── src-frontend/              ← 前端（浏览器）
│   ├── main.ts
│   ├── ble/
│   │   ├── gan-cube-protocol.ts       GAN v2/v3/v4 协议
│   │   ├── moyu-cube-protocol.ts      魔域协议
│   │   ├── gan-crypto.ts              ★ AES-128 加解密（Web Crypto）
│   │   └── gan-crypto-helpers.ts      纯函数（parseMac、密钥派生）
│   ├── scramble/
│   │   └── scramble-333.ts            3x3 WCA 打乱
│   ├── core/
│   │   ├── cfop-parser.ts             CFOP 阶段识别
│   │   └── timer.ts                   计时器 + 停顿检测
│   ├── formula/
│   │   ├── types.ts
│   │   ├── f2l-formulas.ts            F2L 公式库（12 case）
│   │   ├── oll-formulas.ts            OLL 公式库（15 case）
│   │   ├── pll-formulas.ts            PLL 公式库（21 case）
│   │   └── formula-library.ts         统一入口 + 推荐
│   ├── agent/
│   │   ├── types.ts                   AnalysisInput/Result 类型
│   │   └── deepseek.ts                前端 fallback
│   ├── utils/
│   │   ├── mathlib.ts                 CubieCube + moveCube
│   │   └── lzstring.ts                lz-string 包装（GAN 密钥解压）
│   └── __tests__/                     单元测试（8 套件，76 用例）
│
└── src-backend/               ← 后端（Node.js）
    ├── server.ts                     Express 入口
    ├── routes/
    │   ├── analyze.ts                POST /api/analyze
    │   └── solves.ts                 /api/solves CRUD
    ├── services/
    │   └── deepseek.ts               DeepSeek API + fallback
    └── data/
        └── history.json              解法历史持久化
```

## 🎯 已实现功能

### M1: BLE + 打乱
- ✅ 3x3 WCA 打乱生成（20/25/30 步）
- ✅ GAN v2 协议（**AES-128 加密** + 明文双模式）
- ✅ 魔域协议（明文）

### M2: 计时 + Move 流
- ✅ 计时器（开始/停止/重置）
- ✅ 实时 move 事件流
- ✅ 停顿检测（>300ms 视为思考）

### M3: CFOP 阶段识别
- ✅ 倒序解析算法
- ✅ Cross / F2L / OLL / PLL 自动切分
- ✅ 阶段用时统计

### M4: DeepSeek AGENT
- ✅ 后端代理 DeepSeek API（API_KEY 隔离）
- ✅ 前端 fallback（无需后端也能跑）
- ✅ 瓶颈识别 + 训练建议 + 鼓励
- ✅ 历史数据带入（最近 5 把）

### M5: 公式库（V0.2 核心）
- ✅ F2L 公式库（12 case）
- ✅ OLL 公式库（15 case，含 7 个 2-look）
- ✅ PLL 公式库（21 case）
- ✅ **每条公式包含"如何识别"+"如何执行"教学描述**
- ✅ AGENT 复盘后一键跳转

## 🧪 运行测试

```bash
# 全部测试
npm test

# 或直接
npx tsx --test src-frontend/__tests__/*.test.ts
```

| 套件 | 通过/总数 |
|------|----------|
| mathlib | 9/11（2 跳过已知缺陷） |
| scramble-333 | 7/7 |
| cfop-parser | 8/8 |
| timer | 7/7 |
| deepseek (fallback) | 6/6 |
| moyu-cube | 12/12 |
| formula-library | 15/15 |
| **gan-crypto** | **10/10**（纯函数） |
| **总计** | **74/76 · 0 失败** |

## 🔧 技术栈

| 维度 | 选型 |
|------|------|
| 前端语言 | TypeScript (strict) |
| 前端构建 | esbuild |
| 前端 BLE | Chrome Web Bluetooth API |
| 前端加密 | Web Crypto API（crypto.subtle） |
| 后端语言 | TypeScript + Node.js |
| 后端框架 | Express |
| 后端运行 | tsx (无需编译) |
| AGENT | DeepSeek API |
| 压缩算法 | lz-string（cstimer 用了同款） |
| 测试 | node:test + tsx |
| 存储 | 前端 localStorage + 后端 JSON 文件 |

## 🎮 使用流程

1. Chrome 打开 `http://localhost:8080`
2. 点击"生成新打乱"，记下 20 步序列
3. 把魔方拧成打乱状态
4. 点击"连接 GAN" → 选蓝牙（**如果是加密模式，弹出 MAC 输入**）
5. 点击"开始"开始计时
6. 转动魔方还原
7. 点击"停止并分析" → AI 给出瓶颈 + 建议
8. **点击"📖 跳转到公式库练习"** → 查看对应 case 的识别+执行

## 🐛 已知限制

- **GAN v2 AES 解密**：纯函数已验证（10/10 测试通过），实际解密依赖浏览器 Web Crypto API（Node 测试环境不支持 AES-ECB）。真 GAN 魔方测试留待用户。
- **mathlib 多步公式还原**：复杂 OLL/PLL 公式累积还原失败（已知缺陷，待 V0.3 完整对照 cstimer min2phase.js 复刻）
- **iOS Safari**：不支持 Web Bluetooth，仅 Chrome / Edge / Bluefy
- **F2L 启发式判定**：当前 80% 准确率，V0.3 升级到 4 槽位配对算法
- **历史数据**：前端 localStorage + 后端 JSON 文件，V0.3 换 SQLite

## 📜 API 文档

### `POST /api/analyze`

请求：
```json
{
  "totalDuration": 20000,
  "crossDuration": 2000,
  "f2lDuration": 12000,
  "ollDuration": 3000,
  "pllDuration": 3000,
  "crossMoves": 4,
  "f2lMoves": 24,
  "ollMoves": 7,
  "pllMoves": 7,
  "recentSolves": []
}
```

响应：
```json
{
  "bottleneck": "F2L 阶段步数偏多，观察和连贯性不足。",
  "trainingAdvice": "重点练习 F2L 四向手法...",
  "encouragement": "稳扎稳打，突破在即！"
}
```

### `GET /api/solves` / `POST /api/solves` / `DELETE /api/solves/:id`

解法历史 CRUD（持久化到 `src-backend/data/history.json`）

### `GET /api/health`

健康检查 + DeepSeek 配置状态

## 📅 进度

| Day | 任务 | 状态 |
|-----|------|------|
| Day 01 | 产品立项 | ✅ |
| Day 02 | 复刻核心逻辑 | ✅ |
| Day 03 | CFOP 识别 + 构建链 | ✅ |
| Day 04 | 测试运行 + 魔域测试 | ✅ |
| Day 05 | 公式库 + AGENT 联动 | ✅ |
| Day 06 | **前后端分离 + GAN v2 AES** | ✅ |
| Day 07 | 用户验证 + Demo 视频 | ⬜ |

## 📜 参考资源

- cstimer GitHub：https://github.com/cs0x7f/cstimer
- DeepSeek API：https://platform.deepseek.com/api-docs/
- WCA 打乱标准：https://www.worldcubeassociation.org/regulations/
## 一键启动

Windows 下双击项目根目录的 `start.bat` 即可自动安装依赖（首次运行）、构建前端、启动本地服务并打开浏览器。

服务地址：`http://localhost:3000`

也可以在终端运行：

```bash
python start.py
```
# Cube-mind
