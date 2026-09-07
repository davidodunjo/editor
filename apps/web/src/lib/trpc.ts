/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";

import type { AppRouter } from "@diffusionstudio/api-contract";

export const CLOUD_AI_UNAVAILABLE = "Cloud AI is not available in this build yet";

const apiUrl = import.meta.env.VITE_API_URL as string | undefined;

const unavailableLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    observer.error(TRPCClientError.from(new Error(CLOUD_AI_UNAVAILABLE), { meta: { path: op.path } }));
  });

export const trpc = createTRPCClient<AppRouter>({
  links: [apiUrl ? httpBatchLink({ url: `${apiUrl}/api/trpc` }) : unavailableLink],
});
