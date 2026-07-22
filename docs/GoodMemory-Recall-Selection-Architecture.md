# GoodMemory Recall Selection Architecture

本文档描述 Phase 68 之后的当前召回选择边界。历史 fitted selector 的行为证据仍可复现，但不再属于生产架构。

## Production Boundary

生产事实选择由 `src/recall/engine.ts` 直接调用
`selectGeneralizedFactsForInternalUse`。`src/recall/selection.ts` 是无状态的静态
surface，只负责：

- 将 `selectFacts` 固定导出为 `selectGeneralizedFactsForInternalUse` 的同一函数。
- 导出稳定的 fact/record selector surface。
- 不保存 selector、profile 或 eval activation 状态。

通用事实选择实现在 `src/recall/generalizedSelection.ts`。生产默认不读取环境变量，也不导入 narrow gate、source-order rule table、benchmark query classifier 或 legacy route table。

`src/recall/selectors/` 只保留两个通用模块：

- `recordSelection.ts`：feedback、preference、reference、episode、archive。
- `selectionContext.ts`：trace、tag、slot 和通用候选信号。

历史 `temporal.ts` 与 `topic.ts` 已完整移入 repo-only legacy profile；生产所需的
时间与 query 语义来自 `LanguageQueryAnalysis`、RecallPlan 及通用 projection。

`src/recall/factSelection/` 只保留四个通用基础模块：

- `contracts.ts`
- `draft.ts`
- `generalizedFusionUnion.ts`
- `semanticUnion.ts`

早期的 embedding-free entity floor probe 已移到
`scripts/eval-profiles/generalized-probes/entityUnion.ts`；它只是测量工具，不是生产
selector。生产实体通道由 `src/recall/projections/` 与
`src/recall/generalizedFusion.ts` 实现。

`selectionSlot.ts` 继续拥有 role、focus、blocker、open-loop 和 project-state-support 的 slot 选择。

## Generalized Flow

生产事实选择按以下顺序执行：

1. 使用 `scoring.ts` 构建并排序候选与 trace。
2. 过滤 inactive 和 locale-incompatible 事实。
3. 对纯 reference 查询默认不返回事实；当查询明确表示“执行前检查 reference”时，允许相关 blocker/context 进入。
4. 对 slot query 使用 `selectionSlot.ts`，不进入通用 fact path。
5. 对 direct/count 查询折叠非 benchmark 类别的同 subject 旧值。
6. 对用户事件顺序查询排除 assistant-answer evidence。
7. 对 research recommendation 和 answer-composition 使用有界通用候选。
8. 其余查询按 lexical、subject、intent、explicitness 和 provider signal 选择，跨 session 去重，最多返回 6 条。
9. 在 `recommended` preset 下，从多粒度投影构建 BM25、实体邻接和可选
   dense 通道，用 RRF 融合并施加动态候选/噪声预算。
10. 必要时执行确定性的 zero-retrieval lexical fallback、同 session companion 和 semantic union。

这些机制只能依赖查询结构、事实元数据和通用语言信号，不能依赖 benchmark 人名、原句或 case id。

## Legacy Fitted Profile

历史 fitted graph 位于：

`scripts/eval-profiles/legacy-fitted/`

其中：

- `recall/` 保存历史 selector、narrow gates、source-order rules 和 route/augmenter graph。
- `recall/` 下的少量 proxy 只复用生产的 domain、language、scoring、draft、semantic-union 和 slot primitives，不复制实现。
- `activate.ts` 返回显式的 `FactSelector`，同时只在 legacy profile 内开启 narrow
  gates；它不写入任何 production module state。
- `tests/` 保存历史行为契约。
- `gate-audit.json` 保存跨 BEAM 100K/500K/1M 的 148-gate census。

`scripts/run-phase-63-beam-recall-diagnostic.ts --legacy-fitted-profile` 将该 selector
作为实例依赖传给 `createInternalGoodMemory(..., { factSelector })`。历史 selector
测试直接导入 `selectFactsLegacy`；legacy test preload 只管理 legacy narrow gates，
不再替换生产 selector。

历史 profile 只能通过 repo 内脚本或以下命令显式运行：

```bash
bun run test:legacy-fitted
```

它没有公共配置、环境开关或 package export，且不进入 npm tarball。生产测试不得依赖该 profile 的全局 preload。

## Public And Package Boundary

包发布只包含编译产物与 JavaScript bin wrapper，不包含 `src`、TypeScript bin source 或 `scripts/eval-profiles`。

`selectFacts` 是 generalized selector 的不可变别名。`FactSelector` 的内部签名、
`RecallCandidateTrace` 结构和 GoodMemory 的公共 `recall` 结果保持兼容。
实例级 `factSelector` 只存在于 `InternalGoodMemoryOptions`，不属于
`GoodMemoryConfig`、`src/index.ts` 或任何 package subpath。

## Design Rules

必须保持以下约束：

- 不把 case-specific literal、proper noun 或 benchmark prompt 放回 `src/recall`。
- 不在生产 recall 中增加 narrow-gate 环境变量。
- 新机制必须先用 held-out slice 证明泛化，再进入生产。
- 提升不足 3pt或任一保护集回归超过 1pt时停止该 lever。
- 不以放宽 grounded abstention 换分。
- 不把世界知识写进 core memory；外部知识只属于显式 host/answer adapter。
- selector 只做候选选择，不复制 storage、answer generation 或 benchmark judge。
- 共享 primitive 留在 `src`；历史规则只留在 repo-only profile。

## Guardrails

`tests/unit/architecture.boundaries.test.ts` 与 Phase 68 gate 强制：

- `selection.ts` 不超过 300 行。
- 生产 `selectors/` 只能包含四个允许模块。
- 生产 `factSelection/` 只能包含四个允许模块。
- `src/recall` 不得出现 `narrowGates.ts`、`selectionLegacy.ts` 或 `selectionRunContext.ts`。
- 生产 recall 不读取 `process.env`。
- production selection 不保存 mutable selector，也不提供 activation/reset setter。
- historical selector 只能通过 internal runtime 的实例级依赖注入进入 eval。
- package 不包含 `src` 或 TypeScript entrypoint。
- compiled JavaScript 不包含已知 fitted benchmark literal。
- legacy census 必须完整覆盖 148 gates 和三个 BEAM split。
- generalized BEAM 100K baseline 必须是完整 400 问、零执行失败。

## Verification

生产选择改动至少运行：

```bash
bun test tests/unit/recall.generalizedSelection.test.ts
bun test tests/unit/recall.selection.invariants.test.ts
bun test tests/unit/recall.scoring.test.ts tests/unit/recall.router.test.ts
bun test tests/unit/architecture.boundaries.test.ts
bun run typecheck
```

涉及历史证据、gate census 或 Phase 63 复现时另跑：

```bash
bun run test:legacy-fitted
bun run scripts/list-scenario-gates.ts --pretty
bun run scripts/run-phase-68-generalization-gate.ts
```

## Adding A Retrieval Lever

1. 先定义目标 slice 与保护集。
2. 先写失败测试或可重放的测量。
3. 用通用索引、融合、预算、reranker 或 evidence policy 实现。
4. 不增加 literal rule。
5. 跑目标 slice；不足 3pt即停止。
6. 跑保护集；回归超过 1pt即回退。
7. 只有生产默认与 package boundary 都通过后，才更新 claim。
