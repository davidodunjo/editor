# Diffusion Studio

A fork of [diffusionstudio/editor](https://github.com/diffusionstudio/editor), the video editor built for agents, made to run on Windows and to work without a paid backend. Edits are code: a project is a folder of JSX, your coding agent edits the files through the `dapi` CLI and the `editor` skill, and the app renders the result.

## Requirements

Install Node 20 or newer:

```powershell
winget install OpenJS.NodeJS.LTS --source winget
```

Install Microsoft WinApp CLI only if you need to build the Windows MSIX package:

```powershell
winget install Microsoft.WinAppCLI --source winget
```

## Setup

Clone this repository and the skills repository side by side, then install dependencies from the repo root:

```powershell
git clone https://github.com/davidodunjo/editor.git
git clone https://github.com/davidodunjo/diffusion-skills.git skills
cd editor
npm install
```

Create the client env file. The app does not start without it:

```powershell
Copy-Item apps/web/.env.example apps/web/.env
```

## Development

Run the desktop app from source. This builds the CLI, starts the web dev server, then launches Electron:

```powershell
npm run dev
```

Put `dapi` on your PATH. On Windows this writes a shim into your WindowsApps folder; on macOS it links into Homebrew's bin:

```powershell
npm run symlink:create --workspace=@diffusionstudio/cli
```

Stage the agent skills from the sibling checkout, then use Install in the app's onboarding:

```powershell
npm run stage:skills --workspace=@diffusionstudio/desktop
```

## Checks

Run from the repo root:

```powershell
npm run check
npm run lint
```

## Windows MSIX

Windows builds are signed with your own development certificate and installed as an MSIX package. There is no public installer.

Generate a local development certificate from `apps/desktop`:

```powershell
cd apps/desktop
winapp cert generate --if-exists skip
```

Install the certificate once. Run this from an elevated PowerShell prompt:

```powershell
cd apps/desktop
winapp cert install .\devcert.pfx
```

Build, sign and install the package from the repo root. Run the same command to upgrade after bumping the version:

```powershell
npm run msix:install --workspace=@diffusionstudio/desktop
```

The installed app registers a `diffusionstudio` command. Its onboarding installs `dapi` and the agent skills. The package, the staged files and the certificate are ignored by git.

Regenerate the tile images after changing the app icon:

```powershell
npm run make:assets --workspace=@diffusionstudio/desktop
```

## macOS

Build the DMG as upstream does:

```sh
npm run make --workspace=@diffusionstudio/desktop
```

## Status

Windows support is complete: development, packaging and the CLI. Sign-in, billing and telemetry are removed; the app runs offline with no account. Cloud features still call the upstream backend and fail without it: generation, transcription, `dapi media listen`, upscaling and background removal. Replacing them with user-supplied API keys and local models is the next piece of work.

## License

[MPL-2.0](LICENSE)

The brand assets in [apps/desktop/assets](apps/desktop/assets) are not covered by this license. Copyright (c) Diffusion Studio Inc. All rights reserved.
