# Code extraction sample

This file contains synthetic examples for ThreadPack. Import it as Markdown,
then open **Code snippets** to copy or download either fenced block.

## TypeScript

```typescript
export async function retry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
```

## Python

```python
def group_by_role(messages):
    grouped = {}
    for message in messages:
        grouped.setdefault(message["role"], []).append(message["content"])
    return grouped
```

ThreadPack extracts the code as text. It does not execute either example.
