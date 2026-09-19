/** Cross-platform desktop operations kept separate from RPC routing. */
export function createSystemActions({ subprocess, platform = process.platform }) {
  const kind = platform === 'win32' ? 'win' : platform === 'linux' ? 'linux' : 'mac'

  async function run(argv) {
    try {
      const process = subprocess.spawn({
        argv,
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: { maxBytes: 4096 } },
        graceMs: 6000,
      })
      const outcome = await process.done
      return { code: outcome.exitCode }
    } catch (error) {
      return { error: String(error?.message || error) }
    }
  }

  async function openPath(value) {
    const target = String(value || '')
    if (!target) return { code: -1, error: '缺少路径' }
    if (kind === 'win') return run(['cmd', '/c', 'start', '', target])
    if (kind === 'linux') return run(['xdg-open', target])
    return run(['/usr/bin/open', target])
  }

  async function trashPath(value) {
    const target = String(value || '')
    if (!target) return { ok: false, error: '缺少路径' }
    if (kind === 'win') {
      const escaped = target.replace(/'/g, "''")
      const script = "$sh = New-Object -ComObject Shell.Application; $sh.NameSpace(10).MoveHere('" + escaped + "'); Start-Sleep -Milliseconds 300"
      const result = await run(['powershell', '-NoProfile', '-Command', script])
      return result.code === 0 ? { ok: true } : { ok: false, error: result.error || '移动失败', hint: '请确认 PowerShell 可用（Windows 10+ 自带）' }
    }
    if (kind === 'linux') {
      const primary = await run(['gio', 'trash', target])
      if (primary.code === 0) return { ok: true }
      const fallback = await run(['trash', target])
      if (fallback.code === 0) return { ok: true }
      return { ok: false, error: primary.error || fallback.error || '移动失败', hint: '请安装 gio（glib2）或 trash-cli（如: sudo apt install trash-cli）' }
    }
    const escaped = target.replace(/"/g, '\\"')
    const script = 'tell application "Finder" to delete POSIX file "' + escaped + '"'
    const result = await run(['/usr/bin/osascript', '-e', script])
    return result.code === 0 ? { ok: true } : { ok: false, error: result.error || '移动失败', hint: '如需移到废纸篓，请在 系统设置→隐私与安全性→自动化 中允许 DSH 控制 Finder' }
  }

  return { openPath, trashPath }
}
