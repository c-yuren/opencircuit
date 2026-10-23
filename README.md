# OpenCircuit

English | [繁體中文](README.zh-TW.md)

Build circuits with your AI coding agent. Design, compile, simulate, plan materials, and upload firmware in one local workspace.

**[Download Windows x64 portable](https://github.com/c-yuren/opencircuit/releases/tag/v0.1.0-portable)** · **[Watch the demo](https://youtu.be/TlVQrfFjvt4)**

## Quick start

1. Download **OpenCircuit-Windows-x64.zip** from Releases.
2. Extract the complete folder to a writable location. Do not run it inside the ZIP.
3. Double-click **start-opencircuit.cmd**.
4. Keep the command window open. The app opens at http://127.0.0.1:4318/#workspace . Press Ctrl+C to stop.

Node.js, Python, npm dependencies, Arduino CLI, AVR and ESP32 cores, Arduino libraries, and PICSimLab QEMU are included. No npm installation is needed to start. Board-specific USB drivers may still be required. Install and sign in to your AI coding agent separately.

GitHub's automatic **Source code** archives contain the application source and built web interface, but do not include the bundled environment. Use the portable release ZIP to run the complete package.

## What you can do

- Create circuits and let a coding agent edit the project files.
- Compile real firmware and run supported Arduino Uno and ESP32 simulations.
- Interact with supported LEDs, buttons, OLED displays, sensors, and serial messages.
- Plan inventory, purchase quantities, and material costs.
- Export projects, restore revisions, and upload firmware to a physical board.

Projects are saved under `.local/projects/`. Preserve the full folder when moving or backing up the app. Check the [simulation limits](docs/SIMULATION.md); a successful simulation does not verify physical hardware.

## Package contents

- `start-opencircuit.cmd`: main launcher.
- `scripts/start-portable.ps1`: configures bundled tools for the current folder.
- `apps/server/`, `packages/` and `bin/`: runtime backend and CLI source.
- `apps/web/` and `vite.config.ts`: browser interface source.
- `dist/web/`: built browser interface, generated from `apps/web/`.
- `node_modules/` and `.local/`: bundled runtime and toolchains in the release ZIP. Projects are created in `.local/projects/` on first start.
- `docs/`: simulation limits and third-party notices.

If the folder path is long (or contains non-ASCII characters), the launcher runs the app from a temporary drive letter that points to the folder, because the ESP32 compiler cannot handle very long paths on Windows. The drive letter is removed when you stop OpenCircuit with Ctrl+C.

If port 4318 is busy, run this from the extracted folder:

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-portable.ps1 -ServicePort 4319`

## Feedback and updates

Use **Report an issue** on the project home page or in the workspace “⋯” menu to open a GitHub issue form with your OpenCircuit version and browser filled in. **Check for updates** asks GitHub for the latest release. Both contact GitHub only when you click them, and neither sends project content or local file paths.

## Build the interface from source

Requires Node.js 22.12 or newer. Run `npm ci` once, then `npm run build` to regenerate `dist/web/` from `apps/web/`. `npm run dev` starts a live-reloading interface at http://127.0.0.1:5173 with the API on port 4318.

## License

OpenCircuit is released under the [MIT License](LICENSE). Bundled third-party components keep their own licenses. The release includes a separate third-party source reference bundle; see [third-party notices](docs/THIRD-PARTY.md).

