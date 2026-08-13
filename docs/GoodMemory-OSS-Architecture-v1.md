# GoodMemory OSS v1 架构文档

> A pluggable memory layer for chat apps, copilots, and AI agents.
> `npm install goodmemory`

**Version:** v1-draft  
**Status:** Proposed  
**Audience:** OSS maintainers, SDK integrators, AI product teams

> **Historical v1 architecture map.** The high-level domain/module boundaries
> below still hold, but the "Proposed / v1-draft" status and the v0.1/v0.2/v0.3
> scope language predate the shipped 0.6.0 surface (`src/answer/` evidence packs,
> the evolution layer, host-memory experience, standalone MCP). For the current
> shipped surface see `docs/GoodMemory-Current-Status-and-Evidence.md`.

---

## 1. 项目定位

GoodMemory 的目标不是做：

- 另一个 agent framework
- 另一个通用 RAG 框架
- 另一个向量数据库
- 某一家模型厂商的 memory feature 包装层

GoodMemory 要做的是：

> 一个独立的、可插拔的、可自托管的用户记忆层。

让任意 chatbox / copilot / workflow agent / AI assistant 在不改底层模型的前提下，获得更稳定的用户记忆能力。

它应该同时满足三个约束：

1. 作为开源项目，安装和接入门槛要低。
2. 作为 npm 模块，必须框架无关、厂商无关。
3. 作为未来独立产品的核心，必须保留可治理、可观测、可扩展的演进空间。

---

## 2. 这版文档的核心决策

这份文档综合两份草案后的最终判断如下：

1. 采用 `claude` 版的 OSS-first 骨架。
2. 引入 `chatgpt` 版更成熟的数据模型与治理思路。
3. 明确把 GoodMemory 分成两层：

- **OSS Core**
  - 核心 API
  - 核心数据模型
  - recall / remember 主链路
  - adapter interfaces
  - 默认路由、压缩、检索策略
  - CLI 调试能力

- **Product Add-ons**
  - Web dashboard
  - 可视化审核与人工确认流
  - 高级策略管理
  - 团队协作与分析报表
  - 托管服务能力

4. v0.1 不把 Admin UI 当作核心交付物，先做 CLI inspector / trace。
5. v0.1 不过早拆太多包，先保证核心闭环、接入体验和评测质量。
6. Async-first，但不强依赖内置队列；无队列时也能工作。

---

## 3. 设计原则

### P1. 记忆不是存储问题，而是检索与压缩问题

GoodMemory 不追求“存得更多”，而追求：

- 记什么
- 何时更新
- 何时忽略
- 如何召回
- 如何在 token budget 内表达

### P2. 结构化优先，语义检索补充

- 稳定事实优先结构化
- 服务偏好单独建模
- 历史事件适合做 episodic summary + semantic recall
- working memory 不等于 long-term memory

### P3. 更新优先于追加

记忆系统的上限，不是写入量，而是更新正确率。

必须支持：

- dedupe
- supersede
- conflict handling
- decay
- delete / export
- explicit vs inferred source 区分

### P4. Async-first, hot path first

- `recall()` 是热路径，必须快
- `remember()` 是冷路径，默认异步
- consolidation / decay / re-embedding 都是后台任务

### P5. Zero lock-in

所有外部依赖必须可替换：

- LLM
- Embedding provider
- Storage
- Vector search
- Session store

### P6. Explainability first

系统必须能回答：

- 这次为什么记住了这条内容？
- 这次为什么注入了这条记忆？
- 它来自用户明确表达，还是系统推断？
- 如何删除或禁用？

### P7. Context pressure management 是 memory architecture 的一部分

顶级 memory 中间层不能只做 durable memory。

它还必须处理：

- 大型 tool / retrieval 结果的外溢存储
- 预览替换与稳定引用
- 轻量级 microcompact
- 低成本 session journal compaction
- 必要时的 full compaction

否则系统即使“记得住”，也会因为上下文膨胀而在真实 agent 工作流里失效。

### P8. 不要持久化可从权威来源重新推导的信息

不是所有有价值的信息都应该成为 durable memory。

- 代码结构、当前文件内容、最新 git 历史应优先从权威来源读取
- 当前会话的任务拆解应优先进入 plan / task system，而不是 long-term memory
- 相对时间写入 durable memory 时必须转成绝对时间
- 过期记忆在被用来驱动动作前，应优先做轻量验证

---

## 4. OSS Core 与 Product Add-ons 的边界

这是 GoodMemory 是否能做成独立开源模块的关键。

### 4.1 OSS Core 必须包含

- `createGoodMemory()` 初始化入口
- `recall()` 检索与路由
- `buildContext()` 上下文组装与序列化
- `remember()` 写入与编译
- `forget()` / `exportMemory()` / `deleteAllMemory()`
- runtime context pressure management
- typed observability hooks with redaction-safe trace/audit spans
- 默认 memory router
- 默认 extractor / summarizer / conflict resolver
- adapter interfaces
- `in-memory` / `sqlite` / `postgres+pgvector` 参考实现
- OpenAI-compatible / Anthropic-compatible provider adapters
- CLI inspect / trace / export / stats
- examples 和 evaluation harness

### 4.2 Product Add-ons 不应进入 v0.1 core

- Web dashboard
- 多人审核面板
- 可视化策略编排器
- 团队运营报表
- 托管控制平面
- 高级权限审批流

### 4.3 原则

> 核心库负责“让记忆能用且好用”，产品层负责“让记忆可运营、可协作、可商用”。

---

## 5. 概念模型

为了同时适配 chat app 和 agent，我们不再强行把所有内容塞进单一“4 层”。

更合理的方式是使用 **3 个记忆平面 + 1 个派生层**。

### 5.1 Runtime Context Plane

仅服务当前会话或当前任务。

- Session Buffer
- Working Memory Snapshot
- Session Journal
- Artifact Spill Store

这部分不是 durable memory，但它决定系统是否能在真实长会话中持续工作。

### 5.2 Structured Long-term Plane

可精确更新、可治理、可导出的长期记忆。

- User Profile
- Preferences
- Facts

### 5.3 Episodic Long-term Plane

保存“发生过什么”，而不是只保存“事实是什么”。

- Episodes
- Session summaries
- Key decisions
- Open loops

### 5.4 Derived Memory Plane

高阶推断结果，只能作为可选层，不进入 v0.1 默认主链路。

- Insights
- Habits
- Risks
- Goals inferred from evidence

---

## 6. 数据模型

### 6.1 Scope Model

这是给“独立模块”做对的第一前提。

```ts
interface MemoryScope {
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
}
```

规则：

- `userId` 是必填主键维度。
- `tenantId` 用于 SaaS 隔离。
- `workspaceId` 用于项目、知识域、工作空间隔离。
- `agentId` 用于多 agent 共享/隔离策略。
- `sessionId` 仅用于 runtime memory。

默认查询必须带 `userId`，其余 scope 由 policy 决定是否参与过滤。

### 6.2 SessionBuffer

```ts
interface SessionBuffer {
  sessionId: string;
  userId: string;
  messages: Message[];
  summary: string | null;
  summaryUpToIndex: number;
  createdAt: string;
  lastActiveAt: string;
}
```

职责：

- 维护当前 session 的滑动窗口
- 压缩旧消息
- 给 recall 提供短期上下文

### 6.3 WorkingMemorySnapshot

这部分从 agent 视角非常重要，不能只靠 conversation buffer 代替。

```ts
interface WorkingMemorySnapshot {
  sessionId: string;
  userId: string;
  currentGoal?: string;
  constraints?: string[];
  openLoops?: string[];
  temporaryDecisions?: string[];
  toolState?: Record<string, unknown>;
  state?: Record<string, unknown>;
  updatedAt: string;
}
```

用途：

- 任务连续性
- open loops 跟踪
- tool-driven agent 的中间状态恢复

### 6.3.1 SessionJournal

Session journal 是持续维护的“会话笔记”，用于在 compact 前就提前沉淀可恢复上下文。

```ts
interface SessionJournal {
  sessionId: string;
  userId: string;
  title?: string;
  currentState?: string;
  taskSpecification?: string;
  filesAndFunctions?: string;
  workflow?: string;
  errorsAndCorrections?: string;
  systemDocumentation?: string;
  learnings?: string;
  keyResults?: string;
  worklog?: string;
  lastSummarizedMessageId?: string;
  updatedAt: string;
}
```

设计意图：

- 它不是最终 long-term memory
- 它是低成本 compaction 的输入资产
- 它应该在后台按阈值增量更新，而不是等爆 context 再临时总结

### 6.3.2 ArtifactSpillRecord

对 tool-heavy agent，tool result 外溢存储是核心能力，不是边角料。

```ts
interface ArtifactSpillRecord {
  id: string;
  scope: MemoryScope;
  kind: "tool_result" | "retrieval_result" | "attachment" | "search_result";
  sourceId: string;
  preview: string;
  replacementText: string;
  storageUri: string;
  originalBytes: number;
  createdAt: string;
}
```

设计意图：

- 大结果不直接塞上下文
- 提供稳定 preview 和可回读句柄
- 同一个 sourceId 在同一段上下文生命周期内应复用相同 replacementText

### 6.4 UserProfile

```ts
interface UserProfile {
  userId: string;
  identity: {
    name?: string;
    role?: string;
    organization?: string;
    location?: string;
    timezone?: string;
    languagePreference?: string;
  };
  expertise: {
    primarySkills: string[];
    domains: string[];
    level?: "beginner" | "intermediate" | "senior" | "expert";
  };
  activeContext: {
    goals: string[];
    currentProjects: string[];
  };
  version: number;
  updatedAt: string;
  createdAt: string;
}
```

### 6.5 PreferenceMemory

偏好必须独立于普通 fact。

```ts
interface PreferenceMemory {
  id: string;
  userId: string;
  category: string;
  value: unknown;
  confidence: number;
  source: "explicit" | "inferred" | "import";
  evidenceCount: number;
  isPinned?: boolean;
  updatedAt: string;
}
```

原因：

- 偏好有服务语义，不只是事实语义
- 偏好通常需要 evidence accumulation
- 偏好比普通 fact 更容易被 prompt injection 直接消费

### 6.6 FactMemory

```ts
interface FactMemory {
  id: string;
  userId: string;
  workspaceId?: string;
  category:
    | "project"
    | "technical"
    | "personal"
    | "relationship"
    | "event"
    | "reference";
  content: string;
  confidence: number;
  importance: number;
  source: {
    sessionId?: string;
    method: "explicit" | "inferred" | "import";
    extractedAt: string;
  };
  accessCount: number;
  lastAccessedAt?: string;
  supersededBy?: string | null;
  isActive: boolean;
  embeddingId?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 6.7 EpisodeMemory

```ts
interface EpisodeMemory {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  summary: string;
  keyDecisions: string[];
  unresolvedItems: string[];
  topics: string[];
  entities?: string[];
  emotionalTone?: string;
  importance: number;
  confidence: number;
  embeddingId?: string;
  createdAt: string;
  archivedAt?: string;
}
```

### 6.8 Derived Insight

```ts
interface InsightMemory {
  id: string;
  userId: string;
  kind: "pattern" | "habit" | "goal" | "risk";
  content: string;
  confidence: number;
  evidenceMemoryIds: string[];
  updatedAt: string;
}
```

**决策：** 保留模型，但默认不进入 v0.1 主路径。

---

## 7. 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                    Chat App / Agent Runtime                  │
│  OpenAI SDK / Anthropic SDK / LangGraph / Vercel AI / etc.  │
└──────────────────────────────────────────────────────────────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
        recall(scope, query)         remember(scope, messages)
          hot path, sync             cold path, async-first
               │                             │
               ▼                             ▼
┌──────────────────────────────────────────────────────────────┐
│                        GoodMemory Core                       │
│                                                              │
│  Router        Compiler       Context Builder    Policies    │
│  - rules       - extract      - token budget     - privacy   │
│  - rewrite     - score        - serializer       - retention │
│  - plan        - dedupe       - packet builder   - sharing   │
│                 - merge                                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                       Adapter Layer                          │
│  LLM | Embedding | Document Store | Vector Store | Session   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     Storage / Infra Backends                 │
│   In-memory | SQLite | Postgres+pgvector | Redis | Queue     │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. 热路径：Recall

Recall 的目标不是“搜索更多”，而是“在尽量低的延迟和 token 成本下，选出最值得注入的记忆”。

### 8.1 输入

```ts
interface RecallInput {
  scope: MemoryScope;
  query: string;
  conversationHistory?: Message[];
  tokenBudget?: number;
  retrievalProfile?: string;
  metadata?: Record<string, unknown>;
}
```

### 8.2 流程

```text
query
  ↓
rule-based routing
  ↓
optional query rewrite
  ↓
multi-source recall
  - profile
  - preferences
  - facts
  - episodes
  - working memory
  ↓
rerank / dedupe / cluster
  ↓
budget-aware packet assembly
  ↓
structured recall result
```

### 8.3 路由策略

v0.1 只做两档：

- `rules-only`
- `hybrid`

不建议在 v0.1 把 `llm-only` 当默认策略。

### 8.4 RecallResult

```ts
interface RecallResult {
  profile: UserProfile | null;
  preferences: PreferenceMemory[];
  facts: FactMemory[];
  episodes: EpisodeMemory[];
  workingMemory?: WorkingMemorySnapshot | null;
  packet: MemoryPacket;
  metadata: {
    routingDecision: RoutingDecision;
    tokenCount: number;
    latencyMs: number;
    hits: Array<{
      id: string;
      type: "profile" | "preference" | "fact" | "episode" | "working_memory";
      score?: number;
      reason?: string;
    }>;
  };
}
```

### 8.5 MemoryPacket

```ts
interface MemoryPacket {
  profileSummary?: string;
  preferenceSummary?: string;
  factSummary?: string;
  relevantEpisodes?: Array<{
    id: string;
    summary: string;
    score: number;
  }>;
  workingMemorySummary?: string;
  syntheticMessages?: Message[];
  debug?: Record<string, unknown>;
}
```

设计决策：

- `recall()` 返回结构化结果
- `buildContext()` 才负责序列化
- 不强迫上层用某一种 prompt 格式

### 8.6 Artifact Spillover 与上下文稳定性

这是从 Claude Code 源码里最值得借鉴的机制之一。

原则：

- 大型 tool 结果、搜索结果、检索结果不要直接塞进 prompt
- 超预算内容进入 spill store，只把 preview + handle 注入上下文
- 一旦某个结果在当前上下文周期中被 preview 替换，这个决定应保持稳定
- 同一 sourceId 的 replacementText 必须可重放，以维持 prompt cache 稳定性

对 GoodMemory 的实现意义：

- `Context Builder` 不能只做 token budgeting，还要做 spillover orchestration
- `RecallResult.metadata` 需要显式暴露 spill records 和回读句柄
- 这项能力先在 tool-enabled integrations 中启用，不要求所有 chat app 都实现

---

## 9. 冷路径：Remember

### 9.1 公开语义

对外统一使用 `remember()`，同时保留 `learn()` 作为别名。

原因：

- `remember()` 更符合产品语义
- `learn()` 对已有 agent 生态更顺手

### 9.2 RememberInput

```ts
interface RememberInput {
  scope: MemoryScope;
  messages: Message[];
  mode?: "inline" | "background";
  metadata?: Record<string, unknown>;
}
```

### 9.3 流程

```text
messages
  ↓
candidate extraction
  ↓
classify
  ↓
score
  ↓
privacy / policy checks
  ↓
dedupe / conflict detect
  ↓
merge / supersede / reject
  ↓
persist
  ↓
embed + index
  ↓
emit events
```

### 9.4 v0.1 的保守策略

- 先写 `profile`
- 再写 `preferences`
- 再写 `facts`
- 最后写 `episode`
- `insights` 关闭默认写入

### 9.5 冲突处理原则

- 显式用户表达优先于系统推断
- 高置信旧事实与新推断冲突时，标记 `needs_confirmation`
- 低置信旧事实可被新显式事实 supersede
- 每次 supersede 保留版本链

### 9.6 后台任务必须隔离，并与主线程互斥

从 Claude Code 的实现看，background extraction / compaction / dream 都不是随便起一个异步函数。

它们需要：

- 隔离的执行上下文
- 最小工具权限
- 可复用但不破坏主线程 cache 的参数
- 可跳过 transcript 记录的能力
- 与“主线程已经手工写入 memory”互斥

GoodMemory 中的对应原则：

- 后台 extractor / consolidator 应运行在 worker 或 forked agent 中
- 没有必要写 transcript 的后台任务默认 `skipTranscript`
- 如果主线程本轮已经显式写入 memory，则后台 extraction 跳过，避免重复
- 如果已有任务在跑，新事件应 coalesce，而不是盲目并发堆积

### 9.7 Dreaming / Background Consolidation

“记忆写入”与“记忆整理”必须分开。

v0.2+ 建议加入 dream worker，职责包括：

- 扫描最近若干 session 的 durable signal
- 合并近似记忆
- 删除已被证伪或过时的记录
- 维护 memory index / digest
- 把相对时间标准化为绝对时间

触发策略建议：

- time gate
- session count gate
- consolidation lock

这能避免每轮 remember 都承担重度整理成本。

---

## 10. Public API

### 10.1 High-level API

```ts
import { createGoodMemory } from "goodmemory";

const memory = createGoodMemory({
  llm: { provider: "anthropic", model: "claude-sonnet" },
  embedding: { provider: "openai", model: "text-embedding-3-small" },
  storage: { provider: "sqlite", url: "./goodmemory.db" },
  router: { strategy: "rules-only" },
});

const recall = await memory.recall({
  scope: {
    userId: "u_123",
    workspaceId: "robot-project",
    sessionId: "s_001",
  },
  query: userMessage,
});

const context = await memory.buildContext({
  recall,
  output: "system_prompt_fragment",
});

await memory.remember({
  scope: {
    userId: "u_123",
    workspaceId: "robot-project",
    sessionId: "s_001",
  },
  messages: fullConversation,
  mode: "background",
});
```

Note:
This example is architecture-facing, not a claim that the current v1 OSS runtime already exposes every field shown here.
`llm`, `embedding`, and `router` stay in the v1 architecture because they are part of the planned provider layer and hybrid retrieval roadmap, even when some pieces are still staged for later implementation.

### 10.2 Session API

```ts
await memory.startSession(scope);
await memory.appendToSession(scope, messages);
await memory.updateWorkingMemory(scope, {
  currentGoal: "完成机器人异常恢复流程设计",
  openLoops: ["是否要补心跳丢失重试策略"],
});
await memory.endSession(scope);
```

### 10.3 Escape Hatch API

```ts
await memory.profile.upsert(scope, partialProfile);
await memory.preferences.upsert(scope, preference);
await memory.facts.add(scope, fact);
await memory.episodes.search(scope, query, { topK: 8 });
await memory.forget(scope, { memoryId });
await memory.exportMemory(scope);
await memory.deleteAllMemory(scope);
```

### 10.4 Event API

```ts
memory.on("memory.created", handler);
memory.on("memory.updated", handler);
memory.on("memory.conflict", handler);
memory.on("recall.completed", handler);
memory.on("remember.completed", handler);
memory.on("policy.blocked", handler);
memory.on("error", handler);
```

### 10.5 Context Output Modes

```ts
type ContextOutputMode =
  | "json"
  | "markdown"
  | "system_prompt_fragment"
  | "developer_prompt_fragment";
```

---

## 11. Adapter Contracts

### 11.1 LLM Adapter

```ts
interface LLMAdapter {
  complete(request: LLMRequest): Promise<LLMResponse>;
}
```

### 11.2 Embedding Adapter

```ts
interface EmbeddingAdapter {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
  modelId: string;
}
```

### 11.3 Document Store

```ts
interface DocumentStore {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, doc: T): Promise<void>;
  update<T>(collection: string, id: string, partial: Partial<T>): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  query<T>(collection: string, filter: QueryFilter): Promise<T[]>;
}
```

### 11.4 Vector Store

```ts
interface VectorStore {
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  search(
    collection: string,
    query: number[],
    options: SearchOptions,
  ): Promise<VectorSearchResult[]>;
  delete(collection: string, ids: string[]): Promise<void>;
}
```

### 11.5 Session Store

```ts
interface SessionStore {
  getBuffer(scope: MemoryScope): Promise<SessionBuffer | null>;
  saveBuffer(scope: MemoryScope, buffer: SessionBuffer): Promise<void>;
  getWorkingMemory(scope: MemoryScope): Promise<WorkingMemorySnapshot | null>;
  saveWorkingMemory(
    scope: MemoryScope,
    snapshot: WorkingMemorySnapshot,
  ): Promise<void>;
}
```

### 11.6 Optional Queue Adapter

```ts
interface QueueAdapter {
  enqueue(job: MemoryJob): Promise<void>;
}
```

**决策：**

- Queue 是可选，不是 core 强依赖。
- 没有队列时，SDK 允许调用方自行把 `remember()` 放进后台。

---

## 12. 存储策略

### 12.1 v0.1 默认组合

- 本地开发：`in-memory` 或 `sqlite`
- 生产参考：`postgres + pgvector`

### 12.2 不建议 v0.1 同时支持太多 provider

不要一开始就铺满 Pinecone / Qdrant / Chroma / Redis / Supabase。

建议：

- v0.1: `memory`, `sqlite`, `postgres+pgvector`
- v0.2: Redis session cache, OpenAI-compatible vector backends
- v0.3+: Pinecone / Qdrant / more managed backends

### 12.3 为什么

- 适配器越多，质量越难保证
- 早期真正决定项目生死的是记忆质量，不是 backend matrix
- 最佳开源策略是先把一个参考栈做扎实

---

## 13. Router / Retrieval 策略

### 13.1 路由输入信号

- query 本身
- profile 中的项目名 / 实体名
- session / working memory 状态
- retrieval profile
- policy constraints

### 13.2 路由默认规则

- 明确“上次 / 继续 / 之前 / previous / last time”时，优先搜 episodes
- 明确“我 / 我的项目 / 我们公司 / my project”时，优先搜 facts + preferences
- 纯泛问答时，只注入 profile / preferences，避免污染
- 当前 session 有活跃 open loops 时，优先 working memory

### 13.3 检索源

- exact lookup
- metadata filter recall
- keyword recall
- vector recall
- recent session recall

### 13.4 排序信号

```text
final_score =
  semantic_score * w1 +
  keyword_score  * w2 +
  recency_score  * w3 +
  importance     * w4 +
  confidence     * w5 +
  type_weight    * w6 +
  pinned_bonus   * w7
```

---

## 14. Context Builder

Context Builder 是 core 的一部分，不应让上层自己拼一堆 summary。

### 14.1 责任

- token budget control
- section allocation
- serializer
- truncation policy
- debug metadata

### 14.2 预算规则

建议默认分配：

- profile: 250-400 tokens
- preferences: 150-300 tokens
- facts: 300-600 tokens
- episodes: 200-400 tokens
- working memory: 100-300 tokens

### 14.3 截断策略

只保留三种：

- `truncate`
- `prioritize-relevance`
- `prioritize-recency`

v0.1 不做复杂 DSL。

---

## 15. Policy Engine

这个能力必须存在，但 v0.1 只做 hook 级别，不做重量平台。

### 15.1 Policy Hooks

```ts
interface MemoryPolicyHooks {
  shouldRemember?(candidate: MemoryCandidate, ctx: PolicyContext): Promise<boolean>;
  shouldRecall?(memory: MemoryRecord, ctx: PolicyContext): Promise<boolean>;
  redact?(
    candidate: MemoryCandidate,
    ctx: PolicyContext,
  ): Promise<MemoryCandidate>;
  resolveConflict?(
    existing: MemoryRecord,
    incoming: MemoryCandidate,
    ctx: PolicyContext,
  ): Promise<ConflictResolution>;
}
```

`redact` 保持 API-v1 的完整 `MemoryCandidate` 回调签名；运行时只采纳
`content`、`explicitness`、`kindHint` 和 `metadata`，不会把 hook 返回的
identity、source、disposition 或 durable-target 信息当作授权。

### 15.2 v0.1 默认策略

- 敏感信息保守写入
- inferred memories 降低默认权重
- cross-workspace recall 默认关闭
- cross-agent sharing 默认关闭
- delete/export 必须全链路可达

### 15.3 Memory Hygiene Rules

默认 memory hygiene 规则建议写进 core，而不是留给调用方自己猜：

- 不持久化可从代码、数据库、git、配置实时推导的信息
- 不把当前会话的临时任务拆解直接写入 durable memory
- relative date 入库前转 absolute date
- recalled memory 若驱动下一步动作，优先做轻量验证
- `reference` 类记忆优先保存“去哪里找”，而不是复制完整内容
- 允许用户显式要求“忽略 memory”，此时 recall pipeline 应视作空集

---

## 16. Observability 与 Debugging

如果没有调试能力，记忆层基本不可维护。

### 16.1 v0.1 必须有的 CLI

```bash
./node_modules/.bin/goodmemory inspect --user-id <user-id> --workspace-id <workspace-id>
./node_modules/.bin/goodmemory trace --user-id <user-id> --workspace-id <workspace-id> --query "Which runbook is the source of truth?"
./node_modules/.bin/goodmemory export-memory --user-id <user-id> --workspace-id <workspace-id> --output ./tmp/export
./node_modules/.bin/goodmemory stats --user-id <user-id> --workspace-id <workspace-id>
./node_modules/.bin/goodmemory eval inspect --run-dir reports/eval/live/<run-id> --case-id <case-id>
./node_modules/.bin/goodmemory eval trace --run-dir reports/eval/live/<run-id> --case-id <case-id>
./node_modules/.bin/goodmemory eval export-case --run-dir reports/eval/live/<run-id> --case-id <case-id> --output /tmp/case.json
```

### 16.2 日志字段

- routingDecision
- retrieval hits
- tokenCount
- latencyMs
- memory writes
- blockedByPolicy
- conflict resolutions

### 16.3 Evaluation Harness

这个项目从第一天就要有评测集，而不是等产品上线后凭感觉调。

至少覆盖：

- recall precision
- recall coverage
- conflict correctness
- overwrite correctness
- token efficiency
- user trust metrics

### 16.4 顶级 memory 中间层还应监控这些指标

- spillover rate
- spill preview re-read rate
- session journal freshness
- session-journal compact success rate
- full compact success / failure / circuit-break rate
- cache hit rate before / after compact
- extraction yield per turn
- consolidation churn rate

---

## 17. Package Layout

不采用过细拆包。v0.1 先收敛成下面的结构：

```text
packages/
  goodmemory/                  # public npm entry
  core/                        # types, router, compiler, builder
  storage-memory/              # in-memory adapter
  storage-sqlite/              # local dev adapter
  storage-postgres/            # production reference adapter
  llm-openai/
  llm-anthropic/
  embedding-openai/
  cli/
  integration-vercel-ai/       # optional
  integration-langgraph/       # optional
examples/
  basic-chat/
  nextjs-chat/
  express-api/
docs/
```

### 17.1 明确不建议的 v0.1 过早拆分

以下包可以先留在 `core/` 内部模块，而不是一开始就独立发包：

- compiler
- retrieval
- context-builder
- policies
- observability

理由：

- 这些边界在 v0.1 到 v0.3 期间会频繁变化
- 过早拆包会增加发布复杂度和破坏 API 稳定性

---

## 18. v0.1 范围

### 18.1 必须有

1. `recall()` / `buildContext()` / `remember()`
2. Session buffer + working memory + session journal
3. Profile / Preferences / Facts / Episodes 四类主数据
4. rules-only router
5. 基础 query rewrite
6. dedupe / supersede / conflict 机制
7. SQLite 本地开发适配器
8. Postgres + pgvector 参考生产适配器
9. OpenAI-compatible embedding adapter
10. 至少一个 LLM adapter
11. CLI inspect / trace / export
12. 一个真实 chat demo
13. evaluation harness

### 18.2 明确不做

- Dashboard
- Insight 自动推理主链路
- 多模态 memory
- 联邦记忆
- 图数据库
- 复杂策略 DSL
- 大而全 backend matrix

---

## 19. Roadmap

### Phase 0: Interfaces and ADRs

- MemoryScope 定稿
- data model 定稿
- public API contract 定稿
- package boundaries 定稿
- evaluator 样本集设计

### Phase 1: Core Loop

- `recall()`
- `buildContext()`
- `remember()`
- session buffer
- working memory
- session journal
- sqlite adapter
- postgres adapter

### Phase 2: Quality Hardening

- conflict handling
- decay
- consolidation
- artifact spillover
- session-journal compaction
- autocompact circuit breaker
- policy hooks
- trace CLI
- benchmarks

### Phase 3: Ecosystem

- Vercel AI integration
- LangGraph integration
- Express / Fastify middleware
- dream worker
- docs site
- public release

### Phase 4: Product Layer

- dashboard
- approval flows
- analytics
- managed cloud

---

## 20. 成功标准

GoodMemory 成功，不是因为“支持了多少数据库”，而是因为接入它的产品会出现这些结果：

- 用户明显减少重复输入背景信息
- 系统能更稳定地遵循用户偏好
- 能正确引用过去的重要讨论，而不是随机拉旧上下文
- prompt 组装复杂度下降
- memory token 成本可控
- 开发者能定位“为什么这次回答用了这条记忆”
- 接入方愿意把它当作默认 memory layer，而不是 demo 功能

---

## 21. 最终建议

GoodMemory 的正确方向不是“把两份方案平均一下”，而是：

> 用 OSS-first 的工程骨架去承载产品级的记忆模型与治理能力。

最终架构建议是：

- 采用 `claude` 版的 API / adapter / async-first 主骨架
- 采用 `chatgpt` 版的 preference / working memory / policy / explainability 思路
- 严格区分 core library 与 product add-ons
- v0.1 先把一个参考栈做深，不把生态面铺太宽

如果后续继续推进，下一批应产出的不是更多概念文档，而是：

1. ADR: MemoryScope
2. ADR: data model and write semantics
3. ADR: recall / remember API
4. ADR: sqlite local adapter vs postgres production adapter
5. 一个最小可跑 demo
6. 一套最小评测数据

这会比继续扩写概念层方案更接近真正可发布的开源项目。

---

## 22. 从 Claude Code 源码抽取的可迁移机制

下面这些机制不是概念判断，而是从源码中验证过的、值得迁移到 GoodMemory 的设计模式：

1. **`tokenCountWithEstimation()` 式的 canonical token accounting**
   记忆系统的所有阈值判断都必须基于“上次真实 API usage + 新增消息估算”，而不是简单累加历史 token。

2. **Tool result spillover + deterministic replacement**
   大型结果先外溢，再以稳定 preview 替换。替换一旦发生，在当前上下文生命周期中必须保持一致，否则 prompt cache 会抖。

3. **Microcompact 先于 full compact**
   先清理低价值大块内容，再决定是否需要昂贵总结。能省掉一次 full compaction，就应该省。

4. **Session journal 是预生成的 compaction 资产**
   与其在 context 爆掉时才总结，不如后台持续维护 session notes。真正 compact 时直接复用，成本低很多。

5. **Compaction 不是 summarize-and-forget，而是 summarize-and-rehydrate**
   紧邻当前工作的文件、技能、计划、运行中 agent 状态都需要 selective restore，否则 compact 后上下文连续性会明显变差。

6. **Durable memory extraction 要与主线程显式写入互斥**
   如果主线程本轮已经直接写 memory，后台 extractor 应跳过，避免重复和冲突。

7. **Dreaming 要有时间门、session 门和锁**
   后台 consolidation 不是每轮都做；它应该是一个节流、可回滚、可观察的维护任务。

8. **Memory hygiene 必须是内建规则**
   不要保存可从代码或其他权威来源推导的信息；保存的应是用户、偏好、项目背景、外部引用、非显然约束。

这些点共同说明了一件事：

> 顶级 memory 中间层不是“向量检索 + profile store”，而是“durable memory + runtime context control + background consolidation”三者的组合系统。
