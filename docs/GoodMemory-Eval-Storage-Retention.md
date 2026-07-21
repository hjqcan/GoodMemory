# GoodMemory 评测数据保留与清理

评测数据库是运行时工作区，不是结果证据库。长期证据必须落在版本化的
`reports/quality-gates/`、`reports/eval/` 或 `benchmark-claims/evidence/`
文件中，并绑定数据集、模型、评分器和 run identity。Postgres 中的事实、
evidence、experience、episode 和 embedding 是可重新物化的运行时派生数据，
不作为长期证据；失败现场只短期保留用于排障。

## 保留策略

| 运行结果 | Postgres 行为 | 长期证据 |
|---|---|---|
| 零 execution failure，最终报告校验通过 | 立即删除本 attempt schema | 保留已落盘报告 |
| 有 execution failure | 保留 7 天用于排障 | 保留报告和失败信息 |
| 进程异常退出 | schema 保留，advisory lock 随连接释放，7 天后可清理 | 使用已有 progress/report 文件 |
| 显式设置 `GOODMEMORY_EVAL_RETAIN_POSTGRES=1` | 完成后保留 7 天 | 仍以报告为准 |

接入该生命周期机制的 provider-backed 评测 attempt 使用独立的
`gm_eval_<benchmark>_<hash>` schema。hash 同时绑定 benchmark、runId 和随机
attemptId，因此同一 runId 的重试不会覆盖尚在保留期内的失败现场，也不会
复用已初始化后又被删除的 Postgres runtime cache。

运行期间同时持有 logical run lock 和以 schema 名为 key 的 Postgres
advisory lock。同 benchmark/runId 的并发 attempt 会被拒绝，避免共用
report/progress 目录竞争。清理器拿不到 schema lock 时将该 schema 判定为
active，不会删除。只有带 `goodmemory-eval:v1:` schema
comment 的 schema 会进入策略；同前缀但没有合法标记的 schema 一律忽略。
每次新的受管评测开始前会自动删除已过保留期且未加锁的 schema，
因此 7 天不只是文档约定；手动命令仍用于无后续评测时的定期巡检。

成功运行不会只根据内存中的返回对象删除数据。LongMemEval runner 会先读取
最终 `report.json`（recall diagnostic 使用 `recall-diagnostic.json`），确认内容
与返回报告逐字节一致，然后才删除 attempt schema。报告缺失或不一致会按失败
处理并保留数据。

## 清理命令

默认 dry-run，只输出决策，不改数据库：

```bash
bun run eval:storage:cleanup
```

确认计划后显式执行：

```bash
bun run eval:storage:cleanup --apply
```

临时调整失败数据保留期：

```bash
bun run eval:storage:cleanup --retention-days 3
bun run eval:storage:cleanup --apply --retention-days 3
```

命令从 `GOODMEMORY_TEST_POSTGRES_URL` 读取目标数据库，不接受命令行 URL，避免
凭据出现在 shell history 或进程列表。输出包含每个 schema 的
`delete|keep|ignore` 决策、原因、预计回收字节数，以及可用的
benchmark、runId、attemptId、status 和时间戳。

## 边界

- 当前已强制接入 Phase 62 LongMemEval `goodmemory-hybrid` 主评测与
  recall diagnostic。这是本次 350 万行残留的主要来源。
- 通用模块可供其他持久化评测 runner 接入；未迁移的旧 runner 仍执行其
  原有的 case-scope 清理，不应被宣称为已受 schema 保留策略保护。
- 当前 LongMemEval resume identity 尚未纳入 embedding/extractor 配置，full500
  shard 复用也尚未校验完整的 provider/prompt identity。这是独立的 compact
  evidence 债务：本次 schema 清理机制不会把数据库保留冒充为已解决的可复现性。
- 清理器不扫描或删除 `public` schema 中的普通产品/测试数据。
- 历史遗留的 shared-public benchmark 数据需要一次性、明确作用域的迁移或清理，
  不能把通用清理器扩成按 JSON 模糊匹配的全库删除器。
- `--resume` 的进度真相在报告目录；每个 case 在一次执行中完成
  remember → recall → context，重试使用新 attempt schema，不依赖旧数据库现场。
- 不提供永久 pin。需要长期复现的内容应投影为受版本控制的紧凑证据，而不是
  把共享 Postgres 变成无期限归档库。
