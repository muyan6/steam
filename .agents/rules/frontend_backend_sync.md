---
description: 前后端同步修改与协调适配规则，确保前端新增功能后端同步支持，避免无序修改
trigger: always_on
---

# 前后端同步修改与一体化协同规则 (Frontend & Backend Synchronization)

## 1. 功能闭环与双端同步要求 (Feature Parity & Coordination)
- **同步新增与功能对齐**：前端（Electron 桌面端 / Vue 渲染层）新增或拓展任何功能（例如：新增配置项、数据筛选维度、状态同步、推送通知处理、密钥检索、统计项等），后端（Express 服务端 / Server API / Controller / Service / 管理控制台 Dashboard）必须**同步新增或升级**对应的接口支持、数据持久化与管理调度能力。
- **严禁单端孤岛实现**：严禁前端调用不存在的后端接口，严禁后端新增能力后前端未做适配集成，确保所有业务流程均具备完整的端到端闭环能力。

## 2. 严禁无序与破坏性修改 (Zero Arbitrary or Breaking Changes)
- **协议与数据结构严密对齐**：前后端数据模型、API 请求参数、响应 JSON 格式、字段命名（严格遵循统一的驼峰规范）及 TypeScript 类型定义必须精准匹配。
- **平滑兼容与协调适配**：避免随意破坏已有接口协议；新增字段需具备向后兼容性与合理的默认回退策略，确保前后端更加协调、适配与稳定。

## 3. 双端联调与构建验证 (End-to-End Build & Test Verification)
- 涉及前后端交互的任何变更，必须双向验证：
  1. 后端编译无报错：`npm run build` (在 `server/` 目录下)。
  2. 前端构建无报错：`npx vite build` (在根目录下)。
- 确保客户端与管理控制台、云端 API 的通信契约与鉴权机制完全一致。
