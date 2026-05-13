Option Explicit

Dim fso, shell, scriptDir, projectDir, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

command = "cmd.exe /c cd /d """ & projectDir & """ && node feishu-watchdog.js"
shell.Run command, 0, False
