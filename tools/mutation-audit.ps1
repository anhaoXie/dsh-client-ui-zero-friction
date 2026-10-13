# 变异审计：逐个把修复"退回"，确认对应测试真的会变红。
# 一条守卫 bug 的测试如果抓不住它守的那个 bug，它就只是安慰。
#
# 健壮性要求（这个脚本自己踩过）：
#   - 必须在 finally 里恢复源码，否则中途崩一次就把源码留在变异状态
#   - 不能因为子进程写了 stderr 就中止（node 的告警会走 stderr）
#   - 套件本身崩了要如实报出来，而不是当成"没变红"
$ErrorActionPreference = 'Continue'
$pkg = Split-Path -Parent $PSScriptRoot
$src = Join-Path $pkg "lib\client.js"
$suite = Join-Path $pkg "tools\verify.cjs"
$node = "C:\Program Files\nodejs\node.exe"
$bak = Join-Path $env:TEMP "mutate-backup.js"
Copy-Item $src $bak -Force

$mutations = @(
  @{ name = '01 去掉 sessions 声明'; expect = '声明了 sessions 服务';
     from = 'const inject = ["slots", "sessions"];'; to = 'const inject = ["slots"];' },
  @{ name = '02 create 返回值解析退化'; expect = '新话题真的开了一个新会话';
     from = 'const created = await sessions.create(cwd ? { cwd } : {});'; to = 'const created = {};' },
  @{ name = '03 路由不再排除子智能体'; expect = '命中子智能体标题时也不会投给它';
     from = 'for (const row of candidates) {'; to = 'for (const row of rows) {' },
  @{ name = '04 本地检索返回空'; expect = '边打边搜';
     from = 'const found = useMemo(() => localSearch(rows, query), [rows, query]);'; to = 'const found = useMemo(() => [], [rows, query]);' },
  @{ name = '05 摘要面板不封顶'; expect = '摘要面板默认封顶在 12 张';
     from = 'const visibleSummaries = showAllSummaries ? summarized : summarized.slice(0, SUMMARY_LIMIT);'; to = 'const visibleSummaries = summarized;' },
  @{ name = '06 子智能体不带标记'; expect = '↳ 标记';
     from = 'return (row.parentId || row.origin === "subagent") ? "↳ " + name : name;'; to = 'return name;' },
  # 07 已移除：它守的是"剥尾部虚词"。第 15 轮删掉了"任意取一段中文"的回退路径之后，
  # 这个分支成了防御性代码 —— 现有夹具再也触发不到它。按纪律，审计里不留不会红的条目。
  @{ name = '08 检索结果不截断'; expect = '规模检索命中并被截断渲染';
     from = 'return out.sort((a, b) => a.rank - b.rank).slice(0, 60);'; to = 'return out.sort((a, b) => a.rank - b.rank);' },
  @{ name = '09 HUD 去掉本该打断你'; expect = 'HUD 显示';
     from = '"本该打断你 "'; to = '"没问过你 "' },
  @{ name = '10 默认页签改成偏好'; expect = '摘要面板默认展示';
     from = 'useState("sum")'; to = 'useState("rules")' },
  @{ name = '11 账本表去掉本该打断列'; expect = '账本表头';
     from = 'h("th", null, "本该打断")'; to = 'h("th", null, "低把握")' },
  @{ name = '12 封顶提示去掉数字'; expect = '还有 N 个';
     from = '"还有 " + (list.length - limit) + " 个"'; to = '"还有更多"' },
  @{ name = '13 把排队当成需要你（第14轮纠正的语义）'; expect = '有排队工作的会话不算';
     from = 'if (planPending) needs.push("有一个计划等你批");';
     to = 'if (planPending) needs.push("有一个计划等你批"); if (inboxCount) needs.push(inboxCount + " 条排队中");' },
  @{ name = '14 关键词不再要求与标题有共同特征'; expect = '有共同特征时学到规则';
     from = 'for (let n = Math.min(6, title.length); n >= 2; n--) {';
     to = 'for (let n = 0; n >= 2; n--) {' },
  @{ name = '15 去掉排他性闸门（第15轮加的）'; expect = '特征在别的会话标题里也有时';
     from = 'const keyword = picked && isDiscriminative(picked, rows, row.id) ? picked : null;';
     to = 'const keyword = picked;' },
  # 第 16-19 个：低把握护栏与层级汇报
  @{ name = '16 去掉发送前的低把握警示'; expect = '把握低于 65% 时';
     from = 'const lowConfidence = !!(preview && !preview.pinned && preview.confidence < CONFIDENCE_WARN);';
     to = 'const lowConfidence = false;' },
  @{ name = '17 选中不再钉住发送目标'; expect = '钉住后真的投给被钉住的会话';
     from = 'const decision = pinnedRow'; to = 'const decision = null && pinnedRow' },
  @{ name = '18 看汇报改回跳页面'; expect = '点「看汇报」不会打开原生界面';
     from = 'h("button", { className: "zf-tab", onClick: () => setSelected(row.id) }, "看汇报")';
     to = 'h("button", { className: "zf-tab", onClick: () => openSession(row.id) }, "看汇报")' },
  @{ name = '19 汇报视图不显示下属'; expect = '汇报视图里点名了它手下的子智能体';
     from = 'pinnedSubs.length
					? h("div", { className: "zf-report-subs" },'; to = 'false
					? h("div", { className: "zf-report-subs" },' }
)

$rows = @()
try {
  foreach ($m in $mutations) {
    $text = [System.IO.File]::ReadAllText($bak, [System.Text.Encoding]::UTF8)
    if (-not $text.Contains($m.from)) {
      $rows += [pscustomobject]@{ 变异 = $m.name; 结果 = '锚点没找到'; 红在哪条 = '' }
      continue
    }
    [System.IO.File]::WriteAllText($src, $text.Replace($m.from, $m.to), (New-Object System.Text.UTF8Encoding $false))
    try { $out = (& $node $suite 2>&1 | Out-String) } catch { $out = "RUNNER-THREW: " + $_.Exception.Message }
    Copy-Item $bak $src -Force

    $crashed = -not ($out -match '全部通过|有失败项')
    $isRed = ($out -match '有失败项')
    $firstFail = (($out -split "`n" | Select-String "FAIL" | Select-Object -First 1) -replace '^\s+FAIL\s+', '')
    $expectedHit = $firstFail -and $firstFail.Contains($m.expect)
    $errLine = (($out -split "`n" | Select-String 'Error' | Select-Object -First 1) -as [string])
    $rows += [pscustomobject]@{
      变异 = $m.name
      结果 = if ($crashed) { '套件崩了' }
             elseif (-not $isRed) { '仍然全绿（安慰）' }
             elseif ($expectedHit) { '红在预期测试上 OK' }
             else { '红在别的测试上' }
      红在哪条 = if ($firstFail) { $firstFail.Substring(0, [Math]::Min(40, $firstFail.Length)) }
                 elseif ($errLine) { $errLine.Trim().Substring(0, [Math]::Min(40, $errLine.Trim().Length)) }
                 else { '（无）' }
    }
  }
} finally {
  Copy-Item $bak $src -Force
  Remove-Item $bak -Force -ErrorAction SilentlyContinue
}

$rows | Format-Table -AutoSize
"`n=== 恢复后全量回归 ==="
& $node $suite 2>&1 | Select-Object -Last 2
