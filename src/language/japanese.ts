import type { MemoryCandidate } from "../domain/memoryCandidate";
import type { FactKind } from "../domain/records";
import type {
  LanguageContentAnalysis,
  LanguageEntityMention,
  LanguagePack,
  LanguageQueryAnalysis,
  LanguageRenderInput,
  LanguageTemporalExpression,
} from "./contracts";
import {
  normalizeUnicodeForEquality,
  splitClausesGeneric,
  tokenizeUnicodeText,
} from "./generic";
import {
  analyzeBehavioralRuleWithPatterns,
  createSourceOfTruthReferenceCandidate,
  decomposeQueryByPattern,
  extractPatternMentions,
  matchesNormalizedEntityAlias,
  parseTechnicalTemporalExpressions,
  renderFromCatalog,
  resolveSourceOfTruthDirective,
  splitSentencesGeneric,
} from "./packHelpers";
import { parseCjkTemporalReference } from "./temporal";

const JAPANESE_STOPWORDS = new Set([
  "これ",
  "それ",
  "ため",
  "です",
  "ます",
  "いる",
  "ある",
  "する",
  "した",
  "して",
  "の",
  "は",
  "が",
  "を",
  "に",
  "で",
  "と",
  "も",
]);

const BEHAVIORAL_RULE_PATTERNS = {
  firstAction: [
    /(?:まず|最初に|先に)\s*([A-Za-z_][A-Za-z0-9_@.-]*)/u,
    /([A-Za-z_][A-Za-z0-9_@.-]*)\s*(?:を)?\s*(?:まず|最初に|先に)/u,
  ],
  format: /(冒頭|書き出し|末尾|締め|接頭辞|接尾辞|署名|件名|形式)/u,
  general: /(常に|必ず|べき|今後|いつも|毎回)/u,
  hostAction: {
    destination: [
      /['"`]([^'"`]+)['"`]\s*(?:へ|に)(?:コピー|複製|移動)/u,
      /((?:~\/|\/)[A-Za-z0-9._/-]+)\s*(?:へ|に)(?:コピー|複製|移動)/u,
    ],
    verbs: [
      { pattern: /(?:コピー|複製)/u, value: "copy" },
      { pattern: /移動/u, value: "move" },
    ],
  },
  negative: /(避け|しないで|してはいけない|禁止|決して|ではなく)/u,
  trigger: [
    /^(.+?)(?:では|には|のとき|する前)(?:[、,]|\s)/u,
  ],
} as const;

const QUERY = {
  actionDriving: /(送信|公開|リリース|デプロイ|実行|進め|決定|次のステップ|次に何を|移行案|編集|変更|削除|書き込|確認|チェック)/u,
  after: /(以降|以来|より後|後で)/u,
  aggregateCount: /(いくつ|何件|何個|何項目|合計|総額|全部で|いくら)/u,
  answer: /(返信|返答|回答|要約|まとめ|概要|ドラフト)/u,
  assistantEvidenceRecall: /(前回|以前|さっき|先ほど|あなたが(?:言った|教えた|提案した|勧めた)|リスト|思い出させ)/u,
  blocker: /(ブロッカー|障害|阻害要因|行き詰まり|承認待ち|妨げ)/u,
  before: /(以前|より前|前まで|前に|する前)/u,
  change: /(変更|変わ|切り替|移行|以前は|置き換)/u,
  confirm: /(確認)/u,
  continuation: /(続け|再開|前回の続き|引き続き|途中から)/u,
  directFactualLookup: /^(誰|だれ|何|なに|どこ|いつ|どれ|どの|いくつ|いくら|前回|以前)/u,
  factConfirmationTarget: /(役割|職位|重点|注力|ブロッカー|障害|未完了|残件|承認|検証)/u,
  focus: /(重点|注力|フォーカス|現在取り組んで|いま取り組んで)/u,
  exhaustiveList: /(すべて|全て|全部|一覧|リスト|どれ|残り|未完了|未解決|残件|保留中)/u,
  current: /(現在|最新|現時点|いま)/u,
  guidanceSeeking: /(好み|希望|スタイル|形式|フォーマット|口調|ルール|指示|避け|返信方法)/u,
  openLoop: /(オープンループ|未完了|未解決|残件|TODO|やること|要確認)/iu,
  history: /(履歴|歴史|過去|以前|これまで|前回)/u,
  procedural: /(どうすれば|どのように|手順|方法|ワークフロー|ランブック)/u,
  projectState: /(プロジェクト|ワークフロー|移行|リリース|展開|承認|ブロッカー|未完了|検証)/u,
  recommendationStyle: /(おすすめ|推奨|提案|助言|アドバイス|どうすれば|どうしたら|方法)/u,
  reference: /(ランブック|手順書|文書|ドキュメント|参照|情報源|正とする|基準|ガイド)/u,
  relation: /(何で知られ|何で有名|関連|関係|つなが|誰に報告|メンター)/u,
  role: /(役割|職位|ポジション)/u,
} as const;

const CONTENT = {
  assistantAck: /^(了解|承知しました|わかりました|はい|記録しました|更新しました|問題ありません)[。！!]?$/u,
  assistantContinuity: /(続け|今後|次に|フォロー|維持|更新|確認|対応)/u,
  blockerFact: /(ブロッカー|障害|阻害要因|承認待ち|行き詰ま)/u,
  correctionCue: /(訂正|修正|変更|置き換|代わり|ではなく|正とする|基準にする)/u,
  dont: /(しないで|しないこと|避けて|禁止)/u,
  durableCue: /(覚えて|記憶して|忘れないで|正とする|基準にする|ランブック|ブロッカー|障害|好み|優先|現在の役割|タイムゾーン|使用言語|現在の重点|プロジェクト)/u,
  focusFact: /(現在の重点は|現在の注力先は|いま取り組んでいるのは|現在取り組んでいる|現在.+(?:集中|注力))/u,
  negative: /(ブロック|失敗|未完了|未解決|不安定|行き詰ま)/u,
  openLoopFact: /(オープンループ|未完了|未解決|残件|TODO|必要がある|しなければならない)/iu,
  personalEvidence: /(私|わたし|自分|僕|ぼく|私たち|我々)/u,
  positive: /(安定|解決済み|解決した|完了|修正済み|閉じた)/u,
  preferenceEvidence: /(好み|好き|希望|望む|欲しい|興味|関心|避けたい|嫌い|困って|問題)/u,
  prefer: /(好み|優先|より好き)/u,
  projectStateFact: /(次のマイルストーン|次のステップ|保留|待機中|残って|レビュー待ち|確認待ち|フォローが必要|プロジェクト.+(?:段階|状態|フェーズ))/u,
  roleFact: /(私の現在の役割は|現在の役割は|私は.+(?:担当|責任者|エンジニア|マネージャー))/u,
  sensitiveCredential:
    /(?:API\s*)?(?:パスワード|秘密鍵|シークレット|トークン)\s*[:=：]\s*\S+/iu,
  unresolved: /(未完了|未解決|残件|保留|ブロッカー|次のステップ|要確認|フォロー)/u,
  validated: /(役に立った|有効だった|うまくいった|このまま続けて)/u,
} as const;

function analyzeJapaneseQuery(query: string): LanguageQueryAnalysis {
  const role = QUERY.role.test(query);
  const focus = QUERY.focus.test(query);
  const openLoop = QUERY.openLoop.test(query);
  const blocker = QUERY.blocker.test(query);
  const before = QUERY.before.test(query);
  const userGroundedEventOrder =
    /(順番|順序|時系列|最初[\s\S]{0,80}最後)/u.test(query) &&
    /(?:私|僕|自分)[\s\S]{0,80}(?:話した|言及した|取り上げた|話題にした)/u.test(
      query,
    );
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

function analyzeJapaneseSourceOfTruthDirective(content: string) {
  const negated = (index: number, pointerLength: number): boolean => {
    const prefix = content.slice(Math.max(0, index - 96), index);
    const suffix = content.slice(index + pointerLength, index + pointerLength + 128);
    return (
      /(?:使わず|使用せず|参照せず)\s*$/u.test(prefix) ||
      /^\s*(?:ではなく|でなく|を使わず|を使用せず)/u.test(suffix)
    );
  };

  return resolveSourceOfTruthDirective(content, {
    affirmed(index, pointerLength) {
      if (negated(index, pointerLength)) {
        return false;
      }
      const suffix = content.slice(
        index + pointerLength,
        index + pointerLength + 160,
      );
      return /^\s*(?:を正とする|を基準にする|を参照する|が正本)/u.test(suffix);
    },
    negated,
  });
}

function analyzeJapaneseContent(content: string): LanguageContentAnalysis {
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
    sourceOfTruthDirective: analyzeJapaneseSourceOfTruthDirective(content),
    unresolved: CONTENT.unresolved.test(content),
  };
}

function resolveJapaneseFactKind(
  content: string,
  providedAnalysis?: LanguageContentAnalysis,
): FactKind {
  const analysis = providedAnalysis ?? analyzeJapaneseContent(content);
  if (analysis.blockerFact) return "blocker";
  if (analysis.openLoopFact) return "open_loop";
  if (analysis.focusFact) return "focus_update";
  if (analysis.projectStateFact) return "project_state";
  return "generic_project";
}

function extractJapaneseCandidates(
  input: Parameters<LanguagePack["extractCandidates"]>[0],
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  for (const [index, message] of input.messages.entries()) {
    if (message.role !== "user") {
      continue;
    }
    const sourceMessageIndex = message.sourceMessageIndex ?? index;
    const clauses = splitClausesGeneric(message.content);
    const sourceAnalysis = message.analysis ??
      analyzeJapaneseContent(message.content);
    const sourceOfTruthReference = createSourceOfTruthReferenceCandidate({
      analysis: sourceAnalysis,
      nextId: input.nextId,
      sourceMessageIndex,
    });
    if (sourceOfTruthReference) {
      candidates.push(sourceOfTruthReference);
    }
    const messageAnalysis = clauses.length === 1 ? sourceAnalysis : undefined;
    for (const clause of clauses) {
      const text = clause.trim();
      const goal = text.match(
        /(?:私の)?(?:現在の)?(?:目標|最優先事項)は\s*([^。！？]+?)(?:です|である)?[。！？]?$/u,
      )?.[1];
      if (goal) {
        candidates.push({
          content: goal.trim(),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "goal",
            factKind: "focus_update",
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }
      const name = text.match(
        /(?:私の)?名前は\s*([^。！？]+?)(?=\s*です(?:[。！？]|$)|[。！？]|$)/u,
      );
      if (name?.[1]) {
        candidates.push({
          content: name[1].trim(),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "name" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const role = text.match(/(?:私の)?現在の役割は\s*([^。！？]+)[。！？]?$/u);
      if (role?.[1]) {
        candidates.push({
          content: role[1].trim().replace(/(?:です|である)$/u, ""),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "profile",
          metadata: { profileField: "role" },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const preference = text.match(/(?:私は|私の)?\s*([^。！？]+?)(?:が好き|を好む|を希望する|を希望します)/u);
      if (preference?.[1]) {
        const preferenceValue = preference[1].trim();
        candidates.push({
          content: preferenceValue,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "preference",
          metadata: {
            preferenceCategory: "response_style",
            preferenceValue,
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const explicitFact = text.match(/(?:覚えておいて|覚えて|記憶して|忘れないで)[、,\s]*(.+)/u);
      if (explicitFact?.[1]) {
        const content = explicitFact[1].trim();
        candidates.push({
          content,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: resolveJapaneseFactKind(content, messageAnalysis),
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      } else if (
        !role &&
        !preference &&
        !sourceOfTruthReference &&
        text.length >= 6 &&
        /(現在|いま|ブロッカー|障害|未完了|移行|リリース|プロジェクト)/u.test(text)
      ) {
        candidates.push({
          content: text,
          explicitness: "inferred",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: resolveJapaneseFactKind(text, messageAnalysis),
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      if (/^(?:今後|必ず|優先して)|(?:しないで|避けて)/u.test(text)) {
        candidates.push({
          content: text,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "feedback",
          metadata: {
            appliesTo: "general_response",
            feedbackKind: messageAnalysis?.feedbackKind ??
              analyzeJapaneseContent(text).feedbackKind,
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }
    }
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kindHint}\u0000${candidate.content}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseJapaneseTemporalExpressions(
  text: string,
): LanguageTemporalExpression[] {
  const primary = parseCjkTemporalReference(text);
  const technical = parseTechnicalTemporalExpressions(text);
  return primary
    ? [primary, ...technical.filter(({ raw }) => raw !== primary.raw)]
    : technical;
}

function extractJapaneseEntityMentions(text: string): LanguageEntityMention[] {
  return extractPatternMentions(text, [
    { kind: "term", pattern: /「([^」]{2,40})」/gu },
    { kind: "term", pattern: /([\p{Script=Katakana}ー]{3,40})/gu },
    {
      kind: "term",
      pattern: /([\p{Script=Han}]{2,20}(?:さん|氏|社|株式会社|大学|研究所|プロジェクト))/gu,
    },
    { kind: "identifier", pattern: /\b([A-Za-z]+[-_]\d+|[A-Z]{2,}\d*)\b/gu },
  ]);
}

const JAPANESE_RENDER_CATALOG = {
  active_context: "現在のコンテキスト",
  canonical_pattern: "正規パターン",
  guidance: "ガイダンス",
  instruction: "指示",
  metadata: "メタデータ",
  playbook_title: "プレイブック: {rule}",
  procedure: "手順",
  prompt_snippet_title: "プロンプトスニペット: {rule}",
  skill_snippet_title: "スキルスニペット: {rule}",
  use_when: "使用条件",
  why: "理由",
  actor: "アクター",
  additional_project_state: "追加のプロジェクト状態",
  archive: "会話アーカイブ",
  archive_recap: "アーカイブ要約: {sessionId}",
  artifact_spills: "外部保存コンテンツ",
  behavioral_controls_available:
    "決定的な最終回答の修正に使える関連する生の経験制御があります。",
  behavioral_exact_surface: "厳密な実行形式:",
  behavioral_example: "例 {index}:",
  behavioral_observed_outcome: "観測結果:",
  behavioral_raw_response_control: "生の応答制御:",
  behavioral_relevant_prior_examples: "関連する過去の例:",
  behavioral_safe_corrected_move: "安全な修正動作:",
  behavioral_situation: "状況:",
  behavioral_successful_move: "成功した動作:",
  correction: "訂正",
  claim: "主張",
  current_goal: "現在の目標",
  current_projects: "現在のプロジェクト",
  current_state: "現在の状態",
  constraints: "制約",
  deferred_follow_up: "後続のフォローアップ",
  developer_memory_notes: "開発者メモリノート:",
  durable_memory: "永続メモリ",
  earlier_messages_compacted: "以前のメッセージは圧縮されました。",
  episode: "関連エピソード",
  episode_assistant_follow_through_captured:
    "アシスタントのフォローアップを記録しました。",
  episode_assistant_follow_through_on:
    "アシスタントのフォローアップ: {highlight}",
  episode_assistant_substantive_continuity_captured:
    "アシスタントによる実質的な継続対応を記録しました。",
  episode_conversation_covered: "会話で扱った内容: {segments}",
  episode_item: "エピソード",
  evidence: "根拠",
  evidence_entry: "根拠 {evidenceId} はメモリ {memoryId} に基づきます。",
  evidence_note: "各項目を時間状態と根拠関係に従って読んでください。",
  experiences: "経験記録",
  excerpt: "抜粋",
  fact: "事実",
  fact_item: "事実",
  feedback: "フィードバック",
  file_evidence: "ファイル根拠",
  file_or_function: "ファイル/関数",
  goals: "目標",
  immediate_next_steps: "すぐに進められる次のステップ",
  installed_host_claude_memory_protocol:
    "GoodMemory は Claude Code の自動メモリを補完します。セッション中の作業メモは MEMORY.md に残し、永続的なプロジェクトの事実、決定、設定・好みは GoodMemory に保存して、出典付きで各プロンプトに表示されるようにしてください。Hook で注入された GoodMemory の内容を MEMORY.md にコピーしないでください。",
  installed_host_context_tool_protocol:
    "注入されたコンテキストがない、または不十分な場合は、具体的な質問で goodmemory_get_context を呼び出してください（現在のプロンプトに限らず、どの質問でも構いません）。",
  installed_host_injected_context_protocol:
    "Hook で注入された「開発者メモリノート」ブロックは、現在のプロンプトに対して取得されたメモリです。計画前に読み、プロジェクトの事実を再推論するより優先してください。時間に依存する事実は、実行前にリポジトリで検証してください。",
  installed_host_intro:
    "このリポジトリは、永続的で統制されたメモリのために GoodMemory（インストール済みの {host} ホスト経路）を使用します。",
  installed_host_projection_protocol:
    "エクスポートされたアーティファクトファイルは正規の事実ではなく投影として扱い、注入されたメモリをファイルやコミットメッセージにそのまま書き写さないでください。",
  installed_host_protocol_heading: "メモリプロトコル:",
  installed_host_record_tools_protocol:
    "表示済みの要約ではなく特定のレコードが必要な場合は、goodmemory_search_index を呼び出してから goodmemory_get_records を呼び出してください。メモリが誤っているように見える、または予期せず見つからない場合は、goodmemory_trace_recall を呼び出して選択または除外の理由を確認してください。",
  installed_host_remember_protocol:
    "保存する価値のある永続的な事実、決定、設定・好み、またはブロッカーを知り、goodmemory_remember ツールが利用できる場合は、1 回の呼び出しにつき 1 つの明確な文で保存してください。書き込みは統制され、監査可能です。拒否された場合は結果に理由が示されます。",
  journal: "セッションジャーナル",
  key_decisions: "重要な決定",
  key_files: "主要ファイル",
  language_label: "言語",
  learning_proposals: "学習提案",
  lineage: "系譜",
  location: "場所",
  memory_index: "メモリ索引",
  name: "名前",
  none: "なし",
  organization: "組織",
  open_loops: "未完了事項",
  omitted_sections: "省略されたセクション: {sections}",
  preference: "設定・好み",
  procedural_memory: "手順メモリ",
  profile: "プロフィール",
  progressive_detail_instruction:
    "詳細が必要な場合にのみ、recordRef の値を詳細ツールで使用してください。",
  progressive_detail_instruction_compact:
    "必要に応じて recordRef を詳細ツールで使用してください。",
  progressive_recall: "段階的 GoodMemory リコール",
  promotions: "昇格記録",
  recent_decisions: "最近の決定",
  recent_worklog: "最近の作業ログ",
  reference: "参照資料",
  reference_item: "参照",
  referenced_artifacts: "参照アーティファクト",
  relation_label: "関係",
  role_label: "役割",
  scope: "スコープ",
  session_archive_item: "会話アーカイブ",
  session_ended_without_summary:
    "統合された要約がないままセッションが終了しました。",
  session_handoff: "セッション引き継ぎ: {sessionId}",
  session_memory: "セッションメモリ: {sessionId}",
  session_resume_query:
    "このコーディングセッションで再開すべき継続情報、現在のコンテキスト、未完了事項は何ですか？",
  session_start_query:
    "このコーディングセッションの開始時に知るべき現在のコンテキスト、継続情報、未完了事項は何ですか？",
  tool_result: "ツール結果",
  temporal_status: "時間状態",
  summary: "要約",
  detail_tokens: "詳細トークン数",
  omitted_records: "省略レコード数: {count}",
  record_kind: "種類",
  record_ref: "参照",
  temporary_decision: "一時的な決定",
  timezone: "タイムゾーン",
  verification: "検証",
  user_memory_context: "ユーザーメモリコンテキスト:",
  user_memory: "ユーザーメモリ",
  undated: "日付なし",
  default_label: "既定",
  workflow: "ワークフロー",
  working_memory: "作業メモリ",
  workspace_query_anchor: "ワークスペース: {workspace}。",
} as const;

function renderJapanese(input: LanguageRenderInput): string {
  return renderFromCatalog(input, JAPANESE_RENDER_CATALOG);
}

export function createJapaneseLanguagePack(): LanguagePack {
  return {
    analyzerVersion: "6",
    apiVersion: 1,
    compatibilityGroup: "ja",
    defaultLocale: "ja-JP",
    id: "ja",
    locales: ["ja"],
    detect({ texts }) {
      const joined = texts.join(" ");
      if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(joined)) {
        return "distinctive";
      }
      return /\p{Script=Han}/u.test(joined) ? "compatible" : "none";
    },
    normalizeForEquality: normalizeUnicodeForEquality,
    splitClauses: splitClausesGeneric,
    splitSentences: splitSentencesGeneric,
    tokenizeForScoring(text, _mode, options) {
      const tokens = tokenizeUnicodeText(text, "ja-JP");
      return options?.excludeStopwords
        ? tokens.filter((token) => !JAPANESE_STOPWORDS.has(token))
        : tokens;
    },
    buildSearchTerms(text) {
      return tokenizeUnicodeText(text, "ja-JP").filter(
        (token) => !JAPANESE_STOPWORDS.has(token),
      );
    },
    decomposeQuery(text) {
      return decomposeQueryByPattern(text, /(?:そして|また|さらに|それから)/u);
    },
    analyzeBehavioralRule(text) {
      return analyzeBehavioralRuleWithPatterns(text, BEHAVIORAL_RULE_PATTERNS);
    },
    analyzeQuery: analyzeJapaneseQuery,
    analyzeContent: analyzeJapaneseContent,
    parseTemporalExpressions: parseJapaneseTemporalExpressions,
    extractEntityMentions: extractJapaneseEntityMentions,
    matchesEntityAlias(query, alias) {
      return matchesNormalizedEntityAlias(
        query,
        alias,
        normalizeUnicodeForEquality,
      );
    },
    acceptsEntityCandidate() {
      return true;
    },
    extractCandidates: extractJapaneseCandidates,
    render: renderJapanese,
  };
}
