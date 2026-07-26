The recursive merge currently places default array entries before caller-provided entries.

Fix `defu` so caller-provided array entries stay before default entries at every nesting level. Preserve scalar precedence, null fallback, exported signatures, and input immutability.
