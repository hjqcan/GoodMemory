const LETTERED_EXTENSION =
  String.raw`(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+`;
const IRI_AUTHORITY = String.raw`[\p{L}\p{N}\p{M}._~:\[\]@!$&'()*+,;=%-]+`;
const IRI_PATH_SEGMENT = String.raw`[\p{L}\p{N}\p{M}._~!$&'()*+,;=:@%-]*`;
const IRI_QUERY = String.raw`[\p{L}\p{N}\p{M}._~:/?\[\]@!$&'()*+,;=%-]*`;
const IRI_FRAGMENT = String.raw`[\p{L}\p{N}\p{M}._~:/?#\[\]@!$&'()*+,;=%-]*`;
const POINTER_ALTERNATIVES = [
  String.raw`https?:\/\/${IRI_AUTHORITY}(?:\/${IRI_PATH_SEGMENT})*(?:\?${IRI_QUERY})?(?:#${IRI_FRAGMENT})?`,
  String.raw`(?:[\p{L}\p{N}\p{M}._-]+\/)+[\p{L}\p{N}\p{M}._-]+\.${LETTERED_EXTENSION}`,
  String.raw`[\p{L}\p{N}\p{M}._-]+\.${LETTERED_EXTENSION}`,
] as const;
const POINTER_PATTERN = new RegExp(POINTER_ALTERNATIVES.join("|"), "gu");
const EXACT_POINTER_PATTERN = new RegExp(
  `^(?:${POINTER_ALTERNATIVES.join("|")})$`,
  "u",
);
const WRAPPING_PUNCTUATION = /^[`"'([{<\s]+|[`"')\]}>.,!?;:]+$/g;
const ASCII_EXTENSION_BEFORE_UNICODE_PROSE =
  /^(https?:\/\/[^?#]*?\.[A-Za-z][A-Za-z0-9_-]*)(?=(?![\x00-\x7F])[\p{L}\p{M}])/u;

function normalizePointerMatch(value: string): string {
  const unwrapped = value.replace(WRAPPING_PUNCTUATION, "").trim();
  return unwrapped.match(ASCII_EXTENSION_BEFORE_UNICODE_PROSE)?.[1] ?? unwrapped;
}

export interface ReferencePointerOccurrence {
  index: number;
  pointer: string;
}

export function parseReferencePointer(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const pointer = normalizePointerMatch(value);
  return EXACT_POINTER_PATTERN.test(pointer) ? pointer : undefined;
}

export function extractReferencePointerOccurrences(
  value: string | undefined,
): ReferencePointerOccurrence[] {
  if (!value) {
    return [];
  }

  return [...value.matchAll(POINTER_PATTERN)]
    .map((match) => ({
      index: match.index ?? -1,
      pointer: normalizePointerMatch(match[0] ?? ""),
    }))
    .filter(({ index, pointer }) => index >= 0 && pointer.length > 0);
}

export function extractReferencePointers(
  value: string | undefined,
): string[] {
  return extractReferencePointerOccurrences(value).map(({ pointer }) => pointer);
}

export function extractReferencePointer(
  value: string | undefined,
): string | undefined {
  return extractReferencePointers(value)[0];
}
