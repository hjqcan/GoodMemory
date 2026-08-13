import type {
  MemoryCandidate,
  MemoryCandidateMetadata,
  ProfileField,
} from "../domain/memoryCandidate";
import {
  attachLanguageDurableTarget,
  createLanguageDurableOptOutDisposition,
  deriveLanguageDurableTarget,
} from "./durableTarget";
import type {
  LanguageCandidateExtractionInput,
  LanguageContentAnalysis,
  LanguagePack,
} from "./contracts";
import type {
  FactKind,
  MemoryScopeKind,
} from "../domain/records";
import {
  expandExplicitFactCandidateClauses,
  hasUnterminatedQuote,
  isExplicitlyQuotedValue,
  isolateDirectiveGrammar,
  maskQuotedText,
  replaceUnquotedText,
  splitClausesGeneric,
  splitTrailingClause,
} from "./generic";
import type { DirectiveGrammarMatch } from "./generic";
import {
  buildChineseSearchTerms,
  CHINESE_ANALYZER_VERSION,
  normalizeChineseForEquality,
  tokenizeChineseForScoring,
} from "./chineseConversion";
import {
  analyzeChineseContent as analyzeChineseContentBase,
  analyzeChineseQuery,
  type ChineseScript,
  decomposeChineseQuery,
  detectChinese,
  extractChineseEntityMentions,
  parseChineseTemporalExpressions,
  renderChinese,
} from "./chineseSemantics";
import {
  analyzeBehavioralRuleWithPatterns,
  createSourceOfTruthReferenceCandidate,
  matchesNormalizedEntityAlias,
  splitSentencesGeneric,
} from "./packHelpers";
import {
  canResolveOccurrenceExpression,
  maskQuotedTemporalLiterals,
} from "./temporal";

const BEHAVIORAL_RULE_PATTERNS = {
  firstAction: [
    /(?:先|首先|优先|優先)\s*(?:运行|運行|执行|執行|使用|调用|調用|呼叫)?\s*([A-Za-z_][A-Za-z0-9_@.-]*)/u,
    /([A-Za-z_][A-Za-z0-9_@.-]*)\s*(?:要|应|應|需)?\s*(?:先|首先|优先|優先)/u,
  ],
  format: /(开头|開頭|结尾|結尾|前缀|前綴|后缀|後綴|签名|簽名|主题行|主旨行|格式)/u,
  general: /(始终|始終|总是|總是|必须|必須|应该|應該|以后|以後|今后|今後|每当|每當)/u,
  hostAction: {
    destination: [
      /(?:到|至|放入)\s*['"`]([^'"`]+)['"`]/u,
      /(?:到|至|放入)\s*((?:~\/|\/)[A-Za-z0-9._/-]+)/u,
    ],
    verbs: [
      { pattern: /(?:复制|複製|拷贝|拷貝)/u, value: "copy" },
      { pattern: /(?:移动|移動)/u, value: "move" },
    ],
  },
  negative: /(避免|不要|不得|禁止|绝不|絕不|而不是|不要使用|不应|不應)/u,
  trigger: [
    /^(.+?)(?:时|時|的时候|的時候)(?:[，,]|\s*)/u,
  ],
} as const;

const CHINESE_STOPWORDS = new Set([
  "这个",
  "這個",
  "那个",
  "那個",
  "请",
  "請",
  "一下",
  "现在",
  "現在",
  "目前",
  "仍然",
  "已经",
  "已經",
  "以后",
  "以後",
]);
const CHINESE_INTERROGATIVE_FORMS = {
  anchors: [
  "为什么",
  "為什麼",
  "有没有",
  "有沒有",
  "是不是",
  "哪一个",
  "哪一個",
  "什么",
  "什麼",
  "哪个",
  "哪個",
  "哪些",
  "哪里",
  "哪裡",
  "哪儿",
  "哪兒",
  "哪位",
  "多少",
  "几个",
  "幾個",
  "几项",
  "幾項",
  "是否",
  "怎么",
  "怎麼",
  "为何",
  "為何",
  "能否",
  "可否",
  "何时",
  "何時",
  "何处",
  "何處",
  "何人",
  "何以",
  "如何",
  "谁",
  "誰",
  ],
  particles: ["吗", "嗎", "呢"],
} as const;
const CHINESE_INTERROGATIVE_ANCHOR_SOURCE =
  `(?:${CHINESE_INTERROGATIVE_FORMS.anchors.join("|")})`;
const CHINESE_LEADING_INTERROGATIVE_ANCHOR_PATTERN = new RegExp(
  `^${CHINESE_INTERROGATIVE_ANCHOR_SOURCE}`,
  "u",
);
const CHINESE_INTERROGATIVE_RETRIEVAL_PATTERN = new RegExp(
  CHINESE_INTERROGATIVE_ANCHOR_SOURCE,
  "gu",
);
const CHINESE_INTERROGATIVE_PARTICLE_RETRIEVAL_PATTERN =
  /(?:吗|嗎|呢)(?=[?？。.!！]*\s*$)/gu;
const CHINESE_REFERENCE_SUBJECT_NOISE_PATTERN =
  /^(?:现在|目前|当前|以后|以后都|今后|之后|后续|之后都|暂时|先|继续|仍然|都|统一|默认|请|请以后|以后请)$/u;
const CHINESE_REFERENCE_SUBJECT_HINT_PATTERN =
  /(项目|流程|迁移|发布|上线|系统|服务|模块|计划|工作|工作流|平台|接口|看板|质量|程序|任务|手册|剧本|审批|验收|签收|交接|可靠性|支付|订单|运行时)/u;
const CHINESE_DURABLE_TARGET_ALIASES = {
  偏好: "preference",
  位置: "profile:location",
  公司: "profile:organization",
  当前项目: "profile:currentProject",
  當前專案: "profile:currentProject",
  當前項目: "profile:currentProject",
  常用语言: "profile:languagePreference",
  常用語言: "profile:languagePreference",
  当前位置: "profile:location",
  當前位置: "profile:location",
  我的公司: "profile:organization",
  我的当前位置: "profile:location",
  我的當前位置: "profile:location",
  我的角色: "profile:role",
  我的语言偏好: "profile:languagePreference",
  我的語言偏好: "profile:languagePreference",
  我的组织: "profile:organization",
  我的組織: "profile:organization",
  名字: "profile:name",
  姓名: "profile:name",
  我的名字: "profile:name",
  我的姓名: "profile:name",
  我的时区: "profile:timezone",
  我的時區: "profile:timezone",
  时区: "profile:timezone",
  時區: "profile:timezone",
  角色: "profile:role",
  语言偏好: "profile:languagePreference",
  語言偏好: "profile:languagePreference",
  组织: "profile:organization",
  組織: "profile:organization",
  项目代码: "assignment:project_code",
  项目代号: "assignment:project_code",
  項目代碼: "assignment:project_code",
  項目代號: "assignment:project_code",
  專案代碼: "assignment:project_code",
  專案代號: "assignment:project_code",
} as const;

const DURABLE_INFERENCE_PATTERNS = [
  /(目前|现在|仍然|已经)/u,
  /(阻塞|卡住|失败|报错|迁移|上线|发布|审批|项目|流程|工作流|运行时|接口|构建)/u,
];
const EDUCATION_DEGREE_PATTERN =
  /我(?:毕业于|获得|拿到|有|拥有)\s*([^，。！？；]+?(?:专业|学位))(?=，|。|！|？|；|$)/u;
const PET_NAME_PATTERN =
  /(?:我的?|我家)\s*(猫|狗|小猫|小狗|宠物)(?:的)?名字(?:是|叫)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const PET_NAME_SHORT_PATTERN =
  /(?:我的?|我家)\s*(猫|狗|小猫|小狗|宠物)\s*叫\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const DOG_BREED_PATTERN =
  /(?:我的?|我家)\s*狗\s*([A-Za-z0-9_\p{Script=Han}'’-]{1,30})?\s*(?:是|品种是|属于)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const UNDERGRAD_INSTITUTION_WITH_SUBJECT_PATTERN =
  /我(?:的)?(?:本科|大学本科)\s*(?:在|毕业于)\s*([^，。！？；]+?)(?:读|学)\s*([^，。！？；]*?(?:计算机|CS|Computer Science))(?=，|。|！|？|；|$)/iu;
const UNDERGRAD_INSTITUTION_PATTERN =
  /我(?:的)?(?:本科|大学本科)\s*(?:在|毕业于)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/iu;
const FIRST_PERSON_USE_PATTERN =
  /我(?:一直|最近|正在|已经)?(?:在)?(?:使用|用)(?:了)?\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const PERSONAL_ATTRIBUTE_PATTERN =
  /我的([^，。！？；]+?)(?:需要|花费|耗时)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const OPEN_LOOP_PATTERN =
  /我(?:仍然|还)?(?:需要|要|得)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const PLANNED_OPEN_LOOP_PATTERN =
  /我(?:明天|后天|後天|下周|下週|下个月|下個月|下月|下季度|明年)?(?:会|會|将|將|准备|準備|打算|计划|計劃)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const RECENT_EVENT_PATTERN =
  /我(?:实际上|刚刚|刚|今天|昨天|上周|最近)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const COMPLETED_FIRST_PERSON_EVENT_PATTERN =
  /^我(?!\s*(?:会|會|将|將|准备|準備|打算|计划|計劃))(?![^。！？]*(?:没|沒|未|没有|沒有))[^。！？]+了[^。！？]*[。！？]?$/u;
const PERSONAL_BEST_TIME_PATTERN =
  /(?:我(?:这次|在)?\s*)?([^，。！？；]*?)?的?个人(?:最好|最佳)(?:成绩|时间|纪录)(?:是|为|达到)?\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const LEARNING_WITH_TOOL_PATTERN =
  /我(?:正在|想|想要|试着)?学习\s*([^，。！？；]+?)(?:，|,)?(?:用|使用)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const CURRENT_PROJECT_INVOLVEMENT_PATTERN =
  /我(?:正在|最近|一直|已经)?(?:做|负责|推进|参与)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const PROJECT_LEADERSHIP_PATTERN =
  /我(?:主导了|主导|带领了|带领|领导了|领导|负责了|负责)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const PROJECT_ACTIVITY_PATTERN =
  /我(?:最近|刚)?(参加了|参与了|展示了|汇报了|发表了|介绍了)\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const RELATION_RELOCATION_PATTERN =
  /我的(?:朋友|表亲|堂亲|阿姨|叔叔|姐妹|兄弟|伴侣|同事)\s*([^，。！？；]+?)\s*(?:最近|刚刚|刚)?搬(?:回|到|去)?了?\s*([^，。！？；]+?)(?=，|。|！|？|；|$)/u;
const USER_IDENTITY_PATTERN = /^作为\s*([^，。！？；]+?)用户(?:，|,)/u;
const EXPLICIT_FACT_DIRECTIVE_PATTERN =
  /^(?:(?:(?:请|請)(?:你|帮我|幫我)?|(?:麻烦|麻煩)你)?(?:记住|記住)|有个事实(?:是)?|有個事實(?:是)?)/u;
const COUNTED_FACT_LIST_PATTERN =
  /^(?:(?:以下|这|這)\s*)?([一二两兩三四五六七八九十\d]+)件事(?:是)?(?=[：:,，\s]|$)/u;
const COUNTED_FACT_ASSIGNMENT_PATTERN =
  /^(?!(?:请|請|不要|别|別))[\p{L}\p{N}_.-]{1,40}\s*[=＝]\s*\S(?:.*\S)?$/u;
const COUNTED_FACT_QUESTION_PATTERN = new RegExp(
  `${CHINESE_INTERROGATIVE_ANCHOR_SOURCE}|(?:${CHINESE_INTERROGATIVE_FORMS.particles.join("|")})$`,
  "u",
);
const COUNTED_FACT_POSTPOSED_QUESTION_VALUE_PATTERN = new RegExp(
  `[，,、]\\s*${CHINESE_INTERROGATIVE_ANCHOR_SOURCE}(?:呢|啊|呀)?$`,
  "u",
);
const COUNTED_FACT_CONFIRMATION_PATTERN =
  /(?:正确|正確|对|對|没错|沒錯|可用|能用|能上线|能上線)(?:吗|嗎|么|麼)?\s*$/u;
const COUNTED_FACT_CONFIRMATION_QUESTION_PATTERN =
  /(?:是否|是不是|有没有|有沒有|能否|可否)|(?:吗|嗎|么|麼)\s*$/u;
const COUNTED_FACT_A_NOT_A_QUESTION_PATTERN =
  /(?:对不对|對不對|正确不正确|正確不正確|能不能(?:用|上线|上線)?|可不可以(?:用|上线|上線)?|可不可(?:用|上线|上線)?)\s*$/u;
const CHINESE_CLEAR_TRAILING_QUESTION_PATTERN = new RegExp(
  `(?:${CHINESE_INTERROGATIVE_ANCHOR_SOURCE})(?:呢|啊|呀)?\\s*$|(?:${CHINESE_INTERROGATIVE_FORMS.particles.join("|")})\\s*$`,
  "u",
);
const CHINESE_CONFIRMATION_QUESTION_PATTERN =
  /[，,]\s*(?:对吧|對吧|是吗|是嗎|对不对|對不對)\s*[。！]?$/u;
const CHINESE_NOMINAL_CLAUSE_ASSERTION_PATTERN = new RegExp(
  `^(?:${CHINESE_INTERROGATIVE_ANCHOR_SOURCE})(?:[^?？。！]+(?:取决于|取決於)[^?？。！]+|[^?？。！]+由[^?？。！]+(?:决定|決定)|(?!已(?:经|經)?(?:记录|記錄))[^?？。！]{2,}?(?:已|已经|已經)(?:记录|記錄)(?:在|于|於)[^?？。！]+|[^?？。！]+(?:尚|仍|还|還)?(?:不清楚|不明确|不明確|未知))[。！]?$`,
  "u",
);
const COUNTED_FIRST_PERSON_ASSERTION_PATTERN =
  /^我(?:(?:的[^，。！？；]+(?:是|为|為))|(?:最|更)?(?:喜欢|喜歡|偏好)|(?:叫|是))/u;
const EXPLICIT_FACT_OPT_OUT_PATTERN =
  /^(?:(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你)?)\s*)?(?:不要|别|別)(?:再)?(?:记住|記住|保存|存储|儲存|记录|記錄)/u;
const EXPLICIT_FACT_OPT_OUT_GRAMMAR_PATTERN =
  /(?:(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你)?)\s*)?(?:不要|别|別)(?:再)?(?:记住|記住|保存|存储|儲存|记录|記錄)/u;
const EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN =
  /(?:[，,]\s*|(?:而且|并且|並且|以及|和|但(?:是)?|不过|不過)\s*)(?=(?:(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你)?)\s*)?(?:不要|别|別)(?:再)?(?:记住|記住|保存|存储|儲存|记录|記錄))/u;
const EXPLICIT_FACT_OPT_OUT_CONNECTOR_BOUNDARY_PATTERN =
  /(?:而且|并且|並且|以及|和|但(?:是)?|不过|不過)\s*(?=(?:(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你)?)\s*)?(?:不要|别|別)(?:再)?(?:记住|記住|保存|存储|儲存|记录|記錄))/u;
const CHINESE_REPORTED_DIRECTIVE_PREFIX_PATTERN =
  /(?:^|[。！？.!?]\s*)(?:(?:(?:我|我们|我們|他|她|他们|他們|她们|她們)\s*)?(?:(?:没有|沒有|没|沒|从未|從未|并未|並未)\s*)?(?:说|說|提到|表示|声称|聲稱|要求|请求|請求|写|寫|引用)(?:过|過|了)?(?:\s*(?:这|這|那|这样|這樣|要你|让你|讓你))?|(?:说明|說明|指南|文档|文檔|文件|句子)(?:中|里|裡)?(?:写着|寫著|出现|出現|包含)?)\s*[：:,，]?\s*$/u;

function hasChineseReportedDirectiveScope({
  prefix,
}: DirectiveGrammarMatch): boolean {
  return CHINESE_REPORTED_DIRECTIVE_PREFIX_PATTERN.test(prefix);
}
const CHINESE_BEHAVIORAL_DIRECTIVE_PATTERN =
  /^(?:(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你|您)?)[，,]?\s*)?(?:不要|别|別|避免|优先|優先|保持|用|使用|改用|读取|讀取|写入|寫入|创建|創建|建立|告诉|告訴|回复|回覆|回答|给|給|运行|運行|执行|執行|调用|調用|打开|打開|关闭|關閉|删除|刪除|移动|移動|复制|複製|汇报|彙報|检查|檢查|查看|确认|確認|验证|驗證|总结|總結|概括|修复|修復|实现|實現|解释|解釋|添加|新增|更新|部署|重构|重構)/u;
const CHINESE_DURABLE_BEHAVIORAL_SCOPE_PATTERN =
  /^(?:(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你|您)?)\s*)?(?:以后|以後|今后|今後|始终|始終|总是|總是|每次|每当|每當|永远|永遠|绝不|絕不)/u;
const CHINESE_CORRECTION_PREAMBLE_PATTERN =
  /^(?:纠正|糾正|更正|修正)(?:一下)?(?=\s|[：:,，。]|$)\s*(?:[：:,，。]\s*)?/u;
const CHINESE_OBJECT_FRONTED_BEHAVIORAL_DIRECTIVE_PATTERN =
  /^(?:(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你|您)?)[，,]?\s*)?(?:把|将|將)[^。！？\n]{1,120}?(?:用|使用|读取|讀取|写入|寫入|创建|創建|建立|告诉|告訴|回复|回覆|回答|运行|運行|执行|執行|调用|調用|打开|打開|关闭|關閉|删除|刪除|移动|移動|复制|複製|检查|檢查|查看|确认|確認|验证|驗證)/u;
const CHINESE_ACTION_NOMINAL_ASSERTION_PATTERN =
  /^(?:[^，。！？\s]{1,12}(?:说明|說明|率|状态|狀態|情况|情況|方式|方法|方案|结果|結果|报告|報告|记录|記錄|计划|計畫|进度|進度))(?:是|为|為|在|已|会|會|保持|处于|處於)/u;
const CHINESE_STRUCTURAL_BEHAVIORAL_DIRECTIVE_PATTERN =
  /^[\p{Script=Han}]{1,4}(?:为什么|為什麼|如何|怎么|怎麼)/u;
const CHINESE_CLEAR_BEHAVIORAL_BOUNDARY_PATTERN =
  /^(?:(?:请|請)(?:你|您)?|(?:麻烦|麻煩)(?:你|您)?|不要|别|別|避免|优先|優先|以后|以後|今后|今後|始终|始終|总是|總是|每次|每当|每當|永远|永遠|绝不|絕不|纠正|糾正|更正|修正)/u;
const ORGANIZATION_SUFFIX_PATTERN =
  /(公司|集团|大学|学院|学校|医院|实验室|研究院|研究所|工作室|事务所|委员会|基金会|机构|平台|团队|部门|银行|媒体|出版社|中心)$/u;
const LOCATION_SUFFIX_PATTERN =
  /(省|市|区|县|镇|乡|村|路|街|道|湾|岛|州|国)$/u;
const COMMON_LOCATION_NAMES = new Set([
  "中国",
  "美国",
  "英国",
  "日本",
  "新加坡",
  "北京",
  "上海",
  "广州",
  "深圳",
  "杭州",
  "南京",
  "成都",
  "武汉",
  "西安",
  "重庆",
  "天津",
  "苏州",
  "宁波",
  "厦门",
  "青岛",
  "长沙",
  "郑州",
  "福州",
  "香港",
  "台北",
]);

function cleanValue(value: string): string {
  return value.trim().replace(/[，。！？；,.!?;]+$/u, "").trim();
}

function stripExplicitFactHeaders(value: string): {
  content: string;
  expectedFactCount: number | undefined;
  hasCountedList: boolean;
  hasDirective: boolean;
} | undefined {
  let content = value.trim();
  let hasCountedList = false;
  let hasDirective = false;
  let expectedFactCount: number | undefined = 1;

  while (content.length > 0) {
    const directive = content.match(EXPLICIT_FACT_DIRECTIVE_PATTERN);
    const countedList = directive
      ? null
      : content.match(COUNTED_FACT_LIST_PATTERN);
    const header = directive ?? countedList;
    if (!header) {
      break;
    }

    hasDirective ||= directive !== null;
    hasCountedList ||= countedList !== null;
    if (countedList?.[1]) {
      expectedFactCount = parseChineseFactCount(countedList[1]);
    }
    content = content.slice(header[0].length).trimStart();
  }

  return hasDirective || hasCountedList
    ? {
      content: content.replace(/^[：:,，\s]+/u, ""),
      expectedFactCount,
      hasCountedList,
      hasDirective,
    }
    : undefined;
}

function parseChineseFactCount(value: string): number | undefined {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return numeric;
  }
  const counts: Readonly<Record<string, number>> = {
    一: 1,
    二: 2,
    两: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return counts[value];
}

function cleanExplicitFactContent(value: string): string {
  const withoutLeadingPunctuation = value.replace(/^[：:,，\s]+/u, "");
  const withoutCountedList = stripExplicitFactHeaders(withoutLeadingPunctuation)?.content ??
    withoutLeadingPunctuation;
  return cleanValue(withoutCountedList);
}

function extractChineseOptOutTarget(content: string): string {
  return content
    .replace(EXPLICIT_FACT_OPT_OUT_PATTERN, "")
    .replace(/^[：:,，\s]+/u, "")
    .trim();
}

function splitChineseClauses(text: string): string[] {
  return splitClausesGeneric(text)
    .filter(Boolean)
    .flatMap((clause) =>
      EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) ||
        EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) => isChineseInterrogativeClause(candidate, candidate),
          (candidate) =>
            /[?？]\s*$/u.test(maskQuotedText(candidate)) ||
            CHINESE_CLEAR_TRAILING_QUESTION_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
        )
    )
    .flatMap((clause) =>
      EXPLICIT_FACT_DIRECTIVE_PATTERN.test(clause.trim()) ||
        EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : splitTrailingClause(
          clause,
          (candidate) =>
            classifyChineseBehavioralDirective(candidate) !== "none" ||
            CHINESE_DURABLE_BEHAVIORAL_SCOPE_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
          (candidate) =>
            CHINESE_CLEAR_BEHAVIORAL_BOUNDARY_PATTERN.test(
              maskQuotedText(candidate).trim(),
            ),
          (candidate) =>
            /^(?:请|請|(?:麻烦|麻煩)(?:你|您)?)$/u.test(candidate.trim()),
        )
    )
    .flatMap((clause) =>
      clause.split(EXPLICIT_FACT_OPT_OUT_CONNECTOR_BOUNDARY_PATTERN)
    )
    .map((clause) =>
      isolateDirectiveGrammar(
        clause,
        EXPLICIT_FACT_OPT_OUT_GRAMMAR_PATTERN,
        hasChineseReportedDirectiveScope,
      )
    )
    .flatMap((clause) =>
      EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause.trim())
        ? [clause]
        : clause.split(EXPLICIT_FACT_OPT_OUT_CLAUSE_BOUNDARY_PATTERN)
    )
    .filter(Boolean);
}

function looksLikeCountedFactAssertion(content: string): boolean {
  return COUNTED_FACT_ASSIGNMENT_PATTERN.test(content) ||
    (!COUNTED_FACT_QUESTION_PATTERN.test(content) &&
      COUNTED_FIRST_PERSON_ASSERTION_PATTERN.test(content));
}

function stripChineseInterrogativeRetrievalNoise(text: string): string {
  return replaceUnquotedText(
    replaceUnquotedText(
      text,
      CHINESE_INTERROGATIVE_RETRIEVAL_PATTERN,
      " ",
    ),
    CHINESE_INTERROGATIVE_PARTICLE_RETRIEVAL_PATTERN,
    " ",
  );
}

function isChineseInterrogativeClause(
  content: string,
  source: string,
): boolean {
  const unquotedContent = maskQuotedText(content).trim();
  const unquotedSource = maskQuotedText(source).trim();
  if (CHINESE_CONFIRMATION_QUESTION_PATTERN.test(unquotedContent)) {
    return true;
  }
  const assignmentIndex = content.search(/[=＝]/u);
  if (assignmentIndex >= 0) {
    const left = content.slice(0, assignmentIndex).trim();
    const right = content.slice(assignmentIndex + 1).trim();
    if (COUNTED_FACT_QUESTION_PATTERN.test(left)) {
      return true;
    }
    const assignmentConfirmation =
      COUNTED_FACT_A_NOT_A_QUESTION_PATTERN.test(right) ||
      (COUNTED_FACT_CONFIRMATION_PATTERN.test(right) &&
        COUNTED_FACT_CONFIRMATION_QUESTION_PATTERN.test(right));
    if (assignmentConfirmation) {
      return true;
    }
    if (hasUnterminatedQuote(right)) {
      return true;
    }
    if (isExplicitlyQuotedValue(right)) {
      return false;
    }
    if (COUNTED_FACT_POSTPOSED_QUESTION_VALUE_PATTERN.test(right)) {
      return true;
    }
    if (/[?？]\s*$/u.test(unquotedSource)) {
      return true;
    }
    return false;
  }
  if (
    !/[?？]\s*$/u.test(unquotedSource) &&
    CHINESE_NOMINAL_CLAUSE_ASSERTION_PATTERN.test(unquotedContent) &&
    !COUNTED_FACT_QUESTION_PATTERN.test(
      unquotedContent.replace(CHINESE_LEADING_INTERROGATIVE_ANCHOR_PATTERN, ""),
    )
  ) {
    return false;
  }

  const hasDeclarativeTerminator = /[。.!！]\s*$/u.test(unquotedSource);
  const statementBody = hasDeclarativeTerminator
    ? unquotedContent.replace(/[。.!！]\s*$/u, "").trim()
    : unquotedContent;
  if (
    hasDeclarativeTerminator &&
    !CHINESE_CLEAR_TRAILING_QUESTION_PATTERN.test(statementBody)
  ) {
    return false;
  }

  return /[?？]\s*$/u.test(unquotedSource) ||
    COUNTED_FACT_QUESTION_PATTERN.test(unquotedContent);
}

function analyzeChineseContent(content: string): LanguageContentAnalysis {
  const analysis = analyzeChineseContentBase(content);
  return {
    ...analysis,
    behavioralDirective: classifyChineseBehavioralDirective(
      content,
      analysis,
    ),
    interrogative: isChineseInterrogativeClause(content, content),
  };
}

function classifyChineseBehavioralDirective(
  content: string,
  analysis = analyzeChineseContentBase(content),
): NonNullable<LanguageContentAnalysis["behavioralDirective"]> {
  const trimmed = content.trim();
  if (
    EXPLICIT_FACT_DIRECTIVE_PATTERN.test(trimmed) ||
    EXPLICIT_FACT_OPT_OUT_PATTERN.test(trimmed) ||
    analysis.sourceOfTruthDirective ||
    /^我(?:更)?(?:喜欢|喜歡|偏好)/u.test(trimmed)
  ) {
    return "none";
  }

  const unquoted = maskQuotedText(trimmed).trim();
  if (!unquoted) {
    return "none";
  }
  const correctionMatch = unquoted.match(CHINESE_CORRECTION_PREAMBLE_PATTERN);
  const corrected = correctionMatch
    ? unquoted.slice(correctionMatch[0].length).trim()
    : unquoted;
  if (!corrected) {
    return correctionMatch ? "one_off" : "none";
  }
  const directiveBody = corrected
    .replace(CHINESE_DURABLE_BEHAVIORAL_SCOPE_PATTERN, "")
    .replace(/^[：:,，;；\s]+/u, "");
  const nominalAction = CHINESE_ACTION_NOMINAL_ASSERTION_PATTERN.test(directiveBody);
  const isBehavioralDirective =
    !nominalAction &&
    (CHINESE_BEHAVIORAL_DIRECTIVE_PATTERN.test(corrected) ||
      CHINESE_BEHAVIORAL_DIRECTIVE_PATTERN.test(directiveBody) ||
      CHINESE_OBJECT_FRONTED_BEHAVIORAL_DIRECTIVE_PATTERN.test(corrected) ||
      CHINESE_OBJECT_FRONTED_BEHAVIORAL_DIRECTIVE_PATTERN.test(directiveBody) ||
      CHINESE_STRUCTURAL_BEHAVIORAL_DIRECTIVE_PATTERN.test(directiveBody));
  if (
    CHINESE_DURABLE_BEHAVIORAL_SCOPE_PATTERN.test(corrected) &&
    isBehavioralDirective
  ) {
    return "durable";
  }
  return isBehavioralDirective ? "one_off" : "none";
}

function extractExplicitFactClauses(content: string) {
  const trimmed = content.trim();
  if (EXPLICIT_FACT_OPT_OUT_PATTERN.test(trimmed)) {
    return {
      clauses: [{ content: trimmed, disposition: "feedback" as const }],
      status: "complete" as const,
    };
  }

  const headers = stripExplicitFactHeaders(content);
  if (!headers) {
    return undefined;
  }

  if (headers.expectedFactCount === undefined) {
    return { clauses: [], status: "invalid" as const };
  }

  const clauses = splitChineseClauses(headers.content)
    .map((source) => ({
      content: cleanExplicitFactContent(source),
      source,
    }))
    .filter(({ content: clause }) => clause.length > 0);

  if (clauses.length < headers.expectedFactCount) {
    return headers.hasCountedList
      ? {
        clauses: clauses.map(({ content: clause }) => ({
          content: clause,
          disposition: EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause)
            ? "feedback" as const
            : "fact" as const,
        })),
        status: "incomplete-counted-list" as const,
      }
      : { clauses: [], status: "invalid" as const };
  }
  if (clauses.some(({ content: clause, source }) =>
    !EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause) &&
    isChineseInterrogativeClause(clause, source)
  )) {
    return { clauses: [], status: "invalid" as const };
  }

  if (
    !headers.hasDirective &&
    (
      !headers.hasCountedList ||
      clauses.some(({ content: clause }) => !looksLikeCountedFactAssertion(clause))
    )
  ) {
    return { clauses: [], status: "invalid" as const };
  }

  return {
    clauses: clauses
      .slice(0, headers.expectedFactCount)
      .map(({ content: clause }) => ({
        content: clause,
        disposition: EXPLICIT_FACT_OPT_OUT_PATTERN.test(clause)
          ? "feedback" as const
          : "fact" as const,
      })),
    status: "complete" as const,
  };
}

function normalizeChineseUndergradSubject(value: string | undefined): string {
  if (!value) {
    return "本科";
  }

  const cleaned = cleanValue(value);
  if (/(?:计算机|CS|Computer Science)/iu.test(cleaned)) {
    return "计算机本科";
  }

  return `${cleaned}本科`;
}

function looksLikeDogBreed(value: string): boolean {
  return /(金毛|拉布拉多|贵宾|柴犬|哈士奇|牧羊犬|斗牛犬|犬|Retriever|Poodle|Beagle|Bulldog)/iu.test(
    value,
  );
}

function createProfileCandidate(
  index: number,
  nextId: () => string,
  profileField: ProfileField,
  content: string,
): MemoryCandidate {
  return {
    id: nextId(),
    kindHint: "profile",
    explicitness: "explicit",
    content,
    sourceMessageIndex: index,
    sourceRole: "user",
    metadata: {
      profileField,
    },
  };
}

function createFactCandidate(
  index: number,
  nextId: () => string,
  content: string,
  categoryOverride?: "project" | "technical" | "personal" | "relationship" | "event",
  metadata?: MemoryCandidateMetadata,
): MemoryCandidate {
  return {
    id: nextId(),
    kindHint: "fact",
    explicitness: "explicit",
    content,
    sourceMessageIndex: index,
    sourceRole: "user",
    metadata: {
      ...buildFactMetadata(content, categoryOverride),
      ...metadata,
    },
  };
}

function deriveFactCategory(
  content: string,
): "project" | "technical" | "personal" | "relationship" | "event" {
  if (
    /(工作流|项目|流程|手册|剧本|迁移|上线|发布|审批|待办|阻塞|卡点|交接)/u.test(content)
  ) {
    return "project";
  }

  if (/(接口|运行时|错误|报错|构建|模式|schema|数据库|服务)/iu.test(content)) {
    return "technical";
  }

  if (/(家人|伴侣|朋友)/u.test(content)) {
    return "relationship";
  }

  if (/(旅行|活动|会议)/u.test(content)) {
    return "event";
  }

  return "personal";
}

function deriveFeedbackKind(
  content: string,
  analysis?: LanguageContentAnalysis,
): "do" | "dont" | "prefer" {
  if (analysis?.feedbackKind) {
    return analysis.feedbackKind === "validated_pattern"
      ? "do"
      : analysis.feedbackKind;
  }

  if (/(不要|别|別|禁止)/u.test(content)) {
    return "dont";
  }

  if (/(偏好|更喜欢|更喜歡|优先|優先)/u.test(content)) {
    return "prefer";
  }

  return "do";
}

function extractStableSubject(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = cleanValue(value)
    .replace(/^(当前|目前|现在|这个|该)/u, "")
    .replace(/\s+/gu, " ")
    .trim();

  return cleaned.length >= 2 ? cleaned : undefined;
}

function extractFactSubject(content: string): string | undefined {
  const matches = [
    content.match(/(?:为了|关于|针对)\s*([^，。！？；]+)/u),
    content.match(/(?:在|于)\s*([^，。！？；]+)(?:上|中)/u),
    content.match(/是\s*([^，。！？；]+?)\s*的[^，。！？；]+/u),
  ];

  for (const match of matches) {
    if (match?.[1]) {
      return extractStableSubject(match[1]);
    }
  }

  return undefined;
}

function extractReferenceSubject(content: string): string | undefined {
  const matches = [
    content.match(/(?:关于|针对)\s*([^，。！？；]+)/u),
    content.match(/([^，。！？；]+?)\s*(?:现在)?以\s*[A-Za-z0-9_./-]+\.[A-Za-z0-9]+\s*(?:为准|作为事实来源)/u),
  ];

  for (const match of matches) {
    if (match?.[1]) {
      const subject = extractStableSubject(match[1]);
      if (
        subject &&
        !CHINESE_REFERENCE_SUBJECT_NOISE_PATTERN.test(subject) &&
        (CHINESE_REFERENCE_SUBJECT_HINT_PATTERN.test(subject) ||
          /[A-Za-z0-9][A-Za-z0-9 _-]{1,}/u.test(subject))
      ) {
        return subject;
      }
    }
  }

  return undefined;
}

function deriveFactKind(content: string): FactKind | undefined {
  if (/(我当前角色是|我的角色是)/u.test(content)) {
    return "role_update";
  }

  if (/(我当前重点是|当前重点是|当前关注是|当前关注点是)/u.test(content)) {
    return "focus_update";
  }

  if (/(阻塞|卡住|审批)/u.test(content)) {
    return "blocker";
  }

  if (/(开环|待办|未完成|签收|验收|验证)/u.test(content)) {
    return "open_loop";
  }

  if (/(待确认|待处理|待跟进|待完成|待评审|仍需|还需|剩余|尚待|待 review)/u.test(content)) {
    return "project_state";
  }

  if (deriveFactCategory(content) === "project" || deriveFactCategory(content) === "technical") {
    return "generic_project";
  }

  return undefined;
}

function deriveFactScopeKind(
  category: ReturnType<typeof deriveFactCategory>,
  factKind: FactKind | undefined,
): MemoryScopeKind | undefined {
  if (factKind === "role_update") {
    return "identity";
  }

  if (
    factKind === "focus_update" ||
    factKind === "blocker" ||
    factKind === "open_loop" ||
    factKind === "project_state" ||
    factKind === "generic_project"
  ) {
    return "project";
  }

  if (category === "personal" || category === "relationship" || category === "event") {
    return "identity";
  }

  if (category === "project" || category === "technical") {
    return "project";
  }

  return undefined;
}

function buildFactMetadata(
  content: string,
  categoryOverride?: "project" | "technical" | "personal" | "relationship" | "event",
): MemoryCandidateMetadata {
  const category = categoryOverride ?? deriveFactCategory(content);
  const factKind = deriveFactKind(content);

  return {
    category,
    factKind,
    scopeKind: deriveFactScopeKind(category, factKind),
    subject: extractFactSubject(content) ?? "unknown",
  };
}

function cleanActivityTarget(value: string): string {
  return cleanValue(value)
    .replace(/^(一些|一个|一份|这个|那个|新的?)/u, "")
    .trim();
}

function extractChineseOccurrenceEvent(
  content: string,
  context: {
    locale: string;
    observedAt?: string;
    timezone?: string;
  },
): { content: string; occurrenceExpression: ReturnType<typeof parseChineseTemporalExpressions>[number] } | undefined {
  if (
    /[?？]/u.test(content) ||
    CHINESE_CONFIRMATION_QUESTION_PATTERN.test(content) ||
    /(?:什么|什麼|谁|誰|哪里|哪裡|何时|何時|为何|為何|为什么|為什麼|怎么|怎麼)(?:呢|啊|呀)?[。！]?$|(?:吗|嗎|么|麼|呢)[。！]?$/u.test(
      content,
    )
  ) {
    return undefined;
  }
  const maskedLiterals = maskQuotedTemporalLiterals(content);
  const occurrenceExpression = parseChineseTemporalExpressions(maskedLiterals)[0];
  if (!occurrenceExpression) {
    return undefined;
  }

  const expressionIndex = maskedLiterals.indexOf(occurrenceExpression.raw);
  const before = content.slice(0, expressionIndex).replace(/(?:在|于|於)\s*$/u, "");
  const after = content.slice(expressionIndex + occurrenceExpression.raw.length)
    .replace(/^\s*[，,]\s*/u, "");
  const canonical = `${before}${after}`.trim();
  const canonicalize = canResolveOccurrenceExpression({
    ...context,
    expression: occurrenceExpression,
  });

  return COMPLETED_FIRST_PERSON_EVENT_PATTERN.test(canonical)
    ? {
      content: canonicalize ? canonical : content,
      occurrenceExpression,
    }
    : undefined;
}

function cleanProjectTarget(value: string): string {
  return cleanValue(value)
    .replace(/^(一个|一项|这个|该)/u, "")
    .trim();
}

function createOpenLoopFactCandidate(
  index: number,
  nextId: () => string,
  content: string,
  subject: string,
): MemoryCandidate {
  return createFactCandidate(index, nextId, content, "personal", {
    category: "personal",
    factKind: "open_loop",
    scopeKind: "identity",
    subject: extractStableSubject(subject) ?? "unknown",
  });
}

function createGenericProjectFactCandidate(
  index: number,
  nextId: () => string,
  content: string,
  subject: string,
): MemoryCandidate {
  return createFactCandidate(index, nextId, content, "project", {
    category: "project",
    factKind: "generic_project",
    scopeKind: "project",
    subject: extractStableSubject(subject) ?? "project",
  });
}

function looksLikeDurableInferredFact(content: string): boolean {
  return DURABLE_INFERENCE_PATTERNS.some((pattern) => pattern.test(content));
}

function classifyWorkContextSubject(
  value: string,
): "organization" | "location" | "unknown" {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return "unknown";
  }

  if (
    COMMON_LOCATION_NAMES.has(cleaned) ||
    LOCATION_SUFFIX_PATTERN.test(cleaned)
  ) {
    return "location";
  }

  if (
    ORGANIZATION_SUFFIX_PATTERN.test(cleaned) ||
    /[A-Za-z]/u.test(cleaned) ||
    /\d/u.test(cleaned)
  ) {
    return "organization";
  }

  // Work-subject-only phrasing is semantically ambiguous in Chinese.
  // Prefer abstaining to avoid corrupting canonical profile memory.
  return "unknown";
}

function createWorkContextCandidate(
  index: number,
  nextId: () => string,
  value: string,
): MemoryCandidate | null {
  const cleaned = cleanValue(value);
  const classification = classifyWorkContextSubject(cleaned);

  if (classification === "organization") {
    return createProfileCandidate(index, nextId, "organization", cleaned);
  }

  if (classification === "location") {
    return createProfileCandidate(index, nextId, "location", cleaned);
  }

  return null;
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  return candidates.filter((candidate, candidateIndex, all) => {
    return (
      all.findIndex((other) => {
        return (
          other.kindHint === candidate.kindHint &&
          other.content === candidate.content &&
          other.metadata?.profileField === candidate.metadata?.profileField &&
          other.metadata?.preferenceCategory === candidate.metadata?.preferenceCategory &&
          other.metadata?.referencePointer === candidate.metadata?.referencePointer &&
          other.metadata?.supersedesPointer === candidate.metadata?.supersedesPointer
        );
      }) === candidateIndex
    );
  });
}

function shouldSkipExplicitFactForProfileLikeClause(
  factContent: string,
  candidates: MemoryCandidate[],
): boolean {
  if (!candidates.some((candidate) => candidate.kindHint === "profile")) {
    return false;
  }

  return !/(阻塞|卡住|事实来源|为准|工作流|项目|流程|迁移|审批|待办|上线)/u.test(
    factContent,
  );
}

function maybeExtractCandidatesFromClause(
  content: string,
  index: number,
  nextId: () => string,
  analysis?: LanguageContentAnalysis,
  explicitFact = false,
  occurrenceContext?: {
    locale: string;
    observedAt?: string;
    timezone?: string;
  },
): MemoryCandidate[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (EXPLICIT_FACT_OPT_OUT_PATTERN.test(trimmed)) {
    return [{
      content: trimmed,
      explicitness: "explicit",
      id: nextId(),
      kindHint: "feedback",
      metadata: {
        appliesTo: "general_response",
        feedbackKind: analysis?.feedbackKind,
      },
      sourceMessageIndex: index,
      sourceRole: "user",
    }];
  }

  if (!explicitFact && analysis?.behavioralDirective === "one_off") {
    return [];
  }
  if (!explicitFact && analysis?.behavioralDirective === "durable") {
    return [{
      id: nextId(),
      kindHint: "feedback",
      explicitness: "explicit",
      content: trimmed,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        feedbackKind: deriveFeedbackKind(trimmed, analysis),
        appliesTo: "general_response",
      },
    }];
  }

  const occurrenceEvent = extractChineseOccurrenceEvent(
    trimmed,
    occurrenceContext ?? { locale: "zh-CN" },
  );
  if (occurrenceEvent) {
    return [createFactCandidate(
      index,
      nextId,
      occurrenceEvent.content,
      "event",
      { occurrenceExpression: occurrenceEvent.occurrenceExpression },
    )];
  }

  const candidates: MemoryCandidate[] = [];

  const currentGoal = trimmed.match(
    /我(?:的)?(?:目前|当前|當前|现在|現在)?(?:的)?(?:目标|目標|优先事项|優先事項)(?:是|为|為)\s*([^，。！？；]+)/u,
  )?.[1];
  if (currentGoal) {
    candidates.push(createFactCandidate(
      index,
      nextId,
      cleanValue(currentGoal),
      undefined,
      {
        category: "goal",
        factKind: "focus_update",
        scopeKind: "project",
      },
    ));
  }

  const nameMatch = trimmed.match(
    /(?:请记住|請記住)?我(?:(?:的)?(?:名字|姓名)(?:是|叫)|叫)\s*([^\s，。！？；]+)/u,
  );
  if (nameMatch?.[1]) {
    candidates.push(createProfileCandidate(index, nextId, "name", cleanValue(nameMatch[1])));
  }

  const timezoneMatch = trimmed.match(
    /我(?:的)?(?:时区|時區)是\s*([A-Za-z0-9_./+-]+)/u,
  );
  if (timezoneMatch?.[1]) {
    candidates.push(
      createProfileCandidate(index, nextId, "timezone", cleanValue(timezoneMatch[1])),
    );
  }

  const languageMatch = trimmed.match(/(?:我的?常用语言是|我的?语言是)\s*([^，。！？；]+)/u);
  if (languageMatch?.[1]) {
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "languagePreference",
        cleanValue(languageMatch[1]),
      ),
    );
  }

  const orgAndRoleMatch = trimmed.match(/我在\s*([^，。！？；]+?)\s*(?:工作|上班|任职)[，,]?\s*我是\s*([^，。！？；]+)/u);
  if (orgAndRoleMatch?.[1] && orgAndRoleMatch?.[2]) {
    const workContextCandidate = createWorkContextCandidate(
      index,
      nextId,
      orgAndRoleMatch[1],
    );
    if (workContextCandidate) {
      candidates.push(workContextCandidate);
    }
    candidates.push(
      createProfileCandidate(index, nextId, "role", cleanValue(orgAndRoleMatch[2])),
    );
  } else {
    const organizationMatch = trimmed.match(/我在\s*([^，。！？；]+?)\s*(?:工作|上班|任职)/u);
    if (organizationMatch?.[1]) {
      const workContextCandidate = createWorkContextCandidate(
        index,
        nextId,
        organizationMatch[1],
      );
      if (workContextCandidate) {
        candidates.push(workContextCandidate);
      }
    }

    const roleMatch = trimmed.match(/(?:请记住)?我是\s*([^，。！？；]+)/u);
    if (roleMatch?.[1]) {
      candidates.push(createProfileCandidate(index, nextId, "role", cleanValue(roleMatch[1])));
    }
  }

  const currentProjectMatch = trimmed.match(/我(?:现在|目前|正在)?(?:在做|负责|推进)\s*([^，。！？；]+)/u);
  if (currentProjectMatch?.[1]) {
    candidates.push(
      createProfileCandidate(
        index,
        nextId,
        "currentProject",
        cleanValue(currentProjectMatch[1]),
      ),
    );
  }

  const locationMatch = trimmed.match(/我在\s*([^，。！？；]+?)\s*(?:生活|居住|办公)/u);
  if (locationMatch?.[1]) {
    candidates.push(
      createProfileCandidate(index, nextId, "location", cleanValue(locationMatch[1])),
    );
  }

  const educationDegreeMatch = trimmed.match(EDUCATION_DEGREE_PATTERN);
  if (educationDegreeMatch?.[1]) {
    const degree = cleanValue(educationDegreeMatch[1]);
    candidates.push(
      createFactCandidate(index, nextId, `我毕业于${degree}。`, "personal"),
    );
  }

  const petNameMatch =
    trimmed.match(PET_NAME_PATTERN) ??
    trimmed.match(PET_NAME_SHORT_PATTERN);
  if (petNameMatch?.[1] && petNameMatch?.[2]) {
    const pet = cleanValue(petNameMatch[1]);
    const name = cleanValue(petNameMatch[2]);
    candidates.push(
      createFactCandidate(index, nextId, `我的${pet}叫${name}。`, "personal", {
        category: "personal",
        scopeKind: "identity",
        subject: `${pet}名字`,
      }),
    );
  }

  const dogBreedMatch = trimmed.match(DOG_BREED_PATTERN);
  if (dogBreedMatch?.[2] && looksLikeDogBreed(dogBreedMatch[2])) {
    const name = dogBreedMatch[1] ? cleanValue(dogBreedMatch[1]) : "";
    const breed = cleanValue(dogBreedMatch[2]);
    candidates.push(
      createFactCandidate(index, nextId, `我的狗${name}是${breed}。`, "personal", {
        category: "personal",
        scopeKind: "identity",
        subject: "狗品种",
      }),
    );
  }

  const undergradInstitutionMatch =
    trimmed.match(UNDERGRAD_INSTITUTION_WITH_SUBJECT_PATTERN) ??
    trimmed.match(UNDERGRAD_INSTITUTION_PATTERN);
  if (undergradInstitutionMatch?.[1]) {
    const institution = cleanValue(undergradInstitutionMatch[1]);
    const subject = normalizeChineseUndergradSubject(undergradInstitutionMatch[2]);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `我的${subject}学校是${institution}。`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject,
        },
      ),
    );
  }

  const firstPersonUseMatch = trimmed.match(FIRST_PERSON_USE_PATTERN);
  if (firstPersonUseMatch?.[1]) {
    const target = cleanActivityTarget(firstPersonUseMatch[1]);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `我使用${target}。`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractStableSubject(target) ?? "个人使用",
        },
      ),
    );
  }

  const personalAttributeMatch = trimmed.match(PERSONAL_ATTRIBUTE_PATTERN);
  if (personalAttributeMatch?.[1] && personalAttributeMatch[2]) {
    const subject = cleanValue(personalAttributeMatch[1]);
    const value = cleanValue(personalAttributeMatch[2]);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `我的${subject}需要${value}。`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: extractStableSubject(subject) ?? subject,
        },
      ),
    );
  }

  const openLoopMatch = trimmed.match(OPEN_LOOP_PATTERN);
  if (openLoopMatch?.[1]) {
    const task = cleanActivityTarget(openLoopMatch[1]);
    candidates.push(
      createOpenLoopFactCandidate(
        index,
        nextId,
        `我仍需${task}。`,
        task,
      ),
    );
  }

  const plannedOpenLoopMatch = trimmed.match(PLANNED_OPEN_LOOP_PATTERN);
  if (plannedOpenLoopMatch?.[1]) {
    const task = cleanActivityTarget(plannedOpenLoopMatch[1]);
    candidates.push(
      createOpenLoopFactCandidate(
        index,
        nextId,
        `我仍需${task}。`,
        task,
      ),
    );
  }

  const projectActivityMatch = trimmed.match(PROJECT_ACTIVITY_PATTERN);
  const recentEventMatch = trimmed.match(RECENT_EVENT_PATTERN);
  if (recentEventMatch?.[1] && !projectActivityMatch) {
    const event = cleanActivityTarget(recentEventMatch[1]);
    candidates.push(
      createFactCandidate(index, nextId, `我${event}。`, "event"),
    );
  }

  const personalBestTimeMatch = trimmed.match(PERSONAL_BEST_TIME_PATTERN);
  if (personalBestTimeMatch?.[2]) {
    const event = personalBestTimeMatch[1]
      ? cleanValue(personalBestTimeMatch[1])
      : "";
    const time = cleanValue(personalBestTimeMatch[2]);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `我${event ? `在${event}` : ""}的个人最好成绩是${time}。`,
        "personal",
        {
          category: "personal",
          scopeKind: "identity",
          subject: event || "个人最好成绩",
        },
      ),
    );
  }

  const learningWithToolMatch = trimmed.match(LEARNING_WITH_TOOL_PATTERN);
  if (learningWithToolMatch?.[1] && learningWithToolMatch?.[2]) {
    const topic = cleanActivityTarget(learningWithToolMatch[1]);
    const tool = cleanValue(learningWithToolMatch[2]);
    candidates.push(
      createFactCandidate(
        index,
        nextId,
        `我用${tool}学习${topic}。`,
        "personal",
      ),
    );
  }

  const userIdentityMatch = trimmed.match(USER_IDENTITY_PATTERN);
  if (userIdentityMatch?.[1]) {
    const identity = cleanValue(userIdentityMatch[1]);
    candidates.push(
      createFactCandidate(index, nextId, `我是${identity}用户。`, "personal", {
        category: "personal",
        scopeKind: "identity",
        subject: extractStableSubject(identity) ?? identity,
      }),
    );
  }

  const currentProjectInvolvementMatch = trimmed.match(
    CURRENT_PROJECT_INVOLVEMENT_PATTERN,
  );
  if (currentProjectInvolvementMatch?.[1]) {
    const project = cleanProjectTarget(currentProjectInvolvementMatch[1]);
    candidates.push(
      createGenericProjectFactCandidate(
        index,
        nextId,
        `我正在做${project}。`,
        project,
      ),
    );
  }

  const projectLeadershipMatch = trimmed.match(PROJECT_LEADERSHIP_PATTERN);
  if (projectLeadershipMatch?.[1]) {
    const leadership = cleanProjectTarget(projectLeadershipMatch[1]);
    candidates.push(
      createGenericProjectFactCandidate(
        index,
        nextId,
        `我主导了${leadership}。`,
        leadership,
      ),
    );
  }

  if (projectActivityMatch?.[1] && projectActivityMatch[2]) {
    const action = projectActivityMatch[1];
    const activity = cleanProjectTarget(projectActivityMatch[2]);
    candidates.push(
      createGenericProjectFactCandidate(
        index,
        nextId,
        `我${action}${activity}。`,
        activity,
      ),
    );
  }

  const relationRelocationMatch = trimmed.match(RELATION_RELOCATION_PATTERN);
  if (relationRelocationMatch?.[1] && relationRelocationMatch?.[2]) {
    const name = cleanValue(relationRelocationMatch[1]);
    const location = cleanValue(relationRelocationMatch[2]);
    candidates.push(
      createFactCandidate(index, nextId, `${name}搬到了${location}。`, "relationship", {
        category: "relationship",
        scopeKind: "identity",
        subject: name,
      }),
    );
  }

  const preferenceMatch = trimmed.match(/我(?:更)?(?:喜欢|偏好)\s*([^，。！？；]+)/u);
  const explicitFactMatch = explicitFact ? trimmed : undefined;
  if (explicitFactMatch !== undefined) {
    const factContent = cleanExplicitFactContent(explicitFactMatch);
    if (
      factContent.length > 0 &&
      !preferenceMatch &&
      !candidates.some(({ kindHint }) => kindHint === "fact") &&
      !shouldSkipExplicitFactForProfileLikeClause(factContent, candidates)
    ) {
      candidates.push({
        id: nextId(),
        kindHint: "fact",
        explicitness: "explicit",
        content: factContent,
        sourceMessageIndex: index,
        sourceRole: "user",
        metadata: {
          ...buildFactMetadata(factContent),
        },
      });
    }
  }

  if (preferenceMatch?.[1]) {
    const preferenceValue = cleanValue(preferenceMatch[1]);
    candidates.push({
      id: nextId(),
      kindHint: "preference",
      explicitness: "explicit",
      content: preferenceValue,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        preferenceCategory: "response_style",
        preferenceValue,
      },
    });
  }

  if (candidates.length === 0 && trimmed.length >= 8 && looksLikeDurableInferredFact(trimmed)) {
    candidates.push({
      id: nextId(),
      kindHint: "fact",
      explicitness: "inferred",
      content: trimmed,
      sourceMessageIndex: index,
      sourceRole: "user",
      metadata: {
        ...buildFactMetadata(trimmed),
      },
    });
  }

  return dedupeCandidates(candidates);
}

export function createChineseLanguagePack(script: ChineseScript): LanguagePack {
  const locale = script === "Hant" ? "zh-Hant" : "zh-CN";
  return {
    analyzerVersion: CHINESE_ANALYZER_VERSION,
    apiVersion: 1,
    compatibilityGroup: `zh-${script}`,
    defaultLocale: locale,
    id: `zh-${script}`,
    locales: script === "Hant"
      ? ["zh-Hant", "zh-TW", "zh-HK", "zh-MO"]
      : ["zh-Hans", "zh-CN", "zh-SG"],
    detect({ texts }) {
      return detectChinese(texts, script);
    },
    splitClauses(text: string): string[] {
      return splitChineseClauses(text);
    },
    normalizeForEquality(text: string): string {
      return normalizeChineseForEquality(text);
    },
    splitSentences(text: string): string[] {
      return splitSentencesGeneric(text);
    },
    tokenizeForScoring(
      text: string,
      _mode: "bm25" | "overlap",
      options?: { excludeStopwords?: boolean },
    ): string[] {
      const tokens = tokenizeChineseForScoring(text, locale);
      if (options?.excludeStopwords) {
        return tokenizeChineseForScoring(
          stripChineseInterrogativeRetrievalNoise(text),
          locale,
        ).filter((token) => !CHINESE_STOPWORDS.has(token));
      }
      return tokens;
    },
    buildSearchTerms(text: string): string[] {
      return buildChineseSearchTerms(
        stripChineseInterrogativeRetrievalNoise(text),
        locale,
      ).filter(
        (token) => !CHINESE_STOPWORDS.has(token),
      );
    },
    decomposeQuery: decomposeChineseQuery,
    analyzeBehavioralRule(text) {
      return analyzeBehavioralRuleWithPatterns(text, BEHAVIORAL_RULE_PATTERNS);
    },
    analyzeQuery: analyzeChineseQuery,
    analyzeContent(content) {
      return analyzeChineseContent(content);
    },
    parseTemporalExpressions: parseChineseTemporalExpressions,
    extractEntityMentions: extractChineseEntityMentions,
    matchesEntityAlias(query, alias) {
      return matchesNormalizedEntityAlias(
        query,
        alias,
        normalizeChineseForEquality,
      );
    },
    acceptsEntityCandidate() {
      return true;
    },
    deriveDurableTarget(candidate) {
      return deriveLanguageDurableTarget(
        candidate,
        CHINESE_DURABLE_TARGET_ALIASES,
      );
    },
    render(input) {
      return renderChinese(input, script);
    },
    extractCandidates(input: LanguageCandidateExtractionInput): MemoryCandidate[] {
      const candidates: MemoryCandidate[] = [];

      input.messages.forEach((message, index) => {
        if (message.role !== "user") {
          return;
        }

        const sourceMessageIndex = message.sourceMessageIndex ?? index;
        const canonicalSourceAnalysis = analyzeChineseContent(message.content);
        const sourceAnalysis = {
          ...(message.analysis ?? canonicalSourceAnalysis),
          behavioralDirective: canonicalSourceAnalysis.behavioralDirective,
          interrogative: canonicalSourceAnalysis.interrogative,
        };
        const clauses = expandExplicitFactCandidateClauses(
          message.content,
          extractExplicitFactClauses,
          splitChineseClauses,
        );
        for (const clause of clauses) {
          const clauseAnalysis = clauses.length === 1 && clause.content === message.content
            ? sourceAnalysis
            : analyzeChineseContent(clause.content);
          if (clause.disposition === "feedback") {
            const optOutTarget = extractChineseOptOutTarget(clause.content);
            candidates.push({
              id: input.nextId(),
              kindHint: "feedback",
              explicitness: "explicit",
              content: clause.content.trim(),
              disposition: createLanguageDurableOptOutDisposition(
                optOutTarget,
                CHINESE_DURABLE_TARGET_ALIASES,
              ),
              sourceMessageIndex,
              sourceRole: "user",
              metadata: {
                feedbackKind: "dont",
                appliesTo: "general_response",
              },
            });
            continue;
          }
          if (
            clause.disposition === "ordinary" &&
            (isChineseInterrogativeClause(clause.content, clause.content) ||
              clauseAnalysis.behavioralDirective === "one_off")
          ) {
            continue;
          }
          const sourceOfTruthReference = createSourceOfTruthReferenceCandidate({
            analysis: clauseAnalysis,
            nextId: input.nextId,
            sourceMessageIndex,
            subject: extractReferenceSubject(clause.content) ?? "unknown",
          });
          if (sourceOfTruthReference) {
            candidates.push(sourceOfTruthReference);
          }
          const clauseCandidates = maybeExtractCandidatesFromClause(
            clause.content,
            sourceMessageIndex,
            input.nextId,
            clauseAnalysis,
            clause.disposition === "fact",
            {
              locale: input.locale,
              observedAt: message.observedAt,
              timezone: message.timezone,
            },
          );
          candidates.push(...(sourceOfTruthReference
            ? clauseCandidates.filter(
              ({ explicitness, kindHint }) =>
                kindHint !== "fact" || explicitness !== "inferred",
            )
            : clauseCandidates));
        }
      });

      return candidates.map((candidate) =>
        attachLanguageDurableTarget(
          candidate,
          CHINESE_DURABLE_TARGET_ALIASES,
        )
      );
    },
  };
}
