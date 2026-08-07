# GoodMemory PRD

> Product Requirements Document for GoodMemory  
> Source documents: [GoodMemory-First-Principles-and-Reference-Architecture.md](./GoodMemory-First-Principles-and-Reference-Architecture.md), [GoodMemory-OSS-Architecture-v1.md](./GoodMemory-OSS-Architecture-v1.md)

**Status:** Draft  
**Product type:** OSS-first TypeScript library  
**Primary positioning:** LLM 和用户之间的 memory layer  
**Target release:** v1 OSS release

---

## 1. 产品概述

GoodMemory 是一个面向 AI 应用的独立 memory layer。

它位于：

- 上层 chatbox / copilot / agent runtime
- 与下层模型、存储、embedding、检索系统

之间。

它的目标不是替代：

- LLM
- agent framework
- RAG
- vector database

它要解决的问题更具体：

> 让任意 LLM 应用以尽量小的集成成本，获得更稳定、更可解释、更可维护的用户记忆能力。

从产品定义上，GoodMemory 不是 memory store。

它是一个 **user-aware context engine**，负责：

- remember: 决定什么值得记住
- recall: 决定这轮什么相关
- buildContext: 决定如何把记忆喂给模型
- verify: 决定什么时候不要盲信旧记忆
- maintain: 决定记忆如何衰减、合并、纠错和删除

---

## 2. 背景与问题

LLM 默认是无状态的。

如果应用希望模型“记住用户”，通常会落入以下几类方案：

- 直接拼接历史消息
- 做一个 profile store
- 把所有历史都扔进向量库
- 绑定某个 agent framework 的 memory 模块
- 依赖模型厂商内置 memory feature

这些方案都有明显问题：

- 历史消息拼接会迅速碰到上下文和成本上限
- profile store 只能表达静态属性，难以表达 episodic 和 procedural memory
- 向量检索会放大噪声，且很难处理更新、冲突和时效性
- framework 内置 memory 迁移成本高，难以成为通用基础设施
- 模型厂商内置 memory 不可编排、不可审计、不可移植

真实的产品问题不是“怎么存”，而是：

- 什么应该进入 memory
- 什么不应该进入 memory
- 什么应该在这轮被召回
- 什么应该先验证再用
- 什么应该随着时间消失、合并或修正

因此，市场上缺少一个真正独立、简洁可集成、同时又足够强的 memory layer。

---

## 3. 产品目标

### 3.1 核心目标

GoodMemory v1 必须达成以下目标：

1. 让一个工程师在 15-20 分钟内把 GoodMemory 接入一个 chatbox 或 AI agent。
2. 在不改变底层模型的前提下，明显改善用户连续性、个性化和多轮协作质量。
3. 让开发者能解释每一次记忆写入与召回的原因。
4. 让系统在长会话下依然可用，而不是随着上下文增长迅速失效。
5. 保持默认形态足够轻，不要求 sidecar、图数据库或复杂基础设施。

### 3.2 v1 成功标准

GoodMemory v1 成功，不是因为功能最多，而是因为它满足以下结果：

- 用户明显减少重复提供背景信息
- 回答更稳定地符合用户偏好和已确认的协作方式
- 可以正确承接过去的重要对话和决定
- prompt 组装复杂度对接入方明显下降
- 记忆相关 token 成本可控
- 开发者可以定位 recall / remember 的行为原因
- 接入方愿意把它当作默认 memory layer，而不是 demo 附件

---

## 4. 非目标

v1 明确不做：

- 通用企业知识库平台
- 通用 orchestration / workflow engine
- graph-first memory platform
- multimodal-first memory platform
- 全量 memory OS
- UI-first managed product
- 强耦合任一 agent framework 的 memory abstraction

v1 也不默认承担：

- knowledge ingestion from arbitrary docs at scale
- cross-org memory governance platform
- enterprise-grade analytics dashboard
- heavy cloud control plane

这些能力可以是未来产品层或插件层方向，但不进入 v1 默认产品心智。

---

## 5. 目标用户

### 5.1 主要用户

1. **AI 产品工程师**
   正在做 chatbox、copilot、AI workflow assistant，希望快速补上 memory。
2. **Agent runtime 作者**
   需要一个框架无关、可嵌入的 memory layer，而不是再造一套。
3. **独立开发者 / 小团队**
   需要本地可跑、低运维、默认可用的长期记忆组件。
4. **编码 agent 产品团队**
   需要在长会话、文件操作、工具调用场景下维持任务连续性和用户偏好。

### 5.2 次级用户

- AI 基础设施团队
- 个性化 AI 产品团队
- 需要自托管用户记忆能力的 SaaS 团队

---

## 6. 核心 Jobs To Be Done

### JTBD 1

当我在做一个 LLM 应用时，我希望通过少量 API 就能获得可靠 memory，而不是自己设计 taxonomy、retrieval policy 和 maintenance loop。

### JTBD 2

当用户再次回来时，我希望系统能记得对未来仍然有价值的内容，而不是只会机械回放聊天记录。

### JTBD 3

当模型基于旧记忆做判断时，我希望系统知道哪些记忆可以直接信，哪些应该先验证。

### JTBD 4

当系统连续工作很久时，我希望上下文不会因为 tool 输出、检索结果和历史堆积而快速失控。

### JTBD 5

当开发者或用户质疑系统为什么记住或引用某条内容时，我希望可以解释、修正、删除、禁用。

---

## 7. 产品原则

GoodMemory v1 的产品原则来自两份架构文档，并转译成产品要求：

1. **默认可接入**
   默认接入必须比“自己糊一个 memory”更容易。
2. **选择性记忆**
   记忆不是日志。只保存未来有价值的内容。
3. **保守写入，精准召回**
   写得少，但召得准。
4. **runtime 与 durable 分离**
   当前任务状态不应自动变成长期记忆。
5. **procedural memory 一等公民**
   用户纠正、验证、偏好和协作方式必须有独立建模。
6. **verify before act**
   旧记忆不是事实真相。
7. **maintenance is core**
   没有维护能力的 memory layer 迟早退化。
8. **explainable by default**
   记忆必须可解释、可修正、可删除。
9. **advanced capability hidden by default**
   高级能力存在，但不应污染默认产品心智。

---

## 8. 产品定义

### 8.1 顶层定位

GoodMemory 的主定义固定为：

> 一个帮助 LLM 应用在用户交互中做连续性决策的 memory layer。

不使用 “Memory OS” 作为 v1 主定义。

Memory OS 只在 future direction 中作为可能的演化方向出现。

### 8.2 对外最小 API

v1 面向集成者只主推以下接口：

```ts
createGoodMemory(config)
recall(input)
buildContext(input)
remember(input)
forget(input)
feedback(input)
```

其中：

- `feedback(input)` 是 procedural memory 的正式入口
- `updateWorkingMemory()`、`runMaintenance()`、`exportMemory()` 这类接口只作为高级能力或 escape hatch 出现

### 8.3 核心产品闭环

GoodMemory v1 的最小产品闭环是：

```text
write -> recall -> compose -> verify -> maintain
```

如果其中任何一个环节缺失，产品会退化为：

- 只会存的数据库层
- 只会召回的检索层
- 只会拼 prompt 的 context helper
- 或没有生命周期治理的脆弱 memory feature

---

## 9. Memory Taxonomy

v1 的记忆分类固定为 5 类。

### 9.1 Runtime memory

用于当前会话和当前任务的连续性。

包括：

- session buffer
- working memory
- session journal
- optional runtime context controls

特点：

- 更新频率高
- 生命周期短
- 行动相关性高
- 默认不直接作为 durable memory 导出

### 9.2 Semantic memory

用于表达用户和协作关系中的稳定知识。

包括：

- user profile
- preferences
- facts
- references

特点：

- 跨会话复用
- 通常便于精确更新
- 多数情况下注入成本低

### 9.3 Episodic memory

用于表达发生过什么、做了什么决定、有哪些未完成问题。

包括：

- episodes
- decisions
- unresolved items
- follow-up hooks

特点：

- 更适合时间和叙事相关召回
- 不等于 profile
- 不等于 raw chat history

### 9.4 Procedural memory

用于表达“系统应该如何做事”。

包括：

- explicit corrections
- validated patterns
- confirmed working styles
- do / don't / prefer guidance

特点：

- 对协作质量影响非常大
- 不应被混入 preference 或 fact
- 是 v1 的一等能力

### 9.5 Derived memory

用于表达高阶推断结果。

包括：

- inferred goals
- habits
- risk patterns
- higher-level insights

特点：

- 默认信任等级低
- 需要 evidence 和 confidence
- v1 默认关闭主链路

---

## 10. 目标使用场景

v1 同时覆盖两类主场景，但通过 profile 区分，而不是两套产品。

### 10.1 通用 chat / copilot

默认 profile：`general_chat`

重点能力：

- user profile continuity
- preference consistency
- episodic carry-forward
- procedural memory for tone and collaboration style

价值：

- 更少重复背景输入
- 更稳定的个性化体验
- 更自然的跨会话延续

### 10.2 Coding agent

默认 profile：`coding_agent`

重点能力：

- runtime continuity
- working memory
- session journal
- procedural memory for validated patterns and corrections
- optional runtime context controls

价值：

- 长会话不容易丢任务状态
- 用户确认过的工作方式能被持续遵守
- 重要工作历史不会被随机上下文噪声覆盖

### 10.3 Workflow agent

v1 支持，但不是主设计中心。

原则：

- memory informs workflow
- memory does not become orchestration

---

## 11. 用户体验与集成模型

### 11.1 默认接入路径

接入方的默认心智必须足够简单：

1. 初始化 `createGoodMemory(config)`
2. 模型调用前执行 `recall()`
3. 用 `buildContext()` 得到可注入内容
4. 模型响应后执行 `remember()`
5. 用户纠正或确认时执行 `feedback()`

### 11.2 Before-LLM hook

产品要求：

- 必须支持在模型调用前注入 memory context
- 输出必须支持最少一种通用序列化形式
- 默认不强迫接入方采用某一种固定 prompt 模板

### 11.3 After-response hook

产品要求：

- 必须支持在模型完成一轮响应后编译新记忆
- 不要求主线程同步等待所有后台维护任务完成
- 默认记忆写入应支持异步模式

### 11.4 Optional maintenance hook

产品要求：

- TTL expiry、dedupe cleanup、consolidation、stale verification、dream-style consolidation
  作为 maintenance 层能力存在
- soft decay 是 recall-time ranking policy，不是 maintenance mutation job
- retrieval exposure 不是 reinforcement，不得因 recall 次数提高未来排序、confidence 或 lifecycle
- 这些能力不要求纳入最小集成闭环
- 没有 maintenance，系统仍能运行；有 maintenance，质量明显提升

### 11.5 本地优先

产品要求：

- 必须支持 local-first 开发体验
- 默认本地模式应使用 in-memory 或 SQLite
- 不要求 sidecar、Redis、图数据库、队列等基础设施才能跑起来

---

## 12. 功能需求

### 12.1 FR-1 基础初始化

系统必须允许集成者通过一个统一入口初始化 memory layer。

要求：

- config 足够小
- 默认值清晰
- 对外表达 framework-neutral

### 12.2 FR-2 Recall

系统必须支持按当前 query 和 scope 召回相关记忆。

要求：

- 支持 `general_chat` 与 `coding_agent` 两种默认 retrieval profiles
- 支持 semantic / episodic / procedural / runtime 的差异化召回
- 召回结果必须可解释
- 召回结果必须能进入 `buildContext()`
- 可选 provider reranker 只能重排已接纳候选，不得改变召回成员或放宽 abstention
- provider reranker 失败必须确定性降级，并在不含 query/正文/密钥的 retrieval trace 中可见
- retrieval trace 必须能区分 lexical、dense、entity、RRF fusion 与 reranker 分数/排名

### 12.3 FR-3 BuildContext

系统必须把 recall 结果变成模型可用的 context。

要求：

- 支持结构化对象输出
- 支持至少一种直接可注入 prompt 的输出
- 负责 token budget 控制
- 不把所有 recall 结果原样注入

### 12.4 FR-4 Remember

系统必须能从最近交互中编译 durable memory。

要求：

- 能识别不同 memory 类型
- 支持 merge / supersede / reject
- supersede 必须保留旧记录与 `supersededBy` lineage，不得复用旧 ID 或静默删除历史值
- 支持 explicit vs inferred 区分
- 支持 conservative write policy

### 12.5 FR-5 Feedback

系统必须支持 procedural memory 的独立写入。

要求：

- 允许记录用户纠正
- 允许记录用户确认的有效做法
- procedural memory 不得被混入普通 preference/fact

### 12.6 FR-6 Forget / Correction

系统必须支持纠正与删除。

要求：

- 能基于 memory id 删除或失效
- 能导出与删除用户相关 durable memory
- 能处理 superseded / inactive 状态

### 12.7 FR-7 Verification

系统必须在产品层承认 “memory 可能过期”。

要求：

- recalled memory 在驱动行动时可触发轻量验证
- verification 可以是默认策略的一部分，也可以是 profile 行为
- stale memory 不应与 fresh memory 被等价对待

### 12.8 FR-8 Maintenance

系统必须具备 maintenance 能力。

要求：

- dedupe cleanup
- TTL expiry
- consolidation
- stale verification
- contradiction repair

这些能力不要求都在热路径中完成。

Soft decay 仅在 recall 时计算；它不得修改 durable record。TTL/validity 是
hard expiry：到期记录在 maintenance 持久化前也必须立即不可召回，maintenance
再负责写入 inactive lifecycle 并删除对应向量。

### 12.9 FR-9 Explainability

系统必须能解释：

- 为什么记住
- 为什么召回
- 它的来源是什么
- 它是否被推断
- 如何修改或删除

### 12.10 FR-10 Optional runtime context controls

系统应允许更高级的长会话能力，但不把它们作为默认接入前提。

包括：

- tool-result spillover
- preview replacement
- microcompact
- session-journal compaction
- full compaction

这些能力在产品中被归类为 advanced internal capability。

### 12.11 FR-11 LanguagePack 横向扩展

GoodMemory 必须把语言支持实现为一个端到端语义边界，而不是散落在业务模块中的
locale 分支或翻译文件。

0.7 的产品契约是：

- `LanguagePack` 是唯一语言扩展点；不保留旧 language adapter 兼容层
- 一等支持 English、简体中文、繁体中文、日文、韩文、法文和西班牙文
- 同一 pack 负责检测、抽取、query/content analysis、时间表达、实体、搜索词和人类可读渲染
- remember、recall、answer、storage 和 installed-host 只能消费语言无关的结构化分析，不新增具体语言分支
- 未支持的显式 locale 使用 neutral Unicode 行为，不继承英文语义
- 简体和繁体分别保证同脚本写入与召回，不承诺简繁跨脚本词法召回
- 原始用户内容永远不转换；OpenCC、第三方语言检测器和日文 NLP 运行时不进入默认依赖
- analyzer、search schema 或 resolver identity 变化时，版本化派生 projection 必须 fail-closed 重建
- 新增自定义语言只注册完整 pack，并通过同一 conformance 与 `xx-Test` 端到端门禁，不修改业务模块

0.7 是干净 breaking release。升级必须完成 API/配置迁移、per-scope projection
重建和发布验证；不发布 adapter shim、dual-write 或半迁移状态。完整决策见
ADR-008，操作步骤见 `GoodMemory-0.6-to-0.7-Migration-Guide.md`。

---

## 13. 非功能需求

### 13.1 易集成

- 默认 API 必须少
- 文档首页必须有短接入示例
- 不暴露内部子模块心智

### 13.2 可移植

- 不绑定单一模型厂商
- 不绑定单一框架
- 不绑定单一存储

### 13.3 可解释

- 所有核心行为都应具备审计线索
- 用户与开发者都能理解系统行为

### 13.4 可维护

- 支持长期记忆质量维护
- 支持简单本地调试
- 支持 CLI inspect / trace / export

### 13.5 成本可控

- 默认召回不能粗暴注入大量历史
- 默认写入不应频繁制造低价值记忆
- 长会话下上下文成本必须可被限制

### 13.6 隐私与控制

- 支持 delete/export
- 支持 policy hooks
- 支持用户显式要求 “ignore memory”

---

## 14. 竞争对比与产品取舍

这部分作为 PRD 的产品立场说明，而不是研究笔记。

| 项目 | 借鉴 | 放弃 | GoodMemory 的选择 |
|---|---|---|---|
| LangMem | hot-path memory tools、background memory manager | 向 LangGraph storage/runtime 倾斜太强 | 采用热路径 + 后台维护双模型，但保持框架无关 |
| Mem0 | 极简 API、快速 adoption path | 把 memory 过度扁平化为简单 CRUD/flat memory 心智 | 保持接入简单，同时保留更强的 taxonomy 和 maintenance |
| Zep | temporal awareness、provenance、pre-assembled context | graph-rich context engineering 对多数 OSS 接入方过重 | 引入 provenance 和时效性思想，但不以图谱为默认落地 |
| EverMemOS | 连续学习 ambition、跨 session memory vision | 平台范围过大、默认复杂度高 | 学其 ambition，不采用其默认重形态 |
| MemOS | tool memory、feedback correction、maintenance ambition、local/cloud split | memory OS 级别广度和更重基础设施 | 保留 feedback 和 maintenance 作为一等能力，但坚持 library-first |

PRD 的正式产品姿态为：

> 像 Mem0 一样易接入，像 Claude Code 一样懂长会话，像 Zep 一样重 provenance，但不走 MemOS/EverMemOS 那种重平台路线。

---

## 15. 与现有架构文档的关系

### 15.1 现有 canonical 文档

[GoodMemory-First-Principles-and-Reference-Architecture.md](./GoodMemory-First-Principles-and-Reference-Architecture.md)

作用：

- 定义第一性原理
- 定义产品边界
- 定义参考架构
- 作为外部稳定设计说明

### 15.2 现有 v1 实现蓝图

[GoodMemory-OSS-Architecture-v1.md](./GoodMemory-OSS-Architecture-v1.md)

作用：

- 定义模块边界
- 定义更细的数据模型和内部能力
- 定义 adapter 和 roadmap
- 作为 implementation-oriented companion document

### 15.3 本 PRD 的作用

本 PRD 回答的是：

- 这个产品要服务谁
- 要解决什么问题
- 为什么要这样设计
- v1 应交付什么
- 什么明确不做
- 什么才算成功

它不重复：

- 详细 package layout
- 全部 adapter matrix
- 具体 backlog 分期细节
- 低层实现决策

---

## 16. v1 范围

### 16.1 v1 必须交付

1. TypeScript library-first 形态
2. 最小公共 API：`createGoodMemory`、`recall`、`buildContext`、`remember`、`forget`、`feedback`
3. 5 类 memory taxonomy 的稳定产品心智
4. `general_chat` 与 `coding_agent` 两个默认 retrieval profiles
5. semantic / episodic / procedural / runtime memory 的主链路
6. maintenance 层的基本能力定义
7. local-first 开发体验
8. explainability + inspectability 基础能力
9. 文档和 example 接入路径
10. Bun + TypeScript 运行时与测试基础设施
11. TDD 驱动的开发流程
12. 产品级完整评测集

### 16.2 v1 明确不交付

- full memory OS positioning
- graph-native default architecture
- multimodal-first memory
- dashboard / memory viewer
- managed cloud control plane
- enterprise analytics platform
- heavy infra dependency matrix

---

## 17. 成功指标

### 17.1 产品指标

- 集成时间：接入 demo 时间控制在 15-20 分钟
- 复用率：接入方愿意持续保留 GoodMemory，而不是试用后移除
- 个性化效果：用户少重复输入背景信息
- 延续性效果：能正确承接 prior interaction
- 可解释性：开发者能定位 recall / remember 的原因

### 17.2 质量指标

- recall precision
- recall coverage
- overwrite correctness
- conflict correctness
- stale memory handling quality
- token efficiency
- user identity/background recognition quality
- history task / open-loop continuation quality

### 17.3 系统指标

- memory write yield
- maintenance completion rate
- session continuity quality
- long-session token pressure stability
- regression suite pass rate
- persona eval stability across reruns
- baseline vs GoodMemory uplift

---

## 18. 测试与验证策略

v1 必须采用 **TDD（测试驱动开发）** 形式推进。

### 18.1 开发测试策略

每一部分功能开发都必须遵循：

1. 先写测试
2. 再写最小实现
3. 再做重构
4. 回归到全量测试集

### 18.2 测试层级

GoodMemory v1 至少包含四层测试：

1. **Unit tests**
   验证 memory taxonomy、merge/supersede、routing、budgeting、policy、verification 等局部逻辑。
2. **Integration tests**
   验证 recall / buildContext / remember / feedback / forget 在 Bun + TypeScript 运行时中的协同行为。
3. **Scenario tests**
   用结构化 persona spec + 合成对话 replay 验证单个用户生命周期中的连续性表现。
4. **Product eval suite**
   用完整的多 persona 测试集做回归评测，对比使用 GoodMemory 与不使用 GoodMemory 的效果差异。

### 18.3 评测口径

产品完整测试集采用：

- **LLM-as-judge 为主**
- **结构化 persona spec + 合成对话 replay**
- **允许使用真实外部模型 API**

其中：

- 核心单元与集成测试应尽量 deterministic
- 产品完整评测允许 live model calls
- 回归套件以 A/B 方式比较 “without memory” 与 “with GoodMemory”

### 18.4 产品级评测集要求

v1 必须包含一批完整回归测试样本。

最低要求：

- 约 40 个独立 persona
- 每个 persona 有明确的：
  - 身份
  - 背景知识
  - 职业
  - 偏好
  - 成长路径
  - 历史任务与开放问题
- 大部分 persona 为中等生命周期样本
- 少量 persona 为长期生命周期样本

### 18.5 主评测目标

产品级评测优先衡量两项主目标：

1. **更好识别用户身份 / 背景**
2. **更好承接历史任务 / 开放问题**

其他指标如风格个性化、token 成本、procedural memory 命中率可作为次级指标。

### 18.6 评测产出

产品评测每次运行至少输出：

- 总分与分项分数
- 每个 persona 的失败案例
- memory write / recall / feedback trace
- 使用 GoodMemory 与不使用 GoodMemory 的 A/B 对比结果

---

## 19. 风险与缓解

### 风险 1：做成“什么都想做”的 memory 平台

后果：

- adoption 变差
- 学习成本变高
- v1 迟迟无法定型

缓解：

- 严格坚持 library-first
- 严格区分 default vs advanced
- 不把 Memory OS 当主定位

### 风险 2：写入太多低价值记忆

后果：

- recall 噪声增大
- 维护成本变高
- 用户信任下降

缓解：

- conservative write policy
- procedural/semantic/episodic 区分
- maintenance 必须存在

### 风险 3：召回太多，导致 prompt 污染

后果：

- token 成本上升
- 回答质量下降
- 长会话更快失效

缓解：

- precise recall
- budgeted context builder
- optional runtime context controls

### 风险 4：过度依赖旧记忆

后果：

- 误导当前动作
- 产生过期判断

缓解：

- verify before act
- stale memory handling
- provenance 和维护能力

---

## 20. 最终产品结论

GoodMemory v1 应被定义为：

> 一个面向 LLM 应用的、可插拔的、可解释的、默认简洁的 memory layer。

它的优势不应来自“存得最多”或“基础设施最重”，而应来自：

- 更正确地决定什么该被记住
- 更正确地决定什么该在当前被想起
- 更正确地把记忆变成模型可消费的上下文
- 更正确地知道何时不该盲信旧记忆
- 更正确地维护记忆质量

这就是 GoodMemory 作为产品应该坚持的核心。
