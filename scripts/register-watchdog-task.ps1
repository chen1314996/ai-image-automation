param(
    [string]$TaskName = "AI Image Automation Watchdog",
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$node = (Get-Command node.exe -ErrorAction Stop).Source
$watchdog = Join-Path $ProjectDir "feishu-watchdog.js"
$launcher = Join-Path $ProjectDir "scripts\start-watchdog-hidden.vbs"

if (-not (Test-Path $watchdog)) {
    throw "Watchdog script not found: $watchdog"
}
if (-not (Test-Path $launcher)) {
    throw "Hidden launcher not found: $launcher"
}

$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$launcher`"" `
    -WorkingDirectory $ProjectDir

$triggerAtLogon = New-ScheduledTaskTrigger -AtLogOn
$triggerEveryMinute = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($triggerAtLogon, $triggerEveryMinute) `
    -Settings $settings `
    -Description "Monitor AI image automation server.js, notify Feishu on downtime, and restart the service." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Output "Windows Scheduled Task installed and started: $TaskName"
