# 回滚：把 desktop profile 恢复到安装 zero-friction 插件之前。
#
# 安装改动了三处，这个脚本把它们全部还原：
#
#   1. <profile>\package.json —— dependencies 里的 link: 依赖、dsh.profile.bundles 里多出的一项
#   2. <profile>\node_modules —— pnpm 为这个依赖建立的内容（Junction 或硬链接）
#   3. （可选）pnpm-lock.yaml —— 用 -RemoveNodeModules 时一并清掉
#
# 用法：
#     pwsh -File uninstall.ps1                       # 只卸载插件，保留 node_modules 目录
#     pwsh -File uninstall.ps1 -RemoveNodeModules    # 连 node_modules / lockfile 一起删
#     pwsh -File uninstall.ps1 -ProfileDir <路径>     # 指定别的 profile
#
# 改完之后需要刷新页面，或重启 DeepSeek Harness 才会生效。
# 脚本幂等：没装过也能安全地跑。
#
# 注意：这个脚本只改 profile 文件，不碰你的会话数据（~/.dsh/sessions）。

<#
.SYNOPSIS
  从 desktop profile 卸载 zero-friction 插件。
#>
[CmdletBinding()]
param(
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop",
  [string]$PackageName = 'dsh-client-ui-zero-friction',
  [switch]$RemoveNodeModules
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ProfileDir)) { throw "找不到 profile 目录：$ProfileDir" }

$pkgFile = Join-Path $ProfileDir 'package.json'
$backupRoot = Join-Path $ProfileDir '.uninstall-backup'
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgFile (Join-Path $backupRoot "package.json.$stamp") -Force

$json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json

if ($json.dependencies.PSObject.Properties.Name -contains $PackageName) {
  $json.dependencies.PSObject.Properties.Remove($PackageName)
}
$bundles = @()
if ($json.dsh -and $json.dsh.profile -and $json.dsh.profile.bundles) {
  $bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne $PackageName })
  $json.dsh.profile.bundles = $bundles
}

# 必须写 BOM-less UTF-8：PowerShell 5.1 的 Set-Content -Encoding UTF8 会写进 BOM，
# 带 BOM 的 JSON 解析会失败，那会让 DSH 起不来。
[System.IO.File]::WriteAllText($pkgFile, ($json | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding $false))
try {
  $bytes = [System.IO.File]::ReadAllBytes($pkgFile)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw "写出来的文件带 BOM" }
  [System.IO.File]::ReadAllText($pkgFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json | Out-Null
} catch {
  Copy-Item (Join-Path $backupRoot "package.json.$stamp") $pkgFile -Force
  throw "卸载中止：写出的 package.json 校验失败（$($_.Exception.Message)），已回滚。"
}
Write-Host "已从 package.json 移除依赖与 bundle：$PackageName（已校验）" -ForegroundColor Green

$installed = Join-Path $ProfileDir "node_modules\$PackageName"
if (Test-Path $installed) {
  if ($RemoveNodeModules) {
    Write-Host "正在删除 node_modules 与 lockfile…"
    Remove-Item (Join-Path $ProfileDir 'node_modules') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $ProfileDir 'pnpm-lock.yaml') -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "保留 node_modules（用 -RemoveNodeModules 可一并删除）"
    Write-Host "  残留：$installed"
  }
}

Write-Host ""
Write-Host "卸载完成。重启 DeepSeek Harness 后，「零摩擦」面板与侧栏入口会消失。" -ForegroundColor Yellow
Write-Host "备份：$backupRoot"
