/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { registry } from "@/providers";

import type { ModelsRequest, ModelInfo } from "@diffusionstudio/cli/channels";
import type { Capability } from "@diffusionstudio/providers";

type ModelType = NonNullable<ModelsRequest["type"]>;

const CAPABILITIES: Record<ModelType, Capability> = { image: "image", video: "video", audio: "sound" };

export function handleModels() {
  return async (req: ModelsRequest): Promise<ModelInfo[]> => {
    const types = req.type ? [req.type] : (Object.keys(CAPABILITIES) as ModelType[]);
    const out: ModelInfo[] = [];
    for (const type of types) {
      for (const model of await registry.models(CAPABILITIES[type])) {
        out.push({
          type,
          id: model.id,
          name: model.name,
          provider: model.provider,
          available: model.available,
          durations: model.durations?.map((seconds) => `${seconds}s`),
          aspectRatios: model.aspectRatios,
          features: model.features,
        });
      }
    }
    return out;
  };
}
