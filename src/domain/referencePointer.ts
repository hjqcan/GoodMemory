const LETTERED_EXTENSION =
  String.raw`(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+`;
const POINTER_ALTERNATIVES = [
  String.raw`https?:\/\/[\p{L}\p{N}._~:\[\]%-]+(?:\/[\p{L}\p{N}\p{M}._~!$&'()*+,;=:@%-]*)*\/[\p{L}\p{N}\p{M}._~!$&'()*+,;=:@%-]+\.${LETTERED_EXTENSION}(?:\?[A-Za-z0-9._~:/?\[\]@!$&()*+,;=%-]*)?(?:#[\p{L}\p{N}\p{M}._~:/?\[\]@!$&()*+,;=%-]*)?`,
  String.raw`https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]+`,
  String.raw`(?:[\p{L}\p{N}\p{M}._-]+\/)+[\p{L}\p{N}\p{M}._-]+\.${LETTERED_EXTENSION}`,
  String.raw`[\p{L}\p{N}\p{M}._-]+\.${LETTERED_EXTENSION}`,
] as const;
const POINTER_PATTERN = new RegExp(POINTER_ALTERNATIVES.join("|"), "gu");
const EXACT_POINTER_PATTERN = new RegExp(
  `^(?:${POINTER_ALTERNATIVES.join("|")})$`,
  "u",
);
const WRAPPING_PUNCTUATION = /^[`"'([{<\s]+|[`"')\]}>.,!?;:]+$/g;

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
  const pointer = value.replace(WRAPPING_PUNCTUATION, "").trim();
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
      pointer: (match[0] ?? "").replace(WRAPPING_PUNCTUATION, "").trim(),
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
