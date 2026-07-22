import type { LanguageBehavioralRuleAnalysis } from "./contracts";
import {
  analyzeBehavioralRuleWithPatterns,
  type BehavioralRulePatterns,
} from "./packHelpers";

const FILE_ARTIFACT_PATTERN =
  /[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,8}|\.[A-Za-z0-9]{2,8}/u;

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function extractQuotedFragment(
  rule: string,
  kind: "prefix" | "suffix",
): string | undefined {
  const patterns = kind === "prefix"
    ? [
        /\b(?:start|begin)(?:[^"'`]+)?with\s+["'`]([^"'`]+)["'`]/iu,
        /\b(?:open|greet)(?:[^"'`]+)?with\s+["'`]([^"'`]+)["'`]/iu,
        /\b(?:use|with|and)\s+["'`]([^"'`]+)["'`]\s+as\s+the\s+(?:opener|greeting)/iu,
      ]
    : [
        /\b(?:end|close|sign off)(?:[^"'`]+)?with\s+["'`]([^"'`]+)["'`]/iu,
        /\b(?:use|and)\s+["'`]([^"'`]+)["'`]\s+as\s+the\s+closing/iu,
        /\bsign off(?:[^"'`]+)?as\s+["'`]([^"'`]+)["'`]/iu,
      ];

  for (const pattern of patterns) {
    const value = rule.match(pattern)?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return kind === "prefix"
    ? rule.match(/^(?:Subject:[^\n]*|Dear [^,\n]+,|Greetings,)/iu)?.[0]
    : rule.match(/(?:Regards,|Sincerely,)[^]*$/iu)?.[0];
}

function extractFormatSurface(
  rule: string,
): LanguageBehavioralRuleAnalysis["formatSurface"] {
  const prefixes = uniqueStrings([
    rule.match(/^Subject:[^\n]*/iu)?.[0],
    rule.match(/^Dear [^,\n]+,/iu)?.[0],
    rule.match(/^Greetings,/iu)?.[0],
  ]);
  const suffixes = uniqueStrings([
    rule.match(/Regards,[^]*$/iu)?.[0],
    rule.match(/Sincerely,[^]*$/iu)?.[0],
  ]);
  return prefixes.length > 0 || suffixes.length > 0
    ? { prefixes, suffixes }
    : undefined;
}

function withSenderNamePlaceholder(
  fragment: string | undefined,
  rule: string,
): string | undefined {
  if (
    !fragment ||
    !/\b(?:plus\s+your\s+name|followed\s+by\s+the\s+sender'?s\s+name)\b/iu.test(rule) ||
    /\bname\b/iu.test(fragment)
  ) {
    return fragment;
  }
  return `${fragment}\nName`;
}

function extractRequiredFragments(rule: string): string[] {
  return uniqueStrings([
    ...[...rule.matchAll(/["'`]([^"'`]+)["'`]/gu)].map((match) =>
      match[1]?.trim()
    ),
    /\bsubject line\b/iu.test(rule) ? "Subject:" : undefined,
  ]);
}

function extractForbiddenFragments(rule: string): string[] {
  const explicit = [
    ...[...rule.matchAll(
      /\bavoid\s+(?:the\s+)?(?:term|phrase)\s+["'`]([^"'`]+)["'`]/giu,
    )].map((match) => match[1]?.trim()),
    ...[...rule.matchAll(
      /\bavoid\s+(?:the\s+)?term\s+([A-Za-z][A-Za-z0-9_-]*)\b/giu,
    )].map((match) => match[1]?.trim()),
    ...[...rule.matchAll(
      /\b(?:[Aa]void|[Dd]o\s+not\s+use|[Dd]on't\s+use|[Nn]ever\s+use)\s+([A-Z][A-Za-z0-9_]*|[a-z]+_[a-z0-9_]*)\b/gu,
    )].map((match) => match[1]?.trim()),
    ...[...rule.matchAll(
      /\b[Ii]nstead\s+of\s+([A-Z][A-Za-z0-9_]*|[a-z]+_[a-z0-9_]*)\b/gu,
    )].map((match) => match[1]?.trim()),
  ];
  const firstPersonOnly =
    /\b(?:answer|respond|speak|write)[^.。;:]*\bonly\s+in\s+first[-\s]?person\b|\b(?:only|strictly)\s+first[-\s]?person\b|\bonly\s+first[-\s]?person\s+pronouns?\b|\bfirst[-\s]?person\s+pronouns?\s+only\b|\bstrictly\s+(?:in|to)\s+first[-\s]?person\b/iu
      .test(rule);
  return uniqueStrings([
    ...explicit,
    ...(firstPersonOnly
      ? [
          "you",
          "your",
          "yours",
          "he",
          "him",
          "his",
          "she",
          "her",
          "hers",
          "they",
          "them",
          "their",
          "theirs",
          "it",
          "its",
          "we",
          "us",
          "our",
          "ours",
        ]
      : []),
  ]);
}

function extractPreferredFragments(rule: string): string[] {
  return /\b(?:analogy|similes?)\b/iu.test(rule) ? ["like"] : [];
}

function extractPreferredAlternatives(rule: string): string[] {
  const ignored = new Set([
    "file",
    "files",
    "http",
    "https",
    "url",
    "urls",
    "warning",
    "warnings",
  ]);
  const matches: string[] = [];
  for (const pattern of [
    /\buse\s+([A-Z][A-Za-z0-9_]*(?:\s+specialist)?)\s+or\s+warn\b/giu,
    /\bprefer\s+([A-Z][A-Za-z0-9_]*|[a-z_]+_[a-z0-9_]*)\s+or\s+(?:a|an)\s+warning\b/giu,
    /\bprefer\s+([A-Z][A-Za-z0-9_]*|[a-z_]+_[a-z0-9_]*)\b/giu,
    /\bchoose\s+([A-Z][A-Za-z0-9_]*(?:\/[A-Za-z][A-Za-z0-9_ -]*)*)\s+instead\b/giu,
    /\buse\s+([A-Z][A-Za-z0-9_]*)\s+(?:instead|first)\b/giu,
  ]) {
    for (const match of rule.matchAll(pattern)) {
      for (const part of (match[1] ?? "").split("/")) {
        const value = part.trim();
        if (value && !ignored.has(value.toLowerCase())) {
          matches.push(value);
        }
      }
    }
  }
  return uniqueStrings(matches);
}

function extractFiletypeReplacement(
  rule: string,
): LanguageBehavioralRuleAnalysis["filetypeReplacement"] {
  const avoidThenUse = rule.match(
    /\b(?:do not|don't|avoid|never)\b[\s\S]{0,120}?([A-Za-z0-9_-]+\.[A-Za-z0-9]{2,8}|\.[A-Za-z0-9]{2,8})[\s\S]{0,100}?\b(?:use|prefer|choose)\s+([A-Za-z0-9_-]+\.[A-Za-z0-9]{2,8}|\.[A-Za-z0-9]{2,8})\s+instead\b/iu,
  );
  const useInsteadOf = rule.match(
    /\b(?:use|prefer|choose)\s+([A-Za-z0-9_-]+\.[A-Za-z0-9]{2,8}|\.[A-Za-z0-9]{2,8})\s+instead\s+of\s+([A-Za-z0-9_-]+\.[A-Za-z0-9]{2,8}|\.[A-Za-z0-9]{2,8})\b/iu,
  );
  const preferOrWarn = rule.match(
    /\bprefer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9]{2,8}|\.[A-Za-z0-9]{2,8})\s+or\s+warn\s+(?:about|against|on)\s+([A-Za-z0-9_-]+\.[A-Za-z0-9]{2,8}|\.[A-Za-z0-9]{2,8})\b/iu,
  );
  const forbidden = avoidThenUse?.[1] ?? useInsteadOf?.[2] ?? preferOrWarn?.[2];
  const preferred = avoidThenUse?.[2] ?? useInsteadOf?.[1] ?? preferOrWarn?.[1];
  return forbidden && preferred &&
      FILE_ARTIFACT_PATTERN.test(forbidden) &&
      FILE_ARTIFACT_PATTERN.test(preferred)
    ? { forbidden, preferred }
    : undefined;
}

function extractDistrustRouting(
  rule: string,
): LanguageBehavioralRuleAnalysis["distrustRouting"] {
  const target = rule.match(
    /\b(?:distrusts?|do not trust|don't trust|untrusted)\s+([A-Za-z_][A-Za-z0-9_]*)\b/iu,
  )?.[1]?.trim();
  if (!target) {
    return undefined;
  }
  const preferredAlternative = rule.match(
    /\buse\s+([A-Z][A-Za-z0-9_]*(?:\s+specialist)?)\s+or\s+warn\b/iu,
  )?.[1]?.trim();
  return { target, ...(preferredAlternative ? { preferredAlternative } : {}) };
}

function extractExactAction(rule: string): string | undefined {
  for (const pattern of [
    /\b(?:output|emit|return|run|use)\s+(?:the\s+)?exact\s+(?:[A-Za-z0-9_-]+\s+)?(?:command|query|syntax|line)\s+(.+?)(?:[.](?:\s|$)|$)/iu,
    /\b(?:first line must be exactly|exact command is|exact query is)\s+(.+?)(?:[.](?:\s|$)|$)/iu,
  ]) {
    const value = rule.match(pattern)?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractGuard(
  rule: string,
): LanguageBehavioralRuleAnalysis["guard"] {
  const match = rule.match(
    /\bbefore using\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*check\s+(.+?)\s+first\s+and\s+only proceed when\s+(.+?)(?:[.]|$)/iu,
  );
  const check = match?.[2]?.trim();
  if (match && check) {
    const allowedStates = uniqueStrings(
      match[3]?.split(/\bor\b|,/iu).map((part) =>
        part
          .replace(/\b(?:is|are|equals?)\b/giu, " ")
          .replace(/\s+/gu, " ")
          .trim()
      ) ?? [],
    );
    const subject = match[1]?.trim();
    return {
      allowedStates,
      check,
      ...(subject ? { subject } : {}),
    };
  }

  const beforeMatch = rule.match(
    /\bbefore\s+using\s+([A-Za-z_][A-Za-z0-9_-]*)\b[^.]*\bcheck\s+(.+?)\s+first\b[^.]*\bonly\s+(?:proceed|run|submit|dispatch|start|send|sync|process|render|aggregate|transcode|generate|update)\s+(?:if|when)\s+(.+?)(?:[.]|$)/iu,
  );
  if (beforeMatch?.[1] && beforeMatch[2] && beforeMatch[3]) {
    return {
      allowedStates: [beforeMatch[3].trim()],
      check: beforeMatch[2].trim(),
      subject: beforeMatch[1].trim(),
    };
  }

  const checkingMatch = rule.match(
    /\bchecking\s+(.+?)(?:;|,)\s*(.+?)(?:[.]|$)/iu,
  );
  const conditional = checkingMatch?.[2]?.match(
    /\bonly\s+(?:proceed|run|running|submit|dispatch|start|send|sync|process|processing|render|rendering|aggregate|aggregating|transcode|transcoding|generate|generating|update|updating|call|calling|execute|executing)\s+(?:if|when)\s+(.+?)(?:[.]|$)/iu,
  )?.[1] ?? checkingMatch?.[2]?.match(
    /\b(?:proceed|run|running|submit|dispatch|start|send|sync|process|processing|render|rendering|aggregate|aggregating|transcode|transcoding|generate|generating|update|updating|call|calling|execute|executing)\b.+?\bonly\s+(?:if|when)\s+(.+?)(?:[.]|$)/iu,
  )?.[1];
  return checkingMatch?.[1] && conditional
    ? {
        allowedStates: [conditional.trim()],
        check: checkingMatch[1].trim(),
      }
    : undefined;
}

function extractProtocolRewrite(
  rule: string,
): LanguageBehavioralRuleAnalysis["protocolRewrite"] {
  const normalized = rule.trim().toLowerCase();
  if (
    !normalized.includes("https") ||
    !normalized.includes("http") ||
    ![
      "prefer https",
      "prefer urls in the form https://",
      "avoid http",
      "warn instead of producing http",
    ].some((phrase) => normalized.includes(phrase))
  ) {
    return undefined;
  }
  const template = rule.match(/(https:\/\/[A-Za-z0-9.-]+\/<page>)/u)?.[1];
  return { ...(template ? { template } : {}) };
}

function extractDirectoryRestriction(
  rule: string,
): LanguageBehavioralRuleAnalysis["directoryRestriction"] {
  const normalized = rule.trim().toLowerCase();
  const paths = [...rule.matchAll(
    /(?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9_/-]/gu,
  )].map((match) => match[0]);
  const forbiddenRoot =
    rule.match(
      /\bdo not write under\s+((?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9_/-])/iu,
    )?.[1] ??
    paths.find((path) =>
      path.startsWith("/root") ||
      path.startsWith("/system") ||
      path.startsWith("/etc")
    );
  const safeTemplate = rule.match(
    /(?:in the form|under)\s+(~\/[A-Za-z0-9._/-]+\/<file>|\/home\/[A-Za-z0-9._/-]+\/<file>)/u,
  )?.[1];
  if (!forbiddenRoot && !safeTemplate && !normalized.includes("home-directory")) {
    return undefined;
  }
  return {
    ...(forbiddenRoot ? { forbiddenRoot } : {}),
    ...(safeTemplate ? { safeTemplate } : {}),
    ...(normalized.includes("home-directory")
      ? { userHomeRequired: true }
      : {}),
  };
}

function extractArgumentOrder(rule: string): string[] {
  const byOrdinal = new Map<string, string>();
  for (const match of rule.matchAll(
    /\b([a-z_][a-z0-9_ -]+?)\s+(first|second|third)\b/giu,
  )) {
    const label = match[1]
      ?.trim()
      .replace(/\s+/gu, " ")
      .replace(/.*\b(?:takes|use|with)\s+/iu, "")
      .replace(/^(?:and|then)\s+/iu, "");
    const ordinal = match[2]?.toLowerCase();
    if (label && ordinal) {
      byOrdinal.set(ordinal, label);
    }
  }
  return ["first", "second", "third"]
    .map((ordinal) => byOrdinal.get(ordinal))
    .filter((value): value is string => Boolean(value));
}

function extractBareCommandName(rule: string): string | undefined {
  const firstLine = rule.split(/\r?\n/u)[0]?.trim() ?? "";
  if (
    !firstLine ||
    /^(?:a|an|can|could|dear|for|greetings|hello|here|hi|i|in|it|please|sure|the|this|to|you)\b/iu
      .test(firstLine)
  ) {
    return undefined;
  }

  return firstLine.match(
    /^([a-z][a-z0-9_.@-]*|[A-Z][A-Z0-9_]{1,})(?:\s+(?:-[A-Za-z0-9-]+|\+\S+|\.|~?\/\S+|[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9_@-]+=[^\s]+|'[^']+'|"[^"]+"|\|[^|]+\||[a-z0-9_@-]+)){1,8}$/u,
  )?.[1];
}

function extractCommandName(rule: string): string | undefined {
  const normalized = rule.replace(/\s+/gu, " ").trim();
  return (
    normalized.match(/\b([A-Za-z_][A-Za-z0-9_@]*)\s*\(/u)?.[1] ??
    normalized.match(/\b([A-Za-z_][A-Za-z0-9_@]*)\s+\|[^|]+\|/u)?.[1] ??
    normalized.match(/\b([A-Z][A-Z0-9_]*)\s+[A-Za-z0-9_]+\s+\|/u)?.[1] ??
    normalized.match(
      /\b(?:API|tool|command|function)\s+name:\s*([A-Za-z_][A-Za-z0-9_@]*)\b/iu,
    )?.[1] ??
    normalized.match(
      /\b([A-Za-z_][A-Za-z0-9_@]*)\s+(?:takes|uses|requires|accepts)\b/iu,
    )?.[1] ??
    normalized.match(
      /\b(?:use|run|call|invoke|execute)\s+([A-Za-z_][A-Za-z0-9_@]*)\s+(?:with|for|to|instead|first|when|if|or)\b/iu,
    )?.[1] ??
    extractBareCommandName(rule)
  );
}

function quotedValues(rule: string): string[] {
  return [...rule.matchAll(/(?<![\p{L}\p{N}_/])(['"`])([^'"`]+)\1(?![\p{L}\p{N}_/])/gu)]
    .map((match) => match[2]?.trim())
    .filter((value): value is string => Boolean(value));
}

function extractEnglishHostAction(
  rule: string,
): LanguageBehavioralRuleAnalysis["hostAction"] {
  const quoted = quotedValues(rule);
  const sources = uniqueStrings([
    ...[...rule.matchAll(/\bfrom\s+['"`]([^'"`]+)['"`]/giu)]
      .map((match) => match[1]?.trim()),
    ...[...rule.matchAll(
      /\bfrom\s+((?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._-])/giu,
    )].map((match) => match[1]?.trim().replace(/[.,;:!?]+$/u, "")),
  ]);
  const destination =
    rule.match(/\binto\s+['"`]([^'"`]+)['"`]/iu)?.[1]?.trim() ??
    rule.match(
      /\binto\s+((?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._/-])/iu,
    )?.[1]?.trim().replace(/[.,;:!?]+$/u, "") ??
    rule.match(/\bto\s+['"`]([^'"`]+)['"`]/iu)?.[1]?.trim() ??
    rule.match(
      /\bto\s+((?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._/-])/iu,
    )?.[1]?.trim().replace(/[.,;:!?]+$/u, "");
  const usingValues = new Set(
    [...rule.matchAll(/\busing\s+['"`]([^'"`]+)['"`]/giu)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const flags = uniqueStrings(
    [...rule.matchAll(/\bflags?\s+['"`]([^'"`]+)['"`]/giu)]
      .map((match) => match[1]?.trim()),
  );
  const excluded = new Set(
    [destination, ...usingValues, ...flags].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const resolvedSources = uniqueStrings([
    ...sources,
    ...quoted.filter((value) => !excluded.has(value)),
  ]);
  const owner = rule.match(
    /\b(?:owner|as\s+owner)\s+['"`]?([A-Za-z0-9._-]+)['"`]?/iu,
  )?.[1]?.trim();
  const permissions = rule.match(
    /\b(?:perms?|permissions?|mode)\s+['"`]?([0-7]{3,4})['"`]?/iu,
  )?.[1]?.trim();
  const mode = rule.match(
    /\bmode\s+['"`]?([A-Za-z][A-Za-z0-9._-]*)['"`]?/iu,
  )?.[1]?.trim();
  const tag = rule.match(
    /\btag\s+['"`]?([A-Za-z0-9._-]+)['"`]?/iu,
  )?.[1]?.trim();
  const compression = ["bzip2", "gzip", "xz"].find((value) =>
    rule.toLowerCase().includes(value)
  );
  const verb = /\bmove\b/iu.test(rule)
    ? "move"
    : /\bcopy\b/iu.test(rule)
    ? "copy"
    : undefined;
  return resolvedSources.length > 0 || destination || owner || permissions ||
      mode || tag || flags.length > 0 || compression || verb
    ? {
        ...(compression ? { compression } : {}),
        ...(destination ? { destination } : {}),
        ...(flags.length > 0 ? { flags } : {}),
        ...(mode ? { mode } : {}),
        ...(owner ? { owner } : {}),
        ...(permissions ? { permissions } : {}),
        ...(resolvedSources.length > 0 ? { sources: resolvedSources } : {}),
        ...(tag ? { tag } : {}),
        ...(verb ? { verb } : {}),
      }
    : undefined;
}

function extractConciseComputation(
  rule: string,
): LanguageBehavioralRuleAnalysis["conciseComputation"] {
  const percentage = rule.match(
    /(-?\d+(?:\.\d+)?)\s*%\s+of\s+(-?\d+(?:\.\d+)?)/iu,
  );
  if (percentage?.[1] && percentage[2]) {
    return {
      base: Number(percentage[2]),
      kind: "percentage",
      percentage: Number(percentage[1]),
    };
  }
  const circumference = rule.match(
    /\bcircumference\b[\s\S]*\b(?:r|radius)\s*=?\s*(-?\d+(?:\.\d+)?)/iu,
  );
  if (circumference?.[1]) {
    return {
      kind: "circle_circumference",
      radius: Number(circumference[1]),
    };
  }
  return /\bcommand\b[\s\S]*\b(?:print|show)\b[\s\S]*\biso\b[\s\S]*\bdate\b[\s\S]*\bnow\b/iu
      .test(rule) ||
      /\biso\b[\s\S]*\bdate\b[\s\S]*\bnow\b[\s\S]*\bcommand\b/iu.test(rule)
    ? { kind: "iso_datetime_command" }
    : undefined;
}

function extractNamedTarget(rule: string): string | undefined {
  return (
    rule.match(/\b(?:named|called)\s+([A-Za-z0-9._/-]+)/iu)?.[1] ??
    rule.match(
      /\b(?:app|folder|subfolder|directory)\s+(?:named\s+)?([A-Za-z0-9._/-]+)/iu,
    )?.[1] ??
    rule.match(/\b(?:to|for|open)\s+([A-Za-z0-9_-]+)\b/iu)?.[1]
  )
    ?.trim()
    .replace(/[.,;:!?]+$/u, "");
}

function extractPathBase(rule: string): string | undefined {
  return (
    rule.match(
      /(?:under|inside|within|beneath)\s+((?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._-])/iu,
    )?.[1] ??
    rule.match(
      /\b(?:directory|path|folder)\s+(?:named\s+)?((?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._-])/iu,
    )?.[1] ??
    rule.match(/((?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._-])/u)?.[1]
  )
    ?.trim()
    .replace(/[.,;:!?]+$/u, "");
}

function sanitizeJargonTerm(value: string | undefined): string | undefined {
  const sanitized = value
    ?.trim()
    .replace(/^(?:an?|the)\s+/iu, "")
    .replace(/\b(?:in|for)\s+(?:programming|coding|machine learning|software|simple terms|a simple way)\b.*$/iu, "")
    .replace(/\b(?:to|for)\s+(?:a\s+)?beginner\b.*$/iu, "")
    .replace(/[?.!,;:]+$/u, "")
    .trim();
  if (!sanitized || sanitized.length < 2 || sanitized.split(/\s+/u).length > 4) {
    return undefined;
  }
  return /^(?:concept|example|explanation|it|simple|something|term|that|this|what)$/iu
      .test(sanitized)
    ? undefined
    : sanitized;
}

function extractJargonTerms(rule: string): string[] {
  const candidates = [
    rule.match(
      /\bexplain\s+(?:what\s+)?(?:an?\s+|the\s+)?(.+?)(?:\s+(?:is|does|means?|refers?\s+to|to\s+(?:a\s+)?beginner|for\s+(?:a\s+)?beginner|in\s+(?:simple\s+terms|a\s+simple\s+way))|[?.]|$)/iu,
    )?.[1],
    rule.match(
      /\bwhat\s+(?:is|are|does)\s+(?:an?\s+|the\s+)?(.+?)(?:\s+(?:do|mean|refer)|[?.]|$)/iu,
    )?.[1],
    rule.match(/\b(?:tell me about|clarify)\s+(.+?)(?:\s+(?:for|to)\b|[?.]|$)/iu)?.[1],
    rule.match(/\bconcept\s+of\s+(.+?)(?:\s+(?:in|for)\b|[?.]|$)/iu)?.[1],
    rule.match(
      /^(?:sure[, ]+)?(?:an?\s+|the\s+)?(.+?)\s+(?:is|are|means?|refers?\s+to|happens\s+when|allows|enables)\b/iu,
    )?.[1],
  ];
  const terms = uniqueStrings(candidates.map(sanitizeJargonTerm));
  return uniqueStrings(terms.flatMap((term) =>
    /\s+notation$/iu.test(term)
      ? [term, term.replace(/\s+notation$/iu, "")]
      : [term]
  ));
}

function extractStructuredTerms(rule: string): string[] {
  const quoted = [...rule.matchAll(/(?<![\p{L}\p{N}_/])(['"`])([^'"`]+)\1(?![\p{L}\p{N}_/])/gu)]
    .map((match) => match[2]?.trim())
    .filter((value): value is string => Boolean(value));
  if (quoted.length > 0) {
    return quoted;
  }
  const joined = rule.match(
    /\b(?:terms?|tags?|records?)\s+([A-Za-z0-9_-]+(?:\s+and\s+[A-Za-z0-9_-]+)+)/iu,
  )?.[1];
  const joinedTerms = joined
    ? joined.split(/\s+and\s+/iu).map((value) => value.trim()).filter(Boolean)
    : [];
  return uniqueStrings([...joinedTerms, ...extractJargonTerms(rule)]);
}

function extractAnalogyText(rule: string): string | undefined {
  return (
    rule.match(
      /^(?:sure[, ]+)?(?:an?\s+|the\s+)?[^.]+?\s+(?:is|means|refers\s+to)\s+like\s+(.+)$/iu,
    )?.[1] ??
    rule.match(/\b(?:it(?:'s| is)?|this(?: is)?)\s+like\s+(.+)$/iu)?.[1] ??
    rule.match(/\b(imagine\s+.+)$/iu)?.[1]
  )?.replace(/[.。]+$/u, "").trim();
}

function extractComparison(
  rule: string,
): LanguageBehavioralRuleAnalysis["comparison"] {
  const field =
    rule.match(
      /\b([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:>=|<=|=|>|<)\s*(?:['"]?[A-Za-z0-9_.-]+['"]?)/u,
    )?.[1] ??
    rule.match(
      /\b(?:whose|with|where|filter(?:ed)?\s+by|based\s+on)\s+([A-Za-z_][A-Za-z0-9_.-]*)\s+(?:is\s+)?(?:after|before|earlier|older|younger|more|less|above|below|over|under|greater|equal|equals|=|>|<)\b/iu,
    )?.[1] ??
    rule.match(
      /\b(?:whose|with|where)\s+([A-Za-z_][A-Za-z0-9_.-]*)\s+is\s+(?:an?\s+|the\s+)?[A-Za-z_][A-Za-z0-9_.-]*\b/iu,
    )?.[1] ??
    (/\b(?:older|younger)\s+than\b/iu.test(rule) ? "age" : undefined) ??
    rule.match(
      /\b([A-Za-z_][A-Za-z0-9_.-]*)\s+(?:is\s+)?(?:after|before|earlier|older|younger|more|less|above|below|over|under|greater|equal|equals)\b/iu,
    )?.[1];
  const normalized = rule.toLowerCase();
  const operator =
    /\b(?:at\s+least|minimum|no\s+less\s+than)\b/u.test(normalized)
      ? ">=" as const
      : /\b(?:at\s+most|maximum|no\s+more\s+than)\b/u.test(normalized)
        ? "<=" as const
        : /\b(?:older|greater|more|above|over|after)\b/u.test(normalized)
          ? ">" as const
          : /\b(?:younger|less|below|under|before|earlier)\b/u.test(normalized)
            ? "<" as const
            : /\b(?:equal|equals|exactly|is)\b/u.test(normalized)
              ? "=" as const
              : rule.match(/(?:>=|<=|=|>|<)/u)?.[0] as
                  | "<"
                  | "<="
                  | "="
                  | ">"
                  | ">="
                  | undefined;
  const value =
    rule.match(/\b(?:>=|<=|=|>|<)\s*(['"]?[A-Za-z0-9_.-]+['"]?)/u)?.[1] ??
    rule.match(
      /\b(?:after|before|earlier\s+than|older\s+than|younger\s+than|more\s+than|less\s+than|above|below|over|under|greater\s+than|equal(?:s)?(?:\s+to)?)\s+(['"]?[A-Za-z0-9_.-]+['"]?)/iu,
    )?.[1] ??
    rule.match(/\bis\s+(?:an?|the)\s+([A-Za-z_][A-Za-z0-9_.-]*)\b/iu)?.[1] ??
    rule.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0] ??
    rule.match(/\b-?\d+(?:\.\d+)?\b/u)?.[0];
  return field || operator || value
    ? {
        ...(field ? { field } : {}),
        ...(operator ? { operator } : {}),
        ...(value ? { value } : {}),
      }
    : undefined;
}

function extractProtocolReplacement(
  rule: string,
): LanguageBehavioralRuleAnalysis["protocolReplacement"] {
  const match = rule.match(
    /\b(?:use|prefer|choose|select|offer)\s+(https?:\/\/[^\s)]+)\s+instead\s+of\s+(https?:\/\/[^\s)]+)/iu,
  );
  return match?.[1] && match[2]
    ? { forbiddenUrl: match[2], preferredUrl: match[1] }
    : undefined;
}

function extractSemanticCues(
  rule: string,
  base: LanguageBehavioralRuleAnalysis,
): NonNullable<LanguageBehavioralRuleAnalysis["semanticCues"]> {
  const cues: NonNullable<LanguageBehavioralRuleAnalysis["semanticCues"]> = [];
  const add = (
    cue: NonNullable<LanguageBehavioralRuleAnalysis["semanticCues"]>[number],
    matched: boolean,
  ): void => {
    if (matched && !cues.includes(cue)) {
      cues.push(cue);
    }
  };
  add("failure", /\b(?:failed|failure|error|denied|deprecated|unsupported|timeout|timed out)\b/iu.test(rule));
  add("permission_failure", /\bpermission denied\b|\bnot permitted\b|\bforbidden\b/iu.test(rule));
  add("timeout", /\btimeout\b|\btimed out\b|\bslow\b/iu.test(rule));
  add("unsafe", /\b(?:deprecated|unsafe|untrusted|unreliable)\b/iu.test(rule));
  add("inhibition_replacement", /\b(?:instead|replacement|alternative|corrected|avoid|do not|don't|never|rather than)\b/iu.test(rule));
  add("safe_fallback", /\b(?:safe|safer|backup|warn|warning|caution)\b/iu.test(rule));
  add("path", /\b(?:directory|folder|path|root|home-directory|subfolder)\b|(?:~\/|\/)[a-z0-9._/-]+/iu.test(rule));
  add("api", /\b(?:api|endpoint|service|[A-Za-z0-9_]*API)\b/iu.test(rule));
  add("command", /\b(?:tool|command|function|utility|copy|archive|sync|query)\b/iu.test(rule));
  add("operation", /\b(?:run|running|submit|submitting|process|processing|execute|executing|dispatch|send)\b/iu.test(rule));
  add("argument_order", /\b(?:argument|parameter|order|prefix|suffix|pipe-wrapped)\b/iu.test(rule));
  add("url", /\b(?:http|https|url|link|protocol|subdomain|host)\b/iu.test(rule));
  add("filetype", /\b(?:filetype|extension|json|csv|yaml|yml|txt|pdf|docx)\b/iu.test(rule));
  add("format", base.formatRule || /\b(?:subject|signature|sign off|dear|regards|sincerely|opening|closing|compose|draft|formal|notice|email|memo|letter)\b/iu.test(rule));
  add("analogy", /\b(?:jargon|analogy|beginner|plain language|avoid the term|concept|confused|confusing|did not understand|didn't understand|do not understand|don't understand|not understood|simple|too complex)\b/iu.test(rule));
  add("style", /\b(?:jargon|analogy|beginner|plain language|voice|pronoun|first-person|first person|character)\b/iu.test(rule));
  add("voice", /\b(?:voice|pronoun|first-person|first person|character)\b/iu.test(rule));
  add("symbolic", /\b(?:formula|sequence|operator|omega|recurrence|compute|calculate)\b/iu.test(rule) || /\b[A-Z][A-Za-z0-9_]*\((-?\d+)\)/u.test(rule));
  add("precondition", /\b(?:precondition|only proceed|defer|check)\b/iu.test(rule) || /\b(?:load|status|queue|gpu|memory|network|maintenance)\b.*\b(?:normal|idle|available|stable|complete)\b/iu.test(rule));
  add("brevity", /\b(?:brief|brevity|concise|one-line|one line|short|minimal|command only|only the command|quick version|impatience|impatient|frustration|terse|too verbose)\b/iu.test(rule));
  return cues;
}

function extractResponseStyle(
  rule: string,
): LanguageBehavioralRuleAnalysis["responseStyle"] {
  if (/\b(?:bullet-pointed|bullet\s+list|bullets?|impatience|impatient|frustration|terse replies?|short summary|quick version|brief overview)\b/iu.test(rule)) {
    return "bullets";
  }
  return /\b(?:minimal|concise|brief|command only|only the command|just the command|quick version|in a rush|too much detail|too verbose)\b/iu.test(rule)
    ? "brief"
    : undefined;
}

export function analyzeEnglishBehavioralRule(
  rule: string,
  patterns: BehavioralRulePatterns,
): LanguageBehavioralRuleAnalysis {
  const base = analyzeBehavioralRuleWithPatterns(rule, patterns);
  const formatPrefix = extractQuotedFragment(rule, "prefix");
  const formatSurface = extractFormatSurface(rule);
  const formatSuffix = withSenderNamePlaceholder(
    extractQuotedFragment(rule, "suffix"),
    rule,
  );
  const requiredFragments = extractRequiredFragments(rule);
  const forbiddenFragments = extractForbiddenFragments(rule);
  const preferredFragments = extractPreferredFragments(rule);
  const preferredAlternatives = extractPreferredAlternatives(rule);
  const argumentOrder = extractArgumentOrder(rule);
  const analogyText = extractAnalogyText(rule);
  const exactAction = extractExactAction(rule);
  const guard = extractGuard(rule);
  const filetypeReplacement = extractFiletypeReplacement(rule);
  const distrustRouting = extractDistrustRouting(rule);
  const protocolRewrite = extractProtocolRewrite(rule);
  const protocolReplacement = extractProtocolReplacement(rule);
  const directoryRestriction = extractDirectoryRestriction(rule);
  const commandName = extractCommandName(rule);
  const conciseComputation = extractConciseComputation(rule);
  const comparison = extractComparison(rule);
  const hostAction = extractEnglishHostAction(rule);
  const namedTarget = extractNamedTarget(rule);
  const pathBase = extractPathBase(rule);
  const responseStyle = extractResponseStyle(rule);
  const semanticCues = extractSemanticCues(rule, base);
  if (argumentOrder.length >= 2 && !semanticCues.includes("argument_order")) {
    semanticCues.push("argument_order");
  }
  if (guard && !semanticCues.includes("precondition")) {
    semanticCues.push("precondition");
  }
  const structuredTerms = extractStructuredTerms(rule);

  return {
    ...base,
    ...(analogyText ? { analogyText } : {}),
    ...(argumentOrder.length >= 2 ? { argumentOrder } : {}),
    ...(/\bback\s*up\b|\bbackup\b/iu.test(rule)
      ? { backupRequested: true }
      : {}),
    ...(commandName ? { commandName } : {}),
    ...(conciseComputation ? { conciseComputation } : {}),
    ...(comparison ? { comparison } : {}),
    ...(directoryRestriction ? { directoryRestriction } : {}),
    ...(distrustRouting ? { distrustRouting } : {}),
    ...(exactAction ? { exactAction } : {}),
    ...(filetypeReplacement ? { filetypeReplacement } : {}),
    ...(forbiddenFragments.length > 0 ? { forbiddenFragments } : {}),
    ...(formatPrefix ? { formatPrefix } : {}),
    ...(formatSurface ? { formatSurface } : {}),
    ...(formatSuffix ? { formatSuffix } : {}),
    ...(guard ? { guard } : {}),
    ...(hostAction ? { hostAction } : {}),
    ...(namedTarget ? { namedTarget } : {}),
    ...(pathBase ? { pathBase } : {}),
    ...(preferredAlternatives.length > 0 ? { preferredAlternatives } : {}),
    ...(preferredFragments.length > 0 ? { preferredFragments } : {}),
    ...(protocolReplacement ? { protocolReplacement } : {}),
    ...(protocolRewrite ? { protocolRewrite } : {}),
    ...(requiredFragments.length > 0 ? { requiredFragments } : {}),
    ...(responseStyle ? { responseStyle } : {}),
    ...(semanticCues.length > 0 ? { semanticCues } : {}),
    ...(structuredTerms.length > 0 ? { structuredTerms } : {}),
    ...(/\b(?:avoid|cannot|can't|can’t|do not|don't|refuse|warn|warning)\b/iu.test(rule)
      ? { warningSignal: true }
      : {}),
  };
}
