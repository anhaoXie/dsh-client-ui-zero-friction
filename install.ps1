# 把 zero-friction 插件装进一个 DSH profile。
#
# 做三件事，全部幂等：
#   1. 在 profile 的 package.json 里登记 `link:` 依赖（link 而不是 file：
#      file 会被 pnpm 硬链接复制，之后源码改动进不去）
#   2. 把包名加进 dsh.profile.bundles（这个包自带 cordis.patch.yml，会插入自己的行）
#   3. 用 DSH 自带的 pnpm 安装
#
# 用法：
#   pwsh -File install.ps1                                  # 装进默认的 desktop profile
#   pwsh -File install.ps1 -ProfileDir <路径>                # 装进别的 profile
#   pwsh -File install.ps1 -DshHome <路径> -ProfileDir <路径> # 完全自定义（测试用）
#
# 装完需要刷新页面；侧栏没出现「零摩擦」就重启应用。

[CmdletBinding()]
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\DeepSeek Harness",
  [string]$DshHome = "$env:USERPROFILE\.dsh",
  [string]$ProfileDir,
  [string]$PackageName = 'dsh-client-ui-zero-friction',
  [string]$PackagePath,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

if (-not $ProfileDir) { $ProfileDir = Join-Path $DshHome 'profiles\desktop' }
if (-not $PackagePath) { $PackagePath = Split-Path -Parent $MyInvocation.MyCommand.Path }
$PackagePath = (Resolve-Path $PackagePath).Path

Write-Host "插件源码 : $PackagePath"
Write-Host "目标 profile: $ProfileDir"

if (-not (Test-Path (Join-Path $ProfileDir 'package.json'))) {
  throw "找不到 profile 的 package.json。用 -ProfileDir 指定一个存在的 profile。"
}
if (-not (Test-Path (Join-Path $PackagePath 'lib\client.js'))) {
  throw "插件源码不完整：$PackagePath\lib\client.js 不存在。"
}

# ---------- 1 & 2. 改 package.json（先备份） ----------
$pkgFile = Join-Path $ProfileDir 'package.json'
$backupDir = Join-Path $ProfileDir '.install-backup'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgFile (Join-Path $backupDir "package.json.$stamp") -Force
Write-Host "已备份 package.json → .install-backup\package.json.$stamp"

$json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
$spec = 'link:' + ($PackagePath -replace '\\', '/')

if (-not $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force }
$json.dependencies | Add-Member -NotePropertyName $PackageName -NotePropertyValue $spec -Force

if (-not $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
if (-not $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
$bundles = @()
if ($json.dsh.profile.bundles) { $bundles = @($json.dsh.profile.bundles) }
if ($bundles -notcontains $PackageName) { $bundles = $bundles + $PackageName }
$json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force

if ($WhatIf) {
  Write-Host "[WhatIf] 将写入 dependencies.$PackageName = $spec"
  Write-Host "[WhatIf] 将写入 dsh.profile.bundles = [$($bundles -join ', ')]"
} else {
  # 必须写 BOM-less UTF-8：Windows PowerShell 5.1 的 Set-Content -Encoding UTF8
  # 会写进 BOM，而带 BOM 的 JSON 解析会失败 —— 那会让 DSH 直接起不来。
  $jsonText = $json | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($pkgFile, $jsonText, (New-Object System.Text.UTF8Encoding $false))

  # 写后自校验：解析不了就立刻回滚，绝不留下一个坏掉的 profile
  try {
    $bytes = [System.IO.File]::ReadAllBytes($pkgFile)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw "写出来的文件带 BOM" }
    [System.IO.File]::ReadAllText($pkgFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json | Out-Null
  } catch {
    Copy-Item (Join-Path $backupDir "package.json.$stamp") $pkgFile -Force
    Write-Warning "写出的 package.json 校验失败（$($_.Exception.Message)），已回滚到备份。"
    throw "安装中止：profile 未被修改。"
  }
  Write-Host "已登记依赖与 bundle（已校验：可解析、无 BOM）" -ForegroundColor Green
}

# ---------- 3. pnpm install ----------
$pnpm = Join-Path $InstallDir 'resources\runtime\pnpm\bin\pnpm.mjs'
if (-not (Test-Path $pnpm)) { throw "找不到 DSH 自带的 pnpm：$pnpm（用 -InstallDir 指定安装目录）" }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCmd) { $nodeCmd.Source } else { $null }
if (-not $node) {
  $bundled = Join-Path $InstallDir 'resources\runtime\bin\node.exe'
  if (Test-Path $bundled) { $node = $bundled }
}
if (-not $node) { throw "找不到 node（系统 PATH 和 DSH 自带目录里都没有）" }

Write-Host "用 $node 跑 pnpm install …"
if ($WhatIf) {
  Write-Host "[WhatIf] 跳过安装"
} else {
  Push-Location $ProfileDir
  try {
    & $node $pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（exit $LASTEXITCODE）" }
  } finally { Pop-Location }
  $linked = Join-Path $ProfileDir "node_modules\$PackageName"
  if (Test-Path $linked) {
    $item = Get-Item $linked
    Write-Host "已安装：$($item.Name)  ($($item.LinkType) → $($item.Target))" -ForegroundColor Green
  } else {
    Write-Warning "pnpm 跑完了但 node_modules\$PackageName 不存在，请检查上面的输出。"
  }
}

Write-Host ""
Write-Host "下一步：刷新页面（Ctrl+R）。侧栏没出现「零摩擦」就重启 DeepSeek Harness。" -ForegroundColor Yellow
