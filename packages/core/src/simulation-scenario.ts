import type { SimulationAdapter } from './digital-simulation';
export type SimulationStep =
  | { wait: number }
  | { press: { component: string; pressed: boolean } }
  | { expect: { component: string; state: 'on' | 'off' } }
  | { expectSerial: { contains: string } }
  // frequency 0 = silent; tolerance is a fraction of the expected pitch (default 5%).
  | { expectBuzzer: { component: string; frequency: number; tolerance?: number } };
export async function runSimulationScenario(
  sim: SimulationAdapter,
  steps: SimulationStep[],
  timeoutMs = 30000,
) {
  if (!Array.isArray(steps) || steps.length > 1000) throw new Error('測試最多 1000 個步驟');
  const start = Date.now();
  const results: { index: number; timeNs: number; state: 'pass' }[] = [];
  for (const [index, step] of steps.entries()) {
    if ('wait' in step) {
      if (!Number.isFinite(step.wait) || step.wait < 0 || step.wait > 300)
        throw new Error('等待需為 0–300 虛擬秒');
      const target = sim.state().simulatedSeconds + step.wait;
      while (sim.state().simulatedSeconds < target) {
        if (!sim.running || sim.state().error) throw new Error(sim.state().error ?? '模擬已停止');
        if (Date.now() - start > timeoutMs) throw new Error(`模擬測試逾時，步驟 ${index + 1}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } else if ('press' in step) {
      if (typeof step.press.component !== 'string' || typeof step.press.pressed !== 'boolean')
        throw new Error('無效按鈕控制');
      sim.button(step.press.component, step.press.pressed);
    } else if ('expect' in step) {
      const value = sim.state().outputs[step.expect.component];
      if (
        !['on', 'off'].includes(step.expect.state) ||
        typeof value !== 'boolean' ||
        value !== (step.expect.state === 'on')
      )
        throw new Error(
          `步驟 ${index + 1}：${step.expect.component} 預期 ${step.expect.state}，實際 ${String(value)}`,
        );
    } else if ('expectSerial' in step) {
      if (
        typeof step.expectSerial.contains !== 'string' ||
        !sim.log.includes(step.expectSerial.contains)
      )
        throw new Error(`步驟 ${index + 1}：找不到預期序列訊息`);
    } else if ('expectBuzzer' in step) {
      const { component, frequency, tolerance = 0.05 } = step.expectBuzzer;
      const device = sim.state().peripherals?.[component];
      if (
        typeof component !== 'string' ||
        !Number.isFinite(frequency) ||
        frequency < 0 ||
        !Number.isFinite(tolerance) ||
        tolerance < 0 ||
        device?.kind !== 'buzzer'
      )
        throw new Error(`步驟 ${index + 1}：沒有此蜂鳴器或格式錯誤`);
      if (Math.abs(device.frequency - frequency) > frequency * tolerance)
        throw new Error(
          `步驟 ${index + 1}：${component} 預期 ${frequency} Hz，實際 ${device.frequency} Hz`,
        );
    } else throw new Error(`步驟 ${index + 1}：不支援的測試操作`);
    results.push({ index, timeNs: Math.round(sim.state().simulatedSeconds * 1e9), state: 'pass' });
  }
  return { state: 'pass', results, simulation: sim.state() };
}
