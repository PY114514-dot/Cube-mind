# CubeMind 架构记忆

## 目标

CubeMind 是面向 CFOP 竞速玩家的本地化智能魔方计时与 AI 复盘应用。浏览器连接 GAN / 魔域设备，记录动作流，校验还原状态，再提供 CFOP 与 F2L 槽位分析。

## 分层

| 层 | 目录 | 职责 | 禁止事项 |
| --- | --- | --- | --- |
| BLE 协议 | `src-frontend/ble/` | 连接、解密、通知解析、原始包诊断 | 依赖 `core/` 或直接操作 DOM |
| 业务核心 | `src-frontend/core/` | 计时、打乱校验、CFOP、成绩、复盘 | 直接渲染 UI |
| 公式与打乱 | `src-frontend/formula/`、`scramble/` | case、setup、公式可执行性、打乱 | 绕过魔方状态校验 |
| UI | `src-frontend/ui/`、`main.ts`、`index.html` | 3D 渲染、DOM 事件与展示 | 重新实现核心业务规则 |
| 后端 | `src-backend/` | 静态托管、DeepSeek 代理、历史 API | 保存 BLE 密钥或替代前端状态机 |

## 关键不变量

1. 成绩有效性由动作连续性、最终还原状态和数据质量共同决定；只要最终状态不正确，不能计入成绩。
2. 设备协议“识别通知类型”不等于“已可靠解码”。未知 payload 必须保留为诊断数据。
3. 公式库的 setup 从复原状态执行；setup 与公式组合后必须达到对应 CFOP 目标。
4. 公式库的 F2L 视角为白底、红前、蓝左；OLL / PLL 使用白下黄上的顶面状态图。

