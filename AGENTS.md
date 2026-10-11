# AGENTS.md

## 1. 项目定义

**CubeMind** —— 面向 CFOP 竞速玩家的本地化 AI 解法分析助手。

连接 GAN / 魔域智能魔方，自动拆分 CFOP 四阶段用时，通过 DeepSeek AGENT 识别瓶颈并生成训练计划。

**产品范围**：个人本地训练，无需 CubeMind 账号，不开发排行榜。参考 GAN / 魔域 APP 的复盘和公式练习交互，不接入其账号体系。

**当前版本**：V0.4（训练闭环 UI、逐槽位复盘、WCA 观察判罚、3D 回放、陀螺仪三协议、训练计划公式联动）。

**支持范围**：3x3 + GAN v2/v4 + 魔域 MHC/MoYu32（GAN v2/v4 AES 加密与陀螺仪、魔域 WCU_MY32 gyro 0xAB；GAN v1/v3 尚未实现）。

**下一版方向**：case 级识别与 AI 教练闭环，见 `doc/05-roadmap/next-version-case-level-coaching.md`。

---

## 2. 架构与构建

### 2.1 技术栈
- **语言**：TypeScript（strict 模式，0 any / 0 ts-ignore）
- **模块系统**：ES Modules（import 路径带 `.ts` 后缀）
- **打包**：esbuild（`build.mjs`：bootstrap.ts → dist/bundle.js + bundle.css，JS 为 IIFE）
- **BLE**：Chrome Web Bluetooth API
- **AGENT**：DeepSeek API（`DEEPSEEK_API_KEY` 环境变量注入；缺省/占位符时走 `src-shared/local-analysis-fallback.ts` 本地规则引擎，含重试+熔断）
- **存储**：localStorage
- **3D 渲染**：自研 CSS 3D（27 cubie div，无 WebGL / Three.js 依赖）
- **运行**：Node + tsx（后端 watch）、esbuild（前端）

### 2.2 目录结构
```
d:\计时器\
├── index.html              ← Demo 入口（构建时复制进 dist/ 并注入 ?v= hash）
├── agents.md               ← 本文件（项目权威手册；CLAUDE.md 为历史文档）
├── README.md               ← 使用说明
├── package.json            ← npm scripts + deps
├── tsconfig.json           ← strict, ES2020, Bundler resolution
├── build.mjs              ← esbuild: bootstrap.ts → dist/bundle.js (IIFE)
├── start.bat / start.py   ← 一键启动
├── doc\                    ← 文档（01-product / 02-tech / 03-dev-log / 04-user-feedback / 05-roadmap）
├── cstimer\                ← 参考源（不复刻，仅查阅，tsconfig 排除）
├── dist\                   ← 构建产物（bundle.js + index.html + cross-scramble-worker.js）
├── src-frontend\           ← 浏览器端 TypeScript（esbuild 打包）
│   ├── bootstrap.ts        ← 入口（错误边界 + 动态 import main.ts）
│   ├── main.ts             ← composition root（控制器工厂装配）
│   ├── ble\                ← BLE 协议层
│   │   ├── cube-driver.ts  ← 统一 CubeDriver 接口 + 诊断回调
│   │   ├── gan-cube-protocol.ts  ← GAN v2/v4（AES + 陀螺仪解码）
│   │   ├── gan-v4-move-packet.ts / gan-v4-move-stream.ts / gan-v4-replay.ts / gan-v2-replay.ts
│   │   ├── moyu-cube-protocol.ts ← 魔域 MHC + WCU_MY32（gyro 0xAB）
│   │   ├── moyu32-move-stream.ts
│   │   ├── gan-crypto.ts / gan-crypto-helpers.ts / aes128.ts ← AES-128 加解密
│   │   └── ble-packet-harness.ts ← 录制/回放测试工具
│   ├── controllers\        ← UI 控制器（工厂函数 createXxxController）
│   │   ├── ble-connection-controller.ts ← BLE 连接生命周期（CubeDriver[] 驱动）
│   │   ├── timer-controller.ts / move-controller.ts / phase-indicator-controller.ts
│   │   ├── practice-entry-controller.ts / solve-completion-controller.ts
│   │   ├── connect-sync-controller.ts / connection-guide-controller.ts
│   │   ├── cross-solver-controller.ts / scramble-controller.ts
│   │   ├── diagnostics-controller.ts / keyboard-shortcuts-controller.ts
│   │   ├── formula-library-controller.ts / settings-controller.ts
│   │   ├── history-controller.ts / timer-display-controller.ts
│   │   └── cube-editor-controller.ts / training-controller.ts
│   ├── core\               ← 业务核心（纯函数，可单测）
│   │   ├── cfop-parser.ts / cstimer-cfop.ts / f2l-slot-tracker.ts / f2l-case-recognizer.ts
│   │   ├── completed-solve-analysis.ts / completed-solve-record.ts
│   │   ├── solve-review.ts / solve-validation.ts / move-reconstruction.ts
│   │   ├── practice-controller.ts / practice-stats.ts / training-plan-engine.ts / training-plan-store.ts
│   │   ├── training-profile.ts / training-profile-store.ts ← 纵向训练档案（跨天聚合 + localStorage）
│   │   ├── plan-formula-picker.ts ← 训练计划 × 公式库联动（今日公式推荐排序，档案兜底掌握度）
│   │   ├── cross-solver.ts / cross-metrics.ts / cross-scramble.ts / cross-scramble-worker.ts
│   │   ├── scramble-tracker.ts / scramble-verification.ts / scramble-ready-gate.ts
│   │   ├── physical-state-sync.ts / inspection-capture.ts / inspection-rules.ts
│   │   ├── timer.ts / app-state.ts / app-settings.ts / session-context.ts
│   │   ├── history-store.ts / history-export.ts / data-migration.ts / data-quality.ts
│   │   ├── wca-average.ts / solve-completion-plan.ts / solve-result-view.ts / solve-result-feedback.ts
│   │   └── diagnostics-client.ts
│   ├── agent\               ← DeepSeek 接入 + 分析控制器
│   │   ├── deepseek.ts / analysis-controller.ts / analysis-input.ts / cube-state-tools.ts
│   ├── formula\             ← CFOP 公式库（F2L/OLL/PLL + 分组 + 顶视图渲染）
│   │   ├── formula-library.ts / formula-groups.ts / f2l-formulas.ts / oll-formulas.ts / pll-formulas.ts
│   │   └── cube-case-diagram.ts / setup-validation.ts
│   ├── scramble\            ← WCA 打乱生成（scramble-333.ts）
│   ├── ui\                  ← CSS 3D 渲染、回放播放器、结果渲染器
│   │   ├── cube-visualizer.ts / static-cube-preview.ts / formula-top-view.ts
│   │   ├── solve-replay-player.ts / solve-timeline.ts / history-detail-controller.ts
│   │   └── analysis-markup.ts / analysis-renderer.ts / solve-result-renderer.ts
│   ├── utils\               ← mathlib / quaternion / lzstring / cube-colors / debug（__CUBEMIND_DEBUG 门控）
│   ├── types\               ← 环境声明（web-bluetooth.d.ts）
│   ├── __tests__\           ← 单元测试（node:test + tsx）
│   └── __fixtures__\        ← 测试数据
├── src-backend\             ← Node.js Express 服务端（tsx watch 运行）
│   ├── server.ts / app.ts / validation.ts
│   ├── routes\              ← /api/analyze / /api/diagnostics / 公式备选
│   └── services\            ← DeepSeek 客户端（重试 + 熔断 + fallback）+ analysis-result.ts 证据引用校验
└── src-shared\              ← 前后端共享类型 + 证据编译层 + 本地分析 fallback
    ├── analysis-types.ts
    ├── analysis-coaching.ts ← 多把 / 个人基准 / severity / 证据目录与准确片段定位
    ├── analysis-evidence.ts ← buildEvidence + evidenceToText + 训练档案 / 实战回流证据段
    ├── local-analysis-fallback.ts
    └── training-plan-types.ts ← 训练计划类型 + TrainingProfileEntry/TrainingProfile（纵向训练档案）
```

### 2.3 模块依赖规则
- `ble/` 只依赖 `utils/`；`ble/cube-driver.ts` 是接口层，不依赖具体实现
- `core/` 可依赖 `ble/`（仅类型）、`scramble/`、`agent/`（仅类型）、`utils/`
- `controllers/` 可依赖 `core/`、`ble/`（仅类型 + CubeDriver 接口）、`formula/`、`ui/`、`utils/`
- `ui/` 可依赖 `core/`、`utils/`
- `main.ts` 是 composition root，可 import 一切
- **禁止反向依赖**（如 `ble/` 不能 import `controllers/` 或 `core/` 的实现）

### 2.4 构建命令

**统一方案：npm scripts**
```bash
npm run build        # build.mjs: esbuild 打包 bootstrap.ts → dist/bundle.js (IIFE) + worker
npm run serve        # build + tsx watch src-backend/server.ts（3000 端口托管 dist 与 /api）
npm run test         # node:test + tsx，全部前后端单元测试
npm run typecheck    # tsc --noEmit
npm run verify       # test + typecheck + build（提交前必跑）
npm run simulate     # 独立 3001 无设备页面：正式训练链路 + 模拟驱动 + 一键自检
```

**首次开发时注意**：改 `index.html` 后必须 `npm run build` 复制进 dist/，否则刷新看不到改动；根目录直接开静态服务器会请求不到 bundle.js。

### 2.5 运行入口
- 开发服务器：`npm run serve` → http://localhost:3000（构建后由后端统一托管前端与 API）
- Demo 页面：`index.html`（构建时复制进 dist/，只引用 `dist/bundle.js`，勿手写 `<script type="module">` import 源码）
- 新模块经 `main.ts` 装配后由 esbuild 打进 bundle，无需在 index.html 里单独验证

### 2.6 BLE 驱动扩展
新增品牌魔方只需三步：
1. 在 `ble/` 下新建 `xxx-cube-protocol.ts`，实现 `CubeDriver` 接口
2. 在 `index.html` 连接面板加对应按钮和 MAC 输入框
3. 在 `main.ts` 的 `driverSlots` Map 和 drivers 数组中注册

controller 主逻辑无需修改。

---

## 3. 版本节奏

每完成一个**里程碑**必须做三件事：**测试 → 代码审查 → 更新日志**。

### 3.1 里程碑定义

| 里程碑 | 内容 | 必须通过的测试 | 状态 |
|--------|------|---------------|------|
| M1 | BLE 连接 + 打乱生成 | 浏览器能连上 GAN/魔域，打乱无连续同轴 | ✅ 已实现（GAN v2/v4 + 魔域 MHC/MoYu32，设备改动需真机复验） |
| M2 | 计时器 + Move 流 | 转动魔方，UI 实时显示 move + 时间间隔 | ✅ 完成（含 WCA 观察判罚） |
| M3 | CFOP 阶段识别 | 30 个标准解法，识别准确率 ≥85% | ✅ 阶段级完成；case 级见 V0.5 计划 |
| M4 | DeepSeek AGENT | 阶段用时 → 中文分析，输出含瓶颈+训练建议 | ✅ 完成（env key + 重试/熔断/fallback） |
| M5 | UI 完善 + 用户验证 | 3 个目标用户完成访谈，反馈记录到 doc/04 | 🔄 进行中（3 用户访谈未完成） |

### 3.2 测试要求

- **每个新模块必须配单元测试**：放在 `src/__tests__/` 下，文件名 `<模块名>.test.ts`
- **测试运行**：`npm test`（node:test + tsx）
- **覆盖标准**：核心算法（打乱、CFOP 解析、move 解析）覆盖率 ≥80%
- **手动测试**：每次里程碑在 Chrome 真实跑一遍，记录到 `doc/03-dev-log/daily-log/day-XX.md`

### 3.3 代码审查要点

每完成一个里程碑自查：
1. **死代码**：未使用的 import、函数、变量必须删除
2. **重复代码**：相同逻辑出现 2 次以上 → 抽函数
3. **类型安全**：禁用 `any`、禁用 `@ts-ignore`（必要时用 `unknown` + 收窄）
4. **依赖方向**：检查 import 是否违反 2.3 的依赖规则
5. **错误处理**：所有 BLE / API 调用必须有 catch + 用户可见的提示

审查结果记录到当日日志的 `## 自查` 小节。

### 3.4 日志规范

每次开发结束必须更新 `doc/03-dev-log/daily-log/day-XX.md`：
- ✅ 今天完成（具体到文件名 + 行数）
- 🤔 待解决（明确阻塞点）
- 📅 明天计划（对应 7day-plan.md 哪一步）

---

## 4. 代码风格

### 4.1 命名
- **文件名**：kebab-case + 后缀（`gan-cube-protocol.ts`）
- **类名**：PascalCase（`GanCube`）
- **函数/变量**：camelCase（`scramble333`）
- **常量**：UPPER_SNAKE（`SOLVED_FACELET`）
- **接口**：PascalCase，I 前缀可选（`CubeMove` 比 `ICubeMove` 优先）
- **私有成员**：下划线前缀（`_device`）或 TypeScript `private`

### 4.2 注释
- **中文注释**，仅解释 *为什么*，不解释 *做了什么*
- JSDoc 仅用于导出的公共 API
- 行内注释用 `//` 不用 `/* */`
- TODO 必须带作者和日期：`// TODO(2026-07-03): 实现 GAN v2 加密`

### 4.3 函数
- 单函数不超过 **80 行**（超出必须拆分）
- 单文件不超过 **400 行**（超出必须拆模块）
- 优先纯函数，避免副作用
- 异步函数必须返回 `Promise<T>`，明确类型

### 4.4 错误处理
- **绝不静默吞错**：`catch (e) {}` 禁止，至少 `console.error(e)`
- 用户可见错误：`throw new Error(\`[模块名] 具体描述: ${detail}\`)`
- BLE 错误：在 catch 中调用 `disconnect()` 清理资源

### 4.5 Import / Export
- 使用 ES Modules：`import { foo } from "./bar.ts"`
- **导入路径必须包含 `.ts` 后缀**（esbuild 与 tsx 均按此解析）
- 每个模块显式声明 `export`，不导出内部实现
- 类型导入用 `import type { Foo } from "./bar.ts"`

### 4.6 TypeScript
- `strict: true`、`noImplicitAny: true`、`strictNullChecks: true`
- 数组用 `T[]` 不用 `Array<T>`
- 对象用 `interface` 不用 `type`（除非需要联合类型）
- 枚举用 `as const` 对象替代（`const Axis = { U: 0, R: 1 } as const`）

### 4.7 禁止项
- ❌ `any` 类型
- ❌ `@ts-ignore`
- ❌ `console.log` 调试残留（提交前删除；BLE 协议层带 `[模块名]` 前缀的功能性诊断日志除外，已收敛为 `window.__CUBEMIND_DEBUG` 门控，见 `utils/debug.ts`）
- ❌ 硬编码密钥/URL（`DEEPSEEK_API_KEY` 仅通过环境变量注入）
- ❌ jQuery、Lodash 等运行时依赖
- ❌ 中文变量名 / 中文文件名

---

## 5. 关键决策记录

| 决策点 | 选择 | 锁定日期 |
|--------|------|----------|
| 目标用户 | CFOP 竞速玩家 sub-30 | 2026-07-03 |
| 平台 | Web（Chrome Web Bluetooth） | 2026-07-03 |
| BLE 库 | Chrome Web Bluetooth API | 2026-07-03 |
| 智能魔方品牌 | GAN 优先（v2 协议），后续加魔域 | 2026-07-03 |
| AGENT | DeepSeek | 2026-07-03 |
| 鉴权 | 无（Demo 级） | 2026-07-03 |
| 存储 | localStorage | 2026-07-03 |
| 与 cstimer 关系 | 独立产品，仅学习打乱格式和 UI | 2026-07-03 |
| 代码风格 | TypeScript strict + ES Modules + 中文注释 | 2026-07-03 |
| 3D 渲染 | 自研 CSS 3D（27 cubie div），不引入 Three.js/WebGL | 2026-07-13 |
| API Key 管理 | 环境变量注入 + 本地规则 fallback（弃硬编码）；2026-08-27 增根目录 `.env`（gitignored）+ `server.ts` 的 `loadEnvOverride`：`.env` 覆盖宿主环境（本机遗留旧 Key 曾遮蔽新 Key 致 401），文件缺失保持 fallback | 2026-08-24 |
| 差异化方向 | case 级识别 + AI 教练闭环（V0.5，弃多用户/云同步路线） | 2026-08-24 |
| AGENT 证据编译层 | 提示词证据段抽到 `src-shared/analysis-evidence.ts`（buildEvidence/evidenceToText + severity/flag 共享函数），fallback 与 AGENT 共用同一判定阈值，证据行内直接标注严重度；schema 校验失败回灌错误反馈修复一次（含流式）；temperature 0.7→0.4 | 2026-08-26 |
| 纵向训练档案 | 新增 `cubemind:training-profile` 持久化档案：公式练习记录按「公式 × 本地日期」聚合为按天桶（`core/training-profile.ts` + `training-profile-store.ts`），跨会话累积、不随历史记录轮转丢失；分析前前端同步并注入 `AnalysisInput.trainingProfile`，`analysis-evidence.ts` 渲染【训练档案】段（每公式最近 7 天成功率序列 + 近 3 日 vs 前窗趋势，阈值 10pp），后端只读。同批修复 `src-backend/validation.ts` 白名单缺口：`moveCount/stepReview/caseEvents/assignmentProgress/trainingProfile` 此前被静默剥离（AGENT 实际收不到逐 case 证据与指派效果），现全部带域校验透传 | 2026-08-27 |
| 训练计划与公式库联动 | 计划卡片当天聚焦 F2L/OLL/PLL 时自动推荐最值得练的具体公式（`core/plan-formula-picker.ts`：未练习 > 近期下滑 > 成功率低排序，掌握度用会话练习记录 + 纵向档案兜底，趋势与 AGENT 证据段同口径 `profileTrend`），渲染时现算保证随练习数据实时更新，芯片一键直达专项练习弹窗 | 2026-08-27 |
| 公式库 F2L 预览视角 | 用户反馈「白色在上面看不清 case」：F2L 3D 预览从底层仰视（rotationX=32，白 D 面占满画面且 U 面被转到背面，分离对的顶层棱块完全不可见）改为与 OLL/PLL 一致的俯视（rotationX=-28，露出 U 面），左右槽位仅翻转 rotationY 镜像。回归测试用 `getF2LFocusFaceletIndexes` + CSS 变换矩阵断言全部 41 个 F2L case 的角块与棱块至少各有一张贴纸朝向观察者（旧视角下 16 个 case 失败） | 2026-08-28 |
| 主页面与 3D 操作 | 计时、打乱、实时魔方和统计形成主舞台；CSS 从 index.html 移至四个 styles 模块，由 esbuild 输出 bundle.css；共享 3D 提供缩放、方向键和视角复位，观察操作不改变实体局面或陀螺仪基准；删除旧动画兼容分支 | 2026-10-11 |
| 自主专项实战反馈 | 固定 CASE 专项完成可直接创建训练回流记录；AI 再指派保留 trainedAt；观察前后各最多 30 把可信常规复原，同 CASE 前后各至少 3 次命中才展示变化，窗口结束样本不足明确提示 | 2026-10-11 |
| AI 多把与个人基准 | 输入保留最近 1–30 把可信常规复原的完整证据；此前最多 30 把构建阶段及同 CASE 中位数基准，与分析窗口不重叠。删除 recentSolves/recentStepReviews 请求字段和未使用的前端非流式入口。阶段占比不判瓶颈；无基准明确说明 | 2026-10-11 |
| AI 问题与回放引用 | analysis-coaching.ts 统一编译证据 ID、严重度和零基半开动作区间；模型引用须存在且阶段一致，数字由程序回填。问题卡定位到对应成绩，从打乱 + 前缀重建原始局面；旧记录无准确区间则不猜，完整解法可折叠 | 2026-10-11 |
| AI 流式请求生命周期 | 监听响应 res.close 的异常结束取消上游，避免把请求体读完误当断开；AbortSignal.any 合并 18 秒期限与客户端取消，覆盖 fetch、正文和一次格式修复；主动取消不计熔断失败。HTTP 模拟回归确认模型结果可完整到达前端 | 2026-10-11 |
| 复盘视角与实战资格 | 3D 回放默认 rotateX(152deg)，实际把黄色 D 面翻到上方，保留贴纸原色，播放和视角控件分区。训练回流与分析窗口共用 core/solve-validation.ts 的 isNormalAnalysisEligible，排除专项、rejected 和 score-only | 2026-10-11 |
| 实速复盘与本地数据 | solve-replay-timing.ts 从完整 moveGaps 建立动作时间；首步等待、暂停剩余间隔与倍速共用同一时钟，缺时间明确为匀速演示。AnalysisSolve 白名单及后端域校验保留间隔，阶段 / 停顿定位重建原始局面；播放器隐藏或移除后暂停，转层 reset 取消动画与定时器。存储失败保留当前页面成绩并通知导出，不自动删除旧成绩 | 2026-10-11 |
| 阶段时间轴与自定义 F2L | 时间占比与阶段入口分开：细条保留比例，卡片展示完整阶段名、用时和步数，手机两列；停顿单独展示。现有 41 个 F2L case 每个保存一条本机解法，使用原 case setup 校验并训练，预览 / 专项 / 今日训练复用同一所选解法。支持外层转动，无新增账号、排行榜或依赖；进入专项关闭公式库，防抖搜索不能重新开窗 | 2026-10-11 |
| 无设备 UI 与逻辑验收 | npm run simulate 在独立 3001 端口用模拟 GAN 驱动装配正式页面，复用计时 / CFOP / 训练 / 3D。支持半转通知、延迟回读、断连、姿态与一键自检；不读取 .env，不上传诊断。UI / 训练改动默认模拟验收，设备协议改动再补真机 | 2026-10-11 |
| 模拟训练工具栏 | 模拟入口采用默认收起的紧凑工具栏，连接与自检在主行，其余操作与公式输入放入更多操作。模板和样式拆到 testing 目录，仅在模拟构建中使用；连接状态跟随正式控制器，运行 / 成功 / 错误分开反馈，保留键盘操作和 44px 点击高度 | 2026-10-11 |
| 首页居中与统计 | 主舞台左右等宽，计时标题与数字 / 控件居中；双侧稳定滚动条槽防止弹窗开关造成左右偏移。首页上一把 / AO5 / 次数在 HistoryController 共享刷新，跟随历史分组 | 2026-10-11 |
| 专项解法与观察回读 | 专项保存所选解法快照，单把差值与 PB 只比较同 CASE / 同解法成功记录；固定 CASE 成效保留成功率，解法混合或缺快照时不比较执行速度。打乱回读独立管理所有权，重置 / 换轮 / 断连后失效，旧 finally 不释放新核验；异常可见 | 2026-10-11 |
| 过渡打乱绝对起点 | 本轮打乱前的已追踪局面保存在 startingMoves，成绩与回放使用 startingMoves + 实际打乱；相邻同面动作合并以抵消重试链。postSolveMoves 保留成绩结束后的全部动作，下一轮先冻结起点再清空本轮记录，避免遗漏额外转动或在 Worker 返回后重复叠加 | 2026-10-11 |
| 所选解法与教练参照 | 成绩完成时由公式库提供所选变体快照，case-event-assembly 不再直接依赖公式库或用实际步数伪造参照。expectedMoves / moveDelta 按快照计算并随历史与 API 保留；复盘区分起手前等待和首末动作间隔，参照不证明实际使用的手法。训练推荐和前后回流共用 hasSameCaseReference，手法不同或缺少快照时步数差为空，后端接受该状态并继续消费停顿证据，不改写历史参照 | 2026-10-11 |

| 成绩核验取消 | TimerController 持有单次核验的 AbortController；启动 / 重置 / 断连使旧核验失效，尾包仍可录入当前计时状态。完成控制器在回读后检查 signal、TimerState 身份、练习会话与打乱身份，失效结果不能接触 UI 或历史；旧 finally 不清除新核验标志。回读异常提示用户并保留动作，不新增存储键或兼容路径 | 2026-10-11 |
| 3D 触点生命周期 | 共享 CubeDomRenderer 只跟踪一个活动 pointerId；其他触点不能重设拖拽起点或结束该手势，pointercancel / lostpointercapture 均结束当前拖拽。鼠标拖拽和手机方向键 / 缩放 / 复位经真实浏览器验证；多触点与丢失捕获由事件回归覆盖，未声称手机真机触摸验收 | 2026-10-11 |

变更决策时更新此表，并在当日日志说明原因。
