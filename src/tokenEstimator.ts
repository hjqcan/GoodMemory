function isConservativeUnicodeCharacter(character: string): boolean {
  return (character.codePointAt(0) ?? 0) > 0x7f;
}

export function estimateTextTokens(value: string): number {
  let conservativeScriptCharacters = 0;
  let otherCodeUnits = 0;

  for (const character of value) {
    if (isConservativeUnicodeCharacter(character)) {
      conservativeScriptCharacters += 1;
    } else {
      otherCodeUnits += character.length;
    }
  }

  return conservativeScriptCharacters + Math.ceil(otherCodeUnits / 4);
}

export function truncateTextToEstimatedTokens(
  value: string,
  maxTokens: number,
): string {
  if (maxTokens <= 0 || value.length === 0) {
    return "";
  }

  let conservativeScriptCharacters = 0;
  let end = 0;
  let otherCodeUnits = 0;

  for (const character of value) {
    const isConservative = isConservativeUnicodeCharacter(character);
    const nextConservativeScriptCharacters =
      conservativeScriptCharacters +
      (isConservative ? 1 : 0);
    const nextOtherCodeUnits =
      otherCodeUnits +
      (isConservative ? 0 : character.length);
    const nextEstimate =
      nextConservativeScriptCharacters + Math.ceil(nextOtherCodeUnits / 4);

    if (nextEstimate > maxTokens) {
      break;
    }

    conservativeScriptCharacters = nextConservativeScriptCharacters;
    end += character.length;
    otherCodeUnits = nextOtherCodeUnits;
  }

  return value.slice(0, end);
}
