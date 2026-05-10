# Windows 一键启动

这个项目现在提供一个更接近 `Mac_restart.command` 的 Windows 双击启动文件：

```text
Windows_start.cmd
```

建议以后双击 `Windows_start.cmd` 启动，不再使用旧版 `Windows_start.bat` 作为主入口。`Windows_start.bat` 现在只是一个安全兼容壳，会转到 `Windows_start.cmd`，里面不再包含隐藏 PowerShell、执行策略绕过或网页探测下载类命令。

## 双击后会做什么

1. 进入当前项目文件夹。
2. 检查 `Node.js` 是否可用。
3. 如果缺少 `Node.js`，会优先尝试用 Windows 官方 `winget` 安装 Node.js LTS。
4. 检查 `npm` 是否可用。
5. 检查项目依赖 `express`、`playwright`、`canvas` 是否存在。
6. 如果项目依赖缺失，会自动执行：

```text
npm install
```

7. 检查 Playwright 浏览器文件是否存在。
8. 如果 Playwright 浏览器文件缺失，会自动执行：

```text
npx playwright install chromium
```

9. 在当前双击打开的终端窗口里启动本地服务器：

```text
npm start
```

10. 几秒后自动打开两个浏览器窗口：Legil 网站和自动化生图平台。

```text
https://lumos.diandian.info/legil/image-ai/image-to-image
http://localhost:3066/
```

## 停止服务器

启动后，双击打开的这个终端窗口会常驻运行服务器。使用平台时请保持这个窗口打开。

需要停止服务器时，在这个终端窗口里按：

```text
Ctrl+C
```

或者直接关闭这个终端窗口。

## 端口已被占用

如果 `3066` 端口已经有服务在运行，脚本不会重复启动服务器，会直接打开 Legil 网站和平台页面：

```text
https://lumos.diandian.info/legil/image-ai/image-to-image
http://localhost:3066/
```

这种情况下，新打开的窗口没有启动服务器，所以不能通过这个窗口的 `Ctrl+C` 关闭旧服务器。如果你想让这个窗口控制服务器，请先关闭旧的服务器窗口，再重新双击 `Windows_start.cmd`。

## 关于杀毒误报

旧版 `Windows_start.bat` 使用过 PowerShell 执行策略绕过、隐藏窗口和网页探测命令，容易触发启发式杀毒规则。

新版启动逻辑改为 `Windows_start.cmd`，只使用可见的本地命令：

```text
winget install --id OpenJS.NodeJS.LTS
npm install
npx playwright install chromium
npm start
```

服务器会在双击打开的可见终端里运行，不会隐藏窗口，也不会绕过系统执行策略。
