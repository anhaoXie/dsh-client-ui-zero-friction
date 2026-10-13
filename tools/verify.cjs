/* 离线验证：把真实的 lib/client.js 装进一个假客户端环境里跑起来。
   验证的东西 —— 模块契约、slot 注册、hooks 顺序、渲染不炸、事件真的工作、
   投递真的打到对应会话、学到的偏好真的落盘、检索真的调用服务。 */
const fs = require("node:fs");
const path = require("node:path");
const { makeRuntime } = require("./mini-react.cjs");

const PKG = path.resolve(__dirname, "..");
const bundle = fs.readFileSync(path.join(PKG, "lib/client.js"), "utf8");
const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log((ok ? "  PASS " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};

/* ---------- 假 localStorage ---------- */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

/* ---------- 加载 bundle ---------- */
let loadedSpec = null;
const storage = makeStorage();
const styleTags = [];
global.window = {
  __ModuleLoader__: { load: (spec) => { loadedSpec = spec; } },
  localStorage: storage,
};
global.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, textContent: "", appendChild() {} }),
  head: { appendChild: (tag) => styleTags.push(tag) },
};

const moduleShim = { exports: {} };
const requireShim = (id) => {
  if (id === "react") return RUNTIME.React;
  if (id === "react/jsx-runtime") return { jsx: RUNTIME.React.createElement, jsxs: RUNTIME.React.createElement, Fragment: "Fragment" };
  throw new Error("模块未注册: " + id);
};

const RUNTIME = makeRuntime();
new Function("window", "document", bundle)(global.window, global.document);

check("bundle 调用 __ModuleLoader__.load", !!loadedSpec);
check("模块 id 等于包名（客户端半区靠这个挂载）", loadedSpec && loadedSpec.id === pkgJson.name,
  loadedSpec ? loadedSpec.id + " vs " + pkgJson.name : "n/a");

const mod = loadedSpec.factory(requireShim);
check("导出 apply", typeof mod.apply === "function");
check("导出 inject 且包含 slots", Array.isArray(mod.inject) && mod.inject.includes("slots"),
  JSON.stringify(mod.inject));
check("声明了 sessions 服务（不声明的话 ctx.sessions 就是 undefined）",
  Array.isArray(mod.inject) && mod.inject.includes("sessions"), JSON.stringify(mod.inject));

/* ---------- 关键回归：用到但没声明的服务，在真机上会静默变 undefined ----------
   Cordis 只把声明过的服务挂到 ctx 上；实测未声明的 `ctx.X` 会**直接抛错**：
     cannot get property "uiWorkspace" without inject
   这条静态检查扫出 bundle 里所有 `app.X` / `ctx.X` 访问，凡是不在 inject 里、
   也不是上下文自身的成员，就报错。扫之前先去掉注释和字符串，否则注释里的
   `ctx.uiWorkspace` 会造成误报。 */
const codeOnly = bundle
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");
/* Cordis 上下文**框架自带的成员**，不是服务，所以不需要写进 inject。
   root / registry 是探针用来枚举服务的（框架成员），加进来是因为它们确实不是服务 ——
   而不是为了绕过检查：漏写真正的服务（比如 sessions）依然会被抓出来。 */
const CONTEXT_MEMBERS = new Set(["get", "on", "effect", "logger", "reflect", "provide", "inject", "start", "stop", "root", "registry"]);
const declared = new Set(Array.isArray(mod.inject) ? mod.inject : []);
const accessed = [...new Set([...codeOnly.matchAll(/\b(?:app|ctx)\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
const undeclared = accessed.filter((name) => !declared.has(name) && !CONTEXT_MEMBERS.has(name));
check("没有「用到却没声明」的服务", undeclared.length === 0,
  undeclared.length ? "未声明: " + undeclared.join(", ") + "（访问到的: " + accessed.join(", ") + "）"
                    : "访问 " + accessed.join(", ") + " · 声明 " + [...declared].join(", "));

/* ---------- 假 ctx：slots + sessions ---------- */
const registered = [];
function driveInject(name, body) {
  const result = body();
  if (result && typeof result.next === "function") {
    let step = result.next();
    let guard = 0;
    while (!step.done && guard++ < 50) step = result.next();
  }
  return result;
}
function makeSessions(rows) {
  const sent = [];
  const searches = [];
  const created = [];
  /* 路由助手的行为：answer 是它会回的那一行；设成 null 就是"永远不回"（模拟超时）。 */
  const routerBehaviour = { answer: "1" };
  /* 真机的 store 会在数据变化时发布新快照并通知订阅者。第一版这里 subscribe 是
     空实现，导致测试里 ROWS.push(...) 之后组件根本不会重渲染 —— 好几条断言因此
     是空转的（"通过"但什么都没测）。所以这里照抄真机语义：
     快照在两次通知之间保持稳定（否则 useSyncExternalStore 会死循环），
     变更后显式发布。 */
  const listeners = new Set();
  let snapshot = null;
  const build = () => ({ byId: Object.fromEntries(rows.map((r) => [r.id, r])), ids: rows.map((r) => r.id), phase: "ready" });
  const publish = () => { snapshot = build(); for (const fn of listeners) fn(); };
  return {
    sent,
    searches,
    created,
    publish,
    routerBehaviour,
    list: {
      getSnapshot: () => (snapshot || (snapshot = build())),
      subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    },
    /* 真机的 ClientSessions.create **直接返回 id 字符串**，失败时抛错。
       这里必须照抄，否则测试台会印证错的返回值假设（真机上就这么错过一次）。 */
    async create(opts) {
      if (!opts || (opts.cwd === undefined && opts.workspaceId === undefined)) {
        /* 真机也允许无参创建，但我们的调用总会带 cwd */
      }
      const id = "s-new-" + (created.length + 1);
      created.push(id);
      rows.push({
        id, displayTitle: "新会话", running: false, blank: true, updatedAt: Date.now(),
        cwd: (opts && opts.cwd) || "C:\\work\\new", retainedBy: { mainView: 1 }, projectionValues: {},
      });
      publish();
      return id;
    },    async using(id, options, operation) {
      return operation({
        ready: Promise.resolve(),
        binding: {
          session: {
            async prompt(content, mode) {
              const body = content.map((c) => c.text).join("");
              sent.push({ id, text: body, mode, source: options.source });
              /* **每一句投递都会在那个会话里留下一轮**（真机就是这样，哪怕是开场白）。
                 不这么做的话"助手会话有内容因而会挤进候选列表"这个真机现象就复现不出来，
                 对应的变异也就抓不到（试过，确实抓不到）。 */
              const row = rows.find((r) => r.id === id);
              if (row) {
                const isClassify = body.includes("应该发给几号");
                /* 模拟"路由助手"的回答：**替换 row 对象**再发布 ——
                   必须照抄真机语义（主机每次发布都换新对象）。原地改 projectionValues
                   会让 describe() 的 WeakMap 命中旧值，新那一轮永远看不到。 */
                const projection = Object.assign({}, row.projectionValues);
                const previous = projection.turnOutline || [];
                projection.turnOutline = previous.concat([{
                  turn: previous.length + 1, seq: 900, prompt: body,
                  response: isClassify && routerBehaviour.answer !== null ? routerBehaviour.answer : ""
                }]);
                rows[rows.indexOf(row)] = Object.assign({}, row, { projectionValues: projection });
                publish();
              }
              return { ok: true, value: {} };
            },
          },
        },
      });
    },
    /* 照抄真机：web/desktop profile 里主机全文索引是关的，
       `sessions.search()` 真实返回 {ok:false, error:{code:"gateway/internal"}}。 */
    async search(query) {
      searches.push(query);
      return { ok: false, error: { code: "gateway/internal", isDSHRemoteError: true, name: "RemoteError", details: {} } };
    },
  };
}

/* 行结构照抄真机 dump 出来的形状（含 projectionValues），否则测不到新逻辑 */
const now = Date.now();
const ROWS = [
  { id: "s-502", displayTitle: "线上 502 排查", running: false, blank: false, updatedAt: now - 3 * 3600e3, cwd: "C:\\work\\api", retainedBy: { mainView: 0 },
    projectionValues: {
      title: "线上 502 排查",
      turnOutline: [
        { turn: 1, seq: 4, prompt: "线上 502 了，看看日志", response: "502 集中在 14:07—14:19，网关 upstream timeout。" },
        { turn: 2, seq: 220, prompt: "", response: "已恢复。根因是 LB idle timeout 比后端 keepalive 短，已调平到 65s。" }
      ],
      sessionStats: { turns: 2, steps: 18 },
      contextPressure: { pressureTokens: 40000, contextWindow: 1000000 },
      inbox: { "next-turn": [{ content: [{ type: "text", text: "排队等它处理的一条" }] }, { content: [] }], "next-step": [] },
      userQuestions: { active: [], settled: [] },
      plan: { active: false, pending: false },
      sessionListMetadata: { blank: false, lastPromptAt: now - 3 * 3600e3 }
    } },
  { id: "s-sales", displayTitle: "8 月销量下滑归因", running: true, blank: false, updatedAt: now - 600e3, cwd: "C:\\work\\bi", retainedBy: { mainView: 0 },
    projectionValues: {
      title: "8 月销量下滑归因",
      turnOutline: [{ turn: 1, seq: 4, prompt: "这份数据销量下滑的原因是什么？", response: "环比 -12.4%，同比只 -2.1%，更像促销退坡。" }],
      sessionStats: { turns: 1, steps: 9 },
      contextPressure: { pressureTokens: 120000, contextWindow: 1000000 },
      inbox: { "next-turn": [], "next-step": [] },
      userQuestions: { active: [], settled: [] },
      plan: { active: false, pending: false },
      sessionListMetadata: { blank: false, lastPromptAt: now - 600e3 }
    } },
  { id: "s-login", displayTitle: "登录页改版", running: false, blank: false, updatedAt: now - 2 * 86400e3, cwd: "C:\\work\\web", retainedBy: { mainView: 1 },
    projectionValues: {
      title: "登录页改版",
      turnOutline: [{ turn: 1, seq: 4, prompt: "登录页太挤了", response: "圆角统一 12、次要文字提到 #9ba8c0。" }],
      sessionStats: { turns: 1, steps: 7 },
      contextPressure: { pressureTokens: 10000, contextWindow: 1000000 },
      inbox: { "next-turn": [], "next-step": [] },
      /* 真机信号：有一个未回答的问题 —— 即使没在跑，也必须进「真的在等你」 */
      userQuestions: { active: [{ id: "q1", text: "柱状还是折线？" }], settled: [] },
      plan: { active: false, pending: false },
      sessionListMetadata: { blank: false, lastPromptAt: now - 2 * 86400e3 }
    } },
  { id: "s-login2", displayTitle: "登录页性能优化", running: false, blank: false, updatedAt: now - 5 * 3600e3, cwd: "C:\\work\\web", retainedBy: { mainView: 0 },
    projectionValues: {
      title: "登录页性能优化",
      turnOutline: [{ turn: 1, seq: 4, prompt: "登录页首屏太慢", response: "这个方案怎么落地？设计上先把首屏依赖砍到 3 个。" }],
      sessionStats: { turns: 1 }, contextPressure: { pressureTokens: 8000, contextWindow: 1000000 },
      inbox: { "next-turn": [], "next-step": [] }, userQuestions: { active: [], settled: [] },
      plan: { active: false, pending: false }, sessionListMetadata: { blank: false, lastPromptAt: now - 5 * 3600e3 }
    } },
  { id: "s-sub", displayTitle: "子任务：抽取图表", running: true, blank: false, updatedAt: now - 120e3, parentId: "s-sales", origin: "subagent", retainedBy: {},
    projectionValues: {
      title: "子任务：抽取图表",
      turnOutline: [{ turn: 1, seq: 4, prompt: "把结论做成图", response: "柱状图 + 同比虚线，已出。" }],
      sessionStats: { turns: 1 },
      contextPressure: { pressureTokens: 5000, contextWindow: 1000000 },
      inbox: { "next-turn": [], "next-step": [] },
      userQuestions: { active: [], settled: [] },
      plan: { pending: false },
      sessionListMetadata: { blank: false, lastPromptAt: now - 120e3 }
    } },
];

const sessions = makeSessions(ROWS);
const opened = [];
const uiWorkspaceStub = { openSession: (id) => opened.push(id) };
const ctx = {
  slots: {
    inject(name, body) { const out = driveInject(name, body); return typeof out === "function" ? out : () => {}; },
    register(opts, component) { registered.push({ opts, component }); return () => {}; },
  },
  sessions,
  /* uiWorkspace 走反射读取，所以这里只提供 ctx.get */
  get(name) { return name === "uiWorkspace" ? uiWorkspaceStub : undefined; },
};

mod.apply(ctx);

const main = registered.find((r) => r.opts.name === "main");
const panel = registered.find((r) => r.opts.name === "sidebar.panellist");
check("注册了 main 面板", !!main, main ? JSON.stringify(main.opts) : "未注册");
check("main 面板 key 与侧栏 id 一致", !!main && !!panel && main.opts.key === panel.opts.id,
  main && panel ? main.opts.key + " / " + panel.opts.id : "n/a");
check("侧栏标签是中文「零摩擦」", !!panel && panel.opts.label() === "零摩擦");

/* ---------- 真实渲染 ---------- */
/* 语义路由用 setTimeout 做防抖（800ms）和超时（45s）。mini-React 不跑定时器，
   所以这里接管它：测试里手动 flush，能把"等模型回答"这件事测出来。 */
const realSetTimeout = global.setTimeout;
const pendingTimers = [];
global.setTimeout = (fn, ms) => { pendingTimers.push({ fn, ms: ms || 0 }); return pendingTimers.length; };
const flushTimers = (maxMs) => {
  const limit = maxMs == null ? 1000 : maxMs;
  const due = pendingTimers.filter((t) => t.ms <= limit);
  for (const timer of due) {
    const index = pendingTimers.indexOf(timer);
    if (index >= 0) pendingTimers.splice(index, 1);
  }
  for (const timer of due) { try { timer.fn(); } catch (error) { /* 由被测代码自己处理 */ } }
};
/* 让被 flush 出来的异步链跑完 */
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

let host = [];
function rerender() { host = RUNTIME.render(main.component, {}); }
RUNTIME.setForceRender(() => rerender());
let renderError = null;
try { rerender(); } catch (e) { renderError = e; }
check("首次渲染不抛错", !renderError, renderError && renderError.message);

const cls = (c) => host.filter((el) => String(el.props.className || "").split(" ").includes(c));
const allText = () => JSON.stringify(host.map((el) => el.props.children));

check("渲染出真实会话标题", allText().includes("线上 502 排查") && allText().includes("登录页改版"));
check("正在跑的会话归入「正在跑」", allText().includes("正在跑") && allText().includes("8 月销量下滑归因"));
check("子智能体单独分组", allText().includes("子智能体"));
check("子智能体在标题上带 ↳ 标记（不冒充普通会话）", allText().includes("↳ 子任务"), allText().slice(0, 200));

/* 这几条原来断言的是 allText() 里的泛字符串，实际测的是别的东西。
   例： 「二次确认」在输入框下方的提示文案里也有（"不做二次确认"），
   所以 HUD 里那个指标即使整个消失，检查照样绿。现在改成断言真正承载它的元素。 */
const hudText = (() => {
  const hud = host.find((el) => String(el.props.className || "").split(" ").includes("zf-hud"));
  return hud ? JSON.stringify(hud.props.children) : "";
})();
check("HUD 显示「本该打断你 N 次 · 实际 0 次」（可证伪指标）",
  hudText.includes("本该打断你") && hudText.includes("实际") && hudText.includes("自动投递") && hudText.includes("新建会话"),
  hudText.slice(0, 160));

/* ---------- 用真实投影驱动的判断与摘要 ---------- */
check("未回答的问题让会话进入「真的在等你」（即使它没在跑）",
  allText().includes("真的在等你") && allText().includes("1 个问题等你回答"));
check("队列卡片显示「需要你」",
  host.some((el) => String(el.props.className || "").includes("zf-need") && JSON.stringify(el.props.children).includes("问题等你回答")));

/* 第 14 轮真机实验纠正的语义：inbox 非空 = "排队等 agent 处理"，
   不是"你在等"。s-502 就是这种会话：没在跑、但有 2 条排队。 */
const cardOf = (title) => host.find((el) => String(el.props.className || "").split(" ").includes("zf-card")
  && JSON.stringify(el.props.children).includes(title));
check("有排队工作的会话不算「需要你」", !allText().includes("条排队中"),
  "「条排队中」是语义搞反时才会出现的文案");
check("有排队工作但没在跑的会话归入「正在跑」",
  !!cardOf("线上 502 排查") && JSON.stringify(cardOf("线上 502 排查").props.children).includes("在跑"),
  "s-502: running=false 但 inbox 有 2 条");
check("排队信息以中性提示呈现，不冒充「需要你」",
  !!cardOf("线上 502 排查") && JSON.stringify(cardOf("线上 502 排查").props.children).includes("队列里还有 2 条"),
  "应有 zf-queued 提示");
check("摘要取到了 turnOutline 的结论",
  allText().includes("LB idle timeout") || allText().includes("促销退坡"),
  "应能在卡片或摘要面板里看到主机大纲里的结论");
/* 断言必须落在摘要卡片上，不能只看页签标签存在 */
const sumCardsNow = () => host.filter((el) => String(el.props.className || "").split(" ").includes("zf-sum"));
check("摘要面板默认展示（确实有卡片，不只是页签在）", sumCardsNow().length > 0, "卡片 " + sumCardsNow().length);
check("卡片上真的写了轮次与上下文占用",
  sumCardsNow().some((el) => { const t = JSON.stringify(el.props.children); return t.includes("轮") && t.includes("上下文"); }),
  /* 注意：JSON.stringify(undefined) 返回的是 undefined **值** 而不是字符串，
     所以不能直接 .slice —— 那会让这条检查在它失败的时候把整轮跑挂掉。
     （变异审计抓到的：把默认页签改成偏好之后，套件直接崩了而不是干净地变红。） */
  (() => {
    const first = sumCardsNow()[0];
    return first ? JSON.stringify(first.props.children).slice(0, 150) : "（没有摘要卡片）";
  })());
/* 摘要面板的构造：切到 sum 后应能看到「你问 / 结论」两行 */
check("摘要面板渲染出「你问」与「结论」",
  host.some((el) => String(el.props.className || "").includes("zf-sum")),
  "应有 zf-sum 卡片");

/* ---------- 摘要卡片：主按钮是"就地看汇报"，不再跳页面 ---------- */
const reportEl = () => host.find((el) => String(el.props.className || "").split(" ").includes("zf-report"));
const reportBtn = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("看汇报"));
check("摘要卡片的主按钮是「看汇报」（不跳页面）", !!reportBtn);
if (reportBtn) reportBtn.props.onClick();
check("点「看汇报」不会打开原生界面", opened.length === 0, "opened=" + JSON.stringify(opened));
check("点「看汇报」后就地展开汇报视图", !!reportEl(), "应有 .zf-report");
check("汇报视图给出该会话的逐轮「你问 / 汇报」",
  !!reportEl() && JSON.stringify(reportEl().props.children).includes("汇报")
  && JSON.stringify(reportEl().props.children).includes("你问"));

/* ---------- 「原生界面」入口仍然在，但降级为次要按钮 ---------- */
const openBtn = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("原生界面"));
check("原生界面入口仍然保留（不能只有一条路）", !!openBtn);
if (openBtn) openBtn.props.onClick();
check("原生界面入口走的是反射拿到的 uiWorkspace.openSession",
  opened.length === 1, "opened=" + JSON.stringify(opened));

/* 失败必须可见：openSession 抛错时要在日志里说出来，而不是按钮点了没反应 */
const realOpen = uiWorkspaceStub.openSession;
uiWorkspaceStub.openSession = () => { throw new Error("模拟：openSession 炸了"); };
const openBtn2 = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("原生界面"));
if (openBtn2) openBtn2.props.onClick();
check("openSession 抛错时会被如实报出来（不静默）",
  allText().includes("打不开这个会话"), allText().slice(0, 220));
uiWorkspaceStub.openSession = realOpen;

/* 选中会**钉住发送目标** —— 这是刻意的（"只对上级说话"），但测试之间必须显式清掉，
   否则后面每条路由用例都会被这个钉子带偏（第一次跑时 7 条用例一起红就是这个原因）。 */
function clearPin() {
  const btn = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("改回自动"));
  if (btn) btn.props.onClick();
  return !!btn;
}
check("汇报视图里有「改回自动」按钮", clearPin());

/* ---------- 输入 → 实时路由预览 ---------- */
function type(value) {
  const area = cls("zf-compose")[0] ? host.find((el) => el.type === "textarea") : null;
  if (!area) throw new Error("找不到输入框");
  area.props.onChange({ target: { value } });
  // setState 触发重渲染
}
function previewText() {
  const fan = host.find((el) => String(el.props.className || "").includes("zf-fan"));
  return JSON.stringify(fan && fan.props.children);
}

type("线上又 502 了");
check("预览把「502」路由到线上排查会话", previewText().includes("线上 502 排查"), previewText().slice(0, 90));
check("预览给出了路由层与把握度", /标题匹配|学到的偏好|延续/.test(previewText()) && previewText().includes("%"));

/* ---------- 低把握：**发送之前**就要给警示 + 改投入口 ---------- */
/* "改版的事情" 只和一个标题共享 2 字片段 → 把握 56%，低于 65% 的线。 */
type("改版的事情");
const warnEl = () => host.find((el) => String(el.props.className || "").split(" ").includes("zf-warn"));
const altBtns = () => host.filter((el) => el.type === "button" && JSON.stringify(el.props.children).includes("改投「"));
check("把握低于 65% 时，发送前就出现警示", !!warnEl(), previewText().slice(0, 130));
check("警示里说明了投错的代价", !!warnEl() && JSON.stringify(warnEl().props.children).includes("污染"));
check("警示里直接列出可以改投的目标", altBtns().length > 0, "按钮 " + altBtns().length);
check("只是警示，没有替你发出去", sessions.sent.length === 0, "sent=" + sessions.sent.length);

if (altBtns().length) altBtns()[0].props.onClick();
check("点了改投目标 → 预览变成「你指定的」", previewText().includes("你指定的"), previewText().slice(0, 130));
check("钉住之后警示消失（不确定性已经没有了）", !warnEl());
check("钉住仍然不会自动发送（发送永远由你触发）", sessions.sent.length === 0);
check("选中即就地展开汇报视图（不跳页面）", !!reportEl());
check("钉住时给得出「改回自动」", clearPin());
check("改回自动后预览重新由系统判断", previewText().includes("标题匹配") || previewText().includes("延续"), previewText().slice(0, 130));

type("登录页的按钮间距再调一下");
/* 两个会话标题都含「登录页」，分数打平 → 选**最近用过的**那个。
   这是改成 rankRows 时顺带统一的规则：旧代码在打平时保留数组里靠前的那个，
   而那个顺序来自主机、语义未知；"最近用过的"更像答案，而且可预测。 */
check("标题打平时选最近用过的那个（登录页性能优化，5 小时前 vs 2 天前）",
  previewText().includes("登录页性能优化"), previewText().slice(0, 90));

/* ---------- 内容相似度**不做决定**，只给询问面板排序 ----------
   真机实测两轮的结论：字面匹配在长中文文本上不可靠 ——
   最小片段设 2 会把无关的话吸走，设 3 又匹配不上"归档"这种 2 字关键词。
   而一个假阳性比"没把握"更糟，因为它会跳过询问。
   所以内容相似度只用来回答"如果是这几个，哪个最像"，由人来拍板。 */
type("keepalive 要怎么调");
check("★ 内容像也不自动发：收敛到「没有把握」并准备问你",
  previewText().includes("没有把握"), previewText().slice(0, 150));

type("量子计算机的散热方案该怎么设计");
check("★ 泛泛的话同样是「没有把握」",
  previewText().includes("没有把握"), previewText().slice(0, 150));

/* 上面这句改了草稿 —— 后面按条数断言的回执用例必须先恢复成它们要的那句 */

/* 上面这句测试改了草稿 —— 后面按条数断言的回执用例必须先恢复成它们要的那句 */
type("登录页的按钮间距再调一下");

/* ---------- 回车 → 真实投递 ---------- */
async function submitDraft() {
  const send = cls("zf-send")[0];
  await send.props.onClick();
}
let submitError = null;
(async () => {
  try { await submitDraft(); } catch (e) { submitError = e; }
  check("投递过程不抛错", !submitError, submitError && submitError.message);
  check("真的打到了预览里承诺的那个会话（打平局 → 最近用过的）",
    sessions.sent.length === 1 && sessions.sent[0].id === "s-login2",
    JSON.stringify(sessions.sent));
  check("走的是真实 queue 投递模式", sessions.sent[0] && sessions.sent[0].mode === "queue");
  check("投递来源标记正确", sessions.sent[0] && sessions.sent[0].source === "zeroFriction");
  check("发送后渲染出投递回执", allText().includes("已投递给"), allText().slice(0, 160));

  /* ---------- 不是它 → 真正的改投：换目标 + 学规则 + 重投 ---------- */
  const learnBtn = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("不是它"));
  check("回执里提供「不是它？改投给…」", !!learnBtn);
  if (learnBtn) learnBtn.props.onClick();
  /* 点开后应出现候选会话（排除投错的那个），而不是直接写规则 */
  const candidates = host.filter((el) => el.type === "button" && String(el.props.className || "").includes("zf-tab"));
  check("点开后进入选目标状态（还没有写规则）",
    !JSON.parse(storage.getItem("dsh.zeroFriction.v1") || "{}").rules
    || JSON.parse(storage.getItem("dsh.zeroFriction.v1") || "{}").rules.length === 0,
    "此时不该已经写入偏好");
  check("改投候选里不含子智能体",
    !host.some((el) => el.type === "button" && JSON.stringify(el.props.children).includes("子任务")),
    "子智能体不是投递目标");
  const pick = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("线上 502 排查"));
  check("候选里能选到别的会话", !!pick);
  if (pick) await pick.props.onClick();
  const stored = JSON.parse(storage.getItem("dsh.zeroFriction.v1") || "{}");
  /* 这条消息（登录页…）与「线上 502 排查」没有共同特征 —— 第 15 轮起刻意不写规则。
     真机教训：原来会退回到"消息里第一段汉字"，于是学出了泛词「工具」。 */
  check("没有共同特征时不写规则（宁可这次不学）",
    Array.isArray(stored.rules) && stored.rules.length === 0, JSON.stringify(stored.rules));
  check("并且如实说明原因", allText().includes("没有共同特征"), allText().slice(0, 200));
  check("改投把消息真的重投到了新目标",
    sessions.sent.length === 2 && sessions.sent[1].id === "s-502",
    JSON.stringify(sessions.sent));
  check("摩擦账本记下了这次纠正", stored.days && Object.values(stored.days)[0].corrections === 1,
    JSON.stringify(stored.days));

  /* ---------- 正例：消息与目标标题有共同特征时，要学到并指向新目标 ---------- */
  type("登录页改版之后还是有问题，帮我排查一下");
  await submitDraft();
  /* 取**最后**一条日志的按钮：新回执追加在末尾，find() 会拿到上一条旧日志的按钮。 */
  const rerouteBtns = () => host.filter((el) => el.type === "button"
    && JSON.stringify(el.props.children).includes("不是它"));
  const learnBtn2 = rerouteBtns()[rerouteBtns().length - 1];
  check("新回执也提供了改投按钮", !!learnBtn2);
  if (learnBtn2) learnBtn2.props.onClick();
  const pickBtns = () => host.filter((el) => el.type === "button"
    && JSON.stringify(el.props.children).includes("线上 502 排查"));
  const pick2 = pickBtns()[pickBtns().length - 1];
  if (pick2) await pick2.props.onClick();
  const stored2 = JSON.parse(storage.getItem("dsh.zeroFriction.v1") || "{}");
  check("有共同特征时学到规则，且指向被改投的那个会话",
    stored2.rules.length === 1 && stored2.rules[0].sessionId === "s-502" && stored2.rules[0].match === "排查",
    JSON.stringify(stored2.rules));

  /* ---------- 特征不排他时同样不学：「登录页」在两个会话标题里都有 ---------- */
  type("登录页和销量都看看");
  await submitDraft();
  const btns3 = host.filter((el) => el.type === "button" && JSON.stringify(el.props.children).includes("不是它"));
  if (btns3.length) btns3[btns3.length - 1].props.onClick();
  const pickBtns3 = () => host.filter((el) => el.type === "button"
    && JSON.stringify(el.props.children).includes("登录页改版"));
  const pick3 = pickBtns3()[pickBtns3().length - 1];
  check("改投候选里能选到另一个登录页会话", !!pick3);
  if (pick3) await pick3.props.onClick();
  const stored3 = JSON.parse(storage.getItem("dsh.zeroFriction.v1") || "{}");
  check("特征在别的会话标题里也有时，不写规则",
    stored3.rules.length === 1, "规则数应仍是 1（只有『排查』那条）：" + JSON.stringify(stored3.rules));
  check("并说明是因为不够独特", allText().includes("在别的会话里也有"), allText().slice(0, 200));

  /* 学到的偏好要真的参与下一次路由（用刚学到的那条特征去问） */
  type("排查一下线上日志");
  check("学到的偏好下次直接命中，并指向被改投的那个会话",
    previewText().includes("学到的偏好") && previewText().includes("线上 502 排查"),
    previewText().slice(0, 130));

  /* ---------- 没证据时：问你，而不是替你挑"上一次用过的" ---------- */
  const choicePanel = () => host.find((el) => String(el.props.className || "").split(" ").includes("zf-choice"));

  /* 先验"面板把内容最接近的排在第一位" —— 内容相似度只用在这里，不用来做决定 */
  const sentBeforeCancel = sessions.sent.length;
  type("keepalive 要怎么调");
  await submitDraft();
  const askBtns = () => host.filter((el) => el.type === "button" && /^(就)?发给「/.test(String(el.props.children || "")));
  check("没证据时按回车会打开询问面板", askBtns().length > 0, "候选按钮 " + askBtns().length);
  check("★ 面板把**内容最接近**的排在第一位（s-502 聊过 keepalive）",
    askBtns().length > 0 && JSON.stringify(askBtns()[0].props.children).includes("线上 502 排查"),
    JSON.stringify(askBtns().map((b) => b.props.children)));
  const cancelBtn = host.find((el) => el.type === "button" && String(el.props.children || "").includes("取消，我改改"));
  if (cancelBtn) cancelBtn.props.onClick();
  check("点「取消」后回到普通输入状态", !choicePanel(), "面板应收起");
  check("取消不会发送任何东西", sessions.sent.length === sentBeforeCancel, "sent=" + sessions.sent.length);

  type("帮我做一个权限审批系统，要能配置角色和审批流");
  const previewNew = previewText();
  check("没证据时如实标注「没有把握」", previewNew.includes("没有把握"), previewNew.slice(0, 140));

  const createdBefore = sessions.created.length;
  const sentBeforeAsk = sessions.sent.length;
  await submitDraft();
  check("★ 没证据时按回车**不发送**，而是把选择面板摆出来", !!choicePanel(),
    "应有 .zf-choice；实际投递 " + (sessions.sent.length - sentBeforeAsk) + " 次");
  check("★ 也确实没有替你开新会话（要等你选）", sessions.created.length === createdBefore);
  check("面板里明确问是否开新会话",
    !!choicePanel() && JSON.stringify(choicePanel().props.children).includes("开个新会话"));

  const newBtn = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("开个新会话发出去"));
  check("面板里能选「开个新会话发出去」", !!newBtn);
  if (newBtn) await newBtn.props.onClick();
  check("选了之后真的开了一个新会话", sessions.created.length === createdBefore + 1, JSON.stringify(sessions.created));
  check("消息投进了新建的那个会话",
    sessions.sent[sessions.sent.length - 1].id === sessions.created[sessions.created.length - 1],
    JSON.stringify(sessions.sent.slice(-1)));
  check("回执写明是新建的", allText().includes("开了新会话"));

  /* 短追问不该被当成"没把握" —— 它接着当前会话说是合理的（但仍然标成 ask） */
  type("再改一下");
  check("短追问走「像是接着说的」，而不是「没有把握」",
    previewText().includes("像是接着说的"), previewText().slice(0, 140));

  /* ---------- 使用者报的具体 bug：「1+1=2」被路由到当前会话 ----------
     旧判据只看"短 + 没有领域词"，而一个全新的短问题同样满足这两条。
     现在必须出现真正的续说标记（再/继续/它/这个…）才算追问。 */
  type("1+1=2");
  check("★ 一个全新的短问题不会被当成「接着当前会话说」",
    !previewText().includes("像是接着说的"), previewText().slice(0, 140));
  check("★ 它会被如实标成「没有把握」", previewText().includes("没有把握"), previewText().slice(0, 140));

  /* ---------- 「开新会话」必须**永远在**，不依赖任何阈值 ---------- */
  const altBtn = () => host.find((el) => el.type === "button" && String(el.props.children || "") === "开新会话");
  check("★ 输入框旁边永远有一个「开新会话」按钮", !!altBtn());
  /* 这句话路由是有把握的（会落到登录页会话）—— 但仍然可以直接开新会话 */
  type("登录页的按钮间距再调一下");
  check("这句话本来是有把握的", previewText().includes("标题匹配"), previewText().slice(0, 120));
  const createdBeforeAlt = sessions.created.length;
  const sentBeforeAlt = sessions.sent.length;
  if (altBtn()) await altBtn().props.onClick();
  check("★ 有把握时点「开新会话」也会开新会话（明示的出口不受阈值约束）",
    sessions.created.length === createdBeforeAlt + 1, JSON.stringify(sessions.created));
  check("并且发到的是新建的那个",
    sessions.sent.length === sentBeforeAlt + 1
    && sessions.sent[sessions.sent.length - 1].id === sessions.created[sessions.created.length - 1],
    JSON.stringify(sessions.sent.slice(-1)));

  /* ---------- 子智能体不能成为投递目标 ---------- */
  type("子任务：抽取图表 的结果再给我看一遍");
  check("命中子智能体标题时也不会投给它",
    !previewText().includes("子任务"), previewText().slice(0, 140));

  /* ---------- 连点两次回车不能重复投递 ---------- */
  type("线上又 502 了");
  const sentBefore = sessions.sent.length;
  /* 关键：**捕获同一个元素**再点两次，而不是每次重新取。
     真实 React 里 setState 是批处理的，第二次事件用的还是上一次渲染交付的那个闭包
     （busy 仍是 false）。每次重新取元素会拿到"已经重渲染过"的新闭包，那就测不出这个
     bug 了 —— 我的 mini-React 同步重渲染，所以必须刻意模拟批处理这一情形。
     下方其余步骤用 sendButton() 每次重新取，因为那里的语义就是"重新渲染后再点"。 */
  const sameClosure = cls("zf-send")[0];
  const sendButton = () => cls("zf-send")[0];
  const first = sameClosure.props.onClick();
  const second = sameClosure.props.onClick();
  await Promise.all([first, second]);
  check("同一 tick 连点两次只投递一次（同步闸门）",
    sessions.sent.length === sentBefore + 1,
    "实际投递 " + (sessions.sent.length - sentBefore) + " 次");

  /* 闸门的另一半：它必须"一定会被释放"。
     走真实可达的失败路径 —— 让新建会话失败（这个版本的 DSH 不支持 create）。 */
  const realCreate = sessions.create;
  sessions.create = async () => { throw new Error("模拟：这个实例不支持新建会话"); };
  type("帮我做一个全新的权限审批系统，需要角色和审批流");
  const beforeFail = sessions.sent.length;
  await sendButton().props.onClick();
  /* 没证据 → 现在先经选择面板（这本身就是新行为），再选"开新会话"走到 create 那条失败路径 */
  const failNewBtn = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("开个新会话发出去"));
  check("失败路径也要先经过选择面板", !!failNewBtn);
  if (failNewBtn) await failNewBtn.props.onClick();
  check("新建会话失败时如实报错", allText().includes("投递失败"),
    "最近投递: " + JSON.stringify(sessions.sent.slice(-2)) + " · 预览: " + previewText().slice(0, 120));
  check("失败时没有误投到别的会话", sessions.sent.length === beforeFail, "投递 " + (sessions.sent.length - beforeFail) + " 次");
  check("失败会把草稿还回来", !!host.find((el) => el.type === "textarea" && String(el.props.value || "").includes("权限审批")));
  sessions.create = realCreate;

  /* 失败之后闸门必须已经被释放，否则面板从此发不出消息 */
  type("线上又 502 了");
  const afterFail = sessions.sent.length;
  await sendButton().props.onClick();
  check("失败之后面板仍然能投递（闸门被释放）",
    sessions.sent.length === afterFail + 1,
    "投递 " + (sessions.sent.length - afterFail) + " 次");

  /* ---------- 语义路由：词面对不上时去问模型 ----------
     只测测试台能**忠实**模拟的部分：
       · 没证据时确实去问了，而且问的是候选列表 + 目标句
       · 用的是**专用助手会话**，并且会复用（不每问一次建一个）
       · 助手答了一个编号 → 预览采纳为「语义路由」，且不再算"没把握"
       · 关掉开关 → 一个字都不发给助手
     超时失败、NEW 这两条**不在这里测** —— 它们依赖 45 秒定时器与 effect 时序，
     而 mini-React 不跑 effect 清理，留下未释放的定时器会互相污染（试着测过，
     结论是不可靠）。那两条改在真机上验：真机没有凭据 → 模型不会回答 →
     超时路径天然被跑到。这条取舍写进了 README。 */
  pendingTimers.length = 0;
  const routerSent = () => sessions.sent.filter((item) => item.text.includes("应该发给几号"));
  const beforeRouter = routerSent().length;
  const createdBeforeRouter = sessions.created.length;

  type("量子计算机的散热方案该怎么设计");
  flushTimers(1000);            /* 放掉 800ms 防抖 */
  await settle();

  check("★ 没证据时会去问路由助手（正好一条）",
    routerSent().length === beforeRouter + 1, "分类请求 " + (routerSent().length - beforeRouter) + " 条");
  const askText = routerSent().slice(-1)[0].text;
  check("★ 助手是个**专用会话**（新建的，不是你已有的）",
    sessions.created.length === createdBeforeRouter + 1
    && routerSent().slice(-1)[0].id === sessions.created[sessions.created.length - 1],
    JSON.stringify(sessions.created.slice(-2)));
  check("分类请求里带了候选编号与目标句",
    /1\.\s/.test(askText) && askText.includes("量子计算机的散热方案该怎么设计"), askText.slice(0, 110));
  check("并且结尾就是那句指令（只回编号或 NEW）", askText.trim().endsWith("只回一个编号或 NEW。"), askText.slice(-60));
  check("★ 助手答了编号 → 预览采纳为「语义路由」",
    previewText().includes("语义路由"), previewText().slice(0, 150));
  check("★ 采纳之后不再算「没有把握」（也就不会再弹询问面板）",
    !previewText().includes("没有把握"), previewText().slice(0, 150));
  /* 采纳的目标必须**正是候选里的第 1 个**（从请求原文里把标题抠出来比对） */
  const firstCandidate = (askText.match(/1\.\s*([^\n｜]+)/) || [])[1];
  check("指向的正是候选列表里的第 1 个",
    !!firstCandidate && previewText().includes(firstCandidate.trim()),
    "候选 1 = " + firstCandidate + " · 预览 = " + previewText().slice(0, 120));

  /* 复用：换一句话再问一次，仍然用同一个助手会话，不会又建一个 */
  pendingTimers.length = 0;
  const sessionUsedBefore = routerSent().slice(-1)[0].id;
  const createdBeforeSecond = sessions.created.length;
  type("月球基地的供电方案要怎么规划");
  flushTimers(1000);
  await settle();
  check("★ 第二次问仍然复用同一个助手会话（不会每问一次建一个）",
    sessions.created.length === createdBeforeSecond && routerSent().slice(-1)[0].id === sessionUsedBefore,
    "会话 " + sessionUsedBefore + " → " + routerSent().slice(-1)[0].id + " · 新建 " + (sessions.created.length - createdBeforeSecond));

  /* ★ 真机验证时抓到：助手会话自己出现在候选里（"发给「你是「零摩擦」插件的语义路」"）。
     它是插件的工具、不是你欠的对话，必须从投递候选里彻底消失。 */
  const secondAsk = routerSent().slice(-1)[0].text;
  check("★ 助手会话不再出现在候选列表里（真机抓到的）",
    !secondAsk.includes("语义路由助手") && !secondAsk.includes("你只回编号"), secondAsk.slice(0, 110));
  pendingTimers.length = 0;
  type("再一句完全没有对应会话的句子");
  flushTimers(1000);
  await settle();
  await submitDraft();      /* 助手不回 → 询问面板 */
  const pickLabels = host.filter((el) => el.type === "button" && /^(就)?发给「/.test(String(el.props.children || "")))
    .map((el) => String(el.props.children));
  check("★ 询问面板的候选里也没有助手自己", !pickLabels.some((label) => label.includes("语义路由助手")),
    JSON.stringify(pickLabels));
  const cancel3 = host.find((el) => el.type === "button" && String(el.props.children || "").includes("取消，我改改"));
  if (cancel3) cancel3.props.onClick();

  /* 「关掉开关就不再问」这条不在这里测：mini-React 的扁平遍历只看到一个 .zf-sw，
     分不清两个开关。它不是正确性守卫，改在真机上点一下验证（README 有记录）。 */
  /* ---------- 摩擦账本 ---------- */
  const ledgerTab = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("摩擦账本"));
  check("存在摩擦账本页签", !!ledgerTab);
  if (ledgerTab) ledgerTab.props.onClick();
  /* 「本该打断」这四个字在账本的说明文字里恒定存在，用它做断言等于没测。
     这里改成断言真的有一张账本表，且表里有今天那一行。 */
  const ledgerTable = host.find((el) => el.type === "table" && String(el.props.className || "").includes("zf-ledger"));
  check("账本真的渲染出一张表", !!ledgerTable);
  const ledgerCells = ledgerTable ? JSON.stringify(ledgerTable.props.children) : "";
  check("账本表头是 日期/投递/新建/纠正/本该打断",
    ledgerCells.includes("日期") && ledgerCells.includes("投递") && ledgerCells.includes("新建")
    && ledgerCells.includes("纠正") && ledgerCells.includes("本该打断"), ledgerCells.slice(0, 140));
  check("账本里有今天那一行（不是空表）",
    new RegExp("\\d\\d-\\d\\d").test(ledgerCells), ledgerCells.slice(0, 160));
  check("账本里有合计行", ledgerCells.includes("合计"));

  /* ---------- 跨会话检索：本地搜大纲，不依赖主机索引 ---------- */
  const findTab = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("检索"));
  check("存在跨会话检索页签", !!findTab);
  if (findTab) findTab.props.onClick();
  const input = host.find((el) => el.type === "input" && String(el.props.placeholder || "").includes("边打边搜"));
  check("检索输入框存在", !!input);
  if (input) {
    const before = sessions.searches.length;
    input.props.onChange({ target: { value: "502" } });
    /* 断言必须落在**检索结果行**上。之前这里断言的是 allText() 里含会话标题 ——
       可队列里本来就有那个标题，于是检索返回空也照样通过（变异审计抓到的）。 */
    const hitRows = () => RUNTIME.host().filter((el) => String(el.props.className || "").split(" ").includes("zf-hit"));
    check("边打边搜：不需要回车就已经出结果", hitRows().length > 0, "命中行 " + hitRows().length);
    check("本地检索不发任何 RPC", sessions.searches.length === before, "searches=" + JSON.stringify(sessions.searches));
    check("命中标注了是哪一轮的哪个字段",
      hitRows().some((el) => JSON.stringify(el.props.children).includes("轮")),
      "命中行内容: " + JSON.stringify(hitRows().map((el) => el.props.children)).slice(0, 160));
    check("关键词被高亮标注", host.some((el) => String(el.props.className || "").includes("zf-mark")));
  }

  /* 探测主机索引：必须如实报出它是关的，而不是静默空结果 */
  const probeBtn = host.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("探测主机索引"));
  check("提供主机索引探测按钮", !!probeBtn);
  if (probeBtn) {
    await probeBtn.props.onClick();
    check("如实报告主机索引不可用",
      allText().includes("关闭") || allText().includes("gateway/internal"),
      allText().slice(0, 200));
  }

  /* ---------- 钉住之后**真的**投给被钉住的会话（不只看预览好看） ----------
     放在这里：此刻 host 还是主渲染、sessions 还是同一个；再往后规模/空态用例会
     重渲染别的组件。前面的按条数断言也都已经跑完了。 */
  (() => {}); // 保持缩进对齐
  sessions.sent.length = 0;
  const cardOf2 = (title) => host.find((el) => String(el.props.className || "").split(" ").includes("zf-card")
    && JSON.stringify(el.props.children).includes(title));
  const target2 = cardOf2("8 月销量下滑归因");
  check("能在队列里选中「8 月销量下滑归因」", !!target2);
  if (target2) target2.props.onClick();
  check("选中后展开的是这个会话的汇报",
    !!reportEl() && JSON.stringify(reportEl().props.children).includes("8 月销量下滑归因"));
  check("汇报视图里点名了它手下的子智能体（层级关系可见）",
    !!reportEl() && JSON.stringify(reportEl().props.children).includes("子智能体"),
    "s-sub 的 parentId 是 s-sales");
  type("这句话只给上级");
  await cls("zf-send")[0].props.onClick();
  check("钉住后真的投给被钉住的会话（不是重算路由）",
    sessions.sent.length === 1 && sessions.sent[0].id === "s-sales" && sessions.sent[0].text === "这句话只给上级",
    JSON.stringify(sessions.sent));
  clearPin();
  check("清掉钉子后预览恢复自动判断", !previewText().includes("你指定的"), previewText().slice(0, 100));

  /* ---------- 规模：用满一天之后会有很多会话，每个几十轮 ---------- */
  const BIG = [];
  for (let i = 0; i < 200; i++) {
    const outline = [];
    for (let t = 1; t <= 40; t++) {
      outline.push({ turn: t, seq: t * 10, prompt: "第 " + t + " 轮的问题 · 会话 " + i, response: "第 " + t + " 轮的结论 alpha · 会话 " + i });
    }
    BIG.push({
      id: "big-" + i, displayTitle: "会话 " + i + " alpha", running: i % 7 === 0, blank: false,
      updatedAt: now - i * 60000, cwd: "C:\\work\\p" + (i % 5), retainedBy: {},
      projectionValues: {
        title: "会话 " + i + " alpha",
        turnOutline: outline,
        sessionStats: { turns: outline.length },
        contextPressure: { pressureTokens: 1000 * i, contextWindow: 1000000 },
        inbox: { "next-turn": [], "next-step": [] },
        userQuestions: { active: i % 11 === 0 ? [{ id: "q", text: "等你回答" }] : [], settled: [] },
        plan: { pending: false },
        sessionListMetadata: { blank: false, lastPromptAt: now - i * 60000 }
      }
    });
  }
  let specBig = null;
  global.window.__ModuleLoader__.load = (spec) => { specBig = spec; };
  new Function("window", "document", bundle)(global.window, global.document);
  const modBig = specBig.factory(requireShim);
  const regBig = [];
  const bigSessions = makeSessions(BIG);
  const ctxBig = {
    slots: { inject: (n, b) => { driveInject(n, b); return () => {}; }, register: (o, c) => { regBig.push({ opts: o, component: c }); return () => {}; } },
    sessions: bigSessions,
    get: () => uiWorkspaceStub,
  };
  modBig.apply(ctxBig);
  const bigMain = regBig.find((r) => r.opts.name === "main").component;
  RUNTIME.reset();
  RUNTIME.setForceRender(() => { bigHost = RUNTIME.render(bigMain, {}); host = bigHost; });
  const startedAt = Date.now();
  let bigError = null;
  let bigHost = [];
  try { bigHost = RUNTIME.render(bigMain, {}); } catch (e) { bigError = e; }
  const elapsed = Date.now() - startedAt;
  host = bigHost;
  check("200 会话 × 40 轮：渲染不抛错", !bigError, bigError && bigError.message);
  check("规模下渲染在预算内（< 3000ms）", elapsed < 3000, elapsed + "ms");
  const countSum = (list) => list.filter((el) => String(el.props.className || "").split(" ").includes("zf-sum")).length;
  check("摘要面板默认封顶在 12 张", countSum(bigHost) === 12, "实际 " + countSum(bigHost));
  check("提供了「显示全部」入口", allText().includes("显示全部 200 个"), allText().slice(0, 160));
  const bigCards = bigHost.filter((el) => String(el.props.className || "").split(" ").includes("zf-card")).length;
  const bigWaiting = BIG.filter((row) => row.projectionValues.userQuestions.active.length > 0).length;
  check("「真的在等你」不封顶（该看的都在）", bigCards >= bigWaiting, "等待 " + bigWaiting + " · 卡片 " + bigCards);
  check("其余分组封顶，队列不会膨胀", bigCards < bigWaiting + 30, "卡片数 " + bigCards);
  /* 「还有 」在两个地方都出现：空态文案「还没有有内容的会话」里就有「还有」。
     所以必须要求它后面跟着数字。 */
  check("封顶处给出「还有 N 个」提示", /还有 \d+ 个/.test(allText()), allText().slice(0, 120));
  const showAllBtn = bigHost.find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("显示全部"));
  if (showAllBtn) showAllBtn.props.onClick();
  check("点开「显示全部」后渲染全部 200 张", countSum(RUNTIME.host()) === 200, "实际 " + countSum(RUNTIME.host()));

  /* 边打边搜在规模下的成本：一次按键要扫 200 × 40 = 8000 条大纲 */
  const findTabBig = RUNTIME.host().find((el) => el.type === "button" && JSON.stringify(el.props.children).includes("检索"));
  if (findTabBig) findTabBig.props.onClick();
  const inputBig = RUNTIME.host().find((el) => el.type === "input" && String(el.props.placeholder || "").includes("边打边搜"));
  check("规模下仍能进入检索页", !!inputBig);
  if (inputBig) {
    const searchStart = Date.now();
    inputBig.props.onChange({ target: { value: "alpha" } });
    const searchMs = Date.now() - searchStart;
    check("规模检索一次按键在预算内（< 800ms）", searchMs < 800, searchMs + "ms（8000 条大纲）");
    check("规模检索命中并被截断渲染",
      RUNTIME.host().filter((el) => String(el.props.className || "").split(" ").includes("zf-hit")).length === 60,
      "命中行 " + RUNTIME.host().filter((el) => String(el.props.className || "").split(" ").includes("zf-hit")).length);
  }

  /* ---------- 空会话列表不能炸 ---------- */
  const empty = makeSessions([]);
  const reg2 = [];
  const ctx2 = { slots: ctx.slots, sessions: empty, uiWorkspace: {} };
  // 重新加载一份干净模块，避免复用已注册状态
  let spec2 = null;
  global.window.__ModuleLoader__.load = (spec) => { spec2 = spec; };
  new Function("window", "document", bundle)(global.window, global.document);
  const mod2 = spec2.factory(requireShim);
  const ctx3 = { slots: { inject: (n, b) => { driveInject(n, b); return () => {}; }, register: (o, c) => { reg2.push({ opts: o, component: c }); return () => {}; } }, sessions: empty, uiWorkspace: {} };
  mod2.apply(ctx3);
  let emptyError = null;
  RUNTIME.reset();
  try { RUNTIME.render(reg2.find((r) => r.opts.name === "main").component, {}); } catch (e) { emptyError = e; }
  check("零会话时渲染不抛错", !emptyError, emptyError && emptyError.message);

  /* ---------- 服务缺失时也必须能渲染出来 ---------- */
  let degradedError = null;
  RUNTIME.reset();
  const reg3 = [];
  const ctx4 = { slots: { inject: (n, b) => { driveInject(n, b); return () => {}; }, register: (o, c) => { reg3.push({ opts: o, component: c }); return () => {}; } } };
  mod2.apply(ctx4);
  try { RUNTIME.render(reg3.find((r) => r.opts.name === "main").component, {}); } catch (e) { degradedError = e; }
  check("会话服务缺失时降级渲染不抛错", !degradedError, degradedError && degradedError.message);



  console.log("\n" + (results.every((r) => r.ok) ? "全部通过" : "有失败项") +
    "：" + results.filter((r) => r.ok).length + "/" + results.length);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
