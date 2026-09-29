---
description: "评测请求的透明 HTTP 观察、Session 归属和真实模型路由门禁。"
kind: "scratch"
---

# 真实请求路由检查

`route-audit.mjs` 是评测专用 Cordis overlay，供准入 smoke 与冻结后的正式 16 次运行使用。它通过公开 `llm/stream` waterfall 原样转发请求和结果，再用 Node `undici` 诊断事件记录实际 HTTP 请求、响应状态、生成结束原因和 Session。它不修改 DSH 内核，不添加模型可见工具或消息，不保存请求正文、响应正文、HTTP 头或认证 URL。响应包含 `x-request-id` 或 `request-id` 时仅保留值的 SHA-256，缺失时保留空列表；本地生成的 call/http ID 不能冒充提供方请求 ID。观察器及其实际端点配置均纳入 release 哈希；未观察到 HTTP 事件时不能由模型选择补造成功。

每次新 Host 使用新的审计路径；文件独占创建，已有路径会使加载失败。`config.endpoint` 是管理员核对的 CodeBuddy chat completions 端点，配置留在 Git 外；记录只保留端点 SHA-256 和精确匹配布尔值。每天检查日常首模型与容器配置，明确允许 `127.0.0.1` 到 `host.docker.internal` 的映射，同时要求 scheme、port、path、API、凭据引用和模型参数相同。

`model_route.py` 通过共享 `metrics.read_home` 按数字选每个目录的最高 Session generation，拒绝重复 Session identity，再与观察器的 Session ID 连接。成功生成要求实际 HTTP request、匹配端点的 HTTP 2xx、正常 `stop` 或 `tool-calls` finish、流完整结束和持久 assistant 来源一致。审查者还必须有主 Session 的持久 review job 和正确 parent。`task_review_decision` 的成功工具结果用于单独判断有效裁决，不作为路由成功条件。200、profile 选择、无关子 Session 或自然语言“通过”均不足以准入。兼容字段 `supervisorBothModes` 检查两组实际主／审查请求与归属；独立组还要求模型的 `run_review_check` 调用、成功结果与持久快照检查记录一致。审查超时、无裁决及未完成最终审查保持为性能结果，不阻止已有正确观察能力的条件进入正式对照。

```sh
python3 -m unittest discover -s eval/deepswe -p test_model_route.py -v
node --test eval/deepswe/model-route/route-audit.test.mjs
python3 eval/deepswe/model_route.py PRIVATE_HOME MAIN_SESSION PRIVATE_AUDIT NEW_SAFE_OUTPUT
```

正式位置使用 `--kind formal-model-attempt --condition CONDITION`；默认 `gate-calibration` 的请求不计入 16 个正式位置。Goal/Plan 只要求真实主请求，两种 Supervisor 要求其真实审查链。每个位置独占写入自己的后验结果，记录失败请求数量及已返回用量，提供方未报告用量时不得把未知成本描述为零。

Python 回归拒绝错路由、错父 Session、没有实际 HTTP 请求和没有绑定独立检查的记录；失败裁决单列为性能结果；Node 回归只运行本地 HTTP 服务，验证诊断关联和脱敏，不能代替真实模型请求。真实 smoke 与公开题 16 个位置分别记录。控制器 worker 负责投递和一次批准，路由检查只读既有记录，不重投模型、不替 Agent 救场。

首条真实 Linux 日志审查链见[准入记录 1](../model-route-gate-20260928-1.json)：主 Agent 与真实审查者实际 HTTP 路由已核对，但提供方故障中断了计划审查，未提交有效决策，且控制器清理未确认。完整门禁保持失败；节点、完成审查和独立检查组尚未证实。提供方 502/504 与缺失决策是运行故障，不会被错记为模型路由偏差或从正式分母中删除。

用户授权上游重试后，新校准用例 `control-supervisor-log-5` 跑通主 Agent、计划、节点和完成审查，共 50 次真实请求全部正常生成，三个审查决策均成功持久化；原失败用例未覆盖，见[准入记录 2](../model-route-gate-20260928-2.json)。一次初始批准、无救场、完成及清理已由控制器记录。实际响应请求 ID 仅保存哈希。日志组代表性链路已通过，独立产物检查组仍待验证，完整双组门禁继续为失败，正式投递仍为 0/16。
