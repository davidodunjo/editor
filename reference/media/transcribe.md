# `dapi media transcribe <path>`

Transcribes the speech in a video or audio asset and returns the timed transcript. Word-level start/end times are in **seconds** (source/content time).

Transcription runs **locally with Whisper**: no account or API key is needed, and the audio never leaves the machine. The first transcription downloads the model into the app's data folder (a toast in the app shows progress); later ones start at once.

## Models

Whisper runs on the GPU through WebGPU when the machine has one, and on the CPU otherwise (a smaller, quantized download).

| Model | Download (GPU / CPU) | Notes |
| ----- | -------------------- | ----- |
| `whisper-base` (default) | ~206 MB / ~77 MB | Fast; fine for clear speech. |
| `whisper-small` | ~586 MB / ~249 MB | More accurate on accents, names and noisy audio. |
| `whisper-large-v3-turbo` | ~1.6 GB | Most accurate; needs WebGPU with 16-bit float support. |

Whisper detects the language itself and transcribes in it.

## Input

- `<path>`: a local video or audio file to transcribe in place without adding it to the library, or a project library path (required; library paths need an open project).

The whole asset is transcribed once per app session (cached in memory, keyed by file content; an app restart or an edited file re-transcribes).

## Output

One JSON object, the transcript:

```ts
{
  segments: Array<{
    text:  string;      // spoken words only (no silence markers)
    words: Array<{ text: string; start: number; end: number }>;  // seconds
  }>;
}
```

A segment is a sentence (split on `.`, `?`, `!`), or up to 40 words when the speech carries no punctuation.

## Errors

Exits non-zero if the path can't be resolved or the asset is not a video/audio asset, if no speech is detected in the audio at all (`No speech detected`), or if the model download fails (no network on first use).
