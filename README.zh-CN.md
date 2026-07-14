# GoodMemory

语言：[English](./README.md) | 简体中文

GoodMemory 是面向 AI 产品和 coding agent 的记忆层。

它为 chat app、copilot 和 agent host 提供一条可审计的用户/项目记忆闭环：
选择性写入事实，检索正确上下文，注入下一轮对话，记录发生过什么，并在记忆错误时删除。

GoodMemory 不是 LLM、agent framework、向量数据库，也不是通用 RAG 系统。它位于你的应用或已安装 agent host 与模型运行时之间，专注做产品级 memory layer。

## 你会得到什么

- 稳定的记忆 API：`remember`、`recall`、`buildContext`、`feedback`、`forget`、`exportMemory`、`deleteAllMemory`。
- 面向 Codex 和 Claude Code 的已安装 agent 记忆：`goodmemory setup`、托管 hooks、Codex 已安装 pre-action、`goodmemory status`、只读 MCP、可选 writeback。
- 公开的一等写入定制能力：`GoodMemoryConfig.remember`、`RememberProfile`、`rememberRules`、`RememberInput.annotations`、命名 extractor id。
- 面向 npm 包的公开导出：`goodmemory`、`goodmemory/ai-sdk`、`goodmemory/host`、`goodmemory/http`，并提供编译后的 `dist` 与 TypeScript 声明文件。
- Local-first 存储：Bun 默认使用本地 SQLite；需要时可以接 Postgres、注入 adapter、启用 embedding provider。
- 面向发布的验证路径：确定性测试、live eval、provider-backed eval、package smoke、quality gate。

## 从这里开始：Codex 或 Claude Code

```bash
npm install -g goodmemory@0.5.1
goodmemory setup
```

无需注册账号或依赖托管服务。GoodMemory 默认把记忆保存在本地 SQLite 中，接入生命周期
hooks 和只读 MCP 检查能力，并让持久写回保持可选。运行 `goodmemory status` 即可核验安装。

使用其他 MCP client，或要接入自己的应用？请[选择对应的接入路径](#选择你的接入路径)。

## 基准结果（Benchmark Results）

GoodMemory 把「当前生产声明」「带版本的历史证据」和「内部研究」分开呈现。一个数字只有在
当前包版本的已提交 declaration 通过 `gate:public-benchmark-claim --strict` 后，才能进入
当前声明表：完整覆盖、`executionFailures: 0`、无记忆基线、确定性评分或独立判官、数据集
来源与 license 已核实、运行可复现（commit + 命令 + 包版本）。历史行使用独立 marker，
不能满足当前版本 gate。

Phase 72 的当前生产泛化刷新仍未完成。LongMemEval 已完成当前
`goodmemory-recommended` full-500 零失败运行，并使用有界、单调的查询相关尾段证据扩展：
`gpt-5.6-terra` 答案经独立 `gpt-5.4` 官方协议重评为 340/500 = 0.680，
judge-free 确定性下限为 269/500 = 0.538。assistant 类别从 39/56 提升到
46/56，其余类别均保持在 1pt 保护线内，但两条总分仍未达到 0.92 / 0.72 gate；
LoCoMo 当前 full-1540
生产运行也未达到 strict / official gate。下表保留已披露包版本和 runtime profile
对应的历史证据，不代表当前 production-generalized 路径的成绩；运行时 capability
descriptor 的 `benchmarks.currentClaims` 在当前版本保持为空，直到完整 gate 明确晋升新结果。

<!-- current-claims-table:start -->
<!-- current-claims-table:end -->

### 带版本的历史声明（非当前生产结果）

<!-- historical-evidence-table:start -->
| 基准 | 主指标 | GoodMemory 结果 | 基线 / 参照 | Claim declaration |
|---|---|---:|---:|---|
| LongMemEval full 500 | 严格轨：judge-free 确定性子集 · 可比轨：官方 LongMemEval 判官协议 | 严格 **0.720**（360/500）· 官方协议 **0.888**（444/500），`goodmemory-rules-only` | 无记忆 0.068；当前 Mem0 harness：94.4 Top200 / 94.8 Top50（模型栈与预算不同） | [longmemeval.json](./benchmark-claims/longmemeval.json) |
| MemoryAgentBench (CR, TTL) | 回答准确率——确定性评分、无判官 | **CR 0.959，TTL 0.767** | 无记忆消融 0.000；已发表 single-hop CR 上限约 0.60 | [memoryagentbench.json](./benchmark-claims/memoryagentbench.json) |
| LoCoMo（完整 10 会话） | 严格轨：确定性 token-F1 · 可比轨：业界 LLM-judge 协议（非对抗 1540 题） | 严格 **0.6117**（942/1540）· 判官协议 **0.837**（1289/1540） | 无记忆非对抗 0.0045；当前 Mem0 harness：92.5 Top200 / 91.8 Top50（模型栈与预算不同） | [locomo.json](./benchmark-claims/locomo.json) |
| BEAM 100K（400 题、1051 条 rubric） | 官方 BEAM rubric 判官（逐条 1.0/0.5/0.0）· 严格轨：内部二元判官 | 官方协议 **0.802** · 严格二元 **0.7225**（289/400） | 无 evidence-pack 消融 0.5725；同协议唯一公开参照：0.49 | [beam.json](./benchmark-claims/beam.json) |
| ImplicitMemBench Full-300 | stored-answer cross-version judge rescore | **0.691**（207.35/300），gpt-5.4 judge over gpt-5.5 answers，sourceAnswersUnchanged | upstream-chat 基线 **0.400**（120/300）；reference line 0.66 | [implicitmembench.json](./benchmark-claims/implicitmembench.json) |
<!-- historical-evidence-table:end -->

在两条轨都存在时，历史行会同时报告它们。**严格轨**是确定性或 judge-free 评分——任何 LLM 判官
都无法夸大的硬下限。**可比轨**把*同一批已存答案*（不重新生成）用该基准的
官方或业界标准判官协议逐字重判，使数字与已发表的竞品结果同尺可比。两轨
之间的差距就是被量化的判官宽松度——披露而不是隐藏。可比轨判官为
gpt-5.4——与 gpt-5.5 回答模型不同的模型、但同一家族；每个协议细节都记录
在链接的 claim declaration 里。

历史 LongMemEval 严格结果是 judge-free 的，取代了此前一个已作废、不可声明的内部带判官数字（0.908）。
一个 case 只有被确定性方法（abstention / exact / contains / expected_alternative /
numeric_count）判对才计入；eval 流水线里的同模型 semantic judge（gpt-5.5 评 gpt-5.5）
按构造排除在外——算上判官的诊断性整体准确率是 0.896，出于透明予以披露，但不作声明。
记录的 0.720（360/500，`executionFailures: 0`，v0.3.5）使用无 embedding 的
`goodmemory-rules-only` profile；360 个判对里弃答只占 28 个，而无记忆基线的 0.068 里
绝大多数是纯弃答（34 个对里占 30 个），所以 +65.2 个百分点的提升来自记忆系统本身。
judge-free 指的是评分方式——答案仍由 gpt-5.5 生成。完整溯源见
[claim declaration](./benchmark-claims/longmemeval.json)。
历史 MemoryAgentBench declaration 刻意限定了范围，只记录 Conflict Resolution
（CR 0.959）和 Test-Time Learning（TTL 0.767）：
无记忆消融在这两项上都是 `0.000`（没有 GoodMemory 检索到的合并事实 /
in-context demos，这些问题根本无法作答），所以它们是真正的记忆贡献，并且以
确定性方式评分、无 LLM 判官（`executionFailures: 0`，259 题）。Accurate
Retrieval 和 Long-Range Understanding 被排除：无记忆消融在这两项上反而*更高*
（AR 0.926 对 0.890；LRU 0.632 对 0.518），说明它们是选择题泄漏——模型直接从
题目里的候选项作答，不是记忆的功劳。CR/TTL 度量的是回答时的 current-value
resolution 和 in-context retrieval，不是通用检索 recall。

历史 LoCoMo 严格结果以确定性 token-F1 评分（judge-free，完整 10 会话集全部 1986 题
`executionFailures: 0`，v0.3.5）。profile 已如实披露且为 opt-in——provider
embedding 语义候选并集（`retrieval.semanticCandidates`，topK 16）+ 对话式
写入时萃取 + 弃答格式回答 prompt；无 embedding 的默认配置在代表性 conv-1
切片上只得 0.020（已入档的检索边界），所以本声明针对的是
embedding+extraction profile，不是零依赖默认配置。历史记忆提升请看非对抗
split（0.6117 对 0.0045——1540 题中 942 对 7）：对抗类（446 题，gold 就是
字面弃答句）会被一个永远弃答的无记忆 arm 轻松拿满（0.998 对带记忆的
0.648），因此整体对整体的比较（0.6198 对 0.2276）低估了记忆在可答题上的
贡献。答案仍由 gpt-5.5 生成——judge-free 指的是评分方式。LoCoMo 数据集为
CC BY-NC 4.0（非商用范围），eval 时拉取、从不 vendor 进仓库。完整溯源见
[claim declaration](./benchmark-claims/locomo.json)。

历史 BEAM 100K 结果保留为带版本证据，但不再放入当前公开 claim 表，因为
其 recall 使用了仅限仓库评测的 `legacy-fitted` profile。该结果按基准的官方统一 rubric 判官评分：1051 条 rubric 逐条打
1.0/0.5/0.0，题分 = 该题各条均值（全部 400 题，`judgeFailures: 0`）。同一
评分方式下唯一公开的端到端 BEAM 100K 数字是 0.49；GoodMemory 得 0.802
（高出 31 个百分点），分类明细在 declaration 里——包括唯一低于该参照的
类别（instruction_following 0.394 对 0.66），披露而非用平均数掩盖。严格
内部二元判官轨为 0.7225，对照无 evidence-pack 消融 0.5725（回答期
evidence pack 贡献 +15 个百分点）。recall 按
[ADR-005](./adr/ADR-005-scenario-fitted-recall-boundary.txt) 双指标披露：
rules-only fitted 0.9621 对 generalization 下限 0.6822（关闭全部 148 个
scenario-fitted 窄门；已发布的 opt-in 语义候选并集把该下限抬到 0.8529）。
披露一处协议偏差：论文管线对 event_ordering 用序相关指标评分，本次与公开
参照一致采用 rubric 判官。数据集 CC BY-SA 4.0，eval 时拉取、从不 vendor。

历史 ImplicitMemBench Full-300 declaration 使用 canonical zero-failure
`run-phase61-full300-rerun-20260706-codex-current` 的答案，再用 gpt-5.4 对
同一批 stored answers 重评（`sourceAnswersUnchanged: true`）。判官是
cross-version，但仍是与 gpt-5.5 回答模型相同的 same GPT family，不是
cross-family judge。记录分数是 **0.691**（207.35/300），对照
upstream-chat 基线 **0.400**（120/300）；baseline 与 GoodMemory 两臂合计
530 个 judge-required row decisions，确定性的 `structured_first_action` 行
直接沿用而不是交给判官。旧的同模型诊断分数是 0.708，不作为公开声明。最近
改动后的 freshest clean answer-regeneration drift check 得分为 0.6895，且
`executionFailures: 0`；它说明当前 checkout 有漂移，但不替代 stored-answer
可比协议 artifact。数据集 CC BY 4.0，eval 时拉取、从不 vendor。

### 内部诊断（非公开声明）

被阻挡的 benchmark 数字不能进入当前声明表，直到 declaration 对当前包版本标为
`candidate_public_claim`，并且 `gate:public-benchmark-claim --strict` 通过。底层运行报告位于
gitignored 的 `reports/` 下，可按 declaration 中记录的运行命令复现。

执行顺序见 [task-board/00-README.txt](./task-board/00-README.txt)，claim boundary 见
[docs/GoodMemory-Current-Status-and-Evidence.md](./docs/GoodMemory-Current-Status-and-Evidence.md)。

## 选择你的接入路径

GoodMemory 有三类主要产品入口。它不是只有这些 API：`goodmemory/host`、
自定义存储、eval tooling、runtime helper 等底层能力都存在，但它们是服务于
这些主路径的支撑能力，不是新用户首先要选的入口。

### 自主 agent？从这里开始

如果你是一个想给*自己*接上持久记忆的 agent，匹配下面一条路径直接执行即可。
这棵决策树的机器可读版本在 [llms.txt](./llms.txt) 和
[.well-known/goodmemory.json](./.well-known/goodmemory.json)（部署后的 bridge
也会在 `/.well-known/goodmemory.json` 提供该 descriptor）。

- **你是、或运行在 Claude Code / Codex 里** →
  `npm install -g goodmemory@0.5.1 && goodmemory setup`。不确定环境里已经装了
  什么？运行 `goodmemory adopt`（加 `--json` 得到机器可读方案）：它会检测
  `.claude/`、`.codex/` 和已有的 MCP 配置，并打印出针对你环境的确切下一条命令。
- **你支持 MCP**（Cursor、Windsurf、Cline、Claude Desktop、Gemini CLI、
  OpenCode 或自定义客户端）→ 加上
  [standalone MCP server](#standalone-mcp-for-any-client)；你需要的两个工具是
  `goodmemory_get_context`（召回）和 `goodmemory_remember`（可选写入）。
- **你是框架 agent 或后端** → 调用
  [HTTP bridge](#pythonfastapi-http-bridge)：托管实例 `goodmemory.vibenest.net`，
  或用 `goodmemory-http-bridge --recommended`（也可用
  `GOODMEMORY_PROFILE=agent-recommended goodmemory-http-bridge`）自托管；Python
  调用方用 `pip install goodmemory-client`。

下面的散文路径会展开每个选项。

### 1. 给其他 agent、chatbox、copilot 接入记忆

适用于你拥有产品 server 和模型调用链的场景。在 Node/Bun 服务里安装
`goodmemory`，创建一个 `memory` 实例，并传入稳定的 `scope`，例如 `userId`、
`workspaceId`、`sessionId`，以及可选 `agentId`。

请求流程是：

1. 模型调用前，用当前 scope 和 query 执行 `recall()`。
2. 用 `buildContext()` 把 recall 命中变成 prompt fragment。
3. 带着这段 memory context 调用你的模型。
4. 响应后，用 `memory.jobs.enqueueRemember()` 或 `remember()` 写入经过筛选的信号。
5. 用 `feedback()`、targeted `reviseMemory()`、`forget()`、`exportMemory()`
   做纠正、删除和用户审计。

如果你的 server 已经使用 Vercel AI SDK，可以通过 `goodmemory/ai-sdk` 包装
`generateText()` 或 `streamText()`，不用手写完整 loop。先看
[应用集成快速开始](#应用集成快速开始)，使用 AI SDK 时再看
[AI SDK Adapter](#ai-sdk-adapter)。

### 2. 给 Codex 或 Claude Code 加强记忆

适用于你想让已安装的 coding agent 记住项目和用户上下文，但不想改 agent
自身实现。安装全局 CLI，然后运行 `goodmemory setup`。

已安装 host 的流程是：

1. `session-start` 注入会话开场简报；`user-prompt-submit` 注入逐 prompt 上下文
   （新安装带相关性闸，低信号 prompt 不打扰）。
2. Claude Code 的 `Stop` hook 从会话 transcript（`transcript_path`）逐轮捕获受
   治理的 writeback 候选——有界、脱敏、绝不落原始 transcript；Codex 侧用
   `goodmemory codex writeback --from-rollout` 把最新会话 rollout 喂进同一条管线。
3. Codex 的 `pre-tool-use` 会把高风险 Bash 拦到同一条 installed config 和
   storage 路径上的 `goodmemory codex action`。
4. MCP 提供 trace、context、stats 和 artifact inspection；`goodmemory_remember`
   写工具通过 `mcp.allowWrite`（或 `goodmemory enable <host> --mcp-allow-write`）
   显式开启。
5. 脚本化安装的 writeback 保持 `off`；交互安装与 `goodmemory setup --recommended`
   （一次同意确认）启用 `selective` 持久写——`writeback inspect` 可审计、
   `writeback forget --event-id` 可撤销。
6. 新安装默认踩上实测的 BM25 hybrid 检索档，会话简报 1024 token、逐 prompt
   512 token 带闸注入；`goodmemory status` 展示检索档位、捕获实况与注入遥测。
   可选 `sharedAgents` 配置让一个 host 读到另一个 host 的记录（写入保持归属）。

先看 [快速开始：让 Codex 或 Claude Code 拥有记忆](#快速开始让-codex-或-claude-code-拥有记忆)。
准备 review 或启用写入时，再看 [Installed Host Writeback：已安装主机写回](#installed-host-writeback已安装主机写回)。

### 3. 把 GoodMemory 部署成后端记忆层服务

适用于另一个后端要把 GoodMemory 当服务调用的场景，尤其是 Python/FastAPI
后端，或 OneLife 这类应该把记忆留在服务端、而不是把 GoodMemory 打包进移动端
或浏览器端的产品。

在 Node/Bun sidecar 中部署 packaged `goodmemory-http-bridge`。你的后端调用：

- `/memory/recall-context`：在自己的模型调用前取 prompt-ready context
- `/memory/remember`：写入用户确认或产品策略允许的信号
- `/memory/feedback`：记录 procedural correction
- `/memory/export` 和 `/memory/forget`：做审计和删除
- `/memory/revise`：按显式 memory id 做 targeted correction

你的服务仍然负责 auth、产品策略、UI 和模型编排。GoodMemory 负责 memory
storage、recall、context assembly、write governance，以及 audit/export/delete。
先看 [Python/FastAPI HTTP Bridge](#pythonfastapi-http-bridge)——官方 Python
客户端（`pip install goodmemory-client`）和一个托管 bridge 实例
`goodmemory.vibenest.net` 都在那里——再看
[Runtime 与存储](#runtime-与存储) 选择 SQLite/Postgres。

在一轮模型调用中，GoodMemory 做四件事：

1. 按当前 `scope` 解析记忆。
2. 生成可以直接放进 prompt 的上下文片段。
3. 在你的应用或 host 允许时，记录经过筛选的响应后信号。
4. 提供审计、纠正、导出和删除路径，让用户能控制记忆。

你的应用或已安装 agent 仍然负责 auth、UI、model call 和产品策略。
GoodMemory 负责 memory loop 和存储边界。

## 安装

GoodMemory `0.5.1` 有两条常用安装路径。

如果你想给已安装的 coding agent 增加记忆能力，使用全局 CLI：

```bash
npm install -g goodmemory@0.5.1
goodmemory setup
goodmemory status
```

如果你是在应用里集成 GoodMemory，作为项目依赖安装：

```bash
npm install goodmemory@0.5.1
```

如果你想直接输入 `goodmemory`，必须安装全局 CLI。
项目内 `npm install goodmemory@0.5.1` 不会把 `goodmemory` 放进 shell 的 `PATH`。
这种本地依赖安装只能从该项目里用 `npx goodmemory`、
`npm exec -- goodmemory` 或 `./node_modules/.bin/goodmemory` 调用。

```bash
npx goodmemory -V
```

Bun 项目可以直接安装：

```bash
bun add goodmemory@0.5.1
```

发布前 tarball 验证：

```bash
npm install ./goodmemory-0.5.1.tgz
```

已安装 CLI 的非版本命令由 Bun 支撑。package bin 对 `goodmemory -V` 和 `goodmemory --version` 是 Node-safe 的；其他命令会委托给 Bun。

## 快速开始：让 Codex 或 Claude Code 拥有记忆

大多数用户最先需要的是 installed-host memory。

```bash
npm install -g goodmemory@0.5.1
goodmemory setup
goodmemory status
```

`goodmemory setup` 会检测 Codex 和 Claude Code，安装托管 host wiring，并交互式询问：

- host：`codex`、`claude`，或检测到的两个 host
- activation：全局启用、当前 workspace 启用，或手动 opt-in
- GoodMemory user id
- 可选 Postgres 存储
- 可选 embedding provider
- 可选 LLM extraction provider
- writeback 模式：`off`、`observe`、`review` 或 `selective`

交互式 setup 默认走全局 activation，并使用 workspace 派生隔离。对新的 host config，交互式流程会推荐 `selective`，让高信号写入立即生效，同时保留 audit 和 undo；如果你想先人工审批，再选择 `review`。已有 host config 在接受 prompt 默认值时会保持当前 writeback 模式。自动化安装可以使用 `--json` 或 `--no-interactive` 保持脚本安全。跳过 provider 配置也可以：GoodMemory 仍然会使用本地 SQLite 和 rules-only extraction 工作。

常用命令：

```bash
goodmemory setup --host codex
goodmemory status codex --workspace-root .
goodmemory enable codex --workspace-root . --writeback observe
goodmemory enable codex --workspace-root . --writeback review
goodmemory inspector serve
goodmemory enable codex --workspace-root . --writeback selective
goodmemory disable codex --workspace-root .
goodmemory uninstall codex
```

已安装 host 路径由四部分组成：

- Codex 托管 pre-action：`pre-tool-use` 会 deny 或 redirect 高风险 Bash，
  `goodmemory codex action` 在和 recall/writeback 相同的 installed
  config、storage、provider、scope 路径上执行经过评估的 first step。
- Recall injection：`session-start` 和 `user-prompt-submit` hooks 调用 `recall()` 与 `buildContext()`；当配置、解析或存储不可用时 fail open。
- 深度 inspection：`goodmemory mcp serve --host codex` 和 `goodmemory-mcp --host codex` 暴露只读 context、trace、stats 与 artifact tools。
- 可选 writeback：`session-stop` 与显式 writeback 命令可以把经过筛选的 after-response 信号写入 durable memory。

## Standalone MCP：任意 MCP 客户端接入

没有托管安装路径的 host（Cursor、Windsurf、Cline、Claude Desktop、Gemini CLI、
OpenCode 或你自己的 MCP 客户端）可以用 standalone 模式运行同一个 MCP
server——不需要 `goodmemory setup`，也不需要任何 host 配置文件。scope 与
storage 来自 flags/env；服务面与已安装模式相同（8 个只读工具 + 可选的受治理写工具）：

```json
{
  "mcpServers": {
    "goodmemory": {
      "command": "goodmemory-mcp",
      "args": ["--standalone", "--user-id", "YOUR_USER_ID"]
    }
  }
}
```

等价命令：`goodmemory-mcp --standalone --user-id <id>`（需要 PATH 上有
Bun；`GOODMEMORY_USER_ID` 是 flag 的 env 回退）。`--allow-write`（或
`GOODMEMORY_MCP_ALLOW_WRITE=1`）注册 `goodmemory_remember` 写工具，写入走
正常的受治理 remember 管线。已安装 host 写入的记忆带 agent 标签、默认对其
私有；加 `--agent-id codex` 并共享 `--storage-url` 才能选入读取。完整
flag/env 矩阵、scope 说明与各 host 配方见
[docs/GoodMemory-Standalone-MCP-Setup-Guide.md](./docs/GoodMemory-Standalone-MCP-Setup-Guide.md)
（[Cursor](./docs/GoodMemory-Cursor-Setup-Guide.md) ·
[Gemini CLI](./docs/GoodMemory-Gemini-CLI-Setup-Guide.md) ·
[OpenCode](./docs/GoodMemory-OpenCode-Setup-Guide.md)）。

## Installed Host Writeback：已安装主机写回

Installed Host Writeback 是 opt-in 的。runtime 默认配置和新的脚本化安装在没有显式选择时仍保持 `off`；已有配置在没有显式 override 时保持当前 writeback 模式，可能是 `off`、`observe`、`review` 或 `selective`。新的交互式安装会推荐 `selective`，让高信号写入立即生效，同时保留 audit 和 undo；如果你想先人工审批，再选择 `review`。

需要先看候选时用 `observe`；需要人工审批时用 `review`；准备自动写入时用 `selective`：

```bash
goodmemory enable codex --writeback observe
goodmemory codex writeback --json

goodmemory enable codex --writeback review
goodmemory inspector serve

goodmemory enable codex --writeback selective
goodmemory codex writeback --json
```

`goodmemory inspector serve` 会打开内置的本地 React 管理台，用于查看用户与
scope、分类记忆与 supersession 历史、处理候选、检查召回证据 trace 和审计事件。
启动 token 只通过 URL fragment 进入页面，随后立即清除并存入 session storage，
API 仅使用 Bearer header。修订与破坏性操作还要求二次确认、ETag 和幂等键。详见
[Inspector 与 Admin API](./docs/GoodMemory-Inspector-and-Admin-API.md)。

writeback 规则：

- `off`：不做 after-response 记忆抽取。
- `observe`：把有界/redacted candidate preview 写入本地 audit ledger 供 review；不保存 raw transcript，也不写 durable memory。
- `review`：把有界/redacted 候选放入 Inspector 审批队列；operator 批准前不写 durable memory。
- `selective`：把选中的候选通过公开 `remember` surface 写入。
- 原始 transcript 不会被当作 memory 持久化。
- assistant 产出的内容默认不能直接成为 durable memory；除非 host 明确确认或验证，并且当前 profile 允许。
- `remember: "never"` 会在 deterministic、custom、assisted extraction 之前屏蔽被标注内容。

审计和撤销：

```bash
goodmemory codex writeback inspect --json
goodmemory codex writeback forget --event-id <event-id> --review-outcome false_write
```

audit ledger 保存有界的 redacted candidate preview、candidate key、类型化 linked record id、状态、原因、host、mode、时间戳、scope/session digest，以及可选人工 review 元数据。它不保存原始 host payload。`forget --event-id` 会先通过公开 `forget()` 删除 durable audit event 的 linked memory/evidence records，再把事件标记为 forgotten；对 observe-only event，它只会标记为 dismissed，不调用 `forget()`。

Claude Code 对 hook 和 writeback 命令有确定性 CLI parity；Codex 是当前 canonical live-evidence path。

## 脚本化 Host 安装

当你需要完全非交互安装时，使用 `goodmemory install <host>`：

```bash
goodmemory install codex \
  --user-id <user-id> \
  --activation-mode global \
  --writeback observe \
  --storage-provider postgres \
  --storage-url "postgres://user:pass@host:5432/goodmemory" \
  --embedding-provider openai \
  --embedding-model text-embedding-3-small \
  --embedding-api-key <key> \
  --llm-provider openai \
  --llm-model gpt-4o-mini \
  --llm-api-key <key> \
  --no-interactive
```

托管配置位于 `~/.goodmemory/<host>.json`。带 provider flags 重复运行 install 会更新同一个配置，并保持 MCP/hook 注册幂等。卸载 npm 包不会删除 `~/.goodmemory`、repo-local `.goodmemory`、本地 SQLite 文件或远端 Postgres 数据。使用 `goodmemory uninstall <host>` 移除托管 host wiring；使用 `goodmemory forget ...` 或显式存储删除来移除记忆数据。

## 应用集成快速开始

当你在构建 chatbox、copilot 或产品 agent 时，使用 root package。推荐的 Node
服务路径就是 Express 和 Fastify 示例所用的同一条 thin loop。更完整的接入演练见
[docs/GoodMemory-15-Minute-App-Integration.md](./docs/GoodMemory-15-Minute-App-Integration.md)。

```ts
import type { GoodMemoryTraceSpan } from "goodmemory";
import { createGoodMemory } from "goodmemory";

const traceSpans: GoodMemoryTraceSpan[] = [];

const memory = createGoodMemory({
  observability: {
    traceSink: {
      emit(span) {
        traceSpans.push(span);
      },
    },
  },
});

const scope = {
  userId: "u-1",
  workspaceId: "workspace-a",
  sessionId: "s-1",
};
const userMessage = "Remember that the migration rollout is blocked on QA signoff.";

// 产品打开新 session 时调用一次 startSession；同一个 sessionId 的后续 turn
// 继续 append 到已有 runtime state。
await memory.runtime.startSession({ scope });
await memory.runtime.appendMessage({
  scope,
  message: {
    role: "user",
    content: userMessage,
  },
});

const recall = await memory.recall({
  scope,
  query: "What should the assistant know before replying?",
  retrievalProfile: "general_chat",
});

const context = await memory.buildContext({
  recall,
  output: "system_prompt_fragment",
});

const assistantText = await callYourModel({
  memoryContext: context.content,
  userMessage,
});

await memory.runtime.appendMessage({
  scope,
  message: {
    role: "assistant",
    content: assistantText,
  },
});

const writeJob = await memory.jobs.enqueueRemember({
  scope,
  messages: [
    {
      role: "user",
      content: userMessage,
    },
    {
      role: "assistant",
      content: assistantText,
    },
  ],
  idempotencyKey: "turn-1",
  reason: "post_response_memory_write",
});
const drained = await memory.jobs.drain({ maxJobs: 1 });
const committedJob =
  drained.jobs.find((job) => job.jobId === writeJob.jobId) ?? writeJob;

console.log({
  traceCount: traceSpans.length,
  writeJobId: writeJob.jobId,
  writeJobStatus: committedJob.status,
});

async function callYourModel(input: {
  memoryContext: string;
  userMessage: string;
}): Promise<string> {
  void input.memoryContext;
  return `Got it. I will keep that in mind: ${input.userMessage}`;
}
```

核心记忆闭环保持很小：

- `remember()` 写入经过筛选的用户、应用或 host 信号。
- `recall()` 按 scope 和 query 检索记忆。
- `buildContext()` 把 recall 命中转换成 prompt fragment 或 JSON payload。
- `feedback()` 记录显式纠正和过程偏好。
- `forget()` 删除错误或过期记忆。

生产应用接入时，推荐的 turn loop 会在这个核心闭环外增加受治理的
runtime 层：

- `memory.runtime.startSession()` 和 `memory.runtime.appendMessage()` 维护
  当前 session 状态，不把 raw transcript 当作默认 durable memory。
- `memory.jobs.enqueueRemember()` 用 idempotency 和可见 job 状态安排
  after-response 写入。
- `memory.jobs.drain()` 在当前 in-memory scheduler 中提交队列写入；生产
  服务应放在 worker 或请求相邻 job loop 中执行。
- `GoodMemoryConfig.observability.traceSink` 接收 redaction-safe trace，
  覆盖 remember、recall、context、revise、forget、export 和 job events。
- `memory.reviseMemory({ target: { memoryId } })` 只按显式 `memoryId`
  修正已知记忆，不做模糊文本选中。
- `exportMemory()` 提供用户可审计、可导出的记忆视图。

Runtime archive 默认不持久化。显式调用
`memory.runtime.endSession({ scope, archive: "off" })` 会清理 session state，
但不会写入 archive。即使产品选择启用 archive，也应保持 summary-only，
不要把 raw transcript 当作默认记忆来源。

server 集成先从 thin examples 开始：
[examples/express-chat-server.ts](./examples/express-chat-server.ts) 或
[examples/fastify-chat-server.ts](./examples/fastify-chat-server.ts)。
Python/FastAPI 后端使用下文的 packaged `goodmemory-http-bridge` 路径。

## 可选 Recall 调优：推荐 preset、多跳、本地 Embedding 与对话事实抽取

下面这些选项都是 opt-in 且默认保守。默认 recall 是单遍、rules-only，默认抽取也保持不变，不开启就不会改变行为。推荐 preset 有完整的 provider-free 本地路径；embedding 与抽取 provider 只增加可选通道，并非启动条件。

### 一键推荐检索 preset

`retrieval.preset: "recommended"` 用一个 flag 启用通用检索和条件式对话抽取：

```ts
const memory = createGoodMemory({
  retrieval: { preset: "recommended" },
});
```

激活后它会：(a) 建立 memory、field、sentence 三种粒度的检索投影；(b) 用 RRF 融合 BM25、直接实体邻接，以及可用时的神经 dense 候选；(c) 使用有上限的动态候选预算；(d) 把 `auto` 路由偏置到 hybrid。显式 per-call strategy 仍然优先，`strategy: "rules-only"` 会绕过通用融合。没有神经 embedding 时，检索保持本地、确定性、零网络；有 embedding 时增加 `topK: 16` 的 dense 通道。当抽取模型已可解析且 `mode` 未显式设置时，preset 才把抽取翻转为 `mode: "conversational"`，从不自行注入 provider。不设 `preset` 时默认行为保持不变。

要求与边界：

- 不要求 provider。`GOODMEMORY_EMBEDDING_*`、`providers.embedding` 或神经 `adapters.embeddingAdapter` 会增加可选 dense 通道；下方 Ollama 配方提供零出境神经路径。`createLocalEmbeddingAdapter()` 与 preset 配对时会被拒绝，因为哈希词法向量会重复 BM25 信号并冒充 dense 语义证据。
- 用 `inspectGoodMemoryRuntime(memory).retrievalPreset` 检查解析结果——其 `extraction` 字段报告写时那一半是否生效（`"conversational"`）或抽取器不可用/保持原样。
- preset 只覆盖记忆检索与条件式抽取；answer prompt 与 abstention policy 仍由应用负责。
- 除非明确需要旧的加法 BM25 排序槽，否则不要再设 `bm25Ranking: true`；通用融合已有独立 BM25 候选通道。
- 若你用 env 解析抽取并采用 preset，写时输出会变为会话式原子事实；退路是显式 `providers.extraction` 对象加 `mode: "default"`。

### 可选 pointwise reranker

当融合后的候选集合已经有用、但最终顺序仍有噪声时，可配置第一方
OpenAI-compatible pointwise reranker：

```ts
const memory = createGoodMemory({
  retrieval: { preset: "recommended" },
  providers: {
    reranking: {
      provider: "openai",
      model: process.env.RERANKING_MODEL!,
      apiKey: process.env.RERANKING_API_KEY!,
      baseURL: process.env.RERANKING_BASE_URL,
    },
  },
});

const result = await memory.recall({ scope, query });
console.log(result.metadata.retrievalTrace?.reranker);
```

每条已选 fact 都通过独立的 query-document 调用评分，同一 prompt 不会放入兄弟候选。
reranker 只重排确定性 recall 已接纳的 facts，不扩大成员集合，也不放宽 grounded
abstention。provider 超时、schema 或 gateway 失败时，会原样返回确定性顺序，并在
`retrievalTrace` 记录 `status: "fallback"` 与稳定原因。单次 recall 可用
`rerank: false` 跳过；显式 `adapters.reranker` 始终优先于
`providers.reranking`。provider reranker 默认请求超时为 15 秒；若网关需要不同
延迟预算，可在 `providers.reranking` 中设置可选的正整数
`requestTimeoutMs`。

trace 只包含有上限的 channel/RRF 归因、模型角色、已清洗 gateway、延迟、分数和
前后排名，不包含 API key、query 文本或记忆正文。该能力是 opt-in，并会对 bounded
rerank window 中的每条 fact 增加一次模型调用；provider-free recommended 路径不变。

### 本地 embedding 端点（Ollama）

推荐 preset 不依赖 embedding。若要增加零出境神经 dense 通道，`GOODMEMORY_EMBEDDING_BASE_URL` 接受任何 OpenAI-compatible 的 `/v1/embeddings` 端点，包括本地 Ollama。

```bash
ollama pull nomic-embed-text        # 或 bge-m3（更强的多语言召回）

export GOODMEMORY_EMBEDDING_PROVIDER=openai
export GOODMEMORY_EMBEDDING_BASE_URL=http://localhost:11434/v1
export GOODMEMORY_EMBEDDING_MODEL=nomic-embed-text
export GOODMEMORY_EMBEDDING_API_KEY=ollama   # 任意占位值；Ollama 忽略它，但变量必须设置
```

- `provider` 保持 `openai`：它选择的是 OpenAI-compatible 线协议，不是厂商。
- 一个存储只用一个 embedding 模型：不同模型/维度的向量不可比，换模型意味着重新 remember（重嵌入）语料。
- 本地 embedding 质量与 `text-embedding-3-small` 不同；公开 LoCoMo 数字用的是 OpenAI 端点。此配方以零出境复现机制，不复现精确数字。
- 这不是下方的 `createLocalEmbeddingAdapter()`——那是哈希词法、非语义，且会被推荐 preset 拒绝。

### 可选多跳 recall（multiHop）

`recall()` 默认单遍。传入 `multiHop: true` 启用 opt-in 两遍检索：先跑一遍查询，
从第一遍证据里抽取桥接实体（bridge entities），用它们扩展查询，再跑第二遍。

```ts
const recall = await memory.recall({
  scope,
  query: "Who manages the project Alice started?",
  multiHop: true,
});
```

- opt-in；不设置 `multiHop` 时默认 recall 保持单遍，行为不变。
- 它**不是**通用语义检索器：按命名实体做词面桥接，不按语义排序。
- 当第一遍 recall 很弱时它会**增加噪声**：第一遍捞错证据 → 桥接实体错 → 扩展查询
  反而稀释 recall。在 LoCoMo（base retrieval 很低）上实测 `multiHop` **降低**了 recall。
  所以不要用它来修对话 / 措辞差距类检索，那需要真正的语义检索。

### 离线本地 embedding adapter

`createLocalEmbeddingAdapter()` 是确定性、离线、零依赖的 embedding adapter
（hashed 字符 n-gram 向量）。在不配置 embedding provider 时注入它做词面/形态层面的并列打破：

```ts
import { createGoodMemory, createLocalEmbeddingAdapter } from "goodmemory";

const memory = createGoodMemory({
  adapters: { embeddingAdapter: createLocalEmbeddingAdapter() },
});
```

- 它**不是**神经语义检索：向量是 hashed 词面特征，只能在词面相似的候选之间打破并列，不理解语义。
- **不要**用它来宣称语义 benchmark 提升：它无法弥合词面重叠已经错过的「问题↔文本」措辞差距。
- 需要真正的语义排序时，请改为通过 `GOODMEMORY_EMBEDDING_*` 配置神经 embedding provider。

### 可选对话事实抽取（conversational）

默认情况下，配置了 `providers.extraction` 模型后的 assisted 抽取提取的是 durable 产品记忆——
profile、preference、reference、fact。把 `providers.extraction.mode` 设为 `"conversational"`，
则改为在写入时把对话分解成自包含、已消解指代、实体与日期归一化的原子事实（atomic claim），
这样后续检索匹配的是归一化后的事实，而不是原始对话轮。

```ts
const memory = createGoodMemory({
  providers: {
    extraction: {
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY!,
      baseURL: process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL,
      mode: "conversational",
    },
  },
});
```

适用于记忆来自多轮对话、且提问措辞与当时说法不同的 chat / agent 产品
（「用户的经理是谁？」对「嗯我老板 Dana 批了」）。

- opt-in；不设置 `mode`（或不配置 `providers.extraction`）就保持默认抽取行为，recall 排序路径不受影响。
- 它是**写入时的一次 LLM 调用**：使用你配置的 chat 模型，因此会增加抽取延迟与 token 成本，
  并且和任何 LLM 步骤一样可能漏掉或改写事实。原始对话轮仍是 ground truth。
- 它**不是**语义检索：只是把存储文本归一化，让词面检索有更好的匹配面，不按语义排序。
  它是针对对话措辞差距的「无 embedding 杠杆」，不替代神经 embedding provider。
- 没有 held-out 验证前**不要**用它的数字宣称 benchmark 提升，也不要把抽取 prompt 调到某个 benchmark 的措辞上。

## Runtime 与存储

`createGoodMemory({})` 遵循 local-first auto-storage contract：

- 显式传入 `storage.provider` 时，以显式配置为准。
- 没有显式 storage 时，只有配置目标可以 bootstrap GoodMemory backend，才会使用 Postgres。
- 在 Bun 上，零配置 durable storage 是本地 SQLite：`./.goodmemory/memory.sqlite`。
- 在没有内置本地 SQLite adapter 的 Node runtime 上，零配置 storage 会 fallback 到 in-memory。
- 不可用的内置 `sqlite` 或 `postgres` 显式选择会被报告为 unavailable，不会被误标成 durable。
- 注入的 `documentStore`、`sessionStore`、`vectorStore` adapter 会被报告为 adapter-defined storage。
- 没有 `GOODMEMORY_EMBEDDING_*` 时，运行时保持 `rules-only`。
- 支持的本地 runtime 可以用 `sqlite-vss` 做 SQLite semantic indexing；不支持时仍保留 durable non-accelerated fallback。

不要猜 runtime，直接检查：

```ts
import { createGoodMemory, inspectGoodMemoryRuntime } from "goodmemory";

const memory = createGoodMemory({});
const runtime = inspectGoodMemoryRuntime(memory);

console.log(runtime.storage);
```

SQLite vector 控制项：

- `GOODMEMORY_SQLITE_VECTOR_MODE=off|prefer|require`
- `GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH`
- `GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH`
- `GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT`
- `GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION`

## 公开写入定制

产品集成应该通过公开 `remember` surface 定制写入。不要把 test-only extractor seam 用作产品行为。

```ts
import { createGoodMemory, rememberRules } from "goodmemory";

const memory = createGoodMemory({
  remember: {
    preset: "default",
    profiles: [
      {
        id: "life-coach",
        when: { agentId: "life-coach" },
        rules: [
          rememberRules.fact(/my top priority this quarter is (.+)/i, {
            id: "life-goal-priority",
            category: "goal",
            tags: ["life_coach", "long_term_goal"],
            attributes: { horizon: "quarter" },
            content: ({ match }) => match[1] ?? "",
          }),
          rememberRules.preference(/please coach me with (.+)/i, {
            id: "life-coaching-style",
            category: "coaching_style",
            value: ({ match }) => match[1] ?? "",
          }),
        ],
        assistantOutputs: { mode: "confirmed_or_verified_only" },
      },
    ],
  },
});

await memory.remember({
  scope: { userId: "u-1", agentId: "life-coach" },
  messages: [
    {
      role: "user",
      content: "My top priority this quarter is rebuilding my sleep routine.",
    },
  ],
  annotations: [
    {
      messageIndex: 0,
      remember: "always",
      metadataPatch: { tags: ["confirmed_by_host"] },
    },
  ],
});
```

Profile `extractors` 可以是原始 `MemoryExtractor`，也可以是命名 `{ id, extractor }`。真实产品集成建议使用命名 extractor，这样 remember events 和 eval reports 即使在 profile 组合顺序变化后，也能保留稳定 `extractorIds`。Remember events 也会携带解析后的 `profileId` 与 `presetId` 元数据。

## AI SDK Adapter

GoodMemory 的 Node-compatible AI SDK 路径是一个普通 `Request -> Response` server handler，由 `createGoodMemory()` 和 `createGoodMemoryAISDK()` 组合而成。

```ts
import { createGoodMemory } from "goodmemory";
import type { GoodMemoryStreamTextInput } from "goodmemory/ai-sdk";
import { createGoodMemoryAISDK } from "goodmemory/ai-sdk";

const memory = createGoodMemory({});

const aiSDK = createGoodMemoryAISDK({
  memory,
});

type MemoryChatRequest = Pick<
  GoodMemoryStreamTextInput,
  "messages" | "query" | "scope" | "system"
>;

function isMemoryChatRequest(value: unknown): value is MemoryChatRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const scope = candidate.scope;
  return Array.isArray(candidate.messages)
    && !!scope
    && typeof scope === "object"
    && !Array.isArray(scope)
    && typeof (scope as { userId?: unknown }).userId === "string"
    && (scope as { userId: string }).userId.trim().length > 0;
}

export async function handleMemoryChat(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  if (!isMemoryChatRequest(body)) {
    return new Response(
      JSON.stringify({
        error: "Expected a request body with a messages array and scope.userId.",
      }),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 400,
      },
    );
  }

  const result = aiSDK.streamText({
    messages: body.messages,
    query: body.query,
    scope: body.scope,
    system: body.system,
    model: {} as never,
  });

  return result.toTextStreamResponse();
}
```

说明：

- canonical server example 是 [examples/plain-ai-sdk-server.ts](./examples/plain-ai-sdk-server.ts)。
- 更薄的 Express 与 Fastify 示例是
  [examples/express-chat-server.ts](./examples/express-chat-server.ts) 和
  [examples/fastify-chat-server.ts](./examples/fastify-chat-server.ts)。
- `examples/vercel-ai-chat.ts` 保留为更底层的 wrapper/API 示例。
- Next.js App Router 可以把 `export async function POST(request: Request)` 映射到同一段 handler 逻辑。
- 第一条公开 server path 是 `ModelMessage`-first。
- wrapper 通过 `recall()` 与 `buildContext()` 增强 `system`，并在 memory layer 出错时 soft-fail。

## Python/FastAPI HTTP Bridge

当 Python 后端需要把 GoodMemory 当作服务端 memory service 调用时，使用已打包的 HTTP bridge：

```bash
GOODMEMORY_HTTP_BRIDGE_TOKEN="replace-with-service-token" \
GOODMEMORY_STORAGE_PROVIDER=postgres \
GOODMEMORY_STORAGE_URL="postgres://user:pass@host:5432/goodmemory" \
./node_modules/.bin/goodmemory-http-bridge --profile life-coach
```

Python 调用方发送 `Authorization: Bearer <token>` 和 `x-goodmemory-*` scope
headers，调用 `POST /memory/recall-context`、`/memory/remember`、
`/memory/feedback`、`/memory/export`、`/memory/forget`，以及只接受显式
`memoryId` 的 `/memory/revise`。TypeScript bridge API 从 `goodmemory/http`
导入。

要通过 bridge 提供推荐检索 preset（多粒度 BM25 + 实体 + RRF，可选 dense），启动时加一个开关
`--recommended`（或 `GOODMEMORY_PROFILE=agent-recommended` /
`GOODMEMORY_HTTP_BRIDGE_RECOMMENDED=1`）。不配置 embedding 也可运行；
`GOODMEMORY_EMBEDDING_*` 只增加 dense 通道。
此后 `GET /healthz` 会报告 `retrievalTier` 与 `embeddingEnabled`，当前档位一眼
可见；recall 请求默认 `strategy: "auto"`，preset 会把它路由到 `hybrid`。
显式 `strategy: "rules-only"` 仍选择严格词法地板。

也可以用 Docker 一条命令部署（自带 SQLite volume；加 compose 的 `postgres`
profile 可切 pgvector）：

```bash
GOODMEMORY_HTTP_BRIDGE_TOKEN="replace-with-service-token" docker compose up -d
curl -fsS http://127.0.0.1:8739/healthz
```

`GET /healthz` 是免认证的存活探针，供容器、负载均衡与客户端 ready-wait 使用。
Python 后端建议使用官方客户端——`pip install goodmemory-client`（[PyPI](https://pypi.org/project/goodmemory-client/)）——它从一个
`Scope` 对象派生 caller headers、逐端点镜像冪等键规则，并在 recall 结果上暴露
`routing`（静默的策略降级由此可见）。详见
[docs/GoodMemory-Python-HTTP-Integration-Bridge.md](./docs/GoodMemory-Python-HTTP-Integration-Bridge.md)。

**托管实例。** 一个在线的 GoodMemory bridge 运行在
`https://goodmemory.vibenest.net`（存活探针：
[`/healthz`](https://goodmemory.vibenest.net/healthz)）。用
`GOODMEMORY_BRIDGE_HOST` / `--goodmemory-host`（或 `GoodMemoryClient` 的 host
参数）把客户端指向它即可，替代本地 URL；它强制 bearer-token 鉴权，需自带
service token。这是一个单进程、可写的 API——对外公开前请加上限流与可丢弃的
scope 数据，且切勿公开共享的写 token。

## Host Adapter API

当外部 host 需要 artifact 或 host-specific contracts，但不想导入内部模块时，使用 `goodmemory/host`。

```ts
import { createGoodMemory } from "goodmemory";
import { createHostAdapter } from "goodmemory/host";

const memory = createGoodMemory({});

const adapter = createHostAdapter({
  id: "codex-handoff",
  hostKind: "codex",
  memory,
  readableArtifactTypes: ["session_memory"],
});

const result = await adapter.readArtifacts({
  scope: {
    userId: "u-1",
    workspaceId: "workspace-a",
    sessionId: "s-1",
  },
  includeRuntime: true,
});
```

模式：

- `file-assisted`：读取编译出的 artifacts，例如 `MEMORY.md`、`user.md`、`session-memory/<sessionId>.md`、`playbooks/*.md`，但不把文件当作 canonical storage。
- `file-authoritative`：可用于最小 writable subset。当前 subset 是 canonical `playbooks/*.md` 文件形态，会把结构化 deltas 写回 active validated-pattern feedback records。

写入 guardrails：

- prompt 和 skill snippet 文件仍然是 derived read-only outputs。
- 高风险 guidance edit 需要显式 `verifyWrite` approval。
- `appliesTo`、`Why` 这类低风险 metadata edit 可以不经过额外 approval。
- 失败的 writable operation 会返回 diagnostics 与 rollback guidance。

当前 Claude/Codex 示例默认保持在 `file-assisted` 模式。

## CLI Reference

shell `PATH` 上的裸 `goodmemory` 命令来自
`npm install -g goodmemory@0.5.1` 安装的全局 CLI。本地 dependency install
里，用 `npx goodmemory`、`npm exec -- goodmemory` 或
`./node_modules/.bin/goodmemory` 调用 package bin。repo-local
`bun run goodmemory` 只用于开发。

Memory-first commands：

```bash
./node_modules/.bin/goodmemory inspect --user-id <user-id> --workspace-id <workspace-id>
./node_modules/.bin/goodmemory trace --user-id <user-id> --workspace-id <workspace-id> --query "Which runbook is the source of truth?"
./node_modules/.bin/goodmemory export-memory --user-id <user-id> --workspace-id <workspace-id> --output ./tmp/export
./node_modules/.bin/goodmemory stats --user-id <user-id> --workspace-id <workspace-id>
./node_modules/.bin/goodmemory remember --user-id <user-id> --workspace-id <workspace-id> --session-id <session-id> --message "Remember that the deploy is blocked on smoke verification."
./node_modules/.bin/goodmemory feedback --host codex --workspace-root . --session-id <session-id> --signal "Keep coding summaries short and list explicit next steps."
./node_modules/.bin/goodmemory forget --host codex --workspace-root . --session-id <session-id> --memory-id <memory-id>
```

Installed-host commands：

```bash
goodmemory -V
goodmemory --version
goodmemory setup --host codex
goodmemory status codex --workspace-root .
goodmemory install codex --activation-mode global --writeback observe --user-id <user-id>
goodmemory enable codex --workspace-root . --writeback selective
goodmemory mcp serve --host codex
goodmemory-mcp --host codex
goodmemory codex bootstrap --user-id <user-id> --workspace-id <workspace-id>
goodmemory claude bootstrap --user-id <user-id> --workspace-id <workspace-id>
```

Hook 与 writeback 示例：

```bash
printf '%s' '{"cwd":".","session_id":"s-1","hook_event_name":"SessionStart","source":"startup"}' \
  | goodmemory codex hook session-start

printf '%s' '{"cwd":".","session_id":"s-1","tool_name":"Bash","tool_input":{"command":"./tools/DeepAnalyzer --detailed"}}' \
  | goodmemory codex hook pre-tool-use

goodmemory codex action -- ./tools/DeepAnalyzer --detailed

printf '%s' '{"cwd":".","session_id":"s-1","messages":[{"role":"user","content":"Next step is to finish the release smoke."}]}' \
  | goodmemory codex writeback --json

printf '%s' '{"cwd":".","session_id":"s-1","event_id":"stop-1","summary":"Keep coding summaries short."}' \
  | goodmemory codex hook session-stop
```

Eval artifact inspection：

```bash
./node_modules/.bin/goodmemory eval inspect --run-dir reports/eval/live/<run-id> --case-id <case-id>
./node_modules/.bin/goodmemory eval trace --run-dir reports/eval/live/<run-id> --case-id <case-id>
./node_modules/.bin/goodmemory eval export-case --run-dir reports/eval/live/<run-id> --case-id <case-id> --output /tmp/case.json
```

CLI surface：

- `goodmemory -V`
- `goodmemory --version`
- `goodmemory setup`
- `goodmemory status`
- `goodmemory install`
- `goodmemory uninstall`
- `goodmemory enable`
- `goodmemory disable`
- `goodmemory inspect`
- `goodmemory trace`
- `goodmemory export-memory`
- `goodmemory stats`
- `goodmemory remember`
- `goodmemory feedback`
- `goodmemory forget`
- `goodmemory mcp serve`
- `goodmemory-mcp`
- `goodmemory codex hook`
- `goodmemory codex writeback`
- `goodmemory claude hook`
- `goodmemory claude writeback`
- `goodmemory codex bootstrap`
- `goodmemory claude bootstrap`
- `goodmemory eval inspect`
- `goodmemory eval trace`
- `goodmemory eval export-case`

## 示例

installed-package guides：

- 15 分钟应用集成指南：[docs/GoodMemory-15-Minute-App-Integration.md](./docs/GoodMemory-15-Minute-App-Integration.md)
- Reference integration guide：[docs/GoodMemory-Reference-Integration-Guide.md](./docs/GoodMemory-Reference-Integration-Guide.md)
- Codex handoff setup guide：[docs/GoodMemory-Codex-Handoff-Setup-Guide.md](./docs/GoodMemory-Codex-Handoff-Setup-Guide.md)
- Claude Code setup guide：[docs/GoodMemory-Claude-Code-Setup-Guide.md](./docs/GoodMemory-Claude-Code-Setup-Guide.md)

repo-local examples：

- Basic chat integration：[examples/basic-chat.ts](./examples/basic-chat.ts)
- Coding-agent flavored integration：[examples/coding-agent.ts](./examples/coding-agent.ts)
- Plain AI SDK server integration：[examples/plain-ai-sdk-server.ts](./examples/plain-ai-sdk-server.ts)
- Express chat server integration：[examples/express-chat-server.ts](./examples/express-chat-server.ts)
- Fastify chat server integration：[examples/fastify-chat-server.ts](./examples/fastify-chat-server.ts)
- AI SDK wrapper integration：[examples/vercel-ai-chat.ts](./examples/vercel-ai-chat.ts)
- Life-coach public remember profile：[examples/life-coach-remember-profile.ts](./examples/life-coach-remember-profile.ts)
- Claude-style host artifact consumption：[examples/host-claude-artifacts.ts](./examples/host-claude-artifacts.ts)
- Codex-style session handoff consumption：[examples/host-codex-handoff.ts](./examples/host-codex-handoff.ts)

从当前 repo 运行示例：

```bash
bun run example:chat
bun run example:coding-agent
bun run example:ai-sdk-server
bun run example:express-chat
bun run example:fastify-chat
bun run example:vercel-ai
bun run example:life-coach-profile
bun run example:host-claude
bun run example:host-codex
```

## Testing And Eval

默认本地 gates：

```bash
bun test
bun run typecheck
bun run test:coverage
```

只有当你明确需要覆盖 vendored 或 third-party test trees 时，才使用 `bun run test:all`。

Eval commands：

```bash
bun run eval:smoke
bun run eval:fallback
bun run eval:live
bun run eval:live-memory
bun run eval:live-auto-memory
bun run eval:live-provider-memory
bun run eval:summary
```

含义：

- `eval:smoke`：harness 自检。
- `eval:fallback`：不调用 live model 的确定性验证。
- `eval:live`：live generator 加 live judge，使用 in-memory backend。
- `eval:live-memory`：live generator 加 live judge，使用 auto-storage 语义；默认是本地 SQLite，除非 provider storage 可解析。
- `eval:live-auto-memory`：`eval:live-memory` 的显式 alias，方便脚本表达 auto-storage。
- `eval:live-provider-memory`：provider-backed evidence path，需要 Postgres、embeddings 与 assisted extraction；不会静默 fallback 到 SQLite。
- `eval:summary`：汇总已有 eval output directories。

Live eval 环境变量：

- `GOODMEMORY_EVAL_PROVIDER`
- `GOODMEMORY_EVAL_BASE_URL`，用于 OpenAI-compatible gateways
- `GOODMEMORY_EVAL_MODEL`
- `GOODMEMORY_EVAL_API_KEY`
- `GOODMEMORY_EVAL_MAX_CONCURRENCY`，可选并发上限
- `GOODMEMORY_JUDGE_PROVIDER`
- `GOODMEMORY_JUDGE_BASE_URL`，用于 OpenAI-compatible gateways
- `GOODMEMORY_JUDGE_MODEL`
- `GOODMEMORY_JUDGE_API_KEY`

`eval:live-memory` 和 `eval:live-auto-memory` 还需要 embedding 与 assisted extractor 配置：

- `GOODMEMORY_EMBEDDING_PROVIDER`
- `GOODMEMORY_EMBEDDING_BASE_URL`，用于 OpenAI-compatible gateways
- `GOODMEMORY_EMBEDDING_MODEL`
- `GOODMEMORY_EMBEDDING_API_KEY`
- `GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER`
- `GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL`，用于 OpenAI-compatible gateways
- `GOODMEMORY_ASSISTED_EXTRACTOR_MODEL`
- `GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY`

`eval:live-provider-memory` 额外需要：

- `GOODMEMORY_TEST_POSTGRES_URL`

输出目录：

- live runs：`reports/eval/live/run-*`
- auto-storage live memory runs：`reports/eval/live-memory/run-*`
- provider-backed live memory runs：`reports/eval/live-provider-memory/run-*`
- fallback runs：`reports/eval/fallback/run-*`

## Strategy Rollout

GoodMemory 把 `rules-only` 保持为受支持 baseline。新的 retrieval behavior 需要按 `observe -> assist -> promote` 推进。

Operator guidance：

- `observe`：收集隔离 shadow evidence，不改变实际执行路径。
- `assist`：只在受控 eval runs 里允许 candidate execution。
- `promote`：需要 `strategy-promotion-gate.json`、干净的 `regression-dashboard.json`，以及 `strategy-promotion-authorization.json`。
- 当 eval evidence 不完整、provider-backed dependencies 不可用，或 rollback 条件存在时，保持 `rules-only`。

## 当前状态

当前稳定公开 surface：

- 通过 `goodmemory` 暴露 root memory API
- 通过 `goodmemory/ai-sdk` 暴露 AI SDK adapter
- 通过 `goodmemory/host` 暴露 host adapter 和 host contracts
- 通过 `goodmemory/http` 和 `goodmemory-http-bridge` 暴露 HTTP bridge
- 通过 `goodmemory setup` 暴露 installed CLI 和托管 host setup
- Codex 与 Claude Code hooks 用于 recall
- 只读 MCP 用于 inspection 和 debugging
- opt-in installed-host writeback，带 audit 和 undo
- Bun 上的本地 SQLite durable fallback
- 配置后可用 Postgres、embeddings、assisted extraction、provider-backed evals

仍然不属于已接受公开承诺：

- 默认开启 automatic writeback
- 原始 transcript archive
- dashboard 或 managed cloud
- 把导出的 artifact files 当作 canonical storage
- 用内部 proposal 或 promotion internals 扩大 root exports

详细当前状态和 evidence map 见 [docs/GoodMemory-Current-Status-and-Evidence.md](./docs/GoodMemory-Current-Status-and-Evidence.md)。

## 文档

- 文档地图与归档规则：[docs/README.md](./docs/README.md)
- 当前状态与 evidence：[docs/GoodMemory-Current-Status-and-Evidence.md](./docs/GoodMemory-Current-Status-and-Evidence.md)
- 产品级对比页：[docs/GoodMemory-Product-Comparison.md](./docs/GoodMemory-Product-Comparison.md)
- canonical design：[docs/GoodMemory-First-Principles-and-Reference-Architecture.md](./docs/GoodMemory-First-Principles-and-Reference-Architecture.md)
- v1 implementation architecture：[docs/GoodMemory-OSS-Architecture-v1.md](./docs/GoodMemory-OSS-Architecture-v1.md)
- PRD：[docs/GoodMemory-PRD.md](./docs/GoodMemory-PRD.md)
- TDD 与 evaluation strategy：[docs/GoodMemory-TDD-and-Evaluation-Strategy.md](./docs/GoodMemory-TDD-and-Evaluation-Strategy.md)
- Strategy rollout guide：[docs/GoodMemory-Strategy-Rollout-Guide.md](./docs/GoodMemory-Strategy-Rollout-Guide.md)
- Release checklist：[docs/GoodMemory-v1-Release-Checklist.md](./docs/GoodMemory-v1-Release-Checklist.md)
- 历史 quality-gate archive：[docs/archive/quality-gates/README.md](./docs/archive/quality-gates/README.md)
- 历史 v1 snapshot：[docs/GoodMemory-v1-Quality-Gate.md](./docs/GoodMemory-v1-Quality-Gate.md)
- 框架 cookbook——在 agent 框架里接入持久记忆：[LangGraph](./docs/cookbooks/langgraph.md) · [CrewAI](./docs/cookbooks/crewai.md) · [OpenAI Agents SDK](./docs/cookbooks/openai-agents-sdk.md)

执行顺序、后续开放工作和 phase-specific acceptance boundaries 见 [task-board/00-README.txt](./task-board/00-README.txt)。历史设计输入不再视为 current truth，统一通过 `docs/README.md` 路由。
