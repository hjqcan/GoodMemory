const SEMANTIC_TEXT_PATTERN =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}]/u;

export function hasPersistableSemanticText(value: string): boolean {
  return !value.includes("\u0000") && SEMANTIC_TEXT_PATTERN.test(value);
}
