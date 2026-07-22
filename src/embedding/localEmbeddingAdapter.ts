import type { EmbeddingAdapter } from "./contracts";

// A dependency-free, deterministic embedding adapter for offline hybrid recall.
//
// It is NOT a neural model: it is a hashed n-gram lexical embedding (the
// "hashing trick"). Each text is turned into a sparse bag of features — whole
// tokens plus boundary-marked character 3-grams of each token — which are
// signed-hashed into a fixed-dimension vector and L2-normalized, so the dot
// product of two vectors is their cosine similarity. This captures lexical and
// morphological overlap (run/running, hash/hashing, shared tokens) well beyond
// exact match, while needing no provider, network, corpus, or build step.
//
// Use it as the default semantic source when no embedding provider is configured
// (the architecture treats the rules/lexical path as the hard floor and uses
// these scores only for semantic tie-breaking), and as a deterministic test
// double. It will not capture deep synonymy or cross-hop relationships the way a
// trained model does; for that, supply a provider-backed EmbeddingAdapter.

const DEFAULT_DIMENSIONS = 256;
const CHAR_NGRAM_SIZE = 3;

// FNV-1a 32-bit: a fast, well-distributed, deterministic string hash.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // 32-bit FNV prime multiply via shifts to stay in the safe integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

// Whole token plus its boundary-marked character n-grams. The boundary markers
// (^ and $) let prefixes/suffixes carry signal (e.g. "^run" vs "ing$").
function tokenFeatures(token: string): string[] {
  const features: string[] = [token];
  if (token.length > CHAR_NGRAM_SIZE) {
    const marked = `^${token}$`;
    for (let index = 0; index + CHAR_NGRAM_SIZE <= marked.length; index += 1) {
      features.push(marked.slice(index, index + CHAR_NGRAM_SIZE));
    }
  }
  return features;
}

export function embedTextLocally(
  text: string,
  dimensions: number = DEFAULT_DIMENSIONS,
): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const token of tokenize(text)) {
    for (const feature of tokenFeatures(token)) {
      const hash = fnv1a(feature);
      const bucket = hash % dimensions;
      // A separate sign bit (signed feature hashing) makes collisions cancel in
      // expectation instead of always reinforcing.
      const sign = (hash & 0x80000000) === 0 ? 1 : -1;
      vector[bucket] += sign;
    }
  }
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= norm;
  }
  return vector;
}

export function createLocalEmbeddingAdapter(
  options: { dimensions?: number } = {},
): EmbeddingAdapter {
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("Local embedding dimensions must be a positive integer.");
  }
  return {
    embed(texts: string[]): Promise<number[][]> {
      return Promise.resolve(
        texts.map((text) => embedTextLocally(text, dimensions)),
      );
    },
    // Brand: these vectors are hashed-lexical, not semantic. Consumers that
    // require neural embeddings (retrieval.preset "recommended") detect and
    // reject this adapter by the symbol — structural typing cannot.
    [Symbol.for("goodmemory.embedding.hashed-lexical")]: true,
  } as EmbeddingAdapter;
}
