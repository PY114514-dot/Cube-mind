# CLAUDE.md

> CubeMind（暂定名）—— 面向CFOP竞速玩家的本地化AI解法分析助手

## 🎯 项目一句话

**连上GAN智能魔方 → 自动拆分CFOP四阶段用时 → DeepSeek AGENT告诉你这次为什么慢、下次练什么**。

---

## 📋 产品定位

| 维度               | 描述                                                          |
| ------------------ | ------------------------------------------------------------- |
| **目标用户** | CFOP竞速玩家（sub-30以内优先），已有智能魔方，每周训练3次以上 |
| **核心价值** | 瓶颈识别 + 训练计划生成，本地+中文优先                        |
| **差异化**   | 对标Cube Station但专注"诊断+处方"，比GAN官方更懂国内玩家      |
| **形态**     | 本地Demo（Mac/Windows Web优先），不依赖云账户                 |
| **品牌支持** | MVP仅支持**GAN**（后续加魔域）                          |

---

## 👤 目标用户画像

```
姓名：小李
年龄：18-28岁
身份：大学魔方社/爱好者，sub-20或sub-15阶段
设备：GAN356 iCarry / GAN i3 等智能魔方
现有工具：CSTIMER（计时）+ GAN Cube Station（回放）+ B站J Perm
痛点：
  1. 知道在某步慢，但说不清是F2L对位还是OLL识别
  2. 每次练完不知道下次该重点练什么
  3. Cube Station中文AI弱，国外APP不友好
付费意愿：愿为"看得见的进步"付30-50元/月
```

---

## 💎 核心卖点（三大杀手锏）

1. **🔍 瓶颈识别** —— 自动标记CFOP四阶段最慢步骤
2. **📋 训练计划生成** —— AGENT基于历史数据给出"下次该练什么"
3. **⚡ 本地化 + 中文优先** —— 不依赖海外服务器

---

## 🛠️ 技术栈（Demo级）

```
前端：纯HTML + Three.js + TailwindCSS
魔方3D：three.js（参考CSTIMER渲染）
BLE：Chrome Web Bluetooth API（省掉iOS/Android开发量）
AGENT：DeepSeek API（API_KEY硬编码，仅Demo）
存储：localStorage
部署：GitHub Pages
```

---

## 🎯 MVP功能边界

### ✅ V0.1 Demo 必须做

1. BLE连接GAN智能魔方（按MAC地址配对）
2. 实时接收转动数据（步数+停顿时间）
3. 简化计时器（按下魔方开始/停止）
4. **解法解析器**：转动序列 → CFOP四阶段（核心难点）
5. 阶段用时统计：Cross/F2L/OLL/PLL各自秒数
6. DeepSeek AGENT分析（瓶颈识别+训练建议）
7. 历史记录查看（最近20把，localStorage）
8. 解法回放（3D魔方，P2可砍）

### 🚫 明确不做

- 用户系统/登录/云同步
- 移动端（先Web）
- 社交/分享/排行榜
- WCA比赛功能
- 桥式/盲拧/FMC分析
- QiYi/YJ等其他品牌（先GAN，后续加魔域）

---

## 📂 项目文档结构

```
d:\计时器\
├── CLAUDE.md              ← 你正在看这个（项目宪法+对话总结）
├── doc\                   ← 所有文档统一放这里
│   ├── 01-product\        ← 产品文档
│   │   ├── product-spec.md        产品定位、用户画像、卖点
│   │   ├── mvp-features.md        MVP功能列表
│   │   └── competitors.md         竞品分析（Cube Station、CSTIMER等）
│   ├── 02-tech\           ← 技术文档
│   │   ├── architecture.md        整体架构
│   │   ├── ble-protocol.md        GAN魔方BLE协议逆向笔记
│   │   ├── cfop-parser.md         CFOP阶段识别算法
│   │   └── agent-prompt.md        DeepSeek prompt模板
│   ├── 03-dev-log\        ← 开发日志
│   │   ├── 7day-plan.md           7天验证计划
│   │   └── daily-log\             每日开发记录
│   │       └── day-01.md
│   └── 04-user-feedback\  ← 用户反馈
│       └── interview-template.md  访谈问题模板
└── src\                   ← 代码（暂未生成）
```

---

## 📅 7天验证计划（已锁定）

### Day 1-2：BLE协议调研 + Hello魔方

- 读CSTIMER `src/js/bluetooth.js`
- 用nRF Connect抓包GAN魔方BLE通信
- 写脚本：发现并连接GAN魔方，打印转动事件
- **里程碑**：终端能打印转动事件（含时间戳）

### Day 3：解法解析器（最难）

- 识别Cross/F2L/OLL/PLL边界
- Cross：以第一次F/B/R/L单转开始，到第一对F2L结束
- OLL：识别七步以内完成顶层定向
- PLL：硬编码10个常见PLL公式
- **里程碑**：给定标准解法序列，能正确拆分四阶段

### Day 4：计时 + 阶段用时

- 按下魔方物理按键 → 开始计时
- 停顿 >300ms → 标记为思考停顿
- 累加各阶段停顿时间
- **里程碑**：转一把，输出"Cross 3.2s / F2L 12.5s / OLL 1.8s / PLL 2.1s"

### Day 5：DeepSeek AGENT接入

- Prompt模板：本次解法+阶段用时+历史10把 → 瓶颈判断+训练建议
- **里程碑**：能拿到中文分析文字

### Day 6：前端UI（极简）

- Three.js+TailwindCSS
- 左侧：计时+阶段用时；右侧：AGENT建议；底部：历史
- 参考CSTIMER暗色配色
- **里程碑**：30秒Demo视频

### Day 7：找3个玩家+录Demo

- 关键问题：AI建议有用吗？愿付多少钱？现在用什么工具？
- B站/小红书发视频，看流量
- **里程碑**：3份反馈+视频数据

---

## 🔑 关键决策记录

| 决策点       | 选择                                   | 原因                                 |
| ------------ | -------------------------------------- | ------------------------------------ |
| 平台         | Web（Chrome Web Bluetooth）            | 省掉iOS/Android开发，BLE Web API够用 |
| BLE库        | Chrome Web Bluetooth API               | 浏览器原生，无需额外依赖             |
| 智能魔方品牌 | **GAN优先**（用户指定）          | 国内市场份额最大，协议相对开放       |
| AGENT供应商  | **DeepSeek**（用户指定）         | 中文友好，成本低                     |
| 鉴权         | 不要（Demo级）                         | 用户明确"本地Demo"                   |
| 存储         | localStorage                           | Demo级，不上数据库                   |
| 兼容CSTIMER  | 学习打乱格式和前端UI，**不Fork** | 独立产品                             |

---

## 🚀 立刻要做的事

1. **现在**：打开CSTIMER GitHub，重点看 `src/js/bluetooth.js` 和GAN协议处理
2. **今晚**：用nRF Connect扫描GAN魔方，记录Service UUID和Characteristic UUID
3. **明天**：写Chrome Web Bluetooth连接GAN魔方的第一行代码

---

## 📌 每次开发的工作流

> **重要约定**：每次Claude开始新工作前，必须先读 `CLAUDE.md` 和 `doc/03-dev-log/daily-log/` 下最新的日志，对齐进度后再动手。

工作流：

1. 读最新日志 → 确认进度
2. 看 `doc/03-dev-log/7day-plan.md` → 确认今天该做哪一步
3. 写代码 / 写文档
4. 更新当天日志（记录做了什么、卡在哪里、下次注意什么）
5. 如果有新决策，更新 `CLAUDE.md` 决策记录表

---

## 🔗 关键参考资源

- CSTIMER GitHub：https://github.com/cs0x7f/cstimer
- Cube Station（参考竞品）
- GAN魔方官方BLE协议（待逆向）
- DeepSeek API文档：https://platform.deepseek.com/

---

## 📞 与Claude协作约定

- 用户语言：**中文**
- 文档语言：**中文**
- 代码注释：**中文**
- 提交粒度：每个里程碑都要提交
- 遇到分歧：先反问，不要急着给方案

---

> **最后更新**：对话轮次 #3，确立了GAN优先、DeepSeek分析、本地Demo、CFOP阶段拆分为核心三大功能
