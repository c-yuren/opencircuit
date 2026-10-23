# OpenCircuit 本機模擬

這是 Wokwi 等級平台計畫的第一階段實作。整份計畫尚未完成。

## 已實作

- MCU adapter 接口與既有 AVR8js adapter。
- 共用 VirtualClock、穩定排序 EventQueue、數位 CircuitGraph 與訊號事件。
- HIGH / LOW / Hi-Z / driver contention、pull-up/down resolution。
- Windows x64 的 ESP32 Xtensa QEMU 隔離程序 adapter。
- ESP32 真實編譯 merged BIN（bootloader、partition、application）的完整 SHA-256 驗證。
- LED、電阻連線、GPIO→按鈕→GND INPUT_PULLUP、UTF-8 UART0 輸入與輸出。
- 暫停／繼續、10 ms 虛擬時間步進、速度設定、GPIO VCD 匯出。
- CLI headless 模擬與 JSON wait / press / LED / serial assertions。
- Uno（AVR8js）與 ESP32 模組模型，完全離線，Uno 不需要額外安裝：
  - **SSD1306 OLED（I²C）**：控制位元組、Adafruit SSD1306 與 U8g2 使用的指令、水平／垂直／頁定址、方向與反相；畫面即時顯示在畫布元件與模擬面板。
  - **MPU6050（I²C）**：`WHO_AM_I`、睡眠／重設、加速度與陀螺儀量程、溫度與六軸資料暫存器；模擬面板用滑桿調整。
  - **DHT22（單線）**：偵測主機起始訊號後，依資料手冊時序逐位元回應溼度、溫度與檢查碼；模擬面板調整溫濕度。
  - **被動蜂鳴器（`official:buzzer`）**：SIG 接唯一 GPIO、GND 接地即可。模型由 GPIO 方波的上升緣間隔（虛擬時間）量測音高（20 Hz–20 kHz），並記錄音高變化，所以 `tone()` 旋律的音符長度與間隔不會因 UI 輪詢而遺失。ESP32 的 `tone()`／`ledcWrite` 走 LEDC 硬體 PWM，QEMU 引擎不會為它回報 GPIO 邊緣，所以橋接程式每 10 虛擬毫秒讀取引擎的 LEDC 內部狀態（腳位路由、通道設定、計時器頻率、佔空比），直接取得音高；不修改你的韌體，也不需要模擬專用的 `tone()` 取代。`digitalWrite` 方波仍由邊緣量測。ESP32 音符時間因此有最多 10 ms 的取樣誤差；用 `digitalWrite` 自己翻轉的方波，音高取決於呼叫負擔與引擎的虛擬時間（QEMU 實測把標稱 440／880 Hz 量成約 400／499 Hz），不是準確的音高。瀏覽器以 Web Audio 發聲；模擬面板可調整音量、音高偏移（±24 半音）、音色（方波／正弦／三角／鋸齒）、靜音，並可用「試聽」確認設定，設定存在瀏覽器 localStorage。音高永遠由韌體決定；畫布上的蜂鳴器在發聲時會顯示聲波。聲音延遲約 0.6 秒（用來排程音符），1× 以外的速度會依速度壓縮音符時間但不改變音高。CLI scenario 可用 `{"expectBuzzer":{"component":"buzzer1","frequency":440,"tolerance":0.05}}`（0 Hz = 靜音）。
  - 模型重現韌體可見的通訊與資料，不模擬 I²C 上拉、匯流排速度、雜訊或電氣特性。
- ESP32（QEMU）使用同一份 TypeScript 模型：
  - **I²C**：bridge 接收 PICSimLab 的 I²C 事件。位址階段由 bridge 依模擬計畫中的位址直接 ACK；寫入串流到主機模型；讀取時暫停 vCPU，等主機模型回覆該位元組，因此虛擬時間不會前進。
  - **DHT22 不支援**：DHT sensor library 1.4.6 呼叫 `read()` 時，PICSimLab QEMU 會發生 `Cache disabled but cached memory region accessed` 錯誤。即使不接任何模型也會發生，屬於引擎限制。請改用 Uno 模擬 DHT22。

## 模組與電壓

原本的 OLED、DHT22、MPU6050 定義為 3.3V 模組，接 Uno 的 5V 腳仍會被電氣規則拒絕。若實際使用 3.3–5V 相容模組（內建穩壓與上拉，例如 GY-521），請在元件庫選擇「（3.3–5V）」版本，例如 `official:ssd1306-oled-5v`；舊專案也能直接加入，定義會寫入該專案的 `components/catalog.json`。

```
npm run test:peripherals
```

驗收會用鎖定的 Arduino CLI 實際編譯韌體：Uno 四份（`tone()` 440／880 Hz 蜂鳴器音高、Adafruit SSD1306 文字、Wire 讀寫 MPU6050 暫存器、DHT sensor library 讀取溫濕度），ESP32 兩份（SSD1306、MPU6050），分別在 AVR8js 與 QEMU 執行，並檢查畫面像素與序列輸出；調整感測器數值後，也確認韌體讀到新的數值。未安裝 ESP32 引擎時略過 ESP32 部分，並明確顯示「略過」；`npm run test:peripherals -- uno` 只跑 Uno。

## 模擬操作

按工具列「▶」即可編譯並開始模擬。ESP32 第一次模擬時，若尚未安裝引擎或尚未套用數位模擬設定，會跳出一次確認視窗：按「安裝並開始」或「套用並開始」就會自動接續，不需要另外到面板操作。模擬面板只顯示開始／停止、重設、暫停、步進與速度；下載波形與紀錄、還原標準 Arduino 啟動、元件支援表都收在「進階」。

## 模擬中專案鎖定

模擬進行（含暫停）時，專案的來源檔（畫布、接線、程式）不能修改：

- 介面：畫布不能拖曳或接線、元件庫不能新增、復原／重做與檢視器表單停用，頂端顯示提示。
- 服務與 `hw`：所有經由專案程式碼的寫入（存檔、編輯命令、復原、`hw rollback`、換板型、套用 ESP32 設定等）都回報 `LOCKED`（「模擬進行中，專案已鎖定」）。換板型等原本會先停止模擬再修改的操作，現在直接拒絕，不會停掉模擬。
- 繞過服務直接寫檔（外部編輯器、AI agent 直接改檔、刪檔或新增來源檔）無法被拒絕，因此 **模擬會在約 0.5 秒內自動停止**，並顯示被改的檔案名稱；檔案保持被改後的樣子，不會被還原。停止後模擬標示為過期，需重新編譯並開始。
- 鎖定記錄在 `.hw/simulation.lock`（擁有者程序 ID）。擁有者程序消失（崩潰、被終止）時，下次啟動服務或執行 `hw` 會自動解鎖。
- 不受影響：`hw check`、`build`、`bom`（只寫入 `.hw/` 與產生檔）、模擬控制、按鈕輸入與感測器調整。

## 安裝與使用

Windows x64 需要 Node 與既有 Arduino CLI 工具鏈。可在環境面板按「安裝缺少套件」，或執行下列指令安裝模擬相依環境：

```
npm run setup:esp32
npm run test:simulation
```

安裝器下載 PICSimLab 0.9.3 的 Windows 套件，以公開 SHA-256 核對，只解壓 `lib/qemu/libqemu-xtensa.dll`、ESP32 ROM（`esp32-v3-rom.bin`、`esp32-v3-rom-app.bin`）、該 DLL 實際匯入的 8 個 DLL 與 `COPYING`，共約 53 MB，再刪除約 100 MB 的下載封包。PICSimLab 圖形介面、其他 MCU 引擎（RISC-V、STM32）與元件素材都不安裝。DLL 清單是從 PE 匯入表遞迴解析而得；其餘依賴為 Windows 系統 DLL。舊版安裝的完整套件會在下次「安裝缺少套件」或 `npm run slim -- engine --apply` 時修剪。引擎不放進 Git。

若缺少 64 位元 Python 3.10+，同一安裝流程會下載 [Python 3.13.16 官方可嵌入套件](https://www.python.org/downloads/release/python-31316/)，校驗官方 SHA-256，解壓到 `.local/python/`。不需要系統管理員安裝或修改 PATH。自訂 `OPENCIRCUIT_PYTHON` 時不會覆蓋該環境。環境檢查分別確認編譯工具、QEMU／ROM 與 Python，缺少模擬工具仍可編輯及編譯。

在序列面板選擇執行中的模擬器，即可傳送 UTF-8 訊息（每次上限 4096 位元組）。Uno 依 UART 接收時序排入佇列，ESP32 傳入 QEMU UART0。ESP32 暫停、繼續、速度與步進會等待引擎回應後才完成；步進回應代表已再次暫停。重設與工具啟動互斥，取消啟動會關閉引擎程序。

在模擬面板按「套用 ESP32 數位模擬設定」，再開始模擬。這會明確修改專案來源：DIO / 4MB Flash，以及 `firmware/main/opencircuit_sim_compat.cpp`。

此啟動檔讓真實 ESP32 FreeRTOS 韌體直接呼叫 Arduino `setup()` / `loop()`。PICSimLab QEMU 與鎖定 Arduino 3.3.2 的完整 OTA/NVS 初始化不相容，因此目前只提供數位啟動模式。啟動檔包含在完整 source snapshot，沒有隱藏改寫 ELF 或偽造 GPIO。

數位啟動檔會在 `setup()` 後將 UART0 接收 FIFO 中斷門檻設為 1 位元組，補足 QEMU 與實體晶片接收逾時行為的差異，避免短訊息尾端留在 FIFO。已有舊版數位啟動檔的專案，重新按「套用 ESP32 數位模擬設定」即可升級；使用者自行修改的同名檔案仍會拒絕覆蓋。傳送資料分批進入引擎，接收速度受模擬速度與韌體處理能力影響。

部署需要完整 Arduino 初始化的韌體前，按「還原標準 Arduino 啟動」。一般 Wi-Fi、OTA、NVS、Preferences、filesystem 韌體不屬於本階段支援範圍，模擬規劃會拒絕已知的相關 API。這個檢查不是完整 C++ 語義分析；未知的 API 仍可能造成引擎中的韌體崩潰。

```
npm run hw -- simulate --project PATH --headless --duration 2 --vcd trace.vcd --json
npm run hw -- simulate --project PATH --headless --scenario scenario.json --json
```

`--duration` 與 scenario wait 使用虛擬秒。速度是最高目標倍率，實際速度取決於主機 CPU；ESP32 使用 QEMU fixed icount（每個指令的固定時間量子），不宣稱 cycle accurate。10 ms 步進不是 CPU instruction step 或下一個 peripheral event step。

Scenario 格式：

```
{"steps":[{"wait":2},{"press":{"component":"button1","pressed":true}},{"wait":0.05},{"expect":{"component":"led1","state":"on"}},{"expectSerial":{"contains":"pressed"}}]}
```

`OPENCIRCUIT_ESP32_ENGINE` 可指定受信任引擎的資料夾（包含 libqemu-xtensa 與 fw/ROM）；`OPENCIRCUIT_PYTHON` 可指定 Python 執行檔。這些由本機服務設定，電路 JSON 無法指定 executable、shell 命令或動態函式。

## 分階段進度

Milestone 1：數位核心与 ESP32 adapter 已加入，範圍與驗收結果見本機 `test:simulation` 報告。

Milestones 2–10 尚待實作：完整 peripheral bus / ADC / PWM / I2C / SPI / CAN、更多元件、ESP-IDF / PlatformIO、多檔 Monaco、完整 ELF debugger / GDB UI、網路、可持久儲存、多 MCU、WASM Custom Chips SDK、VS Code extension 與完整 AI tool API。現有 Arduino CLI、版本管理、BOM 與實體燒錄功能繼續使用原本共用核心。

本階段沒有 Tauri / Rust 桌面殼重寫；先在現有 React / TypeScript / Node 架構驗證 MCU adapter，再決定 native core 的搬遷。

## 引擎來源與授權

- [PICSimLab release 0.9.3](https://github.com/lcgamboa/picsimlab/releases/tag/v0.9.3)
- [PICSimLab QEMU ABI](https://github.com/lcgamboa/picsimlab/blob/master/src/sim_backend/qemu.h)
- [ESP32 QEMU GPIO fork](https://github.com/lcgamboa/qemu/tree/picsimlab-esp32)
- [Espressif QEMU capabilities](https://github.com/espressif/esp-toolchain-docs/blob/main/qemu/README.md)

QEMU / PICSimLab 是 GPL-2.0-or-later；引擎是使用者另外安裝的獨立程序依賴。發行包含原生引擎的產品時，必須一併提供相關授權與對應原始碼，不可把該引擎視為自有閉源程式。
