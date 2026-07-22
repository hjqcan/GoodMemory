import type { MemoryCandidate } from "../domain/memoryCandidate";
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
  decomposeQueryByPattern,
  extractPatternMentions,
  matchesNormalizedEntityAlias,
  parsePatternTemporalExpressions,
  parseTechnicalTemporalExpressions,
  renderFromCatalog,
  resolveSourceOfTruthDirective,
  splitSentencesGeneric,
} from "./packHelpers";
import { resolveCjkTemporalReference } from "./temporal";

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
  focusFact: /(現在の重点は|現在の注力先は|いま取り組んでいるのは|現在取り組んでいる)/u,
  negative: /(ブロック|失敗|未完了|未解決|不安定|行き詰ま)/u,
  openLoopFact: /(オープンループ|未完了|未解決|残件|TODO|必要がある|しなければならない)/iu,
  personalEvidence: /(私|わたし|自分|僕|ぼく|私たち|我々)/u,
  positive: /(安定|解決済み|解決した|完了|修正済み|閉じた)/u,
  preferenceEvidence: /(好み|好き|希望|望む|欲しい|興味|関心|避けたい|嫌い|困って|問題)/u,
  prefer: /(好み|優先|より好き)/u,
  projectStateFact: /(次のマイルストーン|次のステップ|保留|待機中|残って|レビュー待ち|確認待ち|フォローが必要)/u,
  roleFact: /(私の現在の役割は|現在の役割は|私は.+(?:担当|責任者|エンジニア|マネージャー))/u,
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
    sourceOfTruthDirective: analyzeJapaneseSourceOfTruthDirective(content),
    unresolved: CONTENT.unresolved.test(content),
  };
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
    for (const clause of splitClausesGeneric(message.content)) {
      const text = clause.trim();
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

      const reference = text.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\s*(?:を正とする|を基準にする|を参照する)/u);
      if (reference?.[1]) {
        const pointer = reference[1];
        candidates.push({
          content: pointer,
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "reference",
          metadata: {
            referenceKind: "doc",
            referencePointer: pointer,
            referenceTitle: pointer.split("/").at(-1) ?? pointer,
            subject: "unknown",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      }

      const explicitFact = text.match(/(?:覚えておいて|覚えて|記憶して|忘れないで)[、,\s]*(.+)/u);
      if (explicitFact?.[1]) {
        candidates.push({
          content: explicitFact[1].trim(),
          explicitness: "explicit",
          id: input.nextId(),
          kindHint: "fact",
          metadata: {
            category: "project",
            factKind: "generic_project",
            scopeKind: "project",
          },
          sourceMessageIndex,
          sourceRole: "user",
        });
      } else if (
        !role &&
        !preference &&
        !reference &&
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
            factKind: "generic_project",
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
            feedbackKind: analyzeJapaneseContent(text).feedbackKind,
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
  return [
    ...parseTechnicalTemporalExpressions(text),
    ...parsePatternTemporalExpressions(text, [
      {
        kind: "absolute",
        pattern: /\d{4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/gu,
        unit: "day",
      },
      {
        kind: "relative",
        pattern: /(?:今日|昨日|明日|一昨日|明後日)/gu,
        unit: "day",
      },
      {
        kind: "relative",
        pattern: /(?:先週|今週|来週|先月|今月|来月|昨年|今年|来年)/gu,
      },
      {
        kind: "relative",
        pattern: /\d+日前/gu,
        unit: "day",
      },
    ]),
  ];
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
  actor: "アクター",
  additional_project_state: "追加のプロジェクト状態",
  archive: "会話アーカイブ",
  correction: "訂正",
  claim: "主張",
  current_goal: "現在の目標",
  current_projects: "現在のプロジェクト",
  current_state: "現在の状態",
  deferred_follow_up: "後続のフォローアップ",
  durable_memory: "永続メモリ",
  episode: "関連エピソード",
  episode_item: "エピソード",
  evidence: "根拠",
  evidence_entry: "根拠 {evidenceId} はメモリ {memoryId} に基づきます。",
  evidence_note: "各項目を時間状態と根拠関係に従って読んでください。",
  excerpt: "抜粋",
  fact: "事実",
  fact_item: "事実",
  feedback: "フィードバック",
  file_evidence: "ファイル根拠",
  goals: "目標",
  immediate_next_steps: "すぐに進められる次のステップ",
  journal: "セッションジャーナル",
  key_decisions: "重要な決定",
  open_loops: "未完了事項",
  preference: "設定・好み",
  procedural_memory: "手順メモリ",
  profile: "プロフィール",
  recent_worklog: "最近の作業ログ",
  reference: "参照資料",
  reference_item: "参照",
  relation_label: "関係",
  session_archive_item: "会話アーカイブ",
  tool_result: "ツール結果",
  temporal_status: "時間状態",
  verification: "検証",
  working_memory: "作業メモリ",
} as const;

function renderJapanese(input: LanguageRenderInput): string {
  return renderFromCatalog(input, JAPANESE_RENDER_CATALOG);
}

export function createJapaneseLanguagePack(): LanguagePack {
  return {
    analyzerVersion: "4",
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
    analyzeQuery: analyzeJapaneseQuery,
    analyzeContent: analyzeJapaneseContent,
    parseTemporalExpressions: parseJapaneseTemporalExpressions,
    resolveTemporalReference: resolveCjkTemporalReference,
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
