/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Router, HashRouter, Route } from '@solidjs/router';
import { ColorModeProvider } from '@kobalte/core';
import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Toaster } from "@/components/ui/sonner";
import { AppContextMenu } from "@/components/app-context-menu";

import { PersistRoute } from '@/lib/persist-route';
import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { useFullscreenState } from '@/hooks/use-fullscreen-state';
import { EditorApi } from '@/context/dapi';
import { ScreenTooSmall } from '@/components/screen-too-small';
import { UnsupportedBrowser } from '@/components/unsupported-browser';
import { ProjectPage } from '@/pages/project';
import { OnboardingPage, onboardingCompleted } from '@/pages/onboarding';
import { NotFoundPage } from '@/pages/not-found';
import { DashboardPage } from '@/pages/dashboard';

function OnboardingGate(props: { children: JSX.Element }) {
  const [headless, setHeadless] = createSignal(false);

  onMount(() => {
    if (!window.desktop) return;

    mainBridge
      .call(MAIN_CHANNELS.HEADLESS_GET_MODE, undefined)
      .then(setHeadless);

    onCleanup(mainBridge.handle(MAIN_CHANNELS.HEADLESS_MODE, ({ active }) => setHeadless(active)));
  });

  return (
    <Show when={onboardingCompleted() || headless()} fallback={<OnboardingPage />}>
      {props.children}
    </Show>
  );
}

function WindowDragStrip() {
  const isFullscreen = useFullscreenState();
  return (
    <Show when={!!window.desktop && !isFullscreen()}>
      <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
    </Show>
  );
}

function BootSplash() {
  onMount(() => document.getElementById('boot-splash')?.remove());
  return null;
}

function App() {
  const RouterComponent = window.desktop ? HashRouter : Router;
  return (
    <RouterComponent
      root={(props) => (
        <ColorModeProvider initialColorMode="dark">
          <AppContextMenu>
            {props.children}
            <WindowDragStrip />
            <BootSplash />
            <EditorApi />
          </AppContextMenu>
          <Toaster />
          <ScreenTooSmall />
          <UnsupportedBrowser />
          <PersistRoute />
        </ColorModeProvider>
      )}
    >
      <Route path="/" component={() => <OnboardingGate><DashboardPage /></OnboardingGate>} />
      <Route path="/projects/*ref" component={() => <OnboardingGate><ProjectPage /></OnboardingGate>} />
      <Route path="*404" component={NotFoundPage} />
    </RouterComponent>
  );
}

export default App;
