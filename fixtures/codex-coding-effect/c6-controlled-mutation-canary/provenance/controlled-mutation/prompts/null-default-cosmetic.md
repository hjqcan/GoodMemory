Repair the merge regression where a caller's `null` suppresses an available default.

The fix must apply recursively while leaving valid falsy values and all unrelated merge behavior unchanged.
