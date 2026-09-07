# `dapi models [type]`

Lists the generation models available for a media type, including each model's capabilities. Use it to discover valid model ids and the per-model constraints (durations, aspect ratios, features) to set on an asset declaration (see [jsx/generate.md](./jsx/generate.md)).

There are no CLI commands that generate; asset generation is declared in the project module and produced on mount.

The list itself is local and needs no account. Each model names the `provider` that offers it and whether it is `available`: whether that provider's API key is configured (see [AI providers](./README.md#ai-providers)). Declaring a model that is not available fails with `No configured provider offers the model "<id>"`.

Image and video models run through [fal](https://fal.ai) with a `FAL_KEY`:

| Type | Model id | fal endpoint |
| ---- | -------- | ------------ |
| image | `flux-2-turbo` | `fal-ai/flux-2/turbo` (`/edit` with refs) |
| image | `gpt-image-2` | `openai/gpt-image-2` (`/edit` with refs) |
| image | `nano-banana-2` | `fal-ai/nano-banana-2` (`/edit` with refs) |
| image | `nano-banana-pro` | `fal-ai/nano-banana-pro` (`/edit` with refs) |
| image | `seedream-4.5` | `fal-ai/bytedance/seedream/v4.5/text-to-image` (`/edit` with refs) |
| video | `kling-3-pro` | `fal-ai/kling-video/v3/pro/{text,image}-to-video` |
| video | `kling-o3-pro` | `fal-ai/kling-video/o3/pro/{text,image}-to-video` |
| video | `kling-2.5-turbo` | `fal-ai/kling-video/v2.5-turbo/pro/{text,image}-to-video` |
| video | `seedance-2.0` | `bytedance/seedance-2.0/{text,image}-to-video` |
| video | `veo-3.1` | `fal-ai/veo3.1`, `/image-to-video`, `/first-last-frame-to-video` |
| video | `veo-3.1-fast` | `fal-ai/veo3.1/fast`, `/image-to-video`, `/first-last-frame-to-video` |
| video | `wan-2.6` | `wan/v2.6/image-to-video` (needs a `startFrame`) |
| video | `hailuo-2.3` | `fal-ai/minimax/hailuo-2.3/pro/{text,image}-to-video` (fixed 6s, 1080p) |

A video declaration with a `startFrame` goes to the image-to-video endpoint, and one with an `endFrame` too to the endpoint that takes both. `seed` is passed where the endpoint accepts one (FLUX.2, Nano Banana, Seedream, Veo, Wan); the others ignore it.

## Input

- `[type]` (optional): one of `image`, `video`, `audio`. Omit to list all three groups.

## Output

JSON Lines, one per model:

```ts
{
  type:          "image" | "video" | "audio";
  id:            string;     // the model id to set on a generate.* declaration
  name:          string;
  provider:      string;     // the provider that offers the model
  available:     boolean;    // whether that provider's API key is configured
  durations?:    string[];   // video only, e.g. ["5s","10s"]
  aspectRatios?: string[];   // video only
  features?:     Array<"start-frame" | "end-frame" | "audio">;  // video only
}
```
