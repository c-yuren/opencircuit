# Third-party components and sources

OpenCircuit's application code and its separately installed or bundled tools are distinct components. Original license and copyright notices remain in the npm packages, Node.js, Python, board packages, libraries and PICSimLab directories. The original OpenCircuit application code is licensed under the MIT License (see [LICENSE](../LICENSE)); that license does not change the terms of any third-party component.

## Windows portable tools

- **Node.js 24.15.0:** [official release and source archives](https://nodejs.org/dist/v24.15.0/). The bundled distribution includes `LICENSE`.
- **Python 3.13.16:** [official release](https://www.python.org/downloads/release/python-31316/). The embedded distribution includes `LICENSE.txt`. Its downloaded ZIP is checked against SHA-256 `97dae5274cc54867065e8d5a3226e48c35017ed332a0fdb0e27d5b5821961297`.
- **Arduino CLI 1.3.1:** [source and release](https://github.com/arduino/arduino-cli/releases/tag/v1.3.1), [license](https://github.com/arduino/arduino-cli/blob/v1.3.1/LICENSE.txt).
- **Arduino AVR core 1.8.6:** [source](https://github.com/arduino/ArduinoCore-avr/tree/1.8.6). Tool binaries are supplied through Arduino's package index; their licenses and source references belong to the respective tool distributions.
- **Arduino ESP32 core 3.3.2:** [source and release](https://github.com/espressif/arduino-esp32/releases/tag/3.3.2). Espressif toolchain releases, including source packages where provided, are available from [crosstool-NG](https://github.com/espressif/crosstool-NG/releases). Installed versions are recorded in the bundled board packages and package index.
- **AVR8js 0.21.0:** [source](https://github.com/wokwi/avr8js), with a retained notice at [licenses/AVR8js-LICENSE.txt](licenses/AVR8js-LICENSE.txt).
- **npm dependencies:** exact dependency resolution is recorded in `package-lock.json`; license notices remain in each bundled `node_modules` package.
- **Arduino libraries:** Adafruit SSD1306 2.5.13, GFX Library 1.12.1, BusIO 1.17.2, DHT sensor library 1.4.6, Unified Sensor 1.1.15 and U8g2 2.36.12. Their original source and license files remain under `.local/arduino/user/libraries` in the portable distribution.

## PICSimLab QEMU

The portable bundle uses selected, unmodified files from [PICSimLab 0.9.3](https://github.com/lcgamboa/picsimlab/releases/tag/v0.9.3), not the full PICSimLab application. The upstream Windows ZIP is `PICSimLab_0.9.3_260920_win64.zip`, SHA-256 `b7014c97a839dc388a253fde10c1914ccb5f9a691e58e540831ba1e6bb208138`. `COPYING` remains beside the bundled engine and dependency DLLs.

Source references:

- [PICSimLab v0.9.3 source](https://github.com/lcgamboa/picsimlab/tree/v0.9.3), including the Windows build scripts and QEMU ABI.
- The bundled `libqemu-xtensa.dll` identifies itself as `QEMU emulator version 9.2.2 (v4.1.0-28486-g75bd5828e5-dirty)`.
- Its identified QEMU source base is [75bd5828e58ad4925451bf1fd28b0ff79269b927](https://github.com/lcgamboa/qemu/tree/75bd5828e58ad4925451bf1fd28b0ff79269b927), on the PICSimLab ESP32 fork. The `-dirty` suffix is retained here: the source base alone is not proof of a bit-for-bit reproducible upstream binary.
- Upstream development and build instructions: [PICSimLab ESP32 QEMU branch](https://github.com/lcgamboa/qemu/tree/picsimlab-esp32).

The release includes `OpenCircuit-third-party-sources.zip`, containing the PICSimLab release source, the identified QEMU source base, this notice and the retained engine license. It is a source reference bundle, not a claim that every third-party tool in the portable environment can be rebuilt bit-for-bit from that one archive. Other tools' source references are listed above and in their distributions.

QEMU/PICSimLab and related dependencies retain their upstream GPL/LGPL or other applicable terms; they are not proprietary OpenCircuit code. This document records provenance rather than replacing those terms.
