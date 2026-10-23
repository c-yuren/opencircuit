# OpenCircuit

Build circuits with your AI coding agent. Design, compile, simulate, plan materials, and upload firmware in one local workspace.

**[Download Windows x64 portable](https://github.com/c-yuren/opencircuit/releases/tag/v0.1.0-portable)** · **[Watch the demo](https://youtu.be/TlVQrfFjvt4)**

## Quick start

1. Download **OpenCircuit-Windows-x64.zip** from Releases.
2. Extract the complete folder to a writable location.
3. Double-click **start-opencircuit.cmd**.
4. Keep the command window open. The app opens at http://127.0.0.1:4318/#workspace . Press Ctrl+C to stop.

Node.js, Python, npm dependencies, Arduino CLI, AVR and ESP32 cores, Arduino libraries, and PICSimLab QEMU are included. No npm installation is needed to start. Board-specific USB drivers may still be required. Install and sign in to your AI coding agent separately.

GitHub's automatic **Source code** archives contain the runtime source and built web interface, but do not include the bundled environment. Use the portable release ZIP to run the complete package.

## What you can do

- Create circuits and let a coding agent edit the project files.
- Compile real firmware and run supported Arduino Uno and ESP32 simulations.
- Interact with supported LEDs, buttons, OLED displays, sensors, and serial messages.
- Plan inventory, purchase quantities, and material costs.
- Export projects, restore revisions, and upload firmware to a physical board.

Projects are saved under `.local/projects/`. Preserve the full folder when moving or backing up the app. Check the [simulation limits](docs/SIMULATION.md); a successful simulation does not verify physical hardware.

## 中文快速開始

1. 從 Release 下載 **OpenCircuit-Windows-x64.zip**。
2. 將整個資料夾解壓到可寫入的位置，不要直接在 ZIP 裡執行。
3. 雙擊 **start-opencircuit.cmd**，保持命令視窗開啟。
4. 瀏覽器會開啟本機工作區，按 Ctrl+C 可停止服務。

完整執行環境已內附，不需要 npm install。實體板子的 USB 驅動，以及 AI coding agent 的安裝與登入，需依使用情況另外處理。

專案存放在 `.local/projects/`，移動或備份時請保留整個資料夾。GitHub 自動產生的 Source code ZIP 不含完整環境，請下載 Release 裡的 Windows 可攜版。

## Package contents

- `start-opencircuit.cmd`: main launcher.
- `scripts/start-portable.ps1`: configures bundled tools for the current folder.
- `apps/server/`, `packages/` and `bin/`: runtime backend and CLI source.
- `dist/web/`: built browser interface.
- `node_modules/` and `.local/`: bundled runtime, toolchains, and projects in the release ZIP.
- `docs/`: simulation limits and third-party notices.

If port 4318 is busy, run this from the extracted folder:

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-portable.ps1 -ServicePort 4319`

## Source and third-party components

This is a trimmed runtime distribution of the existing OpenCircuit project. Earlier development history is available in [c-yuren/neighborhood-hacks](https://github.com/c-yuren/neighborhood-hacks). The original package metadata remains in `PORTABLE-ORIGIN.json`.

The release includes a separate third-party source reference bundle. See [third-party notices](docs/THIRD-PARTY.md). A license for the original application code has not been designated; bundled components retain their own licenses.
