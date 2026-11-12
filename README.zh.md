# dsh-tool-call-guard

DeepSeek Harness（dsh）的补充型守卫：专治「工具调用因参数被拒 → 模型换个命令继续干 → 同一个错误反复烧步数」这一类空转。

它不是 `thinking-loop-guard` 的替代品。思维通道洪水（`reasoning-delta` 无限流）由那个插件负责；连续完全相同的调用由 dsh 内置的 `repeat-tool-reminder` 负责。这里只补两者都够不到的第三种形态。

## 管什么

| 行为 | 触发条件 | 动作 |
|---|---|---|
| 参数错误修复 | 工具结果含 `invalid arguments` / `missing required property` 等 | 提醒模型**原调用补全重发**，并点名缺哪个字段 |
| 重复失败止损 | 同一 turn 内累计 N 次（默认 3） | 提醒停止重试、向用户汇报现状与缺口 |
| 单轮步数预算 | 单 turn 步数达到 N（默认 60） | 一次性软提醒，汇报进度；**不中止** |
| 脆弱模型提示 | 选中 `fragileModels` 里的模型（默认 `glm-5.3-flash`） | 每个会话一次，提醒长会话可能静默丢参数 |

## 为什么需要它

GLM-5.3-Flash 在长上下文中会出现工具调用参数腐烂（稀疏注意力 `index_topk`/`index_kpool` 相关，vLLM #56605、#56868，修到 #58704 仍未关闭）；实测一个 2000 次调用的会话里，bhash 参数缺失错误 39 次全部落在切换到该模型之后，单 turn 最多 25 次。模型被拒后不会回头修补，而是换新命令继续——每次都是新调用、每次都少字段。

提示词压不住解码层的腐烂，但可以把它造成的浪费从 25 步压到 1 步。

## 配置

全部字段在插件设置页可改：

- `repeatLimit`（默认 3，0 关闭）
- `stepsPerTurn`（默认 60，0 关闭）
- `warnOnModelSwitch`（默认 true）
- `fragileModels`（默认 `["glm-5.3-flash"]`，子串匹配、大小写不敏感）

## 安装

```bash
cd ~/.dsh/profiles/web
pnpm add github:Huakira/dsh-tool-call-guard
```

然后把 `dsh-tool-call-guard` 加进 `package.json` 的 `dsh.profile.bundles`，重启 dsh。
