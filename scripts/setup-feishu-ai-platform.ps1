$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Write-Step($text) {
    Write-Host ""
    Write-Host "== $text ==" -ForegroundColor Cyan
}

function Test-Server {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:3066/api/feishu-cli/status" -Method Get -TimeoutSec 5 | Out-Null
        return $true
    } catch {
        return $false
    }
}

Write-Host "AI生图自动化平台 - 飞书机器人极简配置" -ForegroundColor Green
Write-Host "你只需要在飞书页面完成确认，然后给机器人发送：绑定平台" -ForegroundColor Yellow

Write-Step "1. 检查本地服务"
if (-not (Test-Server)) {
    Write-Host "本地服务未运行，正在启动 node server.js..."
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput "server-runtime.log" -RedirectStandardError "server-runtime.err.log"
    Start-Sleep -Seconds 5
}

if (-not (Test-Server)) {
    throw "本地服务没有启动成功，请先运行 npm start 或 node server.js"
}
Write-Host "本地服务正常：http://127.0.0.1:3066" -ForegroundColor Green

Write-Step "2. 写入首次绑定模式"
node -e "require('./secrets-store').updateSecrets({feishuCliEnabled:false,feishuCliProfile:'ai-image-automation',feishuCliPairingEnabled:true,feishuCliAllowedChatIds:'',feishuCliAllowedUserIds:'',feishuCliNotifyChatId:''}); console.log('已开启首次绑定模式');"

Write-Step "3. 检查飞书 CLI profile"
$ProfileReady = $false
try {
    lark-cli --profile ai-image-automation config show | Out-Null
    $ProfileReady = $true
} catch {
    $ProfileReady = $false
}

if (-not $ProfileReady) {
    Write-Host "接下来会打开或提示飞书开放平台配置页面。" -ForegroundColor Yellow
    Write-Host "请按页面提示创建/确认企业自建应用，名称使用：AI生图自动化平台" -ForegroundColor Yellow
    Write-Host "如果页面要求启用机器人，就启用机器人，并把机器人名字也设为：AI生图自动化平台" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "准备好后按回车继续..."
    Read-Host | Out-Null
    lark-cli config init --new --name ai-image-automation --brand feishu --lang zh
}

try {
    lark-cli --profile ai-image-automation config show | Out-Null
    Write-Host "飞书 profile 已就绪：ai-image-automation" -ForegroundColor Green
} catch {
    throw "飞书 profile 仍未配置成功。请重新运行本脚本，或手动执行：lark-cli config init --new --name ai-image-automation --brand feishu --lang zh"
}

Write-Step "4. 启动飞书桥接"
$startResult = Invoke-RestMethod -Uri "http://127.0.0.1:3066/api/feishu-cli/start" -Method Post -ContentType "application/json" -Body "{}"
Write-Host ($startResult | ConvertTo-Json -Depth 6)

if (-not $startResult.success) {
    throw "飞书桥接启动失败：$($startResult.message)"
}

Write-Step "5. 绑定控制群和你的账号"
Write-Host "现在请在飞书里做两件事：" -ForegroundColor Yellow
Write-Host "1）把机器人“AI生图自动化平台”拉进你要控制项目的群，或者直接私聊它。" -ForegroundColor Yellow
Write-Host "2）发送这四个字：绑定平台" -ForegroundColor Yellow
Write-Host ""
Write-Host "脚本会等待绑定成功，最长等待 15 分钟。"

$Deadline = (Get-Date).AddMinutes(15)
$Bound = $false
while ((Get-Date) -lt $Deadline) {
    Start-Sleep -Seconds 5
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:3066/api/feishu-cli/status" -Method Get -TimeoutSec 5
    if ($status.configured.allowedChatIds -gt 0 -or $status.configured.allowedUserIds -gt 0) {
        $Bound = $true
        break
    }
    Write-Host "等待你发送“绑定平台”..."
}

if (-not $Bound) {
    throw "等待超时：还没有收到“绑定平台”。你可以稍后重新运行本脚本。"
}

Write-Step "6. 发送测试通知"
$testBody = @{
    text = "AI生图自动化平台飞书机器人配置完成，可以开始使用：状态、进度、日志、停止创意拓展、继续创意拓展。"
} | ConvertTo-Json
$testResult = Invoke-RestMethod -Uri "http://127.0.0.1:3066/api/feishu-cli/test-send" -Method Post -ContentType "application/json" -Body $testBody
Write-Host ($testResult | ConvertTo-Json -Depth 5)

Write-Step "完成"
Write-Host "配置完成。以后你可以直接在飞书里发送：状态 / 进度 / 日志 / 停止创意拓展 / 继续创意拓展" -ForegroundColor Green
