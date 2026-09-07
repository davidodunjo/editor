/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app } from "electron";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SkillsInstallResult } from "./main-channels";

// Junctions need no Developer Mode on Windows and still read as symlinks.
const LINK_TYPE = process.platform === "win32" ? "junction" : undefined;
const STAGED_SKILLS = /[\\/](resources|desktop)[\\/]skills[\\/]/;

const AGENT_SKILLS_DIRS = [
  ".adal/skills",
  ".agents/skills",
  ".aider-desk/skills",
  ".astrbot/data/skills",
  ".augment/skills",
  ".autohand/skills",
  ".bob/skills",
  ".claude/skills",
  ".clawdbot/skills",
  ".codeartsdoer/skills",
  ".codebuddy/skills",
  ".codeium/windsurf/skills",
  ".codemaker/skills",
  ".codestudio/skills",
  ".codex/skills",
  ".commandcode/skills",
  ".config/agents/skills",
  ".config/crush/skills",
  ".config/devin/skills",
  ".config/goose/skills",
  ".config/kimchi/harness/skills",
  ".config/opencode/skills",
  ".continue/skills",
  ".copilot/skills",
  ".cursor/skills",
  ".deepagents/agent/skills",
  ".factory/skills",
  ".firebender/skills",
  ".forge/skills",
  ".gemini/antigravity-cli/skills",
  ".gemini/antigravity/skills",
  ".gemini/skills",
  ".grok/skills",
  ".hermes/skills",
  ".iflow/skills",
  ".inferencesh/skills",
  ".jazz/skills",
  ".junie/skills",
  ".kilocode/skills",
  ".kiro/skills",
  ".kode/skills",
  ".lingma/skills",
  ".mcpjam/skills",
  ".minimax/skills",
  ".moltbot/skills",
  ".moxby/skills",
  ".mux/skills",
  ".neovate/skills",
  ".ona/skills",
  ".openclaw/skills",
  ".openhands/skills",
  ".pi/agent/skills",
  ".pochi/skills",
  ".posit/assistant/skills",
  ".qoder-cn/skills",
  ".qoder/skills",
  ".qwen/skills",
  ".reasonix/skills",
  ".roo/skills",
  ".rovodev/skills",
  ".snowflake/cortex/skills",
  ".tabnine/agent/skills",
  ".terramind/skills",
  ".tinycloud/skills",
  ".trae-cn/skills",
  ".trae/skills",
  ".vibe/skills",
  ".zcode/skills",
  ".zencoder/skills",
];

const FALLBACK_AGENT_DIR = ".claude/skills";

function stagedSkillsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(app.getAppPath(), "skills");
}

function stagedSkillNames(): string[] {
  const dir = stagedSkillsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// Agents whose config dir exists on this machine, falling back to Claude Code
// so a machine with no agent yet still gets set up for the primary one.
function targetAgentDirs(): string[] {
  const home = homedir();
  const present = AGENT_SKILLS_DIRS.filter((dir) => existsSync(join(home, dirname(dir))));
  return (present.length > 0 ? present : [FALLBACK_AGENT_DIR]).map((dir) => join(home, dir));
}

// `existsSync` follows symlinks, so a dangling link doesn't count.
export function isSkillsInstalled(): boolean {
  const home = homedir();
  const marker = stagedSkillNames()[0] ?? "editor";
  return AGENT_SKILLS_DIRS.some((dir) => existsSync(join(home, dir, marker, "SKILL.md")));
}

// ln -sf semantics that never clobber real files: an existing symlink is
// repointed (ours or the skills CLI's — the user asked to install), but a
// real directory (a `skills add --copy` install) is left alone.
function linkSkill(linkPath: string, target: string): void {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return;
    rmSync(linkPath);
  } catch {
    // nothing at linkPath
  }
  symlinkSync(target, linkPath, LINK_TYPE);
}

export function installSkills(): SkillsInstallResult {
  const source = stagedSkillsDir();
  // A quarantined first launch runs from a translocated read-only mount whose
  // path won't survive the next launch — linking to it would dangle.
  if (source.includes("/AppTranslocation/")) {
    return {
      status: "error",
      error: "Move Diffusion Studio to the Applications folder and relaunch it, then try again.",
    };
  }
  const skills = stagedSkillNames();
  if (skills.length === 0) {
    return {
      status: "error",
      error: app.isPackaged
        ? "The app bundle is missing its skills resources."
        : "Skills are not staged — run `npm run stage:skills` in apps/desktop.",
    };
  }
  try {
    for (const agentDir of targetAgentDirs()) {
      mkdirSync(agentDir, { recursive: true });
      for (const name of skills) {
        linkSkill(join(agentDir, name), join(source, name));
      }
    }
    return { status: "installed" };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

/**
 * Launch-time self-heal: links created by installSkills break when the app
 * moves or was translocated when they were made. Any symlink that targets a
 * Diffusion Studio bundle but not the running app's resources is repointed.
 * Links owned by the skills CLI and copied installs are left alone.
 */
export function healSkillsLinks(): void {
  if (!app.isPackaged) return;
  const source = stagedSkillsDir();
  if (source.includes("/AppTranslocation/")) return;

  const home = homedir();
  for (const dir of AGENT_SKILLS_DIRS) {
    for (const name of stagedSkillNames()) {
      const linkPath = join(home, dir, name);
      let target: string;
      try {
        target = readlinkSync(linkPath);
      } catch {
        continue; // missing, or not a symlink
      }
      const ours = target.includes("Diffusion Studio") || target.includes("/AppTranslocation/") || STAGED_SKILLS.test(target);
      const current = join(source, name);
      if (!ours || target === current) continue;
      try {
        rmSync(linkPath);
        symlinkSync(current, linkPath, LINK_TYPE);
      } catch {
        // best effort — the install button remains as a manual fix
      }
    }
  }
}
