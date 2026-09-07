/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Match, Show, Switch } from "solid-js";

import { DashboardHelpView } from "@/components/dashboard/help-view";
import { DashboardProjectsView } from "@/components/dashboard/projects-view";
import { DashboardSettingsView } from "@/components/dashboard/settings-view";
import { DashboardSidebarHeader, DashboardSidebarNav, DashboardSidebarItem } from "@/components/dashboard/sidebar";
import { Separator } from "@/components/ui/separator";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";

import type { DashboardView } from "@/components/dashboard/types";

const DASHBOARD_VIEWS: readonly DashboardView[] = [
  "projects",
  "templates",
  "settings",
  "preferences",
  "help",
];

function parseView(value: string | string[] | undefined): DashboardView {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_VIEWS.find((v) => v === raw) ?? "projects";
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const isFullscreen = useFullscreenState();

  const view = (): DashboardView => parseView(params.dashboard);
  const setView = (next: DashboardView) => setParams({ dashboard: next }, { replace: true });

  return (
    <div class="flex h-screen w-full min-h-0 flex-row overflow-hidden bg-sidebar">
      <aside class="relative flex min-h-0 w-69 shrink-0 flex-col">
        <Show when={!!window.desktop && !isFullscreen()}>
          <div class="absolute inset-x-0 top-0 h-10 z-20" style="-webkit-app-region: drag;" />
        </Show>
        <DashboardSidebarHeader />
        <DashboardSidebarNav
          footer={
            <>
              <DashboardSidebarItem active={view() === "settings"} onClick={() => setView("settings")} icon="settings" label="Settings" />
              <DashboardSidebarItem active={view() === "help"} onClick={() => setView("help")} icon="help" label="Help" />
            </>
          }
        >
          <DashboardSidebarItem active={view() === "projects"} onClick={() => setView("projects")} icon="diffusion-project-file" label="Projects" />
        </DashboardSidebarNav>
      </aside>

      <Separator orientation="vertical" class="bg-border-strong" />

      <section class="flex min-h-0 flex-1 flex-col bg-overlay-soft">
        <Switch>
          <Match when={view() === "projects"}>
            <DashboardProjectsView />
          </Match>
          <Match when={view() === "settings"}>
            <DashboardSettingsView />
          </Match>
          <Match when={view() === "help"}>
            <DashboardHelpView />
          </Match>
        </Switch>
      </section>
    </div>
  );
}
