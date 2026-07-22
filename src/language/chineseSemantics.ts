import type {
  LanguageContentAnalysis,
  LanguageDetectionStrength,
  LanguageEntityMention,
  LanguageQueryAnalysis,
  LanguageRenderInput,
  LanguageTemporalExpression,
} from "./contracts";
import {
  decomposeQueryByPattern,
  extractPatternMentions,
  parseTechnicalTemporalExpressions,
  renderFromCatalog,
  resolveSourceOfTruthDirective,
} from "./packHelpers";
import { parseCjkTemporalReference } from "./temporal";

export type ChineseScript = "Hans" | "Hant";

const HAN_PATTERN = /\p{Script=Han}/u;
const JAPANESE_SYLLABARY_PATTERN =
  /\p{Script=Hiragana}|\p{Script=Katakana}/u;
const HANS_DISTINCTIVE_PATTERN =
  /(?:[请记体复发布碍当项总结束开环验证签审议与还里么这个为准优务径码]|应该)/u;
const HANT_DISTINCTIVE_PATTERN =
  /(?:[請記體覆發佈礙當總結開環驗證簽審議與還裡麼這個為準優務徑碼]|應該)/u;
const CHINESE_GRAMMAR_PATTERN =
  /(?:我|我的|我们|我們|请|請|记住|記住|目前|现在|当前|當前|需要|正在|项目|专案|偏好|喜欢|喜歡|不要|別)/u;

const QUERY = {
  actionDriving: /(发送|發送|发布|發佈|上线|上線|决定|決定|执行|執行|推进|推進|下一步|部署|迁移方案|遷移方案|编辑|編輯|修改|删除|刪除|运行|運行|写入|寫入|检查|檢查|查看|确认|確認)/u,
  after: /(之后|之後|以后|以後|晚于|晚於|自从|自從|以来|以來)/u,
  aggregateCount: /(多少|几个|幾個|几件|幾件|几项|幾項|总共|總共|合计|合計|一共|多少钱|多少錢|花了多少钱|花了多少錢|花费多少|花費多少)/u,
  answer: /(怎么回复|怎麼回覆|如何回复|如何回覆|如何回答|怎么回答|怎麼回答|给用户回复|給使用者回覆|回答这个用户|回答這個使用者|总结|總結|摘要|概述|汇总|彙總)/u,
  assistantEvidenceRecall:
    /(之前|上次|刚才|剛才|前面|你(?:告诉|告訴|说|說|建议|建議|推荐|推薦|提供)|清单|清單|列表|第[一二三四五六七八九十\d]+项|第[一二三四五六七八九十\d]+項|提醒我)/u,
  blocker: /(阻塞|阻碍|阻礙|卡点|卡點|卡在哪里|卡在哪裡|卡住|审批|審批|承認待ち)/u,
  before: /(之前|以前|早于|早於|(?<![目当當])前(?:先|要|應|应|需|請|请)?)/u,
  change: /(后来|後來|换成|換成|改成|变成|變成|不再|从[^?？。.!]{1,80}(?:到|换成|換成|改成))/u,
  confirm: /(确认|確認)/u,
  continuation: /(继续|繼續|接着|接著|延续|延續|上次|从上次|從上次|继续做|繼續做|接着做|接著做|继续这个|繼續這個)/u,
  directFactualLookup:
    /^(谁|誰|什么|什麼|哪里|哪裡|哪儿|何时|何時|什么时候|什麼時候|多久|多少|几个|幾個|几件|幾件|几项|幾項|哪个|哪個|哪一个|哪一個|是否|是不是|我是否|我是不是|我上次|上次|之前)/u,
  factConfirmationTarget: /(角色|身份|职位|職位|重点|重點|关注|關注|开环|開環|待办|待辦|阻塞|阻碍|阻礙|卡点|卡點|审批|審批|签收|簽收|验收|驗收|验证|驗證)/u,
  focus: /(重点|重點|当前重点|當前重點|当前关注|當前關注|关注点|關注點)/u,
  exhaustiveList: /(全部|哪些|列表|清单|清單|待处理|待處理|待跟进|待跟進|所有|还有|還有|剩余|剩餘|未完成|待办|待辦|开环|開環)/u,
  current: /(当前|當前|目前|现在|現在|最新|如今)/u,
  guidanceSeeking: /(偏好|喜欢|喜歡|风格|風格|格式|语气|語氣|规则|規則|要求|指令|怎么回复|怎麼回覆|如何回复|如何回覆|如何回答|怎么回答|怎麼回答)/u,
  openLoop: /(开环|開環|待办|待辦|未完成|签收|簽收|验收|驗收|验证|驗證)/u,
  history: /(历史|歷史|过去|過去|此前|之前|历来|歷來)/u,
  procedural: /(怎么做|怎麼做|如何做|步骤|步驟|流程|操作手册|操作手冊|说明|說明)/u,
  projectState: /(项目|專案|項目|流程|迁移|遷移|审批|審批|阻塞|阻碍|阻礙|卡点|卡點|卡在哪里|卡在哪裡|卡住|开环|開環|待办|待辦|签收|簽收|验收|驗收)/u,
  recommendationStyle: /(推荐|推薦|建议|建議|意见|意見|主意|想法|技巧|提示|怎么处理|怎麼處理|如何处理|如何處理|怎么做|怎麼做|怎么办|怎麼辦|有什么建议|有什麼建議|有什么办法|有什麼辦法|该怎么|該怎麼)/u,
  reference: /(手册|手冊|runbook|文档|文件|参考|參考|以什么为准|以什麼為準|以哪个[^。！？?]*为准|以哪個[^。！？?]*為準|来源|來源|规范|規範|流程)/u,
  relation: /(以什么闻名|以什麼聞名|因什么出名|因什麼出名|与谁有关|與誰有關|关联到|關聯到|汇报给|彙報給)/u,
  role: /(角色|身份|职位|職位)/u,
} as const;

const CONTENT = {
  assistantAck:
    /^(好的|收到|明白|知道了|行|可以|沒問題|没问题|記住了|记住了|已記錄|已记录|已更新|好)\.?[。！!]?$/u,
  assistantContinuity: /(会|會|继续|繼續|接下来|接下來|跟进|跟進|保持|下一步|待办|待辦|阻塞|已更新|确认|確認)/u,
  blockerFact: /(阻塞|阻碍|阻礙|卡点|卡點|卡住|审批|審批)/u,
  correctionCue: /(不再|改成|更正|更換|换成|換成|替代|取代|以.+(?:为准|為準))/u,
  dont: /(不要|别|別|禁止)/u,
  durableCue: /(记住|記住|以.+(?:为准|為準)|阻塞|阻礙|卡点|卡點|偏好|请保持|請保持|当前角色|當前角色|时区|時區|常用语言|常用語言|当前重点|當前重點|当前项目|當前專案|不再)/u,
  focusFact: /(我当前重点是|我當前重點是|当前重点是|當前重點是)/u,
  negative: /(阻塞|阻碍|阻礙|失败|失敗|打开|打開|不稳定|不穩定|卡住|未完成)/u,
  openLoopFact: /(开环|開環|待办|待辦|未完成|签收|簽收|验收|驗收|验证|驗證)/u,
  personalEvidence: /(我|我的|我家|我们|我們|我们的|我們的|自己|家里|家裡|家中)/u,
  positive: /(稳定|穩定|已解决|已解決|关闭|關閉|修复|修復|完成)/u,
  preferenceEvidence: /(偏好|更喜欢|更喜歡|喜欢|喜歡|想要|想|希望|需要|在找|感兴趣|感興趣|不想|讨厌|討厭|困扰|困擾|问题|問題|麻烦|麻煩|漏水|刮痕|划痕|劃痕|维修|維修|收纳|收納|乱|亂|杂乱|雜亂)/u,
  prefer: /(偏好|更喜欢|更喜歡|优先|優先)/u,
  projectStateFact: /(待确认|待確認|待处理|待處理|待跟进|待跟進|待完成|待评审|待評審|仍需|还需|還需|剩余|剩餘|尚待|待 review)/u,
  roleFact: /(我当前角色是|我當前角色是|我的角色是)/u,
  sensitiveCredential:
    /(?:API\s*)?(?:密碼|密码|口令|密鑰|密钥|金鑰|令牌)\s*[:=：]\s*\S+/iu,
  unresolved: /(待办|待辦|阻塞|阻碍|阻礙|未完成|剩余|剩餘|后续|後續|跟进|跟進|下一步|以后处理|以後處理|待确认|待確認)/u,
  validated: /(有效|有帮助|有幫助|很好用|繼續這樣|继续这样|保持这样|保持這樣|这样做得好|這樣做得好|这个格式对我很有用|這個格式對我很有用)/u,
} as const;

export function detectChinese(
  texts: readonly string[],
  script: ChineseScript,
): LanguageDetectionStrength {
  const joined = texts.join(" ");
  if (JAPANESE_SYLLABARY_PATTERN.test(joined)) {
    return "none";
  }
  const distinctive = script === "Hant"
    ? HANT_DISTINCTIVE_PATTERN
    : HANS_DISTINCTIVE_PATTERN;
  const opposite = script === "Hant"
    ? HANS_DISTINCTIVE_PATTERN
    : HANT_DISTINCTIVE_PATTERN;
  if (distinctive.test(joined) && !opposite.test(joined)) {
    return "distinctive";
  }
  if (opposite.test(joined) && !distinctive.test(joined)) {
    return "compatible";
  }
  if (CHINESE_GRAMMAR_PATTERN.test(joined)) {
    return "distinctive";
  }
  return HAN_PATTERN.test(joined) ? "compatible" : "none";
}

export function analyzeChineseQuery(query: string): LanguageQueryAnalysis {
  const role = QUERY.role.test(query);
  const focus = QUERY.focus.test(query);
  const openLoop = QUERY.openLoop.test(query);
  const blocker = QUERY.blocker.test(query);
  const before = QUERY.before.test(query);
  const userGroundedEventOrder =
    /(顺序|順序|先后|先後|时间线|時間線|按时间|按時間|最先|最後|最后|第一个|第一個)/u.test(
      query,
    ) &&
    /我[\s\S]{0,80}(提到|討論|讨论|聊到|說過|说过)/u.test(query);
  return {
    actionDriving: QUERY.actionDriving.test(query),
    after: QUERY.after.test(query),
    aggregateCount: QUERY.aggregateCount.test(query),
    answerComposition: QUERY.answer.test(query),
    assistantEvidenceRecall: QUERY.assistantEvidenceRecall.test(query),
    before,
    blocker,
    change: QUERY.change.test(query),
    continuation: QUERY.continuation.test(query),
    current: QUERY.current.test(query),
    directFactualLookup: QUERY.directFactualLookup.test(query.trim()),
    exhaustiveList: QUERY.exhaustiveList.test(query),
    factConfirmation: role || focus || openLoop || blocker ||
      (QUERY.confirm.test(query) && QUERY.factConfirmationTarget.test(query)),
    focus,
    guidanceSeeking: QUERY.guidanceSeeking.test(query),
    history: !before && QUERY.history.test(query),
    openLoop,
    procedural: QUERY.procedural.test(query),
    projectState: QUERY.projectState.test(query),
    recommendationStyle: QUERY.recommendationStyle.test(query),
    relation: QUERY.relation.test(query),
    referenceSeeking: QUERY.reference.test(query),
    role,
    userGroundedEventOrder,
  };
}

function analyzeChineseSourceOfTruthDirective(content: string) {
  const negated = (index: number, pointerLength: number): boolean => {
    const prefix = content.slice(Math.max(0, index - 96), index);
    const suffix = content.slice(index + pointerLength, index + pointerLength + 128);
    return (
      /不再(?:以|按|用|使用)\s*$/u.test(prefix) ||
      /(?:不要|别再|別再)(?:以|按|用|使用)\s*$/u.test(prefix) ||
      /^\s*(?:已)?不再(?:作为|作為|是)?(?:当前|當前)?(?:依据|依據|标准|標準|版本)(?:\s|[,.!?:;。！？；，]|$)/u.test(
        suffix,
      ) ||
      /^\s*(?:已)?不再(?:为准|為準)(?:\s|[,.!?:;。！？；，]|$)/u.test(suffix)
    );
  };

  return resolveSourceOfTruthDirective(content, {
    allowsEmbeddedStart(index) {
      return /以\s*$/u.test(content.slice(Math.max(0, index - 4), index));
    },
    affirmed(index, pointerLength) {
      if (negated(index, pointerLength)) {
        return false;
      }
      const prefix = content.slice(Math.max(0, index - 128), index);
      const suffix = content.slice(
        index + pointerLength,
        index + pointerLength + 160,
      );
      return (
        /(?:现在|現在|当前|當前|目前|以后都|以後都)?以\s*$/u.test(prefix) &&
        /^\s*(?:为准|為準)(?:\s|[,.!?:;。！？；，]|$)/u.test(suffix)
      );
    },
    negated,
    trimPointerSuffix(pointer) {
      return pointer.replace(/(?:为准|為準)$/u, "");
    },
  });
}

export function analyzeChineseContent(content: string): LanguageContentAnalysis {
  const factPolarity = CONTENT.negative.test(content)
    ? "negative"
    : CONTENT.positive.test(content)
    ? "positive"
    : "unknown";
  const feedbackKind = CONTENT.validated.test(content)
    ? "validated_pattern"
    : CONTENT.dont.test(content)
    ? "dont"
    : CONTENT.prefer.test(content)
    ? "prefer"
    : "do";
  return {
    assistantAcknowledgement: CONTENT.assistantAck.test(content.trim()),
    assistantContinuity: CONTENT.assistantContinuity.test(content),
    blockerFact: CONTENT.blockerFact.test(content),
    correctionCue: CONTENT.correctionCue.test(content),
    durableCue: CONTENT.durableCue.test(content),
    factPolarity,
    feedbackKind,
    focusFact: CONTENT.focusFact.test(content),
    openLoopFact: CONTENT.openLoopFact.test(content),
    personalEvidence: CONTENT.personalEvidence.test(content),
    preferenceEvidence: CONTENT.preferenceEvidence.test(content),
    projectStateFact: CONTENT.projectStateFact.test(content),
    roleFact: CONTENT.roleFact.test(content),
    sensitiveCredential: CONTENT.sensitiveCredential.test(content),
    sourceOfTruthDirective: analyzeChineseSourceOfTruthDirective(content),
    unresolved: CONTENT.unresolved.test(content),
  };
}

export function decomposeChineseQuery(query: string): string[] {
  return decomposeQueryByPattern(
    query,
    /(?:以及|并且|並且|而且|同时|同時|还有|還有)/u,
  );
}

export function parseChineseTemporalExpressions(
  text: string,
): LanguageTemporalExpression[] {
  const primary = parseCjkTemporalReference(text);
  const technical = parseTechnicalTemporalExpressions(text);
  return primary
    ? [primary, ...technical.filter(({ raw }) => raw !== primary.raw)]
    : technical;
}

export function extractChineseEntityMentions(
  text: string,
): LanguageEntityMention[] {
  return extractPatternMentions(text, [
    { kind: "term", pattern: /[「“"]([^」”"]{2,40})[」”"]/gu },
    {
      kind: "organization",
      pattern: /([\p{Script=Han}A-Za-z0-9]{2,30}(?:公司|集团|集團|团队|團隊|大学|大學|学院|學院|平台|项目|專案))/gu,
    },
    { kind: "identifier", pattern: /\b([A-Za-z]+[-_]\d+|[A-Z]{2,}\d*)\b/gu },
  ]).filter((mention) =>
    !/^(?:告诉|告訴|请|請|我|什么|什麼|哪个|哪個|目前|现在|現在|当前|當前)/u.test(
      mention.surface,
    )
  );
}

const HANS_RENDER_CATALOG = {
  active_context: "当前上下文",
  canonical_pattern: "规范模式",
  guidance: "指引",
  instruction: "指令",
  metadata: "元数据",
  playbook_title: "操作手册：{rule}",
  procedure: "程序",
  prompt_snippet_title: "提示片段：{rule}",
  skill_snippet_title: "技能片段：{rule}",
  use_when: "适用时机",
  why: "原因",
  actor: "主体",
  additional_project_state: "补充项目状态上下文",
  archive: "会话归档",
  archive_recap: "归档摘要：{sessionId}",
  artifact_spills: "外置内容",
  behavioral_controls_available: "已有相关原始经验控制，可用于确定性修正最终答案。",
  behavioral_exact_surface: "精确执行形式：",
  behavioral_example: "示例 {index}：",
  behavioral_observed_outcome: "观察结果：",
  behavioral_raw_response_control: "原始响应控制：",
  behavioral_relevant_prior_examples: "相关先前示例：",
  behavioral_safe_corrected_move: "安全纠正动作：",
  behavioral_situation: "情境：",
  behavioral_successful_move: "成功动作：",
  correction: "更正",
  claim: "声明",
  current_goal: "当前目标",
  current_projects: "当前项目",
  current_state: "当前状态",
  constraints: "约束",
  deferred_follow_up: "后续待跟进事项",
  developer_memory_notes: "开发者记忆备注：",
  durable_memory: "持久记忆",
  earlier_messages_compacted: "较早的消息已压缩。",
  episode: "相关经历",
  episode_assistant_follow_through_captured: "已记录助手的后续跟进。",
  episode_assistant_follow_through_on: "助手已跟进：{highlight}",
  episode_assistant_substantive_continuity_captured:
    "已记录助手提供的实质性延续。",
  episode_conversation_covered: "本次会话涵盖：{segments}",
  episode_item: "经历",
  evidence: "证据",
  evidence_entry: "证据 {evidenceId} 来自记忆 {memoryId}。",
  evidence_note: "按时间状态和证据关系阅读以下条目。",
  experiences: "经验记录",
  excerpt: "摘录",
  fact: "事实",
  fact_item: "事实",
  feedback: "反馈",
  file_evidence: "文件证据",
  file_or_function: "文件/函数",
  goals: "目标",
  immediate_next_steps: "当前可立即推进的下一步",
  installed_host_claude_memory_protocol:
    "GoodMemory 与 Claude Code 自动记忆相互补充：请在 MEMORY.md 中保留你自己的会话工作笔记；将持久的项目事实、决策和偏好保存在 GoodMemory 中，使其按提示连同来源一起呈现。不要把 Hook 注入的 GoodMemory 内容复制到 MEMORY.md。",
  installed_host_context_tool_protocol:
    "当注入的上下文缺失或不足时，请用具体问题调用 goodmemory_get_context（可以询问任何问题，不限于当前提示）。",
  installed_host_injected_context_protocol:
    "Hook 注入的“开发者记忆备注”区块，是为当前提示检索到的记忆。规划前请先阅读，并优先使用这些内容，避免重复推导项目事实；执行前仍须对照仓库验证具有时效性的事实。",
  installed_host_intro:
    "此仓库使用 GoodMemory（已安装的 {host} 主机路径）提供持久且受治理的记忆。",
  installed_host_projection_protocol:
    "将导出的工件文件视为投影，而不是规范事实来源；不要在文件或提交信息中逐字复述注入的记忆。",
  installed_host_protocol_heading: "记忆协议：",
  installed_host_record_tools_protocol:
    "需要具体记录而非渲染后的摘要时，请先调用 goodmemory_search_index，再调用 goodmemory_get_records。若某条记忆看起来有误或意外缺失，请调用 goodmemory_trace_recall 查看它为何被选中或未被选中。",
  installed_host_remember_protocol:
    "当你获知值得保留的持久事实、决策、偏好或阻碍，并且 goodmemory_remember 工具可用时，请每次调用用一条清晰陈述将其保存。写入受治理且可审计；结果会解释任何拒绝原因。",
  journal: "日志",
  key_decisions: "关键决策",
  key_files: "关键文件",
  language_label: "语言",
  learning_proposals: "学习提案",
  lineage: "沿袭关系",
  location: "位置",
  memory_index: "记忆索引",
  name: "姓名",
  none: "无",
  organization: "组织",
  open_loops: "待办",
  omitted_sections: "已省略部分：{sections}",
  preference: "偏好",
  procedural_memory: "程序性记忆",
  profile: "用户资料",
  progressive_detail_instruction: "仅在需要更多上下文时，使用 recordRef 值调用详情工具。",
  progressive_detail_instruction_compact: "需要时使用 recordRef 调用详情工具。",
  progressive_recall: "渐进式 GoodMemory 召回",
  promotions: "晋升记录",
  recent_decisions: "最近决策",
  recent_worklog: "最近工作记录",
  reference: "参考资料",
  reference_item: "参考",
  referenced_artifacts: "引用的工件",
  relation_label: "关系",
  role_label: "角色",
  scope: "范围",
  session_archive_item: "会话归档",
  session_ended_without_summary: "会话结束时没有可用的综合摘要。",
  session_handoff: "会话交接：{sessionId}",
  session_memory: "会话记忆：{sessionId}",
  session_resume_query: "这个编程会话应继续哪些上下文、当前状态和待办？",
  session_start_query: "这个编程会话开始时需要了解哪些当前上下文、连续状态和待办？",
  tool_result: "工具结果",
  temporal_status: "时间状态",
  summary: "摘要",
  detail_tokens: "详情 token 数",
  omitted_records: "已省略记录：{count}",
  record_kind: "类型",
  record_ref: "引用",
  temporary_decision: "临时决策",
  timezone: "时区",
  verification: "验证",
  user_memory_context: "用户记忆上下文：",
  user_memory: "用户记忆",
  undated: "无日期",
  default_label: "默认",
  workflow: "工作流",
  working_memory: "工作记忆",
  workspace_query_anchor: "工作区：{workspace}。",
} as const;

const HANT_RENDER_CATALOG = {
  active_context: "當前上下文",
  canonical_pattern: "規範模式",
  guidance: "指引",
  instruction: "指令",
  metadata: "中繼資料",
  playbook_title: "操作手冊：{rule}",
  procedure: "程序",
  prompt_snippet_title: "提示片段：{rule}",
  skill_snippet_title: "技能片段：{rule}",
  use_when: "適用時機",
  why: "原因",
  actor: "主體",
  additional_project_state: "補充專案狀態上下文",
  archive: "會話歸檔",
  archive_recap: "歸檔摘要：{sessionId}",
  artifact_spills: "外置內容",
  behavioral_controls_available: "已有相關原始經驗控制，可用於確定性修正最終答案。",
  behavioral_exact_surface: "精確執行形式：",
  behavioral_example: "範例 {index}：",
  behavioral_observed_outcome: "觀察結果：",
  behavioral_raw_response_control: "原始回應控制：",
  behavioral_relevant_prior_examples: "相關先前範例：",
  behavioral_safe_corrected_move: "安全修正動作：",
  behavioral_situation: "情境：",
  behavioral_successful_move: "成功動作：",
  correction: "更正",
  claim: "聲明",
  current_goal: "當前目標",
  current_projects: "當前專案",
  current_state: "當前狀態",
  constraints: "限制",
  deferred_follow_up: "後續待跟進事項",
  developer_memory_notes: "開發者記憶備註：",
  durable_memory: "持久記憶",
  earlier_messages_compacted: "較早的訊息已壓縮。",
  episode: "相關經歷",
  episode_assistant_follow_through_captured: "已記錄助手的後續跟進。",
  episode_assistant_follow_through_on: "助手已跟進：{highlight}",
  episode_assistant_substantive_continuity_captured:
    "已記錄助手提供的實質性延續。",
  episode_conversation_covered: "本次會話涵蓋：{segments}",
  episode_item: "經歷",
  evidence: "證據",
  evidence_entry: "證據 {evidenceId} 來自記憶 {memoryId}。",
  evidence_note: "請按時間狀態和證據關係閱讀以下條目。",
  experiences: "經驗記錄",
  excerpt: "摘錄",
  fact: "事實",
  fact_item: "事實",
  feedback: "回饋",
  file_evidence: "檔案證據",
  file_or_function: "檔案/函式",
  goals: "目標",
  immediate_next_steps: "當前可立即推進的下一步",
  installed_host_claude_memory_protocol:
    "GoodMemory 與 Claude Code 自動記憶相互補充：請在 MEMORY.md 中保留你自己的會話工作筆記；將持久的專案事實、決策和偏好保存在 GoodMemory 中，使其按提示連同來源一起呈現。不要把 Hook 注入的 GoodMemory 內容複製到 MEMORY.md。",
  installed_host_context_tool_protocol:
    "當注入的上下文缺失或不足時，請用具體問題呼叫 goodmemory_get_context（可以詢問任何問題，不限於當前提示）。",
  installed_host_injected_context_protocol:
    "Hook 注入的「開發者記憶備註」區塊，是為當前提示檢索到的記憶。規劃前請先閱讀，並優先使用這些內容，避免重複推導專案事實；執行前仍須對照儲存庫驗證具有時效性的事實。",
  installed_host_intro:
    "此儲存庫使用 GoodMemory（已安裝的 {host} 主機路徑）提供持久且受治理的記憶。",
  installed_host_projection_protocol:
    "將匯出的工件檔案視為投影，而不是規範事實來源；不要在檔案或提交訊息中逐字重述注入的記憶。",
  installed_host_protocol_heading: "記憶協定：",
  installed_host_record_tools_protocol:
    "需要具體記錄而非轉譯後的摘要時，請先呼叫 goodmemory_search_index，再呼叫 goodmemory_get_records。若某條記憶看起來有誤或意外缺失，請呼叫 goodmemory_trace_recall 查看它為何被選中或未被選中。",
  installed_host_remember_protocol:
    "當你獲知值得保留的持久事實、決策、偏好或阻礙，且 goodmemory_remember 工具可用時，請每次呼叫用一條清晰陳述將其保存。寫入受治理且可稽核；結果會解釋任何拒絕原因。",
  journal: "日誌",
  key_decisions: "關鍵決策",
  key_files: "關鍵檔案",
  language_label: "語言",
  learning_proposals: "學習提案",
  lineage: "沿襲關係",
  location: "位置",
  memory_index: "記憶索引",
  name: "姓名",
  none: "無",
  organization: "組織",
  open_loops: "待辦",
  omitted_sections: "已省略部分：{sections}",
  preference: "偏好",
  procedural_memory: "程序性記憶",
  profile: "使用者資料",
  progressive_detail_instruction: "僅在需要更多上下文時，使用 recordRef 值呼叫詳情工具。",
  progressive_detail_instruction_compact: "需要時使用 recordRef 呼叫詳情工具。",
  progressive_recall: "漸進式 GoodMemory 召回",
  promotions: "晉升記錄",
  recent_decisions: "最近決策",
  recent_worklog: "最近工作記錄",
  reference: "參考資料",
  reference_item: "參考",
  referenced_artifacts: "引用的工件",
  relation_label: "關係",
  role_label: "角色",
  scope: "範圍",
  session_archive_item: "會話歸檔",
  session_ended_without_summary: "會話結束時沒有可用的綜合摘要。",
  session_handoff: "會話交接：{sessionId}",
  session_memory: "會話記憶：{sessionId}",
  session_resume_query: "這個程式設計會話應繼續哪些上下文、當前狀態和待辦？",
  session_start_query: "這個程式設計會話開始時需要瞭解哪些當前上下文、連續狀態和待辦？",
  tool_result: "工具結果",
  temporal_status: "時間狀態",
  summary: "摘要",
  detail_tokens: "詳情 token 數",
  omitted_records: "已省略記錄：{count}",
  record_kind: "類型",
  record_ref: "引用",
  temporary_decision: "臨時決策",
  timezone: "時區",
  verification: "驗證",
  user_memory_context: "使用者記憶上下文：",
  user_memory: "使用者記憶",
  undated: "無日期",
  default_label: "預設",
  workflow: "工作流程",
  working_memory: "工作記憶",
  workspace_query_anchor: "工作區：{workspace}。",
} as const;

export function renderChinese(
  input: LanguageRenderInput,
  script: ChineseScript,
): string {
  return renderFromCatalog(
    input,
    script === "Hant" ? HANT_RENDER_CATALOG : HANS_RENDER_CATALOG,
  );
}
