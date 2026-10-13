/* 最小 React 运行时 + 渲染/交互测试台，用于离线验证插件 bundle。
   目标不是像素级还原，而是：hooks 调用顺序、渲染是否抛错、事件处理是否真的工作。 */

function makeRuntime() {
  const state = { hooks: [], cursor: 0, effects: [], host: [] };
  let forceRender = null;

  const depsEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

  const React = {
    createElement(type, props, ...children) {
      const flat = [];
      const push = (c) => {
        if (c === null || c === undefined || c === false || c === true) return;
        if (Array.isArray(c)) { c.forEach(push); return; }
        flat.push(c);
      };
      children.forEach(push);
      return { type, props: Object.assign({}, props || {}, { children: flat }) };
    },
    useState(initial) {
      const i = state.cursor++;
      if (state.hooks.length <= i) state.hooks[i] = typeof initial === "function" ? initial() : initial;
      const setter = (next) => {
        const value = typeof next === "function" ? next(state.hooks[i]) : next;
        if (!Object.is(value, state.hooks[i])) {
          state.hooks[i] = value;
          if (forceRender) forceRender();
        }
      };
      return [state.hooks[i], setter];
    },
    useRef(initial) {
      const i = state.cursor++;
      if (!state.hooks[i]) state.hooks[i] = { current: initial };
      return state.hooks[i];
    },
    useMemo(factory, deps) {
      const i = state.cursor++;
      const prev = state.hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) state.hooks[i] = { deps, value: factory() };
      return state.hooks[i].value;
    },
    useCallback(fn, deps) {
      const i = state.cursor++;
      const prev = state.hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) state.hooks[i] = { deps, value: fn };
      return state.hooks[i].value;
    },
    useEffect(fn, deps) {
      const i = state.cursor++;
      const prev = state.hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) state.effects.push(fn);
      state.hooks[i] = { deps };
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = state.cursor++;
      if (!state.hooks[i]) {
        state.hooks[i] = { value: getSnapshot(), unsubscribe: subscribe(() => { state.hooks[i].value = getSnapshot(); if (forceRender) forceRender(); }) };
      }
      return state.hooks[i].value;
    },
  };

  function walk(node, depth) {
    if (node === null || node === undefined || node === false) return;
    if (typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) { node.forEach((child) => walk(child, depth + 1)); return; }
    if (depth > 60) throw new Error("渲染深度超限，可能有无限递归");
    const { type, props } = node;
    if (typeof type === "function") {
      const rendered = type(props);
      walk(rendered, depth + 1);
      return;
    }
    state.host.push({ type, props });
    walk(props.children, depth + 1);
  }

  function renderRoot(component, props) {
    state.cursor = 0;
    state.host = [];
    state.effects = [];
    walk(React.createElement(component, props || {}), 0);
    const effects = state.effects.slice();
    state.effects = [];
    effects.forEach((fn) => { const cleanup = fn(); if (typeof cleanup === "function") state.cleanups.push(cleanup); });
    return state.host;
  }
  state.cleanups = [];

  return {
    React,
    setForceRender(fn) { forceRender = fn; },
    /** 渲染另一个组件之前必须调用：
        hooks 是按调用顺序存在同一个数组里的。两个组件的 hook 序列不同，
        不重置就会串台 —— 新组件会读到上一个组件留下的状态。
        （这个 bug 让"200 个会话"的规模测试实际渲染了上一次的 4 个会话。） */
    reset() {
      (state.cleanups || []).forEach((fn) => { try { fn(); } catch (error) { /* 清理失败无所谓 */ } });
      state.hooks = [];
      state.cursor = 0;
      state.effects = [];
      state.host = [];
      state.cleanups = [];
      forceRender = null;
    },
    render: renderRoot,
    host: () => state.host,
    find(predicate) { return state.host.filter(predicate); },
    findByClass(cls) { return state.host.filter((el) => String(el.props.className || "").split(" ").includes(cls)); },
    byText(text) { return state.host.filter((el) => typeof el.props.children !== "undefined" && JSON.stringify(el.props.children).includes(text)); },
    text() { return JSON.stringify(state.host.map((el) => el.props.children)); },
  };
}

module.exports = { makeRuntime };
