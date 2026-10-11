# CubeMind

> 面向 CFOP 竞速玩家的本地化 AI 解法分析助手  
> V0.4 · GAN / 魔域智能魔方 · CFOP 分段与逐槽位复盘 · WCA 观察判罚 · 3D 解法回放 · AI 训练建议

面向个人本地训练，无需 CubeMind 账号，不提供排行榜。成绩与训练档案保存在当前浏览器。

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
│ http://localhost:3000                                            │
│                                                                  │
│  src-frontend/                                                   │
│   ├── ble/         GAN v2/v4 + 魔域 MHC/MoYu32                   │
│   ├── scramble/    3x3 WCA 打乱生成                              │
│   ├── core/        CFOP 阶段识别 + 计时                          │
│   │                   + WCA 成绩与观察期判罚                      │
│   ├── formula/     公式库（F2L 41 + OLL 57 + PLL 21）            │
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
│   │   └── diagnostics.ts /api/diagnostics  运行诊断              │
│   ├── services/                                                 │
│   │   └── deepseek.ts  API_KEY 隔离，调用 DeepSeek + fallback   │
│   └── server.ts        入口 + 静态托管前端 dist/                │
└─────────────────────────────────────────────────────────────────┘
```

## 📂 项目结构

```
d:\计时器\
├── AGENTS.md                  ← 项目约定（CLAUDE.md 为历史文档）
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
│   │   ├── gan-cube-protocol.ts       GAN v2/v4 协议
│   │   ├── moyu-cube-protocol.ts      魔域协议
│   │   ├── gan-crypto.ts              AES-128 加解密（复用项目 aes128.ts）
│   │   └── gan-crypto-helpers.ts      纯函数（parseMac、密钥派生）
│   ├── scramble/
│   │   └── scramble-333.ts            3x3 WCA 打乱
│   ├── core/
│   │   ├── cfop-parser.ts             CFOP 阶段识别
│   │   └── timer.ts                   计时器 + 停顿检测
│   ├── formula/
│   │   ├── types.ts
│   │   ├── f2l-formulas.ts            F2L 公式库（41 case）
│   │   ├── oll-formulas.ts            OLL 公式库（57 case）
│   │   ├── pll-formulas.ts            PLL 公式库（21 case）
│   │   └── formula-library.ts         统一入口 + 推荐
│   ├── agent/
│   │   ├── types.ts                   AnalysisInput/Result 类型
│   │   └── deepseek.ts                前端 fallback
│   ├── utils/
│   │   ├── mathlib.ts                 CubieCube + moveCube
│   │   └── lzstring.ts                lz-string 包装（GAN 密钥解压）
│   └── __tests__/                     前端单元与回归测试
│
└── src-backend/               ← 后端（Node.js）
    ├── server.ts                     Express 入口
    ├── routes/
    │   ├── analyze.ts                POST /api/analyze
    │   └── diagnostics.ts            POST /api/diagnostics
    ├── services/
    │   └── deepseek.ts               DeepSeek API + fallback
    └── __tests__/                    API 与输入校验测试
```

## 🎯 已实现功能

### M1: BLE + 打乱
- ✅ 3x3 WCA 打乱生成（20/25/30 步）
- ✅ 白色 Cross 固定 1～8 步训练打乱：优先筛选 20 步 WCA 状态，低步数自动回退到可验证短打乱
- ✅ GAN v2/v4 协议（AES-128 加密；v1/v3 尚未实现）
- ✅ 魔域 MHC 明文协议与 WCU_MY32 加密协议

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
- ✅ 后端流式代理 DeepSeek API，模型请求、正文读取与格式修复共用超时和取消信号
- ✅ 无 Key 或网络失败时使用本地规则，页面明确标注分析来源
- ✅ 分析最近 1–30 把可信常规复原，保留各把 CASE、停顿与动作，排除专项成绩
- ✅ 以窗口之前最多 30 把的阶段 / 同 CASE 中位数建立个人基准；耗时占比仅展示分布
- ✅ 模型问题必须引用本次证据；严重度与数字由程序回填，具体公式也需有同阶段证据
- ✅ 带入专项掌握度、跨天训练档案与训练后的实战表现，调整下一组训练

### M5: 公式库（V0.2 核心）
- ✅ F2L 公式库（41 case）
- ✅ OLL 公式库（57 case，含 2-look 标签）
- ✅ PLL 公式库（21 case）
- ✅ **每条公式包含"如何识别"+"如何执行"教学描述**
- ✅ AGENT 复盘后一键跳转
- ✅ OLL / PLL 顶面状态图与 F2L 槽位聚焦图
- ✅ F2L 每个 case 可保存一条自己的解法，支持修改、删除、局面校验及本机持久化；预览、专项和今日训练使用所选解法

### 3D 回放与设备姿态
- ✅ 27 个独立小方块的真实分层转动
- ✅ 打乱、完整解法与历史详情均支持逐步回放、播放和倍速
- ✅ 完整动作时间支持实速回放，保留起手等待和长停顿；暂停后继续剩余间隔，可切换匀速演示
- ✅ 细时间条展示用时占比，阶段卡片显示完整名称、用时和步数；阶段 / F2L 槽位与独立停顿入口可定位原始局面，手机采用两列阶段卡片
- ✅ 回放默认白底、黄面朝上，便于按 CFOP 视角复盘
- ✅ AI 问题卡可定位到对应成绩的准确动作片段，从原始打乱和前缀动作重建起点，片段结束自动停止
- ✅ 片段保留贴纸原色，播放按钮与视角工具条分区；手机按钮至少 44px，整把回放可折叠
- ✅ 问题片段与整把互斥播放；关闭抽屉、折叠或替换输出后停止推进，清理转层动画和计时器
- ✅ GAN 姿态四元数归一化、SLERP 平滑与渲染帧合并

### 训练界面（V0.4）
- ✅ 主页面集中展示计时、打乱、实时魔方和最近统计，窄屏按阅读顺序排列，保留金色 / 森林 / 海洋 / 紫色主题
- ✅ 3D 支持拖动、方向键、缩放和视角复位；视角操作不改变实体局面或陀螺仪基准
- ✅ 主页面展示下一项 CASE 训练；自主完成固定专项也可跟踪后续实战，前后各至少 3 次同 CASE 命中才展示变化
- ✅ 3D 魔方保持 27 个独立小方块和真实分层转动，增加独立“连接魔方”入口，不复制 APK 资源
- ✅ AI 结果增加阶段耗时条、步数密度和 F2L 四槽位的用时 / 步数 / 停顿 / 修复概览
- ✅ 公式库和历史复盘继续复用同一套 3D 预览与白底、黄面朝上的 CFOP 视角
- ✅ 练习模式支持智能随机 / 顺序出题、未掌握筛选、公式掌握度、识别时间与执行时间
- ✅ 专项开始前精确核验 F2L / OLL / PLL case；起始状态不匹配时不会记为成功样本
- ✅ 3D 回放按 27 个独立 cubie 排队执行真实外层转动，高速播放不丢动作

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
| 全部 node:test 套件 | **455/455** |
| **总计** | **455 · 0 失败（2026-10-11）** |

## 🔧 技术栈

| 维度 | 选型 |
|------|------|
| 前端语言 | TypeScript (strict) |
| 前端构建 | esbuild |
| 前端 BLE | Chrome Web Bluetooth API |
| 前端加密 | 项目内 AES-128 实现（aes128.ts） |
| 后端语言 | TypeScript + Node.js |
| 后端框架 | Express |
| 后端运行 | tsx (无需编译) |
| AGENT | DeepSeek API |
| 压缩算法 | lz-string（cstimer 用了同款） |
| 测试 | node:test + tsx |
| 存储 | 浏览器 localStorage；历史面板支持 JSON / CSV 导出 |

## 🎮 使用流程

1. Chrome 打开 `http://localhost:3000`
2. 点击“新打乱”，查看打乱序列
3. 把魔方拧成打乱状态
4. 点击"连接 GAN" → 选蓝牙（**如果是加密模式，弹出 MAC 输入**）
5. 按提示完成打乱；观察期显示 `15…1`，超时将显示 `+2` 或 `DNF`
6. 转动第一步开始计时，完成还原后停止
7. 查看 CFOP、F2L 槽位与停顿复盘；需要时打开 3D 解法回放
8. 点击 AI 分析或跳转公式库进行专项练习

AI 教练中选择最近的分析把数；页面会区分阶段均值、最近一把的槽位和此前个人基准。点击问题卡的「查看第 X 把」直接回看对应片段，再进入具体公式练习。完整动作间隔会用于实速回放；没有完整时间记录时明确显示匀速演示。缺少准确 CASE 动作区间时不猜位置。历史详情的「查看解法」也提供阶段导航和停顿定位。

历史保存失败会明确提示导出 JSON 备份，新成绩仍留在当前页面；不再自动删除旧记录来重试。刷新或关闭前请先完成导出。

自定义 F2L：打开「公式库 → F2L」，找到 case，展开「添加我的解法」，输入空格分隔的公式后点击「保存并使用」。支持 U R F D L B 及 2 / '，最多 80 步；保存前按该 case 的主解打乱验证，必须完成 F2L 并保留其他槽位。保存后默认使用「我的解法」，也可展开解法列表切回主解；删除自己的解法后恢复主解。数据仅存于本机浏览器。

最新验证包含阶段卡片、停顿定位、自定义解法保存 / 重载 / 删除、专项入口和桌面 / 375px 手机页面；未进行真机 BLE 验收。详细结果见 [Day 35 开发与审查记录](doc/03-dev-log/daily-log/day-35.md)。实速回放验证见 [Day 34](doc/03-dev-log/daily-log/day-34.md)，AI 流式链路的模拟模型验证见 [Day 33](doc/03-dev-log/daily-log/day-33.md)。

### GAN v4 姿态诊断采样

连接 GAN v4 后，可在 Chrome DevTools 控制台执行以下命令收集 `0xEC` 通知：

```js
__cubemindGanDiagnostics.start()
// 静止、绕 X/Y/Z 轴分别转动魔方，并做几次翻转
copy(__cubemindGanDiagnostics.export())
__cubemindGanDiagnostics.stop()
```

导出的 JSON 可随“静止 / 旋转方向 / 动作时间”说明保存，用于复核姿态解析与轴向映射。

## 🐛 已知限制

- **设备验收**：GAN v2/v4、魔域 MY32 姿态已接入代码；本轮未连接真实设备，持续高速转动与持握轴向仍需真机验证。MHC 姿态目前仅录制原始通知。
- **GAN v1/v3**：未实现，不在当前支持范围。
- **iOS Safari**：不支持 Web Bluetooth；桌面 / Android Chrome、Edge 可用，iOS 需使用支持 Web Bluetooth 的独立浏览器。
- **历史数据**：保存在当前浏览器的 localStorage；可从历史面板导出备份。
- **局面编辑器**：支持涂色与合法性校验，AI 局面求解尚未接入。

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
