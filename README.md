# dsh-tool-call-guard

> 个人自用插件，代码和文档由 AI 参与编写，不承诺维护。使用前请先备份 DSH 配置。

A supplemental guard for DeepSeek Harness (dsh). It targets one failure shape: **a tool call is rejected by argument validation, and the model starts a different command instead of repairing the call** — so one omission becomes N wasted steps.

It is not a replacement for the other two layers:

| Layer | Owns |
|---|---|
| `@argszero/cordis-plugin-thinking-loop-guard` | reasoning-channel floods (`reasoning-delta` that never stops) |
| in-tree `repeat-tool-reminder` | *consecutive identical* tool calls |
| **this plugin** | rejected-argument recovery, per-turn step budget, fragile-model caution |

## Behaviour

| Rule | Trigger | Action |
|---|---|---|
| Argument recovery | tool result matches `invalid arguments` / `missing required property` | steer the model to re-issue **the same call** with the missing fields named |
| Stop-loss | `repeatLimit` (default 3) such rejections in one turn | steer to stop retrying and report status |
| Step budget | `stepsPerTurn` (default 60) steps in one turn | one-shot progress nudge; **never aborts** |
| Fragile model | selecting a model in `fragileModels` (default `glm-5.3-flash`) | one caution per session |

## Why

GLM-5.3-Flash corrupts tool-call arguments in long contexts (sparse-attention `index_topk`/`index_kpool`, vLLM issues #56605 and #56868, partially fixed by #58704). In a measured 2,003-call session, every one of 39 argument-validation failures happened after switching to that model, up to 25 in a single turn. A prompt cannot stop decode-time corruption, but it can stop the *wasted steps*: 25 retries become one repair.

## Configuration

Editable from the plugin settings page: `repeatLimit`, `stepsPerTurn`, `warnOnModelSwitch`, `fragileModels`.

## Install

```bash
cd ~/.dsh/profiles/web
dsh plugin --profile web add @huakirax/dsh-tool-call-guard
```

Then add `dsh-tool-call-guard` to `dsh.profile.bundles` in `package.json` and restart dsh.
