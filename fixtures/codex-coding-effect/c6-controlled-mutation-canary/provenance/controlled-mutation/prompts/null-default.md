`defu` is treating an explicit `null` as an override instead of a missing value.

Restore the project rule that `null` falls back to the corresponding default at the root and in nested objects. Preserve falsy non-null values, array ordering, exported signatures, and input immutability.
