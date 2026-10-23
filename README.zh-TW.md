# OpenCircuit

[English](README.md) | 繁體中文

與 AI coding agent 一起建立電路，在同一個本機工作區完成設計、編譯、模擬、材料規劃與韌體燒錄。

**[下載 Windows x64 可攜版](https://github.com/c-yuren/opencircuit/releases/tag/v0.1.0-portable)** · **[觀看示範影片](https://youtu.be/TlVQrfFjvt4)**

## 快速開始

1. 從 Release 下載 **OpenCircuit-Windows-x64.zip**。
2. 將整個資料夾解壓到可寫入的位置，不要直接在 ZIP 裡執行。
3. 雙擊 **start-opencircuit.cmd**。
4. 保持命令視窗開啟，瀏覽器會開啟 http://127.0.0.1:4318/#workspace 。按 Ctrl+C 可停止服務。

套件已內附 Node.js、Python、npm 依賴、Arduino CLI、AVR 與 ESP32 核心、Arduino 函式庫及 PICSimLab QEMU，啟動不需要 npm install。實體板子的 USB 驅動可能需要另行安裝，AI coding agent 也需自行安裝與登入。

GitHub 自動產生的 **Source code** 壓縮檔只有執行程式與已建置介面，不含完整環境。請下載 Release 裡的 Windows 可攜版來執行。

## 功能介紹

- 建立電路，並讓 coding agent 編輯專案檔案。
- 使用真正的工具鏈編譯韌體，執行支援的 Arduino Uno 與 ESP32 模擬。
- 操作支援的 LED、按鈕、OLED、感測器與序列訊息。
- 規劃庫存、購買數量及材料費用。
- 匯出專案、還原版本，並將韌體燒錄到實體開發板。

專案存放在 `.local/projects/`，移動或備份時請保留整個資料夾。使用前請閱讀[模擬限制](docs/SIMULATION.md)；模擬成功不代表實體電路已經通過驗證。

## 套件內容

- `start-opencircuit.cmd`：主要啟動入口。
- `scripts/start-portable.ps1`：依目前資料夾位置設定內附工具。
- `apps/server/`、`packages/`、`bin/`：執行時需要的後端與 CLI 原始程式。
- `dist/web/`：已建置的瀏覽器介面。
- `node_modules/`、`.local/`：Release ZIP 內附的執行環境、工具鏈與專案。
- `docs/`：模擬限制與第三方授權說明。

若連接埠 4318 被占用，請在解壓後的資料夾執行以下指令，改用 4319：

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-portable.ps1 -ServicePort 4319`

## 來源與第三方元件

Release 另附第三方原始碼參考包，詳見[第三方元件說明](docs/THIRD-PARTY.md)。OpenCircuit 原創應用程式目前尚未指定授權條款；內附元件各自保留原有授權。
