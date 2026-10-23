/** Explicit source-level compatibility mode for the first digital milestone.
 * Runs the real setup/loop on FreeRTOS; storage and OTA initialization are excluded.
 * This file is part of the source snapshot, not an invisible binary patch.
 */
export const ESP32_STARTUP_FILE = 'firmware/main/opencircuit_sim_compat.cpp';
export const ESP32_LEGACY_DIGITAL_STARTUP = `#include <Arduino.h>
// OpenCircuit digital simulation startup. OTA/NVS/Wi-Fi are not supported.
// Remove this file before building firmware that needs full Arduino startup.
TaskHandle_t loopTaskHandle = nullptr;
bool loopTaskWDTEnabled = false;
extern void setup();
extern void loop();
extern "C" void app_main() {
  loopTaskHandle = xTaskGetCurrentTaskHandle();
  setup();
  for (;;) loop();
}
`;
export const ESP32_DIGITAL_STARTUP = ESP32_LEGACY_DIGITAL_STARTUP.replace(
  '  setup();',
  '  setup();\n  // QEMU RX timeout differs from silicon; request an interrupt for each byte.\n  Serial.setRxFIFOFull(1);',
);
export function isEsp32DigitalStartup(text: string | undefined) {
  return text === ESP32_DIGITAL_STARTUP || text === ESP32_LEGACY_DIGITAL_STARTUP;
}
