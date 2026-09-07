# `dapi voices`

Lists the speech voices available for `generate.voice` declarations (see [jsx/generate.md](./jsx/generate.md)).

The list itself is local and needs no account. Producing speech with one of these voices currently requires a configured cloud backend; generation is moving to user-supplied API keys and local models.

## Input

None.

## Output

JSON Lines, one per voice:

```ts
{ id: string; label: string; description: string }
```
