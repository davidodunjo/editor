/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";

import {
  DashboardDividedStack,
  DashboardScrollView,
  DashboardSurfaceSection,
} from "./shared";

type DashboardHelpExternalRowProps = {
  label: string;
  href: string;
};

function DashboardHelpExternalRow(props: DashboardHelpExternalRowProps) {
  return (
    <div class="flex h-4 w-full items-center gap-4 rounded-md text-xs text-foreground outline-none focus-ring">
      <span class="min-w-0 flex-1 truncate text-left">
        {props.label}
      </span>
      <a href={props.href} target="_blank">
        <Icon name="external-link" class="text-foreground" />
      </a>
    </div>
  );
}

export function DashboardHelpView() {
  return (
    <DashboardScrollView>
      <DashboardSurfaceSection title="Resources">
        <DashboardDividedStack>
          <DashboardHelpExternalRow
            label="What's new"
            href="https://www.diffusion.studio/updates"
          />
          <DashboardHelpExternalRow
            label="Discord community"
            href="https://discord.gg/AYySWDhgNK"
          />
        </DashboardDividedStack>
      </DashboardSurfaceSection>

      <DashboardSurfaceSection title="Support">
        <DashboardDividedStack>
          <DashboardHelpExternalRow
            label="Report issue"
            href="mailto:support@diffusion.studio"
          />
          <DashboardHelpExternalRow
            label="Contact support"
            href="https://discord.gg/AYySWDhgNK"
          />
        </DashboardDividedStack>
      </DashboardSurfaceSection>

      {/* 
      <DashboardSurfaceSection title="Keyboard shortcuts">
        <DashboardInfoActionRow
          leading={<Icon name="keyboard-shortcut" class="size-6 text-foreground" />}
          title="View, search, and customize shortcuts."
          action={
            <Button variant="secondary">
              Open keyboard shortcuts...
            </Button>
          }
          layout="inline"
        />
      </DashboardSurfaceSection> 
      */}
    </DashboardScrollView>
  );
}

