# GoodMemory TDD and Evaluation Strategy

> Execution strategy for building GoodMemory with TypeScript + Bun using TDD from day one.
> Companion documents: [GoodMemory-PRD.md](./GoodMemory-PRD.md), [GoodMemory-OSS-Architecture-v1.md](./GoodMemory-OSS-Architecture-v1.md), [GoodMemory-First-Principles-and-Reference-Architecture.md](./GoodMemory-First-Principles-and-Reference-Architecture.md)

**Status:** Draft  
**Runtime:** Bun  
**Language:** TypeScript  
**Development style:** TDD first, product eval always-on

---

## 1. 文档目标

这份文档不定义产品是什么，而定义：

- 如何用 TDD 去实现 GoodMemory
- 测试体系如何分层
- 产品级评测集如何设计
- 什么算“可验证”的 memory layer
- 如何把“更好回答”转化为可回归、可比较的结果

GoodMemory 的关键要求不是“能跑”。

而是：

> 在持续迭代后，依然能证明它让 LLM 对用户理解得更好，并且回答得更好。

---

## 2. 开发原则

### 2.1 TDD 是默认开发方式

每个能力必须按以下顺序推进：

1. 写失败测试
2. 写最小实现让测试通过
3. 重构实现
4. 跑该模块全测试
5. 跑产品级回归评测的相关子集

任何 feature 都不能先写实现再“补测试”。

### 2.2 产品评测不是上线前才做

GoodMemory 的产品价值依赖：

- recall 是否更准
- user understanding 是否更强
- historical continuity 是否更稳

因此完整评测集必须从一开始就建立。

它不是 release 前的附加检查，而是持续开发中的主反馈系统。

GoodMemory 评测不能只停留在“记没记住某条信息”。

它还必须持续回答这些问题：

- memory 是否真的改善了个性化结果
- memory 是否引入了错误个性化
- 跨域迁移什么时候有帮助，什么时候造成污染
- 用户状态变化后，旧记忆是否被正确压制

### 2.3 核心逻辑与产品效果分开验证

我们需要区分两类正确性：

1. **逻辑正确性**
   taxonomy、routing、merge、budget、policy、maintenance 等算法层是否正确。
2. **产品正确性**
   使用 GoodMemory 后，LLM 是否真的对用户理解得更好、承接任务更好。

这两类测试必须同时存在。

---

## 3. 技术约束

### 3.1 运行时与语言

- Runtime: Bun
- Language: TypeScript
- Test runner: Bun test
- Assertion / mocking: 优先使用 Bun 原生能力，必要时补轻量依赖

### 3.2 测试的两种执行模式

#### Local deterministic mode

用于：

- unit tests
- integration tests
- scenario tests

要求：

- 尽量不依赖外部模型 API
- 可在 CI 中稳定执行
- 能快速反馈

#### Live evaluation mode

用于：

- 产品级完整评测集
- baseline vs GoodMemory A/B
- LLM-as-judge 主评测

要求：

- 允许真实外部模型 API
- 单独命令执行
- 结果持久化
- 支持多次 rerun 比较

### 3.3 允许的测试策略

你已经明确锁定：

- 主评测以 **LLM-as-judge** 为主
- 数据为 **结构化 persona spec + 合成对话 replay**
- live API **全部允许**

因此测试体系设计要围绕这三点展开，而不是继续争论评测方法论。

---

## 4. 测试分层

GoodMemory v1 采用 4 层测试体系。

## 4.1 Unit Tests

验证局部逻辑和纯函数行为。

覆盖范围：

- memory taxonomy 分类
- write policy
- dedupe / supersede / reject
- conflict resolution
- retrieval planning
- context budgeting
- output serialization
- stale memory verification decision
- maintenance rule logic

目标：

- 高稳定性
- 高覆盖率
- 无需真实模型 API

## 4.2 Integration Tests

验证核心组件协同工作。

覆盖范围：

- `createGoodMemory()`
- `recall()`
- `buildContext()`
- `remember()`
- `feedback()`
- `forget()`
- storage adapter 行为一致性

目标：

- 在 Bun + TypeScript 环境中验证系统主链路
- 发现跨模块 contract 问题

## 4.3 Scenario Tests

验证单个 persona 的生命周期行为。

覆盖范围：

- 一个 persona 的多轮对话 replay
- profile / fact / episode / procedural memory 如何演化
- recall 是否承接了过去的重要信息
- 用户纠正后系统是否行为改变

目标：

- 比 unit/integration 更接近真实产品行为
- 但仍保持结构化和较强可控性

## 4.4 Product Evaluation Suite

这是 GoodMemory 最重要的测试层。

覆盖范围：

- 约 40 个独立 persona
- 中等生命周期样本为主
- 少量长期生命周期样本
- baseline vs GoodMemory A/B
- LLM-as-judge 产品评分

目标：

- 验证产品是否真的带来更强用户理解与连续性
- 提供回归指标，防止版本升级后能力退化

## 4.5 编排与证明协议的 characterization gates

行为保持型重构先锁定现有外部结果和副作用顺序，再移动职责：

- API characterization 固定 adapter precedence、projection 包装、remember
  transaction/rollback 顺序，以及 recall 的 selection -> rerank -> fence ->
  trace -> observation 顺序。
- Remember 的 source CAS、extraction 和 write tests 分开覆盖，但
  `extract()` 与 `remember()` 必须共享同一个 resolved extraction contract。
- Recall 的 content loader、retrieval/fusion 和 result assembly 通过窄类型
  交换数据；fallback、trace 字段、evidence、verification hint 和 packet
  serialization 都由回归测试锁定。
- CLI 以 memory、host、eval、services 四族分别覆盖 help、flags、stdin、
  JSON/text、dry-run、stdout/stderr、exit code 和服务启动边界。

证明协议与产品测试分离：

- `scripts/proof/` 的 unit tests 只验证 canonical bytes、exact closure、
  path/symlink escape、content digest 和 Git 环境隔离；它不包含研究领域语义。
- 活动研究 gate 由 `scripts/research/protocols.json` 精确选择。accepted
  fixture 需要旧 verifier 先通过，再对最小 DTO 比较 decision、counts、
  canonical bytes/hash；历史 golden 和 artifact 不能通过重写来“修绿”。
- Release tests 覆盖 duplicate ids、unknown artifact refs、required
  fail/skip、source drift、pack-once、same-tarball hash、相对路径、
  deterministic archive，以及 prepare/upload 与 stable-only publish 的
  副作用边界。

静态架构门禁限制 facade 回涨：`createGoodMemory.ts <= 700`、
`recall/engine.ts <= 650`、`remember/engine.ts <= 250`、`cli.ts <= 300`、
release entry `<= 200`、release runner `<= 800`、活动研究 facade `<= 800`、
leaf verifier `<= 1200`。冻结的历史 capsule 豁免；这些阈值不能替代行为
测试。

---

## 5. Persona 数据集设计

## 5.1 数据集目标

每个 persona 不是一句“我是程序员”。

而是一个可持续 replay 的独立个体。

每个 persona 至少包含：

- `persona_id`
- `name`
- `age_range`
- `locale`
- `profession`
- `expertise`
- `background`
- `communication_preferences`
- `work_style_preferences`
- `long_term_goals`
- `current_projects`
- `growth_path`
- `known_relationships`
- `memory_risks`
- `domains`
- `stable_preferences`
- `domain_specific_preferences`
- `drift_events`
- `negative_personalization_risks`

其中：

- `growth_path` 用于表达身份/能力/目标如何随时间变化
- `memory_risks` 用于制造冲突、漂移、遗忘和验证需求
- `domains` 用于表达用户会跨哪些场景活动
- `stable_preferences` 用于表达允许跨域迁移的长期偏好
- `domain_specific_preferences` 用于表达不应跨域污染的偏好
- `drift_events` 用于显式编码长期变化与 override 场景
- `negative_personalization_risks` 用于编码错误个性化的高风险模式

## 5.2 样本结构

建议 40 个 persona 的配比：

- 28 个中等生命周期 persona
- 8 个中等偏复杂 persona
- 4 个长期生命周期 persona

### 中等生命周期 persona

建议：

- 8-15 轮对话
- 2-4 个会话
- 明确身份背景
- 至少 1 个历史任务
- 至少 1 个开放问题

### 长期生命周期 persona

建议：

- 20-40 轮对话
- 5-8 个会话
- 至少 1 条身份变化或目标变化
- 至少 1 次显式纠正
- 至少 1 次过期记忆场景

## 5.3 对话设计原则

对话必须覆盖：

- 用户显式透露身份/背景
- 用户隐式暴露偏好
- 历史任务延续
- 开放问题回访
- 新信息与旧信息冲突
- 用户纠正系统
- 用户确认系统某种做法是对的

这能同时测试：

- semantic memory
- episodic memory
- procedural memory
- stale verification

另外，eval fixture 还必须显式编码：

- `task_family`
- `domain`
- `memory_source_domains`
- `evaluation_setting`
- `expected_transfer_signals`
- `expected_non_transfer_signals`
- `expected_update_wins`
- `expected_stale_suppression`
- `wrong_personalization_signals`
- `user_satisfaction_hypothesis`

这些字段只服务内部评测，不属于产品 public API。

---

## 6. 主评测目标

GoodMemory 的主评测目标已经从“两项能力题”升级成“三层质量题”。

原来的两条核心问题仍然保留：

1. 是否更好识别用户身份 / 背景
2. 是否更好承接历史任务 / 开放问题

但它们现在属于更完整矩阵的一部分，而不是全部。

## 6.1 Layer A: Memory Retrieval

这一层衡量 memory middleware 的基础能力。

关注点：

- recall usefulness
- precision / contamination
- token cost
- latency
- hit explanation quality

这一层回答：

- memory 有没有被召回
- 召回的是不是相关信息
- recall trace 能不能解释为什么命中

## 6.2 Layer B: Personalization

这一层是 MemoryCD 启发下的新中心。

关注点：

- preference consistency across sessions
- long-horizon stability
- drift / update / reversal correctness
- cross-domain transfer benefit
- cross-domain contamination penalty
- personalization usefulness
- wrong personalization penalty

这一层回答：

- memory 是否真的改善了个性化结果
- memory 是否在跨域时正确迁移
- memory 是否在不该迁移时保持克制
- 用户状态变化后，旧记忆是否被正确压制

## 6.3 Layer C: Runtime / Governance

这一层关注 memory 的使用安全性和治理质量。

关注点：

- scope isolation
- delete / export correctness
- stale-memory correction
- provenance visibility
- conflict handling
- ignore-memory / policy behavior

这一层回答：

- memory 是否泄漏到错误 scope
- 错的 memory 能否被修正和删除
- trace 是否足够解释系统行为

---

## 7. LLM-as-Judge 评测框架

## 7.1 为什么采用 LLM-as-Judge

因为主评测目标本身不是简单规则可以完整覆盖的。

例如：

- “更好理解用户背景”
- “更好承接历史任务”

这些需要语义层判断。

因此采用：

- 规则校验做底线约束
- LLM-as-judge 做主评分

这里的“规则校验”包含 deterministic hard assertions，而不只是 schema 检查。

例如：

- 允许迁移的信号是否出现
- 不允许迁移的信号是否未出现
- correction 后新状态是否压过旧状态
- stale reference / stale preference 是否没有被 surface 出来
- provenance 是否能从 trace 中解释

## 7.2 Judge 输入

每个测试样本的 judge 输入至少包括：

- persona spec
- 本轮用户输入
- target domain / memory source domains / evaluation setting
- expected identity / history / transfer / suppression / update signals
- baseline 回答
- GoodMemory 回答
- 评分 rubric

## 7.3 Judge 输出

建议每次 judge 输出：

```ts
interface JudgeResult {
  winner: "baseline" | "goodmemory" | "tie";
  scores: {
    factual_recall: number;
    preference_consistency: number;
    cross_domain_transfer: number;
    contamination_penalty: number;
    update_correctness: number;
    personalization_usefulness: number;
    provenance_explainability: number;
  };
  reasoning: string;
  failure_tags: string[];
  blocking_failure_tags?: string[];
}
```

`failure_tags` 的口径需要固定：

- `baseline_*` 表示缺陷主要在 baseline，一般用于 GoodMemory 获胜但 baseline 明显失误的情况
- `goodmemory_*` 表示缺陷仍然真实作用在 GoodMemory 回答上
- `shared_*` 表示 judge 观察到双方共享的问题或限制

也就是说，`failure_tags` 是 judge 的诊断标签集合，不等于“需要拦截发布的失败集合”。

`blocking_failure_tags` 的口径单独固定：

- 它是 `failure_tags` 的严格子集
- 只放“即使 GoodMemory 最终获胜，也仍然应该阻塞 release gate / rerun inbox”的缺陷
- 当 GoodMemory 获胜时，允许进入 `blocking_failure_tags` 的通常是 `goodmemory_*` 或 `shared_*`；`baseline_*` 不应单独阻塞 GoodMemory
- 风格、措辞、显式性不足、轻微 personalization nit 不应进入 `blocking_failure_tags`

## 7.4 Judge Rubric

核心 rubric 固定为：

- `factual_recall`
  是否正确利用用户身份、当前事实、历史任务与 open loop
- `preference_consistency`
  是否稳定反映用户长期偏好和协作方式
- `cross_domain_transfer`
  是否在允许时正确迁移跨域偏好与习惯
- `contamination_penalty`
  是否避免了错误个性化和跨域污染
- `update_correctness`
  是否让新信息、纠正信息和 override 压过旧信息
- `personalization_usefulness`
  memory 是否真正让回答更贴近这个用户
- `provenance_explainability`
  trace 是否足够解释 recall / remember / context 的来源

---

## 8. A/B 回归测试设计

## 8.1 两个系统

每个产品评测样本必须跑两个系统：

### Baseline

- 不接入 GoodMemory
- 只给当前会话必要上下文

### GoodMemory

- 接入 GoodMemory
- 使用 `recall()` + `buildContext()` + `remember()` + `feedback()`

## 8.2 每个样本的评测流程

```text
load persona spec
  ↓
replay historical conversations
  ↓
baseline system answers current prompt
  ↓
goodmemory system answers current prompt
  ↓
judge compares outputs
  ↓
persist score + trace + failure cases
```

## 8.3 必须保存的调试材料

每个样本至少保存：

- baseline answer
- GoodMemory answer
- recalled memories
- built context
- write trace
- feedback trace
- judge result

这样失败时才可调试。

---

## 9. 回归输出格式

每次完整产品评测至少输出 5 类结果。

## 9.1 分项分数

必须至少包含：

- factual recall uplift
- preference consistency uplift
- cross-domain transfer uplift
- contamination penalty uplift
- update correctness uplift
- personalization usefulness uplift
- provenance explainability uplift

## 9.2 Layer 汇总

必须至少包含：

- retrieval layer uplift
- personalization layer uplift
- runtime / governance layer uplift

这样评测结论才能回答：

- memory 是否提高了 retrieval
- memory 是否提高了 personalization
- memory 是否在 governance 上变差

## 9.3 Assertions 汇总

必须至少包含：

- passing cases / total cases
- passing checks / total checks
- contamination failures
- update failures

这些 deterministic assertions 是 LLM-as-judge 之外的硬门槛。

## 9.4 Persona 失败案例

至少列出：

- 哪个 persona 失败
- 失败属于哪一层
- 失败是 judge 失败还是 assertion 失败
- baseline 和 GoodMemory 的回答差异
- judge 的 reasoning

同时要明确失败产物的两层语义：

- `cases/<caseId>.json` 与 `traces/<caseId>/judge.json` 保存完整 judge 结果，包括 `baseline_*`、`goodmemory_*`、`shared_*` 在内的全部诊断标签
- `failures/summary.json` 只保存阻塞型失败索引，用于回归汇总与失败样本 rerun，不作为 judge 全量观察的归档替代

`failures/summary.json` 的判定口径应固定为：

- 如果 `winner !== "goodmemory"`，该样本记为失败
- 如果 `winner === "goodmemory"`，只有 `blocking_failure_tags` 和 assertion 失败会进入 `failures/summary.json`
- `failure_tags` 中的 `baseline_*`、`shared_*`、以及非阻塞的 `goodmemory_*` 诊断，在 GoodMemory 获胜且 assertions 通过时仍应保留在单 case artifact 中，但不应作为 release-blocking failure 进入失败汇总
- 如果 `winner !== "goodmemory"`，`failures/summary.json` 仍应优先保留完整 `failure_tags` 作为诊断信息；`blocking_failure_tags` 主要服务于 GoodMemory 获胜时的 gate 语义
- 为兼容旧 judge 产物，reporting 可以临时把明显高风险的 leak / contamination / update-correctness 标签提升为阻塞项，但这只是过渡策略，不应替代显式的 `blocking_failure_tags`

## 9.5 Memory traces

至少列出：

- remember traces
- raw recall
- built context
- feedback traces
- context build traces
- assertion traces

## 9.6 A/B 对比

必须能回答：

- GoodMemory 比 baseline 平均提升多少
- GoodMemory 在 personalization layer 上平均提升多少
- GoodMemory 是否引入了错误个性化
- GoodMemory 是否正确压制 stale memory
- 哪些 persona 提升最大
- 哪些场景反而变差

---

## 10. 建议的仓库测试结构

建议从一开始就按测试分层建目录。

```text
src/
  core/
  runtime/
  memory/
  retrieval/
  context/
  maintenance/
  adapters/
tests/
  unit/
  integration/
  scenarios/
  eval/
fixtures/
  personas/
  scenarios/
reports/
  eval/
scripts/
  proof/
  research/
  release/
  research.ts
  release.ts
  run-eval.ts
  summarize-eval.ts
```

### `fixtures/personas/`

存 persona spec。

### `fixtures/scenarios/`

存行为驱动的合成对话 replay 数据和 eval expectations。

### `reports/eval/`

存每次 live eval 结果。

---

## 11. TDD 实施顺序

建议按产品风险排序，而不是按模块表面顺序排序。

## Phase 0: Test Harness First

先完成：

- Bun + TypeScript 基础工程
- Bun test 配置
- 测试目录结构
- fixtures 目录结构
- 统一 test utilities
- LLM-as-judge runner 骨架
- eval report 输出结构

没有这些，不进入业务开发。

## Phase 1: Pure Logic First

先写 unit tests，再做：

- taxonomy
- merge / supersede
- conflict handling
- routing
- verification decisions
- budgeting

## Phase 2: Core API Chain

先写 integration tests，再做：

- `createGoodMemory()`
- `recall()`
- `buildContext()`
- `remember()`
- `feedback()`
- `forget()`

## Phase 3: Scenario Layer

先写 scenario tests，再做：

- persona replay
- cross-session continuity
- open-loop continuation
- procedural memory updates

## Phase 4: Product Eval Layer

先写 eval harness 和 40 persona 数据，再跑：

- baseline vs GoodMemory
- judge scoring
- regression reporting

---

## 12. 每类测试必须先写什么

## 12.1 Unit test 先验测试

每个能力开发前先写：

- input
- expected memory state
- expected recall selection
- expected context output
- expected verification decision

## 12.2 Integration test 先验测试

每个主 API 开发前先写：

- happy path
- conflict path
- stale path
- no-memory path
- delete/correction path

## 12.3 Scenario test 先验测试

每个 persona 场景开发前先写：

- 初始 persona spec
- replay conversations
- expected remembered facts
- expected recalled items
- expected answer properties

## 12.4 Eval test 先验测试

每个产品评测样本开发前先写：

- baseline prompt package
- GoodMemory prompt package
- judge rubric
- expected improvement hypothesis
- expected transfer / suppression / update signals
- expected assertion outcomes

---

## 13. 风险与控制

### 风险 1：LLM-as-judge 不稳定

控制：

- rubric 固定
- judge prompt 固定
- 保存 reasoning
- 允许 rerun 比较
- 对关键样本支持多次采样

### 风险 2：合成 persona 太假

控制：

- persona spec 必须结构化
- 职业、背景、成长路径必须足够具体
- 样本覆盖不同风险场景
- 后续允许加入脱敏真实 replay

### 风险 3：live eval 太贵

控制：

- unit/integration/scenario 先本地跑
- eval 独立命令执行
- 支持 smoke / fallback / live 三种模式
- 优先回归失败子集

### 风险 4：只优化 judge 分数，不优化真实产品

控制：

- 保留 baseline 对比
- 保存失败案例人工抽查
- 把 retrieval / personalization / runtime-governance 三层 rubric 锁死，不频繁改 rubric
- 用 deterministic assertions 约束 cross-domain contamination 和 stale update correctness

---

## 14. 最终结论

GoodMemory 这种产品，如果没有从第一天就建设：

- TDD
- scenario tests
- persona replay
- baseline vs GoodMemory A/B
- LLM-as-judge 产品评测

最后一定会退化成“能跑，但无法证明变好”的系统。

所以对 GoodMemory 来说，测试不是支持性工程。

它就是产品本身的一部分。
