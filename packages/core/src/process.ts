import { spawn, type ChildProcess } from 'node:child_process';
export interface ProcessOptions {
  signal?: AbortSignal;
  onOutput?: (channel: 'stdout' | 'stderr', text: string) => void;
  timeout?: number;
  cwd?: string;
}
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  missing?: boolean;
  cancelled?: boolean;
  timedOut?: boolean;
}
export function runProcess(
  binary: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = '',
      stderr = '',
      done = false,
      cancelled = false,
      timedOut = false,
      p: ChildProcess;
    if (options.signal?.aborted)
      return resolve({ stdout, stderr: '工作已取消', exitCode: null, cancelled: true });
    const finish = (exitCode: number | null, missing = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      resolve({ stdout, stderr, exitCode, missing, cancelled, timedOut });
    };
    const kill = () => {
      if (p?.pid) {
        if (process.platform !== 'win32') {
          try {
            process.kill(-p.pid, 'SIGKILL');
          } catch {
            p.kill('SIGKILL');
          }
        } else {
          const killer = spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
          });
          killer.on('error', () => p.kill('SIGKILL'));
        }
      }
    };
    const abort = () => {
      cancelled = true;
      stderr += '\n工作已取消';
      kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stderr += '\n工具執行逾時';
      kill();
    }, options.timeout ?? 600000);
    options.signal?.addEventListener('abort', abort, { once: true });
    p = spawn(binary, args, {
      shell: false,
      detached: process.platform !== 'win32',
      cwd: options.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        ARDUINO_NETWORK_PROXY:
          process.env.ARDUINO_NETWORK_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy,
      },
    });
    p.stdout?.setEncoding('utf8');
    p.stderr?.setEncoding('utf8');
    p.stdout?.on('data', (d) => {
      const text = d.toString();
      stdout = (stdout + text).slice(-8_000_000);
      options.onOutput?.('stdout', text);
    });
    p.stderr?.on('data', (d) => {
      const text = d.toString();
      stderr = (stderr + text).slice(-8_000_000);
      options.onOutput?.('stderr', text);
    });
    p.on('error', (e) => {
      stderr += (e as Error).message;
      finish(null, (e as NodeJS.ErrnoException).code === 'ENOENT');
    });
    p.on('close', (code) => finish(cancelled || timedOut ? null : code));
  });
}
