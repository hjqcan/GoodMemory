export type CanonicalJsonValue =
  | boolean
  | null
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

const UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new Set()));
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function parseCanonicalJson(bytes: Uint8Array | string): CanonicalJsonValue {
  let text: string;
  try {
    text = typeof bytes === "string" ? bytes : UTF8_DECODER.decode(bytes);
  } catch (cause) {
    throw new Error("proof JSON is not valid UTF-8", { cause });
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error("proof JSON is invalid", { cause });
  }
  const canonical = normalizeJson(value, new Set());
  if (JSON.stringify(canonical) !== text) {
    throw new Error("proof JSON is not canonical UTF-8 JSON");
  }
  return canonical;
}

function normalizeJson(
  value: unknown,
  ancestors: Set<object>,
): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("proof JSON rejects non-finite numbers");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`proof JSON rejects ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new Error("proof JSON rejects cyclic values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeJson(entry, ancestors));
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error("proof JSON accepts only plain objects and arrays");
    }
    const normalized = Object.create(null) as Record<
      string,
      CanonicalJsonValue
    >;
    for (const key of Object.keys(value).sort(compareUtf8)) {
      normalized[key] = normalizeJson(
        (value as Record<string, unknown>)[key],
        ancestors,
      );
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
