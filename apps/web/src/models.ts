/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";
import { toast } from "somoto";

import type { ModelFiles, ModelProgress } from "@desktop/main-channels";
import type { ModelStore } from "@diffusionstudio/providers/providers";

const MODELS_URL = "models://store/";
const MEGABYTE = 1024 * 1024;

const downloads = new Map<string, Promise<void>>();
const progressListeners = new Map<string, (progress: ModelProgress) => void>();

function desktopModels(): ModelStore {
  mainBridge.handle(MAIN_CHANNELS.MODELS_PROGRESS, (progress) => progressListeners.get(progress.repo)?.(progress));
  return {
    async ensure(model) {
      const { present } = await mainBridge.call(MAIN_CHANNELS.MODELS_STATUS, model);
      if (!present) await download(model);
      return MODELS_URL;
    },
  };
}

function download(model: ModelFiles): Promise<void> {
  let pending = downloads.get(model.repo);
  if (!pending) {
    pending = downloadWithToast(model).finally(() => downloads.delete(model.repo));
    downloads.set(model.repo, pending);
  }
  return pending;
}

async function downloadWithToast(model: ModelFiles): Promise<void> {
  const id = `models:${model.repo}`;
  const title = "Downloading speech model";
  toast.loading(title, { id, description: model.repo });
  progressListeners.set(model.repo, ({ loaded, total }) => {
    toast.loading(title, { id, description: `${megabytes(loaded)} of ${megabytes(total)} MB` });
  });
  try {
    await mainBridge.call(MAIN_CHANNELS.MODELS_DOWNLOAD, model);
    toast.success("Speech model ready", { id, description: "Transcribing runs on this device from now on." });
  } catch (error) {
    toast.error("Speech model download failed", { id, description: (error as Error).message });
    throw error;
  } finally {
    progressListeners.delete(model.repo);
  }
}

const megabytes = (bytes: number) => Math.round(bytes / MEGABYTE);

const browserModels = (): ModelStore => ({ ensure: async () => null });

export const modelStore = window.desktop ? desktopModels() : browserModels();
