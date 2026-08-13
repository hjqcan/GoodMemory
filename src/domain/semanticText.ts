const SEMANTIC_TEXT_PATTERN =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}]/u;

export const STORAGE_UNSAFE_TEXT_ERROR_CODE =
  "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT";

export class StorageUnsafeTextError extends TypeError {
  readonly code = STORAGE_UNSAFE_TEXT_ERROR_CODE;

  constructor(readonly path: string) {
    super(`Storage-unsafe text at ${path}`);
    this.name = "StorageUnsafeTextError";
  }
}

export function hasSemanticText(value: string): boolean {
  return SEMANTIC_TEXT_PATTERN.test(value);
}

export function isStorageSafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      return false;
    }
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function nestedPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

export function findStorageUnsafeTextPath(
  value: unknown,
  path: string,
): string | undefined {
  if (typeof value === "string") {
    return isStorageSafeText(value) ? undefined : path;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findStorageUnsafeTextPath(item, `${path}[${index}]`);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!isStorageSafeText(key)) {
      return `${path}[${JSON.stringify(key)}]`;
    }
    const found = findStorageUnsafeTextPath(item, nestedPath(path, key));
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function assertStorageSafeExternalValue(
  value: unknown,
  path: string,
): void {
  const unsafePath = findStorageUnsafeTextPath(value, path);
  if (unsafePath) {
    throw new StorageUnsafeTextError(unsafePath);
  }
}

export function hasPersistableSemanticText(value: string): boolean {
  return isStorageSafeText(value) && hasSemanticText(value);
}
