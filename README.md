# OpenCircuit ??Windows x64 portable

## ??雿輻

1. 撠???冗?曉?臬神?亦?雿蔭嚗?閬 ZIP 鋆∠?亙銵?2. ?? `start-opencircuit.cmd`??3. ?汗?冽??? http://127.0.0.1:4318/#workspace ???隞方?蝒?????Ctrl+C ?迫??
?折? Node.js?ython?pm 靘陷?rduino CLI?VR嚗SP32 ?詨???摰??祉? Arduino ?賢?摨怨? PICSimLab QEMU??蝡臬歇撱箇蔭嚗????閬?npm install?SB 撽?隞?撖阡??踹?????
?臬遣蝡蝺楊霅臬?璅⊥?舀??Arduino Uno嚗SP32 ?餉楝嚗?????????箏?獢?銝血??????啣祕擃??潭????隢撠?? USB ?I coding agent ??芾?摰???乓?
撠??脣???`.local/projects/`?宏???遢??????冗?芋?祇??嗉? [docs/SIMULATION.md](docs/SIMULATION.md)?芋?祆???隞?”撖阡??餉楝撌脤?霅?
???◤????臬銵?

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-portable.ps1 -ServicePort 4319`

## Quick start

Extract the complete folder to a writable location, then double-click `start-opencircuit.cmd`. Keep the command window open while using the app. Press Ctrl+C to stop.

The runtime, compiler toolchains, supported simulation engine, and built frontend are bundled. No npm installation is needed to start. Board-specific USB drivers and a separately installed AI coding agent may still be required.

Projects are stored in `.local/projects/`. Preserve the full folder when moving or backing up the app. See [simulation limits](docs/SIMULATION.md) before relying on a peripheral or board feature.

## 敹?瑼? / Package contents

- `start-opencircuit.cmd`?install-and-start.cmd`嚗??????抵?雿輻?折??啣???- `scripts/start-portable.ps1`嚗??桀?鞈?憭曆?蝵株身摰蒂??????- `apps/server/`?packages/`?bin/`嚗?蝡航? CLI ??蝔?嚗銵??閬?- `dist/web/`嚗歇撱箇蔭?雯???Ｕ?- `node_modules/`?.local/`嚗銵?鞈氬楊霅臬?芋?砍??獢???- `package.json`?package-lock.json`?tsconfig.json`嚗?鞈渲? TypeScript ?瑁?閮剖???- `docs/`嚗芋?祇??嗉?蝚砌??寞?甈牧??- `PORTABLE-ORIGIN.json`嚗??隞嗡?皞?閮?
??瑁??典?隞塚?皜祈岫???潛?垢??擗牧?歇蝘駁???湧??澆?憪Ⅳ?風?脰? [GitHub](https://github.com/c-yuren/neighborhood-hacks)?riginal application licensing has not been designated; bundled third-party notices remain with their respective components.

## Source provenance

This is a trimmed runtime distribution of the existing OpenCircuit project, published on October 23, 2026. Earlier development history remains in [c-yuren/neighborhood-hacks](https://github.com/c-yuren/neighborhood-hacks). This repository publication is not a claim that development began on its first commit date. The original portable package metadata is retained in PORTABLE-ORIGIN.json.
