# 测试目录说明

这个目录用来放测试脚本、测试数据、测试截图和历史测试报告，避免根目录越来越乱。

## 目录说明

| 目录 | 作用 |
| --- | --- |
| `suite/` | 快速测试、接口测试、集成测试、代码检查脚本 |
| `qa/` | QA 页面测试脚本 |
| `cycle/` | 完整流程、循环流程、浏览器诊断脚本 |
| `manual/` | 历史手动实验脚本，主要用于排查 Legil 保存问题 |
| `data/` | 测试输入图、参考图等小数据 |
| `reports/` | 测试报告 |
| `artifacts/` | 测试截图、测试输出文件 |

## 常用命令

```bash
npm run test:quick
npm run test:suite
npm run test:qa
npm run test:creative-agent
npm run test:feishu
```

## 安全提醒

- `test:creative-agent` 和 `test:feishu` 是相对安全的逻辑测试。
- `test:quick` 主要做快速检查。
- `test:qa` 可能会打开页面做浏览器检查。
- `cycle/` 和 `manual/` 下的脚本有些会打开浏览器、访问真实平台，运行前要先看脚本内容。

项目启动命令仍然在根目录执行：

```bash
npm start
```
