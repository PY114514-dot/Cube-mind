# CubeMind

> 面向 CFOP 竞速玩家的本地化 AI 解法分析助手  
> V0.3 · GAN / 魔域智能魔方 · CFOP 分段与逐槽位复盘 · WCA 观察判罚 · 3D 解法回放 · AI 训练建议

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 DeepSeek API Key（可选，不配置也能跑，用本地规则引擎）
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"

# 3. 构建并启动完整应用（端口 3000）
npm run serve

# 4. Chrome 打开
# http://localhost:3000
```

不要在项目根目录直接执行 `python -m http.server 8080`。根目录的 `index.html` 会请求不存在的 `bundle.js`，页面只会显示静态骨架。`npm run serve` 会构建 `dist/` 后由后端统一托管页面和 `/api`，请访问 `http://localhost:3000`。

## 🛡️ Harness Engineering

项目已内置面向 AI 与人工协作的工程护栏，规则和架构记忆位于 [`.codex/`](.codex/)。提交跨模块修改前执行：

```bash
npm run harness:verify
```

它会依次运行测试、TypeScript 类型检查和前端构建。BLE、成绩校验与真实设备姿态相关改动还需要遵循 [`.codex/testing.md`](.codex/testing.md) 中的真机验证要求。

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
│   │                   + WCA 成绩与观察期判罚                      │
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
- ✅ WCA 风格观察期：整数 `15…1`、超过 15 秒 `+2`、超过 17 秒 `DNF`
- ✅ +2 / DNF 持久化到历史，并正确参与 PB / AO 的 WCA 成绩计算

### M3: CFOP 阶段识别
- ✅ 倒序解析算法
- ✅ Cross / F2L / OLL / PLL 自动切分
- ✅ 阶段用时统计
- ✅ F2L 四槽位用时、步数、停顿与回退复盘

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
- ✅ OLL / PLL 顶面状态图与 F2L 槽位聚焦图

### 3D 回放与设备姿态
- ✅ 27 个独立小方块的真实分层转动
- ✅ 打乱、完整解法与历史详情均支持逐步回放、播放和倍速
- ✅ 回放默认白底、黄面朝上，便于按 CFOP 视角复盘
- ✅ GAN 姿态四元数归一化、SLERP 平滑与渲染帧合并

## 🧪 运行测试

```bash
# 完整验证（推荐：单元测试、类型检查和构建）
npm run harness:verify

# 仅运行测试
npm test

# BLE 协议回归：通知包录制器、GAN v2 重复包回放与魔域解析
npm run verify:ble

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
| **总计** | **189 · 0 失败** |

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

1. Chrome 打开 `http://localhost:3000`
2. 点击"生成新打乱"，记下 20 步序列
3. 把魔方拧成打乱状态
4. 点击"连接 GAN" → 选蓝牙（**如果是加密模式，弹出 MAC 输入**）
5. 按提示完成打乱；观察期显示 `15…1`，超时将显示 `+2` 或 `DNF`
6. 转动第一步开始计时，完成还原后停止
7. 查看 CFOP、F2L 槽位与停顿复盘；需要时打开 3D 解法回放
8. 点击 AI 分析或跳转公式库进行专项练习

## 🐛 已知限制

- **GAN v2 AES 解密**：纯函数已验证（10/10 测试通过），实际解密依赖浏览器 Web Crypto API（Node 测试环境不支持 AES-ECB）。真 GAN 魔方测试留待用户。
- **iOS Safari**：不支持 Web Bluetooth，仅 Chrome / Edge / Bluefy
- **魔域陀螺仪**：通知入口已预留，但实际姿态字段仍需真机抓包标定。
- **历史数据**：当前为 localStorage + 后端 JSON；后续可迁移到 SQLite。

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
