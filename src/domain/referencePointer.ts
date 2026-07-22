const POINTER_PATTERN = new RegExp(
  [
    String.raw`https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]+`,
    String.raw`(?:[\p{L}\p{N}._-]+\/)+[\p{L}\p{N}._-]+\.[A-Za-z0-9_-]+`,
    String.raw`[\p{L}\p{N}._-]+\.[A-Za-z0-9_-]+`,
  ].join("|"),
  "gu",
);
const WRAPPING_PUNCTUATION = /^[`"'([{<\s]+|[`"')\]}>.,!?;:]+$/g;

export interface ReferencePointerOccurrence {
  index: number;
  pointer: string;
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
