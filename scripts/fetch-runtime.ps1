# 自动下载 Node 运行时到 runtime\win-x64（Windows，免手动安装 Node）
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$V = 'v22.14.0'
$dir = Join-Path (Get-Location) 'runtime\win-x64'
if (Test-Path (Join-Path $dir 'node.exe')) {
  Write-Host '✓ 已内置 Node 运行时'
  exit 0
}
$file = 'node-v22.14.0-win-x64.zip'
$urls = @(
  "https://registry.npmmirror.com/-/binary/node/$V/$file",
  "https://nodejs.org/dist/$V/$file"
)
$tmp = Join-Path $env:TEMP $file
$ok = $false
foreach ($u in $urls) {
  try {
    Write-Host "▶ 正在下载 Node 运行时（约 30MB，仅首次）: $u"
    Invoke-WebRequest -Uri $u -OutFile $tmp -UseBasicParsing
    if (Test-Path $tmp) { $ok = $true; break }
  } catch {
    Write-Host "  该源失败，尝试下一个…"
  }
}
if (-not $ok) { Write-Host '✗ 下载失败，请检查网络后重试（或手动安装 Node.js）'; exit 1 }

Write-Host '▶ 解压…'
$extract = Join-Path $env:TEMP 'node-runtime-extract'
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Expand-Archive -Path $tmp -DestinationPath $extract -Force
$inner = Get-ChildItem $extract | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item (Join-Path $inner.FullName '*') $dir -Recurse -Force
Remove-Item -Recurse -Force $extract
Remove-Item -Force $tmp
Write-Host '✓ Node 运行时就绪: runtime\win-x64\node.exe'
