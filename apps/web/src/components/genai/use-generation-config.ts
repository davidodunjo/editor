/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { getAssetSpec, isAssetRef } from "@diffusionstudio/jsx";
import { authoredElement } from "@diffusionstudio/reconciler";
import { useSelection } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import {
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_MODEL,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "./config";

import type { GenerationConfig } from "./schemas";
import type { AssetInput, AssetSpecInput } from "@diffusionstudio/jsx";
import type { AssetLibrary } from "@diffusionstudio/assets";

function toPromptConfig(spec: AssetSpecInput, library: AssetLibrary): GenerationConfig {
  const idOf = (input: AssetInput | undefined): string | undefined =>
    typeof input === "string" ? library.get(input)?.id : undefined;

  switch (spec.type) {
    case "image":
      return {
        mode: "IMAGE",
        model: spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        count: 1,
        imageRefIds: (spec.refs ?? []).map(idOf).filter((id): id is string => id !== undefined),
      };
    case "video":
      return {
        mode: "VIDEO",
        model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        duration: spec.duration ?? 5,
        generateAudio: spec.audio ?? false,
        startFrameImageId: idOf(spec.startFrame),
        endFrameImageId: idOf(spec.endFrame),
      };
    case "voice":
      return {
        mode: "VOICE",
        model: PROMPT_INPUT_VOICE_MODEL,
        prompt: spec.prompt,
        voice: spec.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value,
      };
    case "audio":
      return {
        mode: "AUDIO",
        model: spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
      };
  }
}

export function useGenerationConfig() {
  const library = useLibrary();
  const { nodes } = useSelection();

  const declarations = createMemo(() =>
    nodes()
      .map((entity) => authoredElement(entity)?.props.src)
      .filter(isAssetRef)
      .map(getAssetSpec),
  );

  const isGenerated = createMemo(() => declarations().length > 0);

  const firstConfig = (): GenerationConfig | undefined => {
    const lib = library();
    const declared = declarations()[0];
    return declared && lib ? toPromptConfig(declared, lib) : undefined;
  };

  return { isGenerated, firstConfig };
}
