/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";

export function HelpMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem as="a" href="https://www.diffusion.studio/updates" target="_blank">
          What’s new
        </DropdownMenuItem>
        <DropdownMenuItem as="a" href="https://discord.gg/AYySWDhgNK" target="_blank">
          Discord community
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem as="a" href="mailto:support@diffusion.studio" target="_blank">
          Report issue
        </DropdownMenuItem>
        <DropdownMenuItem as="a" href="https://discord.gg/AYySWDhgNK" target="_blank">
          Contact support
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
