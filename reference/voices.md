# `dapi voices`

Lists the speech voices available for `generate.voice` declarations (see [jsx/generate.md](./jsx/generate.md)).

The list itself is local and needs no account. Each voice names the `provider` that offers it and whether it is `available`: whether that provider's API key is configured (see [AI providers](./README.md#ai-providers)). Local speech (Piper) is next.

## Input

None.

## Output

JSON Lines, one per voice:

```ts
{ id: string; label: string; description: string; provider: string; available: boolean }
```
