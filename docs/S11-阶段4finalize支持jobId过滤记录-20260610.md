# S11 阶段 4：finalize 支持 jobId 过滤记录

日期：2026-06-10

## 目标

最终交付函数支持只处理当前 job，用于逐 job 闭环交付，也支持后续手动 job 级 finalize。

验收重点：

```text
调用 finalize with jobId 只输出当前 job 文件夹
不会重复处理其它 job
已输出文件可被复用，不重复覆盖除非 force=true
```

## 本阶段改动

### 1. finalizeDeliveryRun() 支持 options.jobId

文件：`src/services/delivery-postprocess/finalize.js`

`finalizeDeliveryRun(run, options)` 现在会读取：

```text
options.jobId
```

当传入 `jobId` 时，只筛选并处理该 job：

```text
jobs = allJobs.filter(job => job.jobId === options.jobId)
```

如果传入不存在的 `jobId`，直接抛出错误，避免静默全量 finalize。

### 2. finalizeDeliveryRunById() 透传 body.jobId

文件：`src/routes/delivery.routes.js`

`finalizeDeliveryRunById(runId, body)` 已经：

```text
1. 用 body.jobId 过滤未标准化检查范围
2. 将 body.jobId 透传给 finalizeDeliveryRun()
```

因此通过接口调用：

```http
POST /api/delivery/runs/:runId/finalize
```

携带：

```json
{
  "jobId": "delivery_job_xxx"
}
```

时，只会 finalize 当前 job。

### 3. job 级 finalize 只更新当前 job 后处理状态

`finalizeDeliveryRun()` 的 job 循环只遍历筛选后的 jobs，因此：

```text
当前 job:
  target.status -> finalized
  target.finalizedCandidates -> 更新
  job.status -> finalized
  job.postprocess.finalized/logoApplied/renamed/packaged -> 更新

其它 job:
  不进入 target 循环
  不更新 postprocess 状态
  不创建 final-package 文件夹
```

另外补了一处边界修正：

```text
如果 job 级 finalize 同时传 namingRule，只重命名当前 job，不会重命名其它 job。
```

### 4. run 级 completedJobs / failedJobs 正确统计

`completedJobs` / `failedJobs` 不再只按本次处理的 job 统计，而是按整个 run 的全部 jobs 重新统计：

```text
run.completedJobs = allJobs.filter(job => job.status === 'finalized').length
run.failedJobs = allJobs.filter(job => job.status === 'failed').length
```

这样 job 级 finalize 后，run 级进度仍能反映整体状态。

### 5. 已输出文件默认复用

`finalizeDeliveryRun()` 已支持检测目标 final JPG 是否已存在且尺寸匹配：

```text
force=false:
  复用已有 final 输出，不重新覆盖

force=true:
  忽略已有输出，重新执行 LOGO 合成并覆盖输出
```

返回值包含：

```text
reusedExistingCount
```

用于判断本次复用了多少已存在最终图。

## 新增测试

新增：

```text
scripts/test-s11-stage4-finalize-jobid.js
```

覆盖：

```text
1. service 层 finalizeDeliveryRun(run, { jobId }) 只输出当前 job 的 3 张最终 JPG
2. 其它 job 的 final-package 文件夹不会被创建
3. 其它 job 的 status / postprocess / targets / baseName / folderName 不被修改
4. completedJobs / failedJobs 按整个 run 正确统计
5. 第二次调用同一 job finalize 默认复用已有输出，mtime 不变，reusedExistingCount = 3
6. force=true 时不复用已有输出，会覆盖已有文件
7. route 层 finalize API 透传 jobId，即使其它 job 未标准化，也只处理当前 job
```

## 验证结果

已执行：

```bash
node --check src/services/delivery-postprocess/finalize.js
node --check src/routes/delivery.routes.js
node --check scripts/test-s11-stage4-finalize-jobid.js
node scripts/test-s11-stage4-finalize-jobid.js
node scripts/test-s11-stage3-closed-loop-delivery.js
node scripts/test-s11-stage2-delivery-ui.js
node scripts/test-s11-stage1-source-reuse-scan.js
node scripts/test-s11-stage0-delivery-baseline.js
npm run test:s10-postprocess
```

结果：

```text
全部通过
```

## 验收结论

```text
调用 finalize with jobId 只输出当前 job 文件夹：通过
不会重复处理其它 job：通过
已输出文件可被复用，不重复覆盖除非 force=true：通过
```
