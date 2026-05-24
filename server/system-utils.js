import { execFile } from 'node:child_process';
import net from 'node:net';

export function execFileText(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: 8000,
        ...options,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      },
    );
  });
}

export function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function listSystemJavaProcesses() {
  if (process.platform !== 'win32') {
    const result = await execFileText('ps', ['-ef'], { timeout: 8000 });
    if (!result.ok) {
      return [];
    }

    return result.stdout
      .split(/\r?\n/)
      .filter((line) => /spring-boot:run|server\.port|java/i.test(line))
      .map((line) => ({
        processId: null,
        parentProcessId: null,
        name: 'process',
        commandLine: line,
      }));
  }

  const command = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'spring-boot:run|server\\.port|maven\\.multiModuleProjectDirectory' }",
    '| Select-Object ProcessId,ParentProcessId,Name,CommandLine',
    '| ConvertTo-Json -Depth 4',
  ].join(' ');
  const result = await execFileText('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    timeout: 12000,
  });
  if (!result.ok || !result.stdout) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((item) => item?.CommandLine)
      .map((item) => ({
        processId: Number(item.ProcessId) || null,
        parentProcessId: Number(item.ParentProcessId) || null,
        name: item.Name ?? 'process',
        commandLine: item.CommandLine,
      }));
  } catch {
    return [];
  }
}

export function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 800 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function runPowerShell(script) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('当前系统不支持本地路径选择'));
  }

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: false, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

export async function pickLocalPath(type) {
  if (type === 'file') {
    return runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择项目文件'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.FileName
}
`);
  }

  return runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择项目文件夹'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
`);
}
