window.__ModuleLoader__.load({
  id: 'dsh-tool-call-guard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const KEY = 'dsh-tool-call-guard#tool-call-guard';

    const zh = (navigator.language || '').toLowerCase().startsWith('zh');
    const T = zh ? {
      summary: '工具调用被拒后的补全、单轮步数预算与脆弱模型提示。',
      loading: '加载中…',
      unavailable: '该插件当前未加载，无法配置。',
      readOnly: '当前配置为只读。',
      failed: '保存失败，已恢复为服务器上的值。',
      hint: '思考通道洪水由 thinking-loop-guard 负责，连续相同调用由内置 repeat-tool-reminder 负责；这里只管参数被拒后的恢复与长轮次的提醒。',
      repeatLimit: '同类参数错误止损阈值（0 = 关闭）',
      stepsPerTurn: '单轮步数提醒阈值（0 = 关闭）',
      warnOnModelSwitch: '选中脆弱模型时给出一次性提示',
      fragileModels: '脆弱模型（逗号分隔，子串匹配）',
    } : {
      summary: 'Argument-rejection recovery, a per-turn step budget, and fragile-model cautions.',
      loading: 'Loading…',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'The configuration is read-only.',
      failed: 'Saving failed; showing the value stored on the host.',
      hint: 'Reasoning floods belong to thinking-loop-guard and consecutive identical calls to the in-tree repeat-tool-reminder; this page only covers recovery from rejected arguments and long-turn nudges.',
      repeatLimit: 'Stop-loss after this many argument rejections in one turn (0 = off)',
      stepsPerTurn: 'Progress nudge after this many steps in one turn (0 = off)',
      warnOnModelSwitch: 'Warn once when a fragile model is selected',
      fragileModels: 'Fragile models (comma-separated, substring match)',
    };

    const css = {
      root: { display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0', color: 'var(--dsw-alias-label-primary)', fontSize: 13 },
      muted: { opacity: 0.6, fontSize: 12, lineHeight: 1.5 },
      label: { display: 'flex', flexDirection: 'column', gap: 6 },
      input: { font: 'inherit', padding: '6px 8px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'transparent', color: 'inherit' },
      row: { display: 'flex', alignItems: 'center', gap: 8 },
    };

    function Page({ form }) {
      const [error, setError] = React.useState(false);
      const state = form && form.state;
      if (!state || state.status === 'loading') return h('div', { style: css.muted }, T.loading);
      if (state.status === 'unavailable' || !state.value) return h('div', { style: css.muted }, T.unavailable);

      const value = state.value;
      const writable = state.writable !== false;
      const num = (key, fallback) => (typeof value[key] === 'number' ? value[key] : fallback);
      const [repeatLimit, setRepeatLimit] = React.useState(String(num('repeatLimit', 3)));
      const [stepsPerTurn, setStepsPerTurn] = React.useState(String(num('stepsPerTurn', 60)));
      const [warn, setWarn] = React.useState(value.warnOnModelSwitch !== false);
      const [fragile, setFragile] = React.useState(Array.isArray(value.fragileModels) ? value.fragileModels.join(', ') : 'glm-5.3-flash');

      const save = async (ops) => {
        setError(false);
        try {
          const ok = await form.mutate(ops, state.revision);
          if (!ok) setError(true);
        } catch { setError(true); }
      };

      return h('div', { style: css.root },
        h('div', { style: css.muted }, T.hint),
        !writable ? h('div', { style: css.muted, role: 'status' }, T.readOnly) : null,
        error ? h('div', { style: { color: 'var(--dsw-alias-label-error, #d1242f)' }, role: 'alert' }, T.failed) : null,
        h('label', { style: css.label }, T.repeatLimit,
          h('input', {
            style: css.input, type: 'number', min: 0, value: repeatLimit, disabled: !writable,
            onChange: (event) => setRepeatLimit(event.target.value),
            onBlur: () => save([{ op: 'set', path: ['repeatLimit'], value: Math.max(0, Number(repeatLimit) || 0) }]),
          })),
        h('label', { style: css.label }, T.stepsPerTurn,
          h('input', {
            style: css.input, type: 'number', min: 0, value: stepsPerTurn, disabled: !writable,
            onChange: (event) => setStepsPerTurn(event.target.value),
            onBlur: () => save([{ op: 'set', path: ['stepsPerTurn'], value: Math.max(0, Number(stepsPerTurn) || 0) }]),
          })),
        h('label', { style: css.row },
          h('input', {
            type: 'checkbox', checked: warn, disabled: !writable,
            onChange: (event) => { setWarn(event.target.checked); save([{ op: 'set', path: ['warnOnModelSwitch'], value: event.target.checked }]); },
          }),
          T.warnOnModelSwitch),
        h('label', { style: css.label }, T.fragileModels,
          h('input', {
            style: css.input, value: fragile, disabled: !writable,
            onChange: (event) => setFragile(event.target.value),
            onBlur: () => save([{
              op: 'set', path: ['fragileModels'],
              value: fragile.split(',').map((name) => name.trim()).filter(Boolean),
            }]),
          })));
    }

    function ConfigEntry(props) {
      if (props.view === 'summary') return T.summary;
      return h(Page, { form: props.form });
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config', key: KEY,
        }, ConfigEntry));
      },
    };
  },
});
