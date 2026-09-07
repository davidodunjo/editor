/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onMount, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { toast } from 'somoto';

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { createStoredSignal } from '@/lib/store';
import { mainBridge } from '@/lib/ipc';
import { store } from '@/init';

const SKILLS_COMMAND = 'npx skills add diffusionstudio/skills -g -y --all';

const [onboardingCompleted, setOnboardingCompleted] = createStoredSignal(
  store.define('onboarding.completed', false),
);

export { onboardingCompleted };

type StepState = 'todo' | 'busy' | 'done';

type SetupRowProps = {
  title: string;
  description: string;
  action?: JSX.Element;
};

function SetupRow(props: SetupRowProps) {
  return (
    <div class="flex items-center gap-4">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <p class="text-xs text-foreground">{props.title}</p>
        <p class="text-xs text-muted-foreground">{props.description}</p>
      </div>
      {props.action}
    </div>
  );
}

type StepButtonProps = {
  state: StepState;
  label: string;
  busyLabel?: string;
  doneLabel: string;
  onClick: () => void;
};

function StepButton(props: StepButtonProps) {
  return (
    <Show
      when={props.state !== 'done'}
      fallback={
        <Button variant="on" class="pointer-events-none">
          {props.doneLabel}
        </Button>
      }
    >
      <Button
        variant="secondary"
        disabled={props.state === 'busy'}
        onClick={props.onClick}
      >
        {props.state === 'busy' ? props.busyLabel ?? props.label : props.label}
      </Button>
    </Show>
  );
}

/**
 * First-run screen for setting up the agent dependencies: the dapi CLI and
 * the agent skills. Shown until dismissed; the dismissal is per-device.
 *
 * On desktop the CLI button links the bundled CLI into PATH via main (the
 * same flow as the "Install dapi Command Line Tool…" menu item). On the web
 * the CLI cannot be installed, so only the skills step has an action.
 */
export function OnboardingPage() {
  const isDesktop = !!window.desktop;
  const [cliState, setCliState] = createSignal<StepState>('todo');
  const [skillsState, setSkillsState] = createSignal<StepState>('todo');

  onMount(async () => {
    if (!isDesktop) return;
    try {
      const [cli, skills] = await Promise.all([
        mainBridge.call(MAIN_CHANNELS.CLI_IS_INSTALLED, undefined),
        mainBridge.call(MAIN_CHANNELS.SKILLS_IS_INSTALLED, undefined),
      ]);
      if (cli) setCliState('done');
      if (skills) setSkillsState('done');
    } catch {
      // Can't tell — leave the install buttons available.
    }
  });

  const installCli = async () => {
    setCliState('busy');
    try {
      const result = await mainBridge.call(MAIN_CHANNELS.CLI_INSTALL, undefined);
      if (result.status === 'installed') {
        setCliState('done');
      } else {
        setCliState('todo');
        if (result.status === 'error') {
          toast('Could not install the dapi CLI', { description: result.error });
        }
      }
    } catch (error) {
      setCliState('todo');
      toast('Could not install the dapi CLI', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const copySkillsCommand = async () => {
    try {
      await navigator.clipboard.writeText(SKILLS_COMMAND);
      setSkillsState('done');
      toast('Copied!', {
        description: 'Run the command in your terminal to install the agent skills.',
      });
    } catch (error) {
      toast('Failed to copy', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const installSkills = async () => {
    setSkillsState('busy');
    try {
      const result = await mainBridge.call(MAIN_CHANNELS.SKILLS_INSTALL, undefined);
      if (result.status === 'installed') {
        setSkillsState('done');
        return;
      }
      setSkillsState('todo');
      toast('Could not install the agent skills', { description: result.error });
    } catch (error) {
      setSkillsState('todo');
      toast('Could not install the agent skills', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const allDone = () => (!isDesktop || cliState() === 'done') && skillsState() === 'done';

  const finish = () => setOnboardingCompleted(true);

  return (
    <div class="flex flex-col bg-background fixed inset-0 z-999">
      <Show when={!isDesktop}>
        <div class="flex items-center gap-1 p-4">
          <Icon name="diffusion-logo" class="size-6" />
          <span class="text-sm font-450 text-foreground">Diffusion Studio</span>
        </div>
      </Show>

      <div class="flex flex-1 items-center justify-center pb-16">
        <div class="flex w-124 max-w-[calc(100vw-2rem)] flex-col gap-6">
          <div class="flex flex-col">
            <div class="flex flex-col gap-1 px-2 pt-2 pb-3">
              <h2 class="text-[12px] font-450 text-foreground">Connect your agent</h2>
              <p class="text-xs text-muted-foreground">
                Edit videos with coding agents like Claude Code, Codex, or Cursor.
              </p>
            </div>

            <div class="flex flex-col gap-3 rounded-xl bg-accent/40 p-4">
              <SetupRow
                title="dapi CLI"
                description={
                  isDesktop
                    ? 'The command line tool for agents to control the editor.'
                    : 'The command line tool for agents. Ships with the desktop app.'
                }
                action={
                  <Show when={isDesktop}>
                    <StepButton
                      state={cliState()}
                      label="Install"
                      busyLabel="Installing…"
                      doneLabel="Installed"
                      onClick={installCli}
                    />
                  </Show>
                }
              />

              <div class="h-px w-full bg-border" />

              <SetupRow
                title="Agent skills"
                description="Instructions that help agents edit videos through dapi."
                action={
                  isDesktop ? (
                    <StepButton
                      state={skillsState()}
                      label="Install"
                      busyLabel="Installing…"
                      doneLabel="Installed"
                      onClick={installSkills}
                    />
                  ) : (
                    <StepButton
                      state={skillsState()}
                      label="Copy command"
                      doneLabel="Copied"
                      onClick={copySkillsCommand}
                    />
                  )
                }
              />
            </div>
          </div>

          <div class="flex items-center gap-2 px-2">
            <Button disabled={!allDone()} onClick={finish}>
              Get started
            </Button>
            <Button variant="ghost" class="text-muted-foreground" onClick={finish}>
              Setup later
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
