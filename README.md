# OpenCircuit

Build circuits with your AI coding agent. Design, compile, simulate, plan materials, and upload firmware in one local workspace.

與 AI coding agent 一起建立電路，在同一個本機工作區完成設計、編譯、模擬、材料規劃與韌體燒錄。

**[Download Windows x64 portable](https://github.com/c-yuren/opencircuit/releases/tag/v0.1.0-portable)** · **[Watch the demo](https://youtu.be/TlVQrfFjvt4)**

**[下載 Windows x64 可攜版](https://github.com/c-yuren/opencircuit/releases/tag/v0.1.0-portable)** · **[觀看示範影片](https://youtu.be/TlVQrfFjvt4)**

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

套件已內附 Node.js、Python、npm 依賴、Arduino CLI、AVR 與 ESP32 核心、Arduino 函式庫及 PICSimLab QEMU，啟動不需要 npm install。實體板子的 USB 驅動，以及 AI coding agent 的安裝與登入，需依使用情況另外處理。預設工作區網址為 http://127.0.0.1:4318/#workspace 。

專案存放在 `.local/projects/`，移動或備份時請保留整個資料夾。GitHub 自動產生的 Source code ZIP 不含完整環境，請下載 Release 裡的 Windows 可攜版。

### 功能介紹

- 建立電路，並讓 coding agent 編輯專案檔案。
- 使用真正的工具鏈編譯韌體，執行支援的 Arduino Uno 與 ESP32 模擬。
- 操作支援的 LED、按鈕、OLED、感測器與序列訊息。
- 規劃庫存、購買數量及材料費用。
- 匯出專案、還原版本，並將韌體燒錄到實體開發板。

使用前請閱讀[模擬限制](docs/SIMULATION.md)；模擬成功不代表實體電路已經通過驗證。

## Package contents / 套件內容

- `start-opencircuit.cmd`: main launcher.
- `scripts/start-portable.ps1`: configures bundled tools for the current folder.
- `apps/server/`, `packages/` and `bin/`: runtime backend and CLI source.
- `dist/web/`: built browser interface.
- `node_modules/` and `.local/`: bundled runtime, toolchains, and projects in the release ZIP.
- `docs/`: simulation limits and third-party notices.

中文說明：

- `start-opencircuit.cmd`：主要啟動入口。
- `scripts/start-portable.ps1`：依目前資料夾位置設定內附工具。
- `apps/server/`、`packages/`、`bin/`：執行時需要的後端與 CLI 原始程式。
- `dist/web/`：已建置的瀏覽器介面。
- `node_modules/`、`.local/`：Release ZIP 內附的執行環境、工具鏈與專案。
- `docs/`：模擬限制與第三方授權說明。

If port 4318 is busy, run this from the extracted folder:

若連接埠 4318 被占用，請在解壓後的資料夾執行以下指令，改用 4319：

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-portable.ps1 -ServicePort 4319`

## Source and third-party components / 來源與第三方元件

This is a trimmed runtime distribution of the existing OpenCircuit project. Earlier development history is available in [c-yuren/neighborhood-hacks](https://github.com/c-yuren/neighborhood-hacks). The original package metadata remains in `PORTABLE-ORIGIN.json`.

The release includes a separate third-party source reference bundle. See [third-party notices](docs/THIRD-PARTY.md). A license for the original application code has not been designated; bundled components retain their own licenses.

這是既有 OpenCircuit 專案的精簡執行版本，更早的開發歷史保留在 [c-yuren/neighborhood-hacks](https://github.com/c-yuren/neighborhood-hacks)。原可攜套件的來源資訊保留於 `PORTABLE-ORIGIN.json`。

Release 另附第三方原始碼參考包，詳見[第三方元件說明](docs/THIRD-PARTY.md)。OpenCircuit 原創應用程式目前尚未指定授權條款；內附元件各自保留原有授權。
