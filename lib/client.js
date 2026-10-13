window.__ModuleLoader__.load({
	id: "dsh-client-ui-zero-friction",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React;

		/* ================================================================
		   常量
		   ================================================================ */
		const PANEL_ID = "zero-friction";
		const CSS_ID = "dsh-client-ui-zero-friction/zero-friction.css";
		const STORE_KEY = "dsh.zeroFriction.v1";
		/* 摘要面板默认只渲染这么多张卡片；用满一天后会话会很多 */
		const SUMMARY_LIMIT = 12;
		/* ================================================================
		   语义路由（可选，默认开）
		   为什么必须问模型：字面匹配区分不了"有意义的短词"和"到处都有的虚词"
		   （见 README 坑 #11 的两轮实测）。真正的"读懂意思"只能过模型。
		   探测结果：客户端唯一的模型入口是 session.prompt（llm 命名空间只暴露
		   列模型/列供应商，没有补全方法）。所以必须有一个**专用会话**当分类器 ——
		   把提示词投进你自己的会话会污染它，那正是要避免的问题。
		   代价：没把握时多花那个助手会话一轮。所以结果带缓存、且有超时兜底。
		   ================================================================ */
		const ROUTER_KICKOFF = "（语义路由助手）之后我给你候选会话和用户的一句话，你只回编号或 NEW，不要解释、不要用工具。";
		const ROUTER_TIMEOUT_MS = 45000;
/* 把握度低于它就要在**发送之前**给出警示与改投入口。
   0.65 是使用者定的：投错一次会污染那个会话的上下文，还要白烧一轮算力，
   所以宁可在这里多给一次机会。注意这和账本里 0.42 那个数不是一回事 ——
   0.42 是"旧设计会打断你"的判据，只用于让「0 次打断」可证伪。 */
const CONFIDENCE_WARN = 0.65;
/** 这条回执是不是"低把握投出去的" —— 是的话收据要显眼并突出改投入口。 */
function isLowEntry(entry) {
	return entry.kind === "ok" && entry.confidence != null && entry.confidence < CONFIDENCE_WARN;
}
		const EMPTY_SNAPSHOT = { byId: {}, ids: [], phase: "pending" };

		/* 样式走 app 自己的设计变量，回退到中性值，浅色/深色都能看 */
		const CSS = `
.zf-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.6}
.zf-head{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-separator-secondary,rgba(128,128,128,.22));flex:none;flex-wrap:wrap}
.zf-head h2{margin:0;font-size:15px;font-weight:600}
.zf-hud{display:flex;gap:14px;margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));flex-wrap:wrap}
.zf-hud b{color:var(--dsw-alias-state-success-primary,#2fd39a);font-weight:600}
.zf-hud .zf-zero b{color:var(--dsw-alias-state-success-primary,#2fd39a)}
.zf-body{display:flex;flex:1;min-height:0}
.zf-queue{width:290px;flex:none;overflow-y:auto;border-right:1px solid var(--dsw-alias-separator-secondary,rgba(128,128,128,.22));padding:10px}
.zf-sect{display:flex;align-items:center;gap:6px;margin:10px 6px 6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.zf-sect span.zf-cnt{margin-left:auto;background:rgba(128,128,128,.16);border-radius:8px;padding:0 6px}
.zf-card{padding:9px 10px;border-radius:10px;border:1px solid transparent;cursor:pointer;margin-bottom:3px}
.zf-card:hover{background:rgba(128,128,128,.09);border-color:rgba(128,128,128,.24)}
.zf-card.on{background:rgba(79,140,255,.14);border-color:rgba(79,140,255,.5)}
.zf-card .zf-t{font-weight:600;margin-bottom:3px;word-break:break-word}
.zf-card .zf-m{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.zf-flag{font-size:10.5px;padding:0 6px;border-radius:7px;font-weight:600;white-space:nowrap}
.zf-flag.run{background:rgba(79,140,255,.2);color:#6fa8ff}
.zf-flag.idle{background:rgba(255,176,32,.18);color:#e0a33a}
.zf-flag.old{background:rgba(128,128,128,.18)}
.zf-flag.sub{background:rgba(167,139,250,.2);color:#b39bfa}
.zf-main{flex:1;min-width:0;display:flex;flex-direction:column}
.zf-log{flex:1;overflow-y:auto;padding:14px 18px}
.zf-item{border:1px solid rgba(128,128,128,.2);border-radius:10px;padding:9px 12px;margin-bottom:9px;background:rgba(128,128,128,.05)}
.zf-item .zf-h{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));margin-bottom:4px}
.zf-item .zf-h b{font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.zf-item .zf-x{font-size:12px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));margin-top:4px;white-space:pre-wrap;word-break:break-word}
.zf-ok{border-color:rgba(47,211,154,.45);background:rgba(47,211,154,.08)}
.zf-err{border-color:rgba(255,93,93,.5);background:rgba(255,93,93,.08);color:#ff8f8f}
.zf-note{color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font-size:12px;text-align:center;padding:22px 0}
.zf-compose{flex:none;border-top:1px solid var(--dsw-alias-separator-secondary,rgba(128,128,128,.22));padding:9px 18px 14px}
.zf-fan{min-height:30px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 12px;margin-bottom:7px;border-radius:9px;background:rgba(128,128,128,.09);font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.zf-fan .zf-to{color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.zf-row{display:flex;gap:9px;align-items:flex-end;border:1px solid rgba(128,128,128,.28);border-radius:13px;padding:9px 9px 9px 13px}
.zf-row:focus-within{border-color:rgba(79,140,255,.7)}
.zf-row textarea{flex:1;background:none;border:none;outline:none;color:inherit;resize:none;font:inherit;max-height:140px;min-height:24px}
.zf-send{background:#4f8cff;color:#fff;border:none;border-radius:10px;padding:7px 15px;font:inherit;font-weight:600;cursor:pointer}
.zf-send:disabled{opacity:.5;cursor:default}
.zf-alt{font:inherit;font-size:12.5px;padding:0 12px;border-radius:9px;cursor:pointer;white-space:nowrap;border:1px dashed var(--dsw-alias-border-secondary,rgba(128,128,128,.5));background:none;color:var(--dsw-alias-label-secondary,rgba(120,120,120,1))}
.zf-alt:hover{border-color:var(--dsw-alias-border-primary,rgba(128,128,128,.9));color:inherit}
.zf-hint{margin-top:7px;font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.zf-side{width:320px;flex:none;border-left:1px solid var(--dsw-alias-separator-secondary,rgba(128,128,128,.22));overflow-y:auto;padding:12px}
.zf-tabs{display:flex;gap:6px;margin-bottom:10px}
.zf-tab{border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:3px 10px;font:inherit;font-size:12px;background:none;color:inherit;cursor:pointer;white-space:nowrap}
.zf-tab.on{border-color:rgba(79,140,255,.6);background:rgba(79,140,255,.15)}
.zf-rule{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(128,128,128,.2);border-radius:10px;margin-bottom:6px;background:rgba(128,128,128,.05)}
.zf-rule .zf-rt{flex:1;min-width:0;font-size:12.5px;word-break:break-word}
.zf-rule small{display:block;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font-size:11px}
.zf-sw{width:32px;height:18px;border-radius:9px;background:rgba(128,128,128,.4);position:relative;flex:none;cursor:pointer;border:none;padding:0}
.zf-sw:after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:.15s}
.zf-sw.on{background:#2fd39a}
.zf-sw.on:after{left:16px}
.zf-input{width:100%;box-sizing:border-box;border:1px solid rgba(128,128,128,.3);border-radius:9px;padding:6px 10px;background:none;color:inherit;font:inherit;outline:none}
.zf-hit{border-bottom:1px solid rgba(128,128,128,.16);padding:8px 2px;cursor:pointer}
.zf-hit:hover{background:rgba(128,128,128,.07)}
.zf-hit .zf-ht{font-size:11px;color:#6fa8ff;margin-bottom:3px}
.zf-hit .zf-hs{font-size:12px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));word-break:break-word}
.zf-flag.wait{background:rgba(255,93,93,.2);color:#ff8f8f}
.zf-ask{font-size:11.5px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));margin-top:4px;word-break:break-word}
.zf-conc{font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));margin-top:2px;word-break:break-word}
.zf-need{margin-top:5px;font-size:11.5px;color:#e0a33a;background:rgba(255,176,32,.12);border:1px solid rgba(255,176,32,.3);border-radius:7px;padding:2px 7px;display:inline-block}
.zf-sum{border:1px solid rgba(128,128,128,.2);border-radius:10px;padding:9px 11px;margin-bottom:9px;background:rgba(128,128,128,.05)}
.zf-sum-h{display:flex;align-items:center;gap:7px;font-size:12.5px;margin-bottom:5px}
.zf-sum-h b{font-weight:600;word-break:break-word}
.zf-sum-goal{font-size:11.5px;color:#6fa8ff;margin-bottom:5px;word-break:break-word}
.zf-sum-row{display:flex;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));margin:3px 0;word-break:break-word}
.zf-sum-row i{font-style:normal;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));flex:none;width:42px}
.zf-sum-row.zf-dim{opacity:.65}
.zf-sum-f{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px;font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.zf-sum-f .zf-tab{margin-left:auto}
.zf-sum-f .zf-tab + .zf-tab{margin-left:0}
.zf-reroute{margin-top:7px;padding:8px 10px;border:1px dashed rgba(79,140,255,.5);border-radius:9px;background:rgba(79,140,255,.07)}
.zf-reroute-h{font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));margin-bottom:6px}
.zf-reroute .zf-tab{margin:0 6px 6px 0}
.zf-ledger{width:100%;border-collapse:collapse;font-size:12px}
.zf-ledger th,.zf-ledger td{padding:5px 4px;text-align:right;border-bottom:1px solid rgba(128,128,128,.18)}
.zf-ledger th:first-child,.zf-ledger td:first-child{text-align:left}
.zf-ledger th{color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font-weight:500}
.zf-ledger-sum td{font-weight:600;border-top:1px solid rgba(128,128,128,.3)}
.zf-mark{background:rgba(255,176,32,.28);color:inherit;border-radius:3px;padding:0 2px}
.zf-queued{margin-top:5px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));background:rgba(128,128,128,.12);border-radius:7px;padding:2px 7px;display:inline-block}
/* ---- 低把握警示：发送前把选项摆在手边 ---- */
.zf-fan.warn{border-color:rgba(230,150,30,.55);background:rgba(230,150,30,.08)}
.zf-warn{margin:0 12px 8px;padding:8px 10px;border-radius:9px;background:rgba(230,150,30,.10);border:1px solid rgba(230,150,30,.40);font-size:12px;line-height:1.65}
.zf-warn b{color:rgba(190,110,10,1);display:block;margin-bottom:2px}
.zf-warn>span{color:var(--dsw-alias-label-secondary,rgba(120,120,120,1))}
.zf-warn-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
/* ---- 没证据时的选择面板（不是模态框，就在输入框上方） ---- */
.zf-choice{margin:0 12px 8px;padding:9px 11px;border-radius:9px;background:rgba(120,120,220,.10);border:1px solid rgba(120,120,220,.40);font-size:12px;line-height:1.7}
.zf-choice b{color:rgba(90,90,190,1);display:block;margin-bottom:2px}
.zf-choice>span{color:var(--dsw-alias-label-secondary,rgba(120,120,120,1))}
.zf-item.zf-warnitem{border-left:3px solid rgba(230,150,30,.75)}
.zf-mini{font:inherit;font-size:11.5px;padding:2px 8px;border-radius:7px;cursor:pointer;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.35));
  background:var(--dsw-alias-bg-elevated,transparent);color:inherit}
.zf-mini:hover{border-color:var(--dsw-alias-border-primary,rgba(128,128,128,.7))}
/* ---- 汇报视图：不进原生界面就能看"上级"逐轮说了什么 ---- */
.zf-report{flex:0 0 auto;max-height:44%;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.25));padding:10px 12px;background:var(--dsw-alias-bg-elevated,rgba(128,128,128,.03))}
.zf-report-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}
.zf-report-h b{font-size:13.5px}
.zf-report-h>span{color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font-size:11.5px}
.zf-report-subs{margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.zf-turns{margin-top:8px;display:flex;flex-direction:column;gap:8px}
.zf-turn{border-left:2px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));padding-left:8px}
.zf-turn i{font-style:normal;font-size:10.5px;letter-spacing:.4px;margin-right:6px;padding:1px 5px;border-radius:5px;background:rgba(128,128,128,.14);color:var(--dsw-alias-label-tertiary,rgba(128,128,128,1))}
.zf-turn-q{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,rgba(110,110,110,1))}
.zf-turn-a{font-size:12.5px;line-height:1.65;margin-top:3px;white-space:pre-wrap}
.zf-icon{width:16px;height:16px;display:block}
@media (prefers-reduced-motion: reduce){.zf-root *{transition:none!important;animation:none!important}}
`;

		function ensureCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_ID) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-client-ui-zero-friction";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* ================================================================
		   插件级服务句柄：apply 时捕获，组件里防御式读取。
		   任何一个服务缺失都不应该让界面炸掉，只应该少一块能力。
		   ================================================================ */
		let app = null;

		function sessionsService() {
			try { return app && app.sessions ? app.sessions : null; } catch (error) { return null; }
		}
		function sessionList() {
			const sessions = sessionsService();
			try { return sessions && sessions.list ? sessions.list : null; } catch (error) { return null; }
		}

		/* ================================================================
		   偏好与摩擦计数（真实计数，按天存 localStorage）
		   ================================================================ */
		function todayKey() {
			const d = new Date();
			return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
		}
		/* 计数器按天存成账本，而不是只有一个今日数字。字段含义见「摩擦账本」页。 */
		const COUNTERS = ["autoRouted", "newSession", "learned", "corrections", "lowConfidence", "asked", "semantic", "manualSwitch"];
		function blankCounters() {
			const out = {};
			for (const key of COUNTERS) out[key] = 0;
			return out;
		}
		function blankPrefs() {
			return { days: {}, rules: [], autoNewSession: true, semanticRouter: true, routerSessionId: null };
		}
		function readPrefs() {
			try {
				const raw = window.localStorage.getItem(STORE_KEY);
				const base = blankPrefs();
				if (!raw) return base;
				const parsed = JSON.parse(raw);
				const out = {
					days: {},
					rules: Array.isArray(parsed.rules) ? parsed.rules : [],
					autoNewSession: parsed.autoNewSession !== false,
					semanticRouter: parsed.semanticRouter !== false,
					routerSessionId: typeof parsed.routerSessionId === "string" ? parsed.routerSessionId : null
				};
				if (parsed.days && typeof parsed.days === "object") {
					for (const day of Object.keys(parsed.days)) out.days[day] = Object.assign(blankCounters(), parsed.days[day]);
				} else if (parsed.friction) {
					/* 迁移早期版本的单日结构 */
					out.days[parsed.day || todayKey()] = Object.assign(blankCounters(), parsed.friction);
				}
				return out;
			} catch (error) {
				return blankPrefs();
			}
		}
		function writePrefs(prefs) {
			try { window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (error) { /* 存储不可用时静默降级 */ }
		}
		function countersOf(prefs, day) {
			return (prefs.days && prefs.days[day || todayKey()]) || blankCounters();
		}
		/** 最近 n 天账本，新的在前。 */
		function ledgerDays(prefs, n) {
			return Object.keys(prefs.days || {}).sort().reverse().slice(0, n || 7)
				.map((day) => Object.assign({ day }, countersOf(prefs, day)));
		}

		/* ================================================================
		   路由：规则 → 标题匹配 → 当前会话 → 最近会话
		   目标全部来自真实会话列表；判断不了一律如实标注，不假装懂。
		   ================================================================ */
		function stripTitle(value) {
			return String(value == null ? "" : value).toLowerCase().replace(/[\s\-_/\\.:,，。！？!?（）()\[\]【】]+/g, "");
		}
		function grams(value) {
			const text = stripTitle(value);
			const set = new Set();
			for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= text.length; i++) set.add(text.slice(i, i + n));
			return set;
		}
		function scoreAgainstTitle(text, row) {
			let score = 0;
			for (const gram of grams(row.displayTitle || row.id)) if (text.includes(gram)) score += gram.length;
			return score;
		}

		/* ================================================================
		   内容匹配：只看标题会漏掉"这个会话其实在聊什么"。
		   标题是主机用 LLM 生成的摘要，但它可能和后面的内容跑偏 ——
		   一个标题叫「线上 502 排查」的会话，后半程可能全程在聊 keepalive 超时。
		   所以标题给不出证据时，再去会话内容里找。
		   成本控制：只扫最近动过的 20 个会话、每个只取最近 6 轮、response 截 240 字，
		   并把词袋缓存在 WeakMap 里（row 对象是稳定的，所以缓存一辈子有效）。
		   ================================================================ */
		/* 内容匹配用的最小片段长度。只影响"给你先看哪个"的排序，不影响路由决定，
		   所以这里可以取 3（比 2 更能说明问题，又不至于像 4 那样几乎匹配不到）。 */
		const CONTENT_GRAM_MIN = 3;
		const contentGramCache = new WeakMap();
		function contentGramsOf(row) {
			const cached = contentGramCache.get(row);
			if (cached !== undefined) return cached;
			const outline = describe(row).outline;
			const set = new Set();
			for (const turn of outline.slice(-6)) {
				const text = stripTitle(String(turn.prompt || "") + " " + String(turn.response || "").slice(0, 240));
				for (let n = CONTENT_GRAM_MIN; n <= 4; n++) {
					for (let i = 0; i + n <= text.length; i++) set.add(text.slice(i, i + n));
				}
			}
			contentGramCache.set(row, set);
			return set;
		}
		/** 用**消息**的词元去会话内容词袋里找。片段越长 = 越像同一件事。 */
		function scoreAgainstContent(text, row) {
			const bag = contentGramsOf(row);
			if (!bag.size) return 0;
			const msg = stripTitle(text).slice(0, 80);
			let score = 0;
			for (let n = 4; n >= CONTENT_GRAM_MIN; n--) {
				for (let i = 0; i + n <= msg.length; i++) {
					if (bag.has(msg.slice(i, i + n))) score += n;
				}
			}
			return score;
		}
		/**
		 * 按"内容接近程度"排序候选 —— **只用来给询问面板排顺序，不用来做决定**。
		 *
		 * 为什么不做决定：真机实测了两轮，结论是字面匹配在长中文文本上不可靠。
		 *   · 最小片段设成 2："量子计算机的散热方案该怎么设计"被一个无关会话吸走
		 *     （"怎么""设计""方案"在任何长会话里都有）
		 *   · 最小片段提到 3：该匹配的短关键词反而匹配不上了（"归档"只有 2 字）
		 * 一个 62% 的假阳性比一句"没把握"更糟 —— 因为它会**跳过询问**。
		 * 所以内容相似度只用来回答"如果是这几个，哪个最像"，由人来拍板。
		 */
		function sortByContent(text, candidates) {
			const pool = candidates.slice()
				.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
				.slice(0, 20);
			return pool
				.map((row) => ({ row, score: scoreAgainstContent(text, row) }))
				.sort((a, b) => (b.score - a.score) || ((b.row.updatedAt || 0) - (a.row.updatedAt || 0)))
				.map((item) => item.row);
		}
		/**
		 * 自动投递的候选只包含主会话。
		 * 子智能体是别的会话内部的执行体（`parentId` / `origin === "subagent"`），
		 * 把用户的新消息自动投进去是错的 —— 它的标题看起来可能很像，所以必须显式排除。
		 * 路由助手会话同样排除：它是插件的工具，不是你的对话，真机验证时它确实
		 * 出现在候选列表里（"发给「你是「零摩擦」插件的语义路」"），那是错的。
		 */
		let excludedSessionId = null;
		function routableRows(rows) {
			return rows.filter((row) => !row.parentId && row.origin !== "subagent" && row.id !== excludedSessionId);
		}

		/**
		 * 给主会话按匹配度排序。
		 * 路由用它挑第一名；「把握不大」时的改投备选也用它 —— 两处必须是同一套打分，
		 * 否则会出现"预览说 A 最像，备选列表里却没有 A"这种自相矛盾。
		 */
		function rankRows(text, rows, prefs) {
			const lower = stripTitle(text);
			const candidates = routableRows(rows);
			const activeRules = (prefs.rules || []).filter((rule) => rule.on && rule.match);
			const hit = activeRules
				.filter((rule) => lower.includes(stripTitle(rule.match)))
				.sort((a, b) => b.match.length - a.match.length)[0];
			const ranked = [];
			for (const row of candidates) {
				const score = scoreAgainstTitle(lower, row);
				if (score >= 2) ranked.push({ row, score, confidence: Math.min(0.9, 0.4 + score * 0.08) });
			}
			ranked.sort((a, b) => (b.score - a.score) || ((b.row.updatedAt || 0) - (a.row.updatedAt || 0)));
			return { lower, candidates, hit, ranked };
		}

		function routeMessage(text, rows, prefs) {
			const lower = stripTitle(text);
			const candidates = routableRows(rows);
			if (candidates.length === 0) return null;

			const { hit, ranked } = rankRows(text, rows, prefs);
			if (hit) {
				const row = candidates.find((candidate) => candidate.id === hit.sessionId);
				if (row) return { row, layer: "学到的偏好", reason: "含「" + hit.match + "」", confidence: 0.95, rule: hit };
			}

			const best = ranked.length ? ranked[0].row : null;
			const bestScore = ranked.length ? ranked[0].score : 0;
			if (best && bestScore >= 2) {
				return { row: best, layer: "标题匹配", reason: "和「" + (best.displayTitle || best.id) + "」最接近", confidence: Math.min(0.9, 0.4 + bestScore * 0.08) };
			}

			/* 标题没给出证据 → 就到这里为止，**不再猜**。
			   内容相似度只在询问面板里用来排序（见 sortByContent 的注释）。 */
			const active = candidates.find((row) => ((row.retainedBy && row.retainedBy.mainView) || 0) > 0);
			/* ---------- "像不像在追问" 必须有**明确的指代**，光"短"不算 ----------
			   真机教训（使用者报的）：输入「1+1=2」被路由到当前会话。
			   原因是旧判据只看"短 + 没有领域词"—— 而一个全新的短问题（算个加法）
			   同样满足这两条。所以改成必须出现真正的续说标记。 */
			const FOLLOWUP_HEAD = /^(再|又|继续|接着|然后|那|这个|那个|它|它们|上面|刚才|前面|还是|改成|换成|别忘了|麻烦把)/;
			const looksLikeFollowUp = text.length <= 12 && topicWeight(lower) < 2 && FOLLOWUP_HEAD.test(lower);
			if (active && looksLikeFollowUp) {
				return {
					row: active, layer: "像是接着说的", confidence: 0.45, ask: true,
					reason: "有「" + (lower.match(FOLLOWUP_HEAD) || [""])[0] + "」这种续说标记，可能是在接着「" + (active.displayTitle || active.id) + "」说"
				};
			}
			return {
				row: null, newTopic: true, layer: "没有把握", confidence: 0.2, ask: true,
				reason: "没有任何会话和这句话有共同点"
			};
		}

		/** 这句话命中过多少领域词（只看有没有，不看命中哪个会话）。 */
		const TOPIC_WORDS = [
			"架构", "设计", "重构", "方案", "技术", "模块", "依赖", "数据库", "接口", "规范",
			"页面", "样式", "组件", "交互", "动画", "布局", "按钮", "前端", "配色", "排版",
			"数据", "报表", "指标", "销量", "归因", "图表", "同比", "环比", "统计", "转化率",
			"线上", "故障", "部署", "日志", "告警", "服务器", "宕机", "运维", "扩容", "超时", "重启",
			"文案", "标题", "措辞", "润色", "宣传", "公告", "对外",
			"权限", "登录", "测试", "文档", "报告", "爬虫", "脚本", "模型", "训练", "数据集"
		];
		function topicWeight(text) {
			let weight = 0;
			for (const word of TOPIC_WORDS) if (text.includes(word)) weight += 2;
			return weight;
		}

		/** 在当前工作区附近新建一个会话。cwd 取最近用过的那一个，保证落在同一工作区。
		   真机上 `sessions.create(opts)` 直接返回新会话 id 字符串，失败时抛错
		   （见 api-session-controller 的 ClientSessions.create：`return result.value.sessionId`）。 */
		async function createSessionNear(rows) {
			const sessions = sessionsService();
			if (!sessions || typeof sessions.create !== "function") throw new Error("这个版本的 DSH 不支持新建会话");
			const ordered = rows.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
			const cwd = (ordered.find((row) => row.cwd) || {}).cwd;
			const created = await sessions.create(cwd ? { cwd } : {});
			const id = typeof created === "string" ? created
				: created && (created.sessionId || (created.value && created.value.sessionId));
			if (!id) throw new Error("新建会话没有返回 id");
			return { id, title: "新会话" };
		}

		/* ================================================================
		   发送：走真实 Session 控制器的 prompt 通道
		   ================================================================ */
		async function sendToSession(sessionId, text) {
			const sessions = sessionsService();
			if (!sessions || typeof sessions.using !== "function") throw new Error("会话服务不可用");
			return await sessions.using(sessionId, { source: "zeroFriction" }, async (reference) => {
				const session = (reference && reference.binding && reference.binding.session) || (reference && reference.session);
				if (!session || typeof session.prompt !== "function") throw new Error("没有拿到会话句柄");
				const result = await session.prompt([{ type: "text", text }], "queue");
				if (!result || result.ok !== true) {
					const detail = result && result.error ? (result.error.code || "") + " " + (result.error.message || "") : "未知错误";
					throw new Error(String(detail).trim());
				}
				return true;
			});
		}
		/* 组件挂载时把自己的日志函数登记进来 —— 这样「打开会话」失败时能被看见，
		   而不是按钮点了没反应。（静默失效比报错更糟：检索那里已经吃过一次教训。） */
		let reportFailure = null;

		function openSession(sessionId) {
			try {
				/* uiWorkspace 刻意不声明进 inject，走反射读取。真机实测：
				   `ctx.get('uiWorkspace')` 有值、`openSession` 是函数；
				   而未声明的 `ctx.uiWorkspace` 会**直接抛错**
				     （cannot get property "uiWorkspace" without inject）。 */
				const workspace = app && typeof app.get === "function" ? app.get("uiWorkspace") : null;
				if (workspace && typeof workspace.openSession === "function") {
					workspace.openSession(sessionId);
					return true;
				}
				if (reportFailure) reportFailure("这个实例没有暴露 uiWorkspace.openSession");
			} catch (error) {
				if (reportFailure) reportFailure(error && error.message ? error.message : String(error));
			}
			return false;
		}

		/* ================================================================
		   真实会话数据的反应式读取
		   ================================================================ */
		function useSessionRows() {
			const store = sessionList();
			const subscribe = useCallback((listener) => {
				if (!store || typeof store.subscribe !== "function") return () => {};
				try { return store.subscribe(listener); } catch (error) { return () => {}; }
			}, [store]);
			const getSnapshot = useCallback(() => {
				if (!store || typeof store.getSnapshot !== "function") return EMPTY_SNAPSHOT;
				try { return store.getSnapshot() || EMPTY_SNAPSHOT; } catch (error) { return EMPTY_SNAPSHOT; }
			}, [store]);
			const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
			return useMemo(() => {
				const byId = (snapshot && snapshot.byId) || {};
				return Object.keys(byId).map((key) => byId[key]).filter(Boolean);
			}, [snapshot]);
		}

		function usePrefs() {
			const [prefs, setPrefs] = useState(readPrefs);
			const update = useCallback((mutate) => {
				setPrefs((current) => {
					const next = mutate(current);
					writePrefs(next);
					return next;
				});
			}, []);
			return [prefs, update];
		}

		/* ================================================================
		   队列分组与摘要：全部读主机已经算好的 projectionValues
		   这些投影由 Host 维护，不需要读事件窗口、不需要调模型、不需要额外 RPC。
		   ================================================================ */
		const DAY = 86400000;

		/** 取某个会话的投影值，拿不到就返回空对象。 */
		function projectionOf(row) {
			return (row && row.projectionValues) || {};
		}

		/**
		 * 从真实投影里抽出这张卡片需要的一切。
		 * - turnOutline 是主机维护的逐轮大纲：每一轮带 prompt 与 response（已截断）
		 *   —— 这就是现成的自动摘要
		 * - userQuestions.active / inbox / plan.pending 是真正的「在等你」信号
		 *
		 * 带缓存：list 快照里的 row 对象是稳定的，而排序比较器会对同一行反复调用
		 * （n log n 次 × 2），不缓存的话每次都要重扫整份 turnOutline。
		 */
		const describeCache = new WeakMap();
		function describe(row) {
			if (!row || typeof row !== "object") return { needs: [], ask: "", conclusion: "", prevConclusion: "", turns: 0, outline: [], pressure: 0, goal: null, lastPromptAt: 0 };
			const cached = describeCache.get(row);
			if (cached !== undefined) return cached;
			const computed = computeDescribe(row);
			describeCache.set(row, computed);
			return computed;
		}
		function computeDescribe(row) {
			const p = projectionOf(row);
			const outline = Array.isArray(p.turnOutline) ? p.turnOutline : [];
			const last = outline.length ? outline[outline.length - 1] : null;
			const prev = outline.length > 1 ? outline[outline.length - 2] : null;
			const stats = p.sessionStats || {};
			const pressure = p.contextPressure || {};
			const goal = p.goal && p.goal.goal ? p.goal.goal : null;

			const activeQuestions = p.userQuestions && Array.isArray(p.userQuestions.active) ? p.userQuestions.active : [];
			const inbox = p.inbox || {};
			const inboxCount = (Array.isArray(inbox["next-turn"]) ? inbox["next-turn"].length : 0)
				+ (Array.isArray(inbox["next-step"]) ? inbox["next-step"].length : 0);
			const planPending = !!(p.plan && p.plan.pending);

			/* 「需要你」只包含**只有人类能推进**的情形。
			   真机实测（第 14 轮）：inbox 里装的是"排队等 agent 处理的消息" ——
			   我投第二条时它就有了，内容是**我自己刚发的那句话**。
			   所以 inbox 非空意味着"agent 还有活要干"，不是"你在等"。
			   把它算进「需要你」会把一个正在推进的会话错误地抬到队列最上面，
			   还标上"需要你"，而它什么都不需要你做 —— 那是注意力队列最不能有的噪音。 */
			const needs = [];
			if (activeQuestions.length) needs.push(activeQuestions.length + " 个问题等你回答");
			if (planPending) needs.push("有一个计划等你批");

			const ratio = pressure.contextWindow ? Math.min(1, (pressure.pressureTokens || 0) / pressure.contextWindow) : 0;

			return {
				needs,
				queued: inboxCount,
				ask: last && last.prompt ? String(last.prompt) : "",
				conclusion: last && last.response ? String(last.response) : "",
				prevConclusion: prev && prev.response ? String(prev.response) : "",
				turns: stats.turns || outline.length || 0,
				steps: stats.steps || 0,
				outline,
				pressure: ratio,
				goal: goal ? { objective: String(goal.objective || ""), phase: String(goal.phase || ""), rounds: p.goal.roundsStarted || 0 } : null,
				lastPromptAt: (p.sessionListMetadata && p.sessionListMetadata.lastPromptAt) || row.updatedAt || 0
			};
		}

		/** 展示用标题：子智能体加个 ↳ 前缀，免得它看起来像一个普通会话。 */
		function titleOf(row) {
			const name = row.displayTitle || row.id;
			return (row.parentId || row.origin === "subagent") ? "↳ " + name : name;
		}

		/** 一行摘要：把 markdown 噪声压掉，只留可读的第一句。 */
		function condense(text, limit) {
			const flat = String(text || "")
				.replace(/```[\s\S]*?```/g, " ")
				.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
				.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/[#*`>|-]+/g, " ")
				.replace(/\s+/g, " ")
				.trim();
			return flat.length > (limit || 96) ? flat.slice(0, limit || 96) + "…" : flat;
		}

		/** 命中片段：截取关键词周围，并把关键词本身高亮出来。 */
		function snippetNodes(text, at, len) {
			const source = String(text || "");
			const from = Math.max(0, at - 40);
			const to = Math.min(source.length, at + len + 70);
			return [
				(from > 0 ? "…" : "") + source.slice(from, at),
				h("b", { className: "zf-mark", key: "hit" }, source.slice(at, at + len)),
				source.slice(at + len, to) + (to < source.length ? "…" : "")
			];
		}

		function groupRows(rows) {
			const mains = rows.filter((row) => !row.parentId && row.origin !== "subagent");
			const subs = rows.filter((row) => row.parentId || row.origin === "subagent");
			const waiting = [];
			const running = [];
			const rest = [];
			for (const row of mains) {
				const info = describe(row);
				if (info.needs.length) waiting.push(row);
				/* 有排队工作 = 系统还在推进，也算"在跑" */
				else if (row.running || info.queued > 0) running.push(row);
				else rest.push(row);
			}
			const byRecency = (a, b) => describe(b).lastPromptAt - describe(a).lastPromptAt;
			waiting.sort(byRecency); running.sort(byRecency); rest.sort(byRecency);
			return { waiting, running, rest, subs };
		}

		function when(ts) {
			if (!ts) return "";
			const delta = Date.now() - ts;
			if (delta < 60000) return "刚刚";
			if (delta < 3600000) return Math.floor(delta / 60000) + " 分钟前";
			if (delta < DAY) return Math.floor(delta / 3600000) + " 小时前";
			return Math.floor(delta / DAY) + " 天前";
		}

		/* ================================================================
		   图标
		   ================================================================ */
		function PanelIcon() {
			return h("svg", { className: "zf-icon", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("path", { d: "M2 8h4l1.5-3 2 6L11 8h3", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }));
		}

		/* ================================================================
		   主面板
		   ================================================================ */
		function ZeroFrictionPage() {
			ensureCss();
			const rows = useSessionRows();
			const [prefs, updatePrefs] = usePrefs();
			const [draft, setDraft] = useState("");
			const [log, setLog] = useState([]);
			const [busy, setBusy] = useState(false);
			const [sideTab, setSideTab] = useState("sum");
			const [query, setQuery] = useState("");
			const [searching, setSearching] = useState(false);
			const [selected, setSelected] = useState(null);
			const [reroute, setReroute] = useState(null);
			const [showAllSummaries, setShowAllSummaries] = useState(false);
			/* 同步闸门：见 submit() 里的说明 */
			const busyRef = useRef(false);
			/* 没证据时不再替你猜，而是把这个选择面板弹出来（渲染在输入框上方，不是模态框）。 */
			const [choice, setChoice] = useState(false);
			/* 语义路由的状态：{ q, status, rowId, raw }。status: idle/asking/done/failed */
			const [semantic, setSemantic] = useState(null);
			const semanticCache = useRef(new Map());
			const semanticPending = useRef(null);
			/* 你在选择面板里点定的目标，只对这一条生效，发完就清掉。 */
			const forceRef = useRef(null);
			const areaRef = useRef(null);

			const text = draft.trim();
			const groups = useMemo(() => groupRows(rows), [rows]);
			const found = useMemo(() => localSearch(rows, query), [rows, query]);
			/* 选中某个会话 = **指定投给它**，并且就地看它的汇报。
			   这是"我是 boss，只跟上级说话"那个意图的实现：不进原生界面、不跳页面，
			   选中的那个会话就是"上级"，它下面的子智能体是"下属"。 */
			const pinnedRow = useMemo(
				() => (selected ? rows.find((row) => row.id === selected) || null : null),
				[selected, rows]);
			const preview = useMemo(() => {
				if (text.length < 2 || rows.length === 0) return null;
				if (pinnedRow) {
					return {
						row: pinnedRow, pinned: true, confidence: 1, alternatives: [],
						layer: "你指定的",
						reason: "你选中了「" + (pinnedRow.displayTitle || pinnedRow.id) + "」"
					};
				}
				const routed = routeMessage(text, rows, prefs);
				if (!routed) return null;
				/* 备选来自和路由**同一套打分**，所以不会出现"预览说 A 最像、备选里却没有 A"。 */
				let alternatives = rankRows(text, rows, prefs).ranked
					.filter((item) => !routed.row || item.row.id !== routed.row.id)
					.slice(0, 3)
					.map((item) => item.row);
				/* 标题一个都没匹配上（典型是"没把握"那种）时，用**内容相似度**给候选排序 ——
				   这一步只影响"先给你看哪个"，不会替你做决定。 */
				if (alternatives.length === 0) {
					alternatives = sortByContent(text, routableRows(rows)).slice(0, 3);
				}
				/* 语义路由已经给出答案 → 用它，并且**不再算"没把握"**（所以不会再弹询问面板）。
				   这是"读懂意思"那条路：模型说 NEW 就是新会话，说编号就是那个会话。 */
				if (semantic && semantic.q === text && semantic.status === "done" && semantic.rowId) {
					const picked = semantic.rowId === "__NEW__" ? null : rows.find((row) => row.id === semantic.rowId);
					if (semantic.rowId === "__NEW__" || picked) {
						return {
							row: picked, newTopic: !picked, alternatives, semantic: true,
							layer: "语义路由",
							reason: picked ? "模型判断这句话属于「" + titleOf(picked) + "」" : "模型判断这是一件新事情",
							confidence: picked ? 0.8 : 0.6
						};
					}
				}
				return Object.assign({}, routed, { alternatives, semanticAsking: !!(semantic && semantic.q === text && semantic.status === "asking") });
			}, [text, rows, prefs, pinnedRow, semantic]);
			/* 把握度不够：发送**之前**就要给出警示与改投入口。 */
			const lowConfidence = !!(preview && !preview.pinned && preview.confidence < CONFIDENCE_WARN);

			/* ---------- 没证据时的选择面板 ----------
			   使用者要求：匹配不上就问是否开新会话，而不是"简单选上一次用过的会话"。
			   这不是模态框 —— 选项就在输入框上方。默认项按偏好排序：
			   「没把握时默认开新会话」开着（默认）就是第一项，关掉就把最可能的会话放前面。
			   再按一次回车 = 接受默认项。 */
			const preferNew = prefs.autoNewSession !== false;
			const choiceNode = choice && preview ? h("div", { className: "zf-choice" },
				h("b", null, "⚠ 没有会话和这句话对得上（最高 " + Math.round(preview.confidence * 100) + "%）"),
				h("span", null, "要开个新会话，还是发给已有的某个？点一下就发；再按一次回车 = 用第一项。"),
				h("div", { className: "zf-warn-row" },
					h("button", {
						className: "zf-tab" + (preferNew ? " on" : ""),
						onClick: () => { forceRef.current = { newTopic: true }; setChoice(false); return submit({ skipAsk: true }); }
					}, "开个新会话发出去"),
					preview.row ? h("button", {
						className: "zf-tab" + (preferNew ? "" : " on"),
						onClick: () => { forceRef.current = { sessionId: preview.row.id }; setChoice(false); return submit({ skipAsk: true }); }
					}, "就发给「" + titleOf(preview.row) + "」") : null,
					(preview.alternatives || []).map((row) => h("button", {
						key: row.id, className: "zf-tab",
						onClick: () => { forceRef.current = { sessionId: row.id }; setChoice(false); return submit({ skipAsk: true }); }
					}, "发给「" + titleOf(row) + "」")),
					h("button", { className: "zf-mini", onClick: () => setChoice(false) }, "取消，我改改这句")))
				: null;

			/* 语义路由取"最新值"要用 ref：防抖 effect 绝不能依赖 rows ——
			   store 每发布一次就会重排一次定时器，于是**每来一次通知就多问一次模型**。
			   这个 bug 是测试台抓到的（真机上就是烧 token）。 */
			const latest = useRef({ rows, prefs, pinnedRow });
			latest.current = { rows, prefs, pinnedRow };
			/* 路由助手会话从"可投递目标"里剔除 —— 渲染期赋值是幂等的，
			   而 routableRows 在 render 里（preview 的 useMemo）就会被调用，所以必须在那之前。 */
			excludedSessionId = prefs.routerSessionId || null;
			const routerSessionRef = useRef(null);
			const semanticAsked = useRef(new Set());
			/* ---------- 语义路由 ----------
			   只在"词面完全没证据"时去问模型；有证据时一个字都不多花。
			   防抖 800ms：不然打字过程中每个字符都会触发一次分类。
			   带缓存 + 已问过集合：同一句话最多问一次。
			   带超时：模型没在时限内给出可解析的答案，就退回询问面板（绝不静默投错）。 */
			useEffect(() => {
				const snapshot = latest.current;
				if (snapshot.prefs.semanticRouter === false) return undefined;
				const q = text.trim();
				if (q.length < 4 || snapshot.pinnedRow) return undefined;
				const routed = snapshot.rows.length === 0 ? null : routeMessage(q, snapshot.rows, snapshot.prefs);
				/* 有证据就别打扰模型 */
				if (routed && !routed.ask) return undefined;
				const cached = semanticCache.current.get(q);
				if (cached) {
					setSemantic({ q, status: "done", rowId: cached.rowId, raw: cached.raw });
					return undefined;
				}
				if (semanticAsked.current.has(q)) return undefined;
				let cancelled = false;
				const timer = setTimeout(() => {
					if (cancelled) return;
					semanticAsked.current.add(q);
					askRouter(q);
				}, 800);
				return () => { cancelled = true; clearTimeout(timer); };
			}, [text, prefs.semanticRouter]);

			/* 等助手的回答：会话投影一变就来看一眼，比轮询快也省。 */
			useEffect(() => {
				const pending = semanticPending.current;
				if (!pending) return;
				const row = rows.find((item) => item.id === pending.sessionId);
				if (!row) return;
				const info = describe(row);
				const last = info.outline[info.outline.length - 1];
				if (!last || String(last.prompt || "").trim() !== pending.prompt.trim()) return;
				const answer = String(last.response || "");
				const picked = parseRouterAnswer(answer, pending.candidates);
				semanticPending.current = null;
				const entry = { rowId: picked, raw: answer.slice(0, 120) };
				semanticCache.current.set(pending.q, entry);
				/* 解析不出编号也**如实说**，不要静默当作"没结果" ——
				   真机上模型的回答可能是一段解释、也可能是空的，那和"没回答"一样糟。 */
				setSemantic({
					q: pending.q,
					status: picked ? "done" : "failed",
					rowId: picked,
					raw: entry.raw
				});
				if (picked) bump("semantic", 1);
			}, [rows]);


			const pushLog = useCallback((entry) => {
				setLog((current) => current.concat([Object.assign({ at: Date.now(), key: String(Math.random()) }, entry)]));
			}, []);

			/* 把日志上报口登记给 openSession，好让「打不开」这件事被看到而不是无声无息。
			   必须放在 pushLog 声明之后 —— 否则依赖数组求值时它会落在 TDZ 里。 */
			useEffect(() => {
				reportFailure = (message) => pushLog({ kind: "info", title: "打不开这个会话：" + message });
				return () => { reportFailure = null; };
			}, [pushLog]);

			function bump(field, delta) {
				updatePrefs((current) => {
					const key = todayKey();
					const days = Object.assign({}, current.days);
					const day = Object.assign(blankCounters(), days[key]);
					day[field] = (day[field] || 0) + (delta == null ? 1 : delta);
					days[key] = day;
					return Object.assign({}, current, { days });
				});
			}

			function choose(sessionId) {
				if (selected !== sessionId) bump("manualSwitch", 1);
				setSelected((current) => (current === sessionId ? null : sessionId));
			}

			/** 解析助手的回答：只认一个编号或 NEW，别的都当没答出来。 */
			function parseRouterAnswer(answer, candidates) {
				const raw = String(answer || "");
				if (/\bNEW\b/i.test(raw)) return "__NEW__";
				for (const token of (raw.match(/\d{1,2}/g) || [])) {
					const index = parseInt(token, 10);
					if (index >= 1 && index <= candidates.length) return candidates[index - 1].id;
				}
				return null;
			}

			/** 拿到路由助手会话；没有就建一个（用它当分类器，不碰你的任何会话）。 */
			async function ensureRouterSession() {
				const snapshot = latest.current;
				const known = routerSessionRef.current || snapshot.prefs.routerSessionId;
				if (known && snapshot.rows.some((row) => row.id === known)) return known;
				const created = await createSessionNear(snapshot.rows);
				if (!created) return null;
				/* ref 立刻记住：不然并发调用会一个接一个地建新会话（测试台抓到过 12 个） */
				routerSessionRef.current = created.id;
				updatePrefs((current) => Object.assign({}, current, { routerSessionId: created.id }));
				await sendToSession(created.id, ROUTER_KICKOFF);
				return created.id;
			}

			/** 把候选会话与目标句交给助手，让它回一个编号或 NEW。 */
			async function askRouter(q) {
				if (semanticPending.current) return;
				/* 先**同步占位**再 await：ensureRouterSession 里有异步创建，
				   不占位的话并发调用会各建一个助手会话（测试台抓到过 12 个）。 */
				semanticPending.current = { q, prompt: null, candidates: [], sessionId: null, at: Date.now() };
				const snapshot = latest.current;
				try {
					const candidates = sortByContent(q, routableRows(snapshot.rows)).slice(0, 8);
					if (candidates.length === 0) { semanticPending.current = null; return; }
					const sessionId = await ensureRouterSession();
					if (!sessionId) { semanticPending.current = null; return; }
					const list = candidates.map((row, index) => {
						const info = describe(row);
						const gist = condense(String(info.conclusion || info.ask || ""), 60);
						return (index + 1) + ". " + titleOf(row) + (gist ? "｜" + gist : "");
					}).join("\n");
					const prompt = "候选会话：\n" + list + "\n\n用户这句话：「" + q + "」\n应该发给几号？都不像就回 NEW。只回一个编号或 NEW。";
					semanticPending.current = { q, prompt, candidates, sessionId, at: Date.now() };
					setSemantic({ q, status: "asking", rowId: null, raw: "" });
					await sendToSession(sessionId, prompt);
					/* 超时兜底：到点还没解析出结果就如实放弃，退回询问面板 —— 绝不静默投错 */
					setTimeout(() => {
						const pending = semanticPending.current;
						if (pending && pending.q === q) {
							semanticPending.current = null;
							setSemantic((current) => (current && current.q === q && current.status === "asking"
								? { q, status: "failed", rowId: null, raw: "" }
								: current));
						}
					}, ROUTER_TIMEOUT_MS);
				} catch (error) {
					semanticPending.current = null;
					setSemantic({ q, status: "failed", rowId: null, raw: String((error && error.message) || error) });
				}
			}

			async function submit(options) {
				const skipAsk = !!(options && options.skipAsk);
				/* 闸门用 ref 而不是 state：state 是异步的，两次快速回车会在同一次渲染
				   周期里都读到 busy === false，于是同一条消息被投递两次。零确认的界面
				   里没有对话框兜底，所以这个闸门必须同步生效。 */
				if (text === "" || busyRef.current) return;

				/* ---------- 没证据时不猜，先问 ----------
				   使用者明确要求的：匹配不上就不要"简单选上一次用过的会话"，
				   而要问是否开新会话。这不是模态框 —— 选择就渲染在输入框上方，
				   点一下就发，或者按回车选默认（开新会话）。
				   已经有证据（ask 不为真）、或者你已经钉住了目标、或者你已经在面板里点过，
				   都不会走到这里。 */
				if (!skipAsk && !pinnedRow && !forceRef.current && preview && preview.ask && !choice) {
					setChoice(true);
					bump("asked", 1);
					return;
				}

				busyRef.current = true;
				/* 整个函数体都在 try 里：闸门只有在"一定会被释放"时才安全。
				   否则任何一处意外抛错（比如路由本身出错）都会让面板永久发不出消息。 */
				try {
					/* 选中了某个会话就是"对上级说话"，直接投给它，不再自动判断。
					   选中的会话如果被删了，pinnedRow 是 null，自动退回路由。 */
					const forced = forceRef.current;
					forceRef.current = null;
					const decision = pinnedRow
						? {
							row: pinnedRow, confidence: 1,
							layer: "你指定的",
							reason: "你选中了「" + (pinnedRow.displayTitle || pinnedRow.id) + "」"
						}
						: forced
							? (forced.newTopic
								? { row: null, newTopic: true, confidence: 1, layer: "你选的", reason: "没有像的，你选择开新会话" }
								: (() => {
									const row = rows.find((candidate) => candidate.id === forced.sessionId);
									return row ? { row, confidence: 1, layer: "你选的", reason: "你在没把握时选了「" + (row.displayTitle || row.id) + "」" } : null;
								})())
							: (rows.length === 0 ? null : routeMessage(text, rows, prefs));
					if (!decision) {
						pushLog({ kind: "err", text: "没有可投递的主会话（子智能体不算），先在正常界面里开一个对话。" });
						return;
					}
					/* 记账：这条如果把握度很低，旧设计会打断你问一次。记下来，好让「0 次打断」可证伪。 */
					if (decision.confidence < 0.42) bump("lowConfidence", 1);

					setBusy(true);
					setDraft("");
					try {
						let sessionId = decision.row ? decision.row.id : null;
						let label = decision.row ? (decision.row.displayTitle || decision.row.id) : "";
						let extra = decision.layer;

						/* 新话题：没有会话接得住，就不硬塞进旧会话，开一个新的。
						   你在选择面板里明确点了「开个新会话」，那就必须开 —— 不能被偏好设成 false 而改写。 */
						if (!decision.row && decision.newTopic) {
							const mustCreate = !!(forced && forced.newTopic);
							if (prefs.autoNewSession || mustCreate) {
								const created = await createSessionNear(rows);
								if (!created) throw new Error("没能新建会话");
								sessionId = created.id;
								label = created.title;
								extra = "新话题 · 自动开了新会话";
								bump("newSession", 1);
							} else {
								const fallback = routableRows(rows).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
								if (fallback) {
									sessionId = fallback.id;
									label = fallback.displayTitle || fallback.id;
									extra = "新话题 · 自动开新会话已关，接到最近会话";
								}
							}
						}
						if (!sessionId) throw new Error("没有可投递的会话");

						await sendToSession(sessionId, text);
						bump("autoRouted", 1);
						pushLog({
							kind: "ok",
							title: "已投递给「" + label + "」",
							layer: extra,
							reason: decision.reason,
							confidence: decision.confidence,
							text: text,
							sessionId
						});
					} catch (error) {
						pushLog({
							kind: "err",
							title: "投递失败：" + (error && error.message ? error.message : String(error)),
							layer: decision.layer,
							text: text,
							sessionId: decision.row ? decision.row.id : null
						});
						setDraft(text);
					} finally {
						setBusy(false);
					}
				} catch (error) {
					/* 路由本身出错（比如某一行数据不可读）也不能把异常抛到界面上，
					   但必须说出来 —— 以及闸门一定要释放。 */
					pushLog({
						kind: "err",
						title: "路由出错：" + (error && error.message ? error.message : String(error)),
						text
					});
				} finally {
					busyRef.current = false;
				}
			}

			/** 真正的改投：换目标 + 学一条规则 + 把这条消息重投过去。 */
			async function applyReroute(entry, row) {
				setReroute(null);
				bump("corrections", 1);
				const picked = pickKeyword(entry.text, row);
				/* 特征不够排他就只改这一次 —— 宁可少一条规则，也不要一条过拟合的规则。 */
				const keyword = picked && isDiscriminative(picked, rows, row.id) ? picked : null;
				if (!keyword) {
					pushLog({
						kind: "info",
						title: picked
							? "「" + picked + "」在别的会话里也有，不够独特"
							: "这句话和「" + (row.displayTitle || row.id) + "」没有共同特征",
						text: "所以只改了这一次，没有写进偏好。"
							+ "一条不准确的偏好会长期把东西投错地方，比这次不学更糟。"
							+ "下次把目标的名字说出来（比如「" + (row.displayTitle || row.id) + "」里的某个词），我就能记住。"
					});
				}
				if (keyword) {
					updatePrefs((current) => {
						const rules = current.rules.slice();
						const existing = rules.find((rule) => rule.match === keyword && rule.sessionId === row.id);
						if (existing) { existing.on = true; existing.hits = (existing.hits || 0) + 1; }
						else rules.unshift({ id: String(Date.now()), match: keyword, sessionId: row.id, title: row.displayTitle || row.id, on: true, hits: 1 });
						return Object.assign({}, current, { rules });
					});
					bump("learned", 1);
				}
				try {
					await sendToSession(row.id, entry.text);
					bump("autoRouted", 1);
					pushLog({
						kind: "ok",
						title: "已改投给「" + (row.displayTitle || row.id) + "」"
							+ (keyword ? "，并记住「" + keyword + "」" : "（没提取到稳定特征，只改了这一次）"),
						layer: "人工纠正",
						text: entry.text,
						sessionId: row.id
					});
				} catch (error) {
					pushLog({
						kind: "err",
						title: "改投失败：" + (error && error.message ? error.message : String(error)),
						text: entry.text,
						sessionId: row.id
					});
				}
			}

			/* 检索走本地：主机已经把每一轮的 prompt/response 算进 projectionValues.turnOutline，
			   所以不需要主机全文索引、不需要 RPC、零延迟。
			   （实测主机索引在 web/desktop profile 里是关的：
			     `sessions.search()` 返回 {ok:false, error:{code:"gateway/internal"}}，
			     因为 web-app patch 把 session-query-sqlite 设成了 openAt: never。
			     之前那版依赖它，于是一个永远返回空的功能在界面上看起来只是"没命中"。） */
			function localSearch(rows, raw) {
				const q = String(raw || "").trim().toLowerCase();
				if (q === "") return [];
				const out = [];
				for (const row of rows) {
					const title = String(row.displayTitle || row.id);
					const info = describe(row);
					if (title.toLowerCase().includes(q)) {
						out.push({ row, where: "标题", text: title, at: title.toLowerCase().indexOf(q), rank: 0 });
					}
					for (const turn of info.outline) {
						for (const field of ["prompt", "response"]) {
							const text = String(turn[field] || "");
							const at = text.toLowerCase().indexOf(q);
							if (at < 0) continue;
							out.push({
								row,
								where: (field === "prompt" ? "你问" : "结论") + " · 第 " + (turn.turn || "?") + " 轮",
								text, at,
								rank: field === "prompt" ? 1 : 2
							});
						}
					}
				}
				return out.sort((a, b) => a.rank - b.rank).slice(0, 60);
			}

			/* 主机索引到底开没开，用一次真实的探测说清楚，而不是让功能静默失效 */
			async function probeHostIndex() {
				const sessions = sessionsService();
				if (!sessions || typeof sessions.search !== "function") {
					pushLog({ kind: "err", title: "这个实例没有暴露检索接口。" });
					return;
				}
				setSearching(true);
				try {
					const result = await sessions.search(query.trim() || "test");
					if (result && result.ok === true) {
						const items = result.value && Array.isArray(result.value.items) ? result.value.items : [];
						pushLog({ kind: "ok", title: "主机全文索引可用，返回 " + items.length + " 条", text: safeJson(items.slice(0, 2), 800) });
					} else {
						const code = result && result.error ? result.error.code : "未知";
						pushLog({
							kind: "info",
							title: "主机全文索引在这个 profile 里是关闭的（" + code + "）",
							text: "所以检索由本地完成：只搜主机已经算好的逐轮大纲。零延迟，但搜不到大纲之外的原文。想开启需要把 session-query-sqlite 的 openAt 改成 first-search。"
						});
					}
				} catch (error) {
					pushLog({ kind: "err", title: "探测失败：" + (error && error.message ? error.message : String(error)) });
				} finally {
					setSearching(false);
				}
			}

			/* ---------- 小块渲染 ---------- */
			const card = (row, flag) => {
				const info = describe(row);
				return h("div", {
					key: row.id,
					className: "zf-card" + (selected === row.id ? " on" : ""),
					onClick: () => choose(row.id)
				},
					h("div", { className: "zf-t" }, titleOf(row)),
					info.ask ? h("div", { className: "zf-ask" }, "你问：" + condense(info.ask, 54)) : null,
					info.conclusion ? h("div", { className: "zf-conc" }, "结论：" + condense(info.conclusion, 64)) : null,
					info.needs.length ? h("div", { className: "zf-need" }, "需要你：" + info.needs.join(" · ")) : null,
					info.queued ? h("div", { className: "zf-queued" }, "队列里还有 " + info.queued + " 条等它处理") : null,
					h("div", { className: "zf-m" },
						flag ? h("span", { className: "zf-flag " + flag.cls }, flag.label) : null,
						h("span", null, when(info.lastPromptAt)),
						info.turns ? h("span", null, info.turns + " 轮") : null,
						info.pressure > 0.02 ? h("span", { title: "上下文占用" }, "上下文 " + Math.round(info.pressure * 100) + "%") : null,
						h("span", { style: { marginLeft: "auto" } }, (row.cwd || "").split(/[\\/]/).filter(Boolean).slice(-1)[0] || "")));
			};

			const section = (title, list, flag, limit) => {
				if (list.length === 0) return null;
				const shown = limit ? list.slice(0, limit) : list;
				return h("div", { key: title },
					h("div", { className: "zf-sect" }, title, h("span", { className: "zf-cnt" }, String(list.length))),
					shown.map((row) => card(row, flag)),
					limit && list.length > limit ? h("div", { className: "zf-sect" }, "还有 " + (list.length - limit) + " 个") : null);
			};

			const today = countersOf(prefs);
			const hud = h("div", { className: "zf-hud" },
				h("span", { className: "zf-zero" }, "手动切换 ", h("b", null, String(today.manualSwitch || 0))),
				h("span", { className: "zf-zero", title: "把握度很低时，旧设计会停下问你一次；这里一次都没问" },
					"本该打断你 ", h("b", null, String(today.lowConfidence || 0)), " 次 · 实际 ", h("b", null, "0"), " 次"),
				h("span", null, "自动投递 ", h("b", null, String(today.autoRouted || 0))),
				h("span", null, "新建会话 ", h("b", null, String(today.newSession || 0))),
				h("span", null, "纠正 ", h("b", null, String(today.corrections || 0))),
				h("span", null, "会话 ", h("b", null, String(rows.length))));

			/* ---------- 汇报视图 ----------
			   目的：只在这一个框里对话。选中的会话是"上级"，它下面的子智能体是"下属"，
			   上级负责对接下属、把结果汇报上来 —— boss 不进原生界面、不跳页面。
			   原料还是 turnOutline（主机已经算好的逐轮 prompt/response），零 RPC、零模型。 */
			const pinnedInfo = pinnedRow ? describe(pinnedRow) : null;
			const pinnedSubs = pinnedRow ? rows.filter((row) => row.parentId === pinnedRow.id) : [];
			const reportNode = pinnedRow ? h("div", { className: "zf-report" },
				h("div", { className: "zf-report-h" },
					h("b", null, titleOf(pinnedRow)),
					h("span", { className: "zf-flag " + (pinnedRow.running ? "run" : "idle") },
						pinnedRow.running ? "在思考" : "已停下"),
					pinnedInfo && pinnedInfo.turns ? h("span", null, pinnedInfo.turns + " 轮") : null,
					pinnedRow.running && pinnedInfo && pinnedInfo.steps ? h("span", null, "第 " + pinnedInfo.steps + " 步") : null,
					pinnedInfo && pinnedInfo.pressure ? h("span", null, "上下文 " + Math.round(pinnedInfo.pressure * 100) + "%") : null,
					pinnedInfo && pinnedInfo.queued ? h("span", null, "队列 " + pinnedInfo.queued + " 条") : null,
					h("button", { className: "zf-mini", onClick: () => setSelected(null) }, "改回自动"),
					h("button", { className: "zf-mini", onClick: () => openSession(pinnedRow.id) }, "原生界面打开")),
				pinnedSubs.length
					? h("div", { className: "zf-report-subs" },
						"↳ 它手下有 " + pinnedSubs.length + " 个子智能体：" +
						pinnedSubs.map((sub) => titleOf(sub)).join("、"))
					: null,
				pinnedInfo && pinnedInfo.outline.length
					? h("div", { className: "zf-turns" },
						pinnedInfo.outline.slice().reverse().slice(0, 20).map((turn, index) => h("div", { className: "zf-turn", key: index },
							turn.prompt ? h("div", { className: "zf-turn-q" },
								h("i", null, "你问"), condense(String(turn.prompt), 180)) : null,
							turn.response ? h("div", { className: "zf-turn-a" },
								h("i", null, "汇报"), condense(String(turn.response), 420)) : null)))
					: h("div", { className: "zf-note" },
						"这个会话还没有回合。在下面输入框里说一句就会开始，它的汇报会出现在这里。"),
				pinnedInfo && pinnedInfo.outline.length > 20
					? h("div", { className: "zf-note" }, "只显示最近 20 轮（共 " + pinnedInfo.outline.length + " 轮）")
					: null)
				: null;

			const logNode = log.length === 0
				? h("div", { className: "zf-note" },
					rows.length === 0
						? "还没有读到会话。如果你刚启动应用，稍等片刻或先开一个对话。"
						: "打完字直接回车，系统决定发给哪个会话。\n左侧队列按「多需要你看」排序，不按时间。")
				: log.map((entry) => h("div", {
					key: entry.key,
					className: "zf-item" + (entry.kind === "ok" ? " zf-ok" : entry.kind === "err" ? " zf-err" : "")
						+ (isLowEntry(entry) ? " zf-warnitem" : "")
				},
					h("div", { className: "zf-h" },
						h("b", null, entry.title || ""),
						entry.layer ? h("span", null, entry.layer) : null,
						entry.reason ? h("span", null, entry.reason) : null,
						entry.confidence != null ? h("span", null, Math.round(entry.confidence * 100) + "%") : null),
					h("div", { className: "zf-x" }, entry.text || ""),
					/* 投出去之后仍然要把话说清楚：这条把握低，改投能把损失收回来，
					   而且**会记住特征**，所以同样的错不会一直犯。 */
					isLowEntry(entry) ? h("div", { className: "zf-warn" },
						h("b", null, "⚠ 这条只有 " + Math.round(entry.confidence * 100) + "% 的把握，很可能投错了"),
						h("span", null, "点下面的「不是它？改投给…」会把它重投到正确的会话，并记住这个特征，下次就不再错。")) : null,
					entry.sessionId ? h("div", { className: "zf-h", style: { marginTop: "6px" } },
						h("button", { className: "zf-tab", onClick: () => openSession(entry.sessionId) }, "原生界面打开"),
						h("button", {
							className: "zf-tab" + (isLowEntry(entry) ? " on" : ""),
							onClick: () => setReroute(reroute && reroute.key === entry.key ? null : entry)
						}, isLowEntry(entry) ? "不是它？改投给…（建议）" : "不是它？改投给…"),
						entry.layer === "学到的偏好" ? h("button", {
							className: "zf-tab",
							onClick: () => updatePrefs((current) => {
								const rules = current.rules.map((rule) => (rule.sessionId === entry.sessionId && rule.on ? Object.assign({}, rule, { on: false }) : rule));
								return Object.assign({}, current, { rules });
							})
						}, "撤销这条偏好") : null) : null,
					/* 改投：选出正确的那个会话 —— 学一条规则，并把这条消息真的重投过去。
					   给"投错的那个"学规则等于强化错误，所以这里必须换目标。 */
					reroute && reroute.key === entry.key ? h("div", { className: "zf-reroute" },
						h("div", { className: "zf-reroute-h" }, "这条本该给谁？选了就重投过去，并记住这个特征："),
						/* 改投也只能选主会话 —— 子智能体不是投递目标 */
						routableRows(rows).filter((row) => row.id !== entry.sessionId).slice(0, 6).map((row) =>
							h("button", {
								className: "zf-tab",
								key: row.id,
								onClick: () => applyReroute(entry, row)
							}, row.displayTitle || row.id)),
						h("button", { className: "zf-tab", onClick: () => setReroute(null) }, "取消")) : null));

			/* 自动摘要：直接用主机维护的 turnOutline，不调模型、不读事件流。
			   默认只渲染最近若干张 —— 用满一天之后会话会很多，全渲染会把面板拖垮。 */
			const summarized = rows
				.map((row) => ({ row, info: describe(row) }))
				.filter((item) => item.info.turns > 0)
				.sort((a, b) => b.info.lastPromptAt - a.info.lastPromptAt);
			const visibleSummaries = showAllSummaries ? summarized : summarized.slice(0, SUMMARY_LIMIT);

			const sideSummary = h("div", null,
				h("div", { className: "zf-note", style: { textAlign: "left", padding: "0 0 10px" } },
					"摘要来自主机维护的逐轮大纲（turnOutline），零额外开销。点标题打开会话，点「投递」把这句话送过去。"),
				summarized.length === 0
					? h("div", { className: "zf-note" }, "还没有有内容的会话。")
					: [visibleSummaries.map(({ row, info }) => h("div", { className: "zf-sum", key: row.id },
						h("div", { className: "zf-sum-h" },
							h("b", null, titleOf(row)),
							h("span", { style: { marginLeft: "auto" } }, when(info.lastPromptAt))),
						info.goal ? h("div", { className: "zf-sum-goal" },
							"🎯 " + condense(info.goal.objective, 70) + "（" + info.goal.phase + " · 第 " + info.goal.rounds + " 轮）") : null,
						info.needs.length ? h("div", { className: "zf-need" }, "需要你：" + info.needs.join(" · ")) : null,
						info.queued ? h("div", { className: "zf-queued" }, "队列里还有 " + info.queued + " 条等它处理") : null,
						info.ask ? h("div", { className: "zf-sum-row" }, h("i", null, "你问"), condense(info.ask, 110)) : null,
						info.conclusion ? h("div", { className: "zf-sum-row" }, h("i", null, "结论"), condense(info.conclusion, 150)) : null,
						info.prevConclusion ? h("div", { className: "zf-sum-row zf-dim" }, h("i", null, "上一轮"), condense(info.prevConclusion, 90)) : null,
						h("div", { className: "zf-sum-f" },
							h("span", null, info.turns + " 轮"),
							info.pressure > 0.02 ? h("span", null, "上下文 " + Math.round(info.pressure * 100) + "%") : null,
							/* 主按钮改成"就地看汇报" —— boss 不需要跳页面。
							   真要去原生界面时，那里还有一个小入口。 */
							h("button", { className: "zf-tab", onClick: () => setSelected(row.id) }, "看汇报"),
							h("button", { className: "zf-mini", onClick: () => openSession(row.id) }, "原生界面"),
							h("button", {
								className: "zf-tab",
								onClick: () => {
									const text = "用三句话总结我们目前聊到哪了，以及下一步该做什么。";
									sendToSession(row.id, text).then(
										() => { bump("autoRouted", 1); pushLog({ kind: "ok", title: "已让「" + (row.displayTitle || row.id) + "」自己总结", text, sessionId: row.id }); },
										(error) => pushLog({ kind: "err", title: "投递失败：" + (error && error.message ? error.message : String(error)), text, sessionId: row.id })
									);
								}
							}, "让它自己总结")))),
						summarized.length > SUMMARY_LIMIT
							? h("button", {
								className: "zf-tab",
								style: { marginTop: "4px" },
								onClick: () => setShowAllSummaries(!showAllSummaries)
							}, showAllSummaries ? "只显示最近 " + SUMMARY_LIMIT + " 个" : "显示全部 " + summarized.length + " 个")
							: null]
			);

			/* 摩擦账本：按天的真实数字，而不是只有一个今日快照 */
			const days = ledgerDays(prefs, 7);
			const total = days.reduce((acc, day) => {
				for (const key of COUNTERS) acc[key] = (acc[key] || 0) + (day[key] || 0);
				return acc;
			}, {});
			const sideLedger = h("div", null,
				h("div", { className: "zf-note", style: { textAlign: "left", padding: "0 0 10px" } },
					"这些数字只在真实使用时才会长。跨天累计，存在本地。"),
				h("table", { className: "zf-ledger" },
					h("tr", null,
						h("th", null, "日期"), h("th", null, "投递"), h("th", null, "新建"),
						h("th", null, "纠正"), h("th", null, "问你"), h("th", null, "本该打断")),
					days.length === 0
						? h("tr", null, h("td", { colSpan: 6, style: { color: "inherit", opacity: .6 } }, "今天还没有记录"))
						: days.map((day) => h("tr", { key: day.day },
							h("td", null, day.day.slice(5)),
							h("td", null, String(day.autoRouted || 0)),
							h("td", null, String(day.newSession || 0)),
							h("td", null, String(day.corrections || 0)),
							h("td", null, String(day.asked || 0)),
							h("td", null, String(day.lowConfidence || 0)))),
					h("tr", { className: "zf-ledger-sum" },
						h("td", null, "合计"), h("td", null, String(total.autoRouted || 0)),
						h("td", null, String(total.newSession || 0)), h("td", null, String(total.corrections || 0)),
						h("td", null, String(total.asked || 0)),
						h("td", null, String(total.lowConfidence || 0)))),
				h("div", { className: "zf-note", style: { textAlign: "left", padding: "10px 0 0" } },
					h("div", null, "投递：自动送到某个会话的次数"),
					h("div", null, "新建：识别为新话题、开了新会话的次数"),
					h("div", null, "纠正：你按了「不是它」的次数（按下去也会变成一条偏好）"),
					h("div", null, "问你：没有任何会话和那句话对得上、于是停下来问你怎么处理的次数。这是这一版新增的护栏，问的次数多说明路由还需要调。"),
					h("div", null, "本该打断：把握度低到旧设计会停下问你的次数。这一列是「零摩擦」的可证伪指标 —— 它不为 0，而右边的实际打断次数应该一直是 0。")),
				h("div", { className: "zf-rule", style: { marginTop: "10px" } },
					h("div", { className: "zf-rt" }, "没把握时默认开新会话",
						h("small", null, "关掉的话，选择面板会把上次在用的会话放第一位（但你还是会被问一次）")),
					h("button", {
						className: "zf-sw" + (prefs.autoNewSession ? " on" : ""),
						onClick: () => updatePrefs((current) => Object.assign({}, current, { autoNewSession: !current.autoNewSession }))
					})),
				h("div", { className: "zf-rule", style: { marginTop: "10px" } },
					h("div", { className: "zf-rt" }, "语义路由（问模型）",
						h("small", null, "词面对不上时，把候选会话和目标句交给一个专用助手会话判断，它只回编号或 NEW。"
							+ "不拿你自己的会话当分类器，所以不会污染你的对话；代价是每问一次多花那个助手会话一轮。"
							+ "结果带缓存，45 秒没答复就退回让你选。")),
					h("button", {
						className: "zf-sw" + (prefs.semanticRouter ? " on" : ""),
						onClick: () => updatePrefs((current) => Object.assign({}, current, { semanticRouter: !current.semanticRouter }))
					})),
				prefs.routerSessionId ? h("div", { className: "zf-note", style: { textAlign: "left", padding: "6px 0 0" } },
					"路由助手会话：",
					h("b", null, (rows.find((row) => row.id === prefs.routerSessionId) || {}).displayTitle || prefs.routerSessionId),
					" ",
					h("button", {
						className: "zf-mini",
						onClick: () => updatePrefs((current) => Object.assign({}, current, { routerSessionId: null }))
					}, "换一个")) : null);

			const sideRules = h("div", null,
				h("div", { className: "zf-note", style: { textAlign: "left", padding: "0 0 10px" } },
					"每次「不是它」都会变成一条可停用的规则。这是越用越准的来源。"),
				prefs.rules.length === 0
					? h("div", { className: "zf-note" }, "还没有学到任何偏好。")
					: prefs.rules.map((rule) => h("div", { className: "zf-rule", key: rule.id },
						h("div", { className: "zf-rt" }, "含「" + rule.match + "」→ ", h("b", null, rule.title || rule.sessionId),
							h("small", null, "已生效 " + (rule.hits || 0) + " 次 · 你纠正过")),
						h("button", {
							className: "zf-sw" + (rule.on ? " on" : ""),
							title: rule.on ? "停用" : "启用",
							onClick: () => updatePrefs((current) => Object.assign({}, current, {
								rules: current.rules.map((item) => (item.id === rule.id ? Object.assign({}, item, { on: !item.on }) : item))
							}))
						}))));

			const sideFind = h("div", null,
				h("input", {
					className: "zf-input",
					placeholder: "在标题与每轮大纲里搜…边打边搜",
					value: query,
					onChange: (event) => setQuery(event.target.value)
				}),
				h("div", { className: "zf-note", style: { textAlign: "left", padding: "8px 0" } },
					"主机全文索引在本 profile 是关闭的，检索在本地完成（搜的是主机已算好的逐轮大纲，零延迟）。",
					h("button", { className: "zf-tab", style: { marginLeft: "6px" }, onClick: probeHostIndex }, searching ? "探测中…" : "探测主机索引")),
				found.length === 0
					? (query.trim() ? h("div", { className: "zf-note" }, "没有命中。") : h("div", { className: "zf-note" }, "输入关键词，在全部会话的标题与逐轮大纲里找。"))
					: found.map((hit, index) => h("div", {
						className: "zf-hit",
						key: String(index),
						onClick: () => setSelected(hit.row.id)
					},
						h("div", { className: "zf-ht" }, titleOf(hit.row) + " · " + hit.where),
						h("div", { className: "zf-hs" }, snippetNodes(hit.text, hit.at, query.trim().length)))));

			const sideHelp = h("div", { className: "zf-note", style: { textAlign: "left" } },
				h("p", null, "全部是真实数据：会话列表来自 Session 控制器；投递走真实 prompt 通道；摘要读主机维护的 turnOutline；新话题用 sessions.create 真的开一个新会话。"),
				h("p", null, "检索在本地做：主机全文索引在 web/desktop profile 里是关闭的（session-query-sqlite 的 openAt 是 never），所以只搜主机已算好的逐轮大纲。零延迟，但搜不到大纲之外的原文。"),
				h("p", null, "唯一保留摩擦的地方是不可逆动作。除此之外不该有「请确认」。"),
				h("p", null, "开发探针：控制台里跑 window.__ZF_DEBUG__.dump(0) 可以把某个会话的真实投影结构打出来。"));

			return h("div", { className: "zf-root" },
				h("div", { className: "zf-head" },
					h("h2", null, "零摩擦工作区"),
					h("span", { className: "zf-m" }, "一个输入框 · 自动投递到该去的会话"),
					hud),
				h("div", { className: "zf-body" },
					h("div", { className: "zf-queue" },
						/* 「真的在等你」刻意不封顶 —— 那正是这个面板存在的意义；
						   其余分组封顶，避免一天之后队列变成几百张卡片。 */
						section("🔴 真的在等你", groups.waiting, { cls: "wait", label: "等你" }),
						section("🟡 正在跑", groups.running, { cls: "run", label: "在跑" }, 8),
						section("⚪ 已停下", groups.rest, { cls: "idle", label: "停" }, 8),
						section("↳ 子智能体", groups.subs, { cls: "sub", label: "子" }, 6)),
					h("div", { className: "zf-main" },
						reportNode,
						h("div", { className: "zf-log", ref: areaRef }, logNode),
						h("div", { className: "zf-compose" },
							h("div", { className: "zf-fan" + (lowConfidence ? " warn" : "") },
								preview == null
									? h("span", null, "打完字直接回车，系统决定发给谁。")
									: h("span", null,
										"→ ", h("span", { className: "zf-to" },
											preview.row ? titleOf(preview.row) : "（新话题：会开一个新会话）"),
										" ", h("span", null, preview.layer + " · " + preview.reason + " · " + Math.round(preview.confidence * 100) + "%"))),
							choiceNode,
							/* 语义路由的状态：让它可见、可等待、可放弃 —— 不静默 */
							preview && preview.semanticAsking ? h("div", { className: "zf-warn" },
								h("b", null, "词面对不上，正在问路由助手…"),
								h("span", null, "它只回一个编号或 NEW。等不及就按回车 —— 会直接让你选。")) : null,
							semantic && semantic.q === text && semantic.status === "failed"
								? h("div", { className: "zf-warn" },
									h("b", null, semantic.raw ? "路由助手没给出可用的答案" : "路由助手没在时限内答出来"),
									h("span", null, semantic.raw
										? "它回的是：" + semantic.raw + " —— 认不出编号，所以退回让你选"
										: "所以退回让你选（按回车就会弹出选项）")) : null,
							/* 低把握时的**发送前**护栏：不是弹窗、不拦你回车，只是把选项摆在手边。
							   零摩擦的意思是"不制造分叉"，不是"看着你投错也不吭声"。 */
							!choice && lowConfidence ? h("div", { className: "zf-warn" },
								h("b", null, "⚠ 把握只有 " + Math.round(preview.confidence * 100) + "%，可能投错"),
								h("span", null, "投错会污染那个会话的上下文，还白烧一轮算力。现在改不要钱："),
								h("span", { className: "zf-warn-row" },
									(preview.alternatives || []).map((row) => h("button", {
										className: "zf-mini", key: row.id,
										onClick: () => setSelected(row.id)
									}, "改投「" + titleOf(row) + "」")))) : null,
							h("div", { className: "zf-row" },
								h("textarea", {
									rows: 1,
									value: draft,
									placeholder: "直接说，模糊也没关系 —— 回车就发，不做二次确认",
									onChange: (event) => setDraft(event.target.value),
									onKeyDown: (event) => {
										if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
									}
								}),
								/* 「开新会话」**永远在**，不依赖任何阈值与启发式。
								   使用者报过：没证据时想要开新会话，却找不到这个入口。
								   阈值再准也不该是唯一的门 —— 明示的出口必须一直在。 */
								h("button", {
									className: "zf-alt",
									title: "不理路由判断，直接把这句话发到一个新会话里",
									onClick: () => { forceRef.current = { newTopic: true }; setChoice(false); return submit({ skipAsk: true }); }
								}, "开新会话"),
								h("button", { className: "zf-send", disabled: busy || text === "", onClick: () => submit() }, busy ? "投递中" : "发送")),
							h("div", { className: "zf-hint" },
								choice
									? "没把握，所以问你一句 —— 选一个，或者点「取消」改改这句话"
									: pinnedRow
										? "Enter 发送给「" + titleOf(pinnedRow) + "」· 点「改回自动」恢复自动判断 · 汇报会显示在上面"
										: "Enter 直接发送 · 有证据就按证据走，没证据会先问你一句，不再替你猜"))),
					h("div", { className: "zf-side" },
						h("div", { className: "zf-tabs" },
							h("button", { className: "zf-tab" + (sideTab === "sum" ? " on" : ""), onClick: () => setSideTab("sum") }, "自动摘要"),
							h("button", { className: "zf-tab" + (sideTab === "ledger" ? " on" : ""), onClick: () => setSideTab("ledger") }, "摩擦账本"),
							h("button", { className: "zf-tab" + (sideTab === "rules" ? " on" : ""), onClick: () => setSideTab("rules") }, "偏好"),
							h("button", { className: "zf-tab" + (sideTab === "find" ? " on" : ""), onClick: () => setSideTab("find") }, "检索"),
							h("button", { className: "zf-tab" + (sideTab === "help" ? " on" : ""), onClick: () => setSideTab("help") }, "说明")),
						sideTab === "sum" ? sideSummary
							: sideTab === "ledger" ? sideLedger
							: sideTab === "rules" ? sideRules
							: sideTab === "find" ? sideFind : sideHelp)));
		}

		/* 明显过于泛化的词：即使别的会话标题里没出现，也不适合当路由特征。 */
		const GENERIC_WORDS = new Set(["工具", "东西", "事情", "问题", "内容", "功能", "方法",
			"时候", "地方", "情况", "结果", "部分", "方面", "任务", "需求", "一个", "这个"]);

		/**
		 * 这个特征够不够"排他"。
		 * 真机实测教训：我第一次在真机上改投，学到的关键词是「工具」（消息与目标标题
		 * 唯一共享的 2 字片段）—— 于是以后任何带「工具」的句子都会被吸到那个会话。
		 * 一条过拟合的规则比没有规则糟得多，因为它会持续地把错的东西投到错的地方。
		 * 判据：目标之外还有会话标题含它 → 它就不足以定人。
		 */
		function isDiscriminative(keyword, rows, targetId) {
			if (!keyword || keyword.length < 2) return false;
			if (GENERIC_WORDS.has(keyword)) return false;
			for (const row of rows) {
				if (row.id === targetId) continue;
				if (String(row.displayTitle || "").includes(keyword)) return false;
			}
			return true;
		}

		/* 末尾虚词：即使来自标题片段也要剥掉，免得学出「登录页的」这种带助词的规则。 */
		const TAIL_STOP = /(的|了|吗|呢|吧|啊|嘛|呀|一下|一个|这个|那个|我们|你们|他们|它们|还是|就是|然后|现在|已经|可以|能不能|帮我)$/;

		/* 从消息里挑一个能当路由特征的词。
		   只有"消息与目标标题真正共享的片段"才算数 —— 这是刻意的保守选择：
		     · 真机实测：我原来还会退回到"消息里第一段 2-4 个汉字"，于是第一次真机改投
		       就学出了「工具」这种泛词，之后所有带"工具"的句子都会被吸过去。
		     · 而且真正需要纠正的句子，本来就与目标标题不像；所以"宁可这次不学"，
		       也不要一条会长期把东西投错地方的规则。
		   共同片段从长到短取第一个命中的（越长越具体）。 */
		function pickKeyword(text, row) {
			const source = String(text || "");
			const title = stripTitle(row.displayTitle || "");
			for (let n = Math.min(6, title.length); n >= 2; n--) {
				for (let i = 0; i + n <= title.length; i++) {
					const gram = title.slice(i, i + n);
					if (source.toLowerCase().includes(gram)) {
						let key = gram;
						for (let k = 0; k < 4 && TAIL_STOP.test(key); k++) key = key.replace(TAIL_STOP, "");
						return key.length >= 2 ? key : null;
					}
				}
			}
			return null;
		}

		/* ================================================================
		   开发用探针：window.__ZF_DEBUG__.dump()
		   DSH 的会话事件窗口没有文档，磁盘上的会话文件又是二进制。所以让
		   运行中的应用自己把真实结构吐出来，比对着压缩代码猜可靠得多。
		   只读，不改变任何状态。
		   ================================================================ */
		function safeJson(value, limit) {
			const seen = new WeakSet();
			let text;
			try {
				text = JSON.stringify(value, (key, item) => {
					if (typeof item === "function") return "[function]";
					if (item && typeof item === "object") {
						if (seen.has(item)) return "[cycle]";
						seen.add(item);
					}
					return item;
				}, 1);
			} catch (error) { return "[无法序列化: " + (error && error.message) + "]"; }
			if (typeof text !== "string") return "[无值]";
			return text.length > (limit || 3000) ? text.slice(0, limit || 3000) + "…(截断)" : text;
		}

		async function dumpDebug(sessionIndex) {
			const sessions = sessionsService();
			if (!sessions) return "sessions 服务不可用（inject 没生效？）";
			const snapshot = sessions.list ? sessions.list.getSnapshot() : null;
			const rows = snapshot && snapshot.byId ? Object.values(snapshot.byId) : [];
			const lines = [];
			lines.push("会话数=" + rows.length + "  phase=" + (snapshot && snapshot.phase));
			if (rows.length) lines.push("row 字段: " + Object.keys(rows[0]).join(", "));
			const pick = rows[sessionIndex || 0];
			if (pick) {
				lines.push("--- row[" + (sessionIndex || 0) + "] ---");
				lines.push(safeJson(pick, 8000));
				try {
					const probe = await sessions.using(pick.id, { source: "zeroFrictionProbe" }, async (reference) => {
						const binding = reference && reference.binding;
						const source = binding && binding.eventSource;
						const snap = source && typeof source.getSnapshot === "function" ? source.getSnapshot() : null;
						const entries = snap && Array.isArray(snap.entries) ? snap.entries : [];
						const out = [];
						out.push("binding 字段: " + (binding ? Object.keys(binding).join(", ") : "(无)"));
						out.push("eventSource snapshot 字段: " + (snap ? Object.keys(snap).join(", ") : "(无)"));
						out.push("entries 数: " + entries.length);
						for (const entry of entries.slice(-2)) out.push("entry: " + safeJson(entry, 1500));
						return out;
					});
					lines.push("--- 事件窗口 ---");
					lines.push(probe.join("\n"));
				} catch (error) {
					lines.push("probe 失败: " + (error && error.message ? error.message : String(error)));
				}
			}
			/* 检索契约也要亲眼看过：web profile 里 session-query-sqlite 是 openAt: never，
			   主机内容索引可能根本没开。之前 create 的返回结构我就是猜错的。 */
			try {
				const found = await sessions.search("502");
				lines.push("--- search('502') 原始返回 ---");
				lines.push(safeJson(found, 2500));
			} catch (error) {
				lines.push("search 抛错: " + (error && error.message ? error.message : String(error)));
			}
			/* 服务解析检查：ctx.get 到底能不能拿到 uiWorkspace？
			   「打开这个会话」按钮靠它，而它失败时是静默的（按钮什么都不做）。 */
			lines.push("--- 服务解析 ---");
			lines.push("app.get 是函数: " + !!(app && typeof app.get === "function"));
			try {
				const ws = app && typeof app.get === "function" ? app.get("uiWorkspace") : null;
				lines.push("ctx.get('uiWorkspace') → " + (ws ? "有值" : "undefined"));
				if (ws) lines.push("  openSession 是函数: " + (typeof ws.openSession === "function")
					+ " · 字段: " + Object.keys(ws).slice(0, 14).join(", "));
			} catch (error) {
				lines.push("ctx.get('uiWorkspace') 抛错: " + (error && error.message));
			}
			/* 已实测的事实，不再重复试：未声明的 `ctx.uiWorkspace` 会直接抛
			   cannot get property "uiWorkspace" without inject —— 所以这里只报结论，
			   不再留一处真实的未声明访问（那会让静态检查失去意义）。 */
			lines.push("未声明访问会抛错（已实测）· 插件自己的 inject 只有: " + JSON.stringify(inject));
			return lines.join("\n");
		}

		/* ================================================================
		   服务注入 —— 写错这里整个面板就是空的
		   Cordis 只向插件暴露它声明过的服务：没写进 inject 的服务在 ctx 上
		   就是 undefined。所以真正用到的服务必须全部列出。
		   同一约定可参照：ui-conversation 声明
		   ["slots","sessions","fileUpload","uiSession","uiWorkspace","locale","configForms"]，
		   ui-workspace 声明 ["slots","sessions","workspaces","locale","remote",…]，
		   ui-input-trigger 声明 ["sessions","locale"]。
		   `uiWorkspace` 刻意不声明：只在点「打开会话」时用到，晚到无所谓，
		   用 ctx.get() 反射读取，少一个激活依赖。
		   ================================================================ */
		const inject = ["slots", "sessions"];

		/* ================================================================
		   服务探针：找出客户端到底能拿到哪些服务。
		   目的是回答"能不能不经过任何会话就调用模型" —— 语义路由必须知道这件事，
		   因为把分类提示词投进用户自己的会话会污染那个会话（正是要避免的问题）。
		   只读：只读属性、只报告类型，不调用任何有副作用的方法。
		   ================================================================ */
		function probeServices() {
			const out = { ctxKeys: [], own: [], candidates: {}, registry: null };
			try {
				out.ctxKeys = Object.keys(app || {});
				const seen = new Set();
				let node = app;
				for (let depth = 0; node && depth < 4; depth++) {
					for (const key of Reflect.ownKeys(node)) {
						if (typeof key === "string" && !seen.has(key)) { seen.add(key); out.own.push(key); }
					}
					node = Object.getPrototypeOf(node);
				}
			} catch (error) { out.ownError = String(error && error.message); }

			/* 候选名：常见的一次性模型/推理服务命名 */
			const names = ["llm", "model", "models", "chat", "completion", "completions", "generate",
				"inference", "agent", "agents", "api", "remote", "gateway", "rpc", "http", "ai",
				"provider", "providers", "openai", "anthropic", "config", "settings"];
			for (const name of names) {
				try {
					const value = app && typeof app.get === "function" ? app.get(name) : undefined;
					if (value === undefined || value === null) continue;
					const methods = [];
					for (const key of Reflect.ownKeys(value)) {
						try { if (typeof value[key] === "function") methods.push(String(key)); } catch (error) { /* 有些 getter 会抛 */ }
					}
					out.candidates[name] = { type: typeof value, ctor: value.constructor && value.constructor.name, methods: methods.slice(0, 40) };
				} catch (error) {
					out.candidates[name] = { error: String(error && error.message) };
				}
			}
			try {
				const reg = (app && (app.registry || (app.root && app.root.registry))) || null;
				if (reg) {
					out.registry = {
						type: typeof reg,
						keys: Object.keys(reg).slice(0, 60),
						services: reg.services ? Object.keys(reg.services).slice(0, 80) : null
					};
					/* Cordis 把真正的服务表放在 registry._internal 下面 —— 往里挖一层 */
					const internal = reg._internal;
					if (internal && typeof internal === "object") {
						out.internalKeys = Object.keys(internal);
						for (const key of Object.keys(internal)) {
							const value = internal[key];
							if (value && typeof value === "object") {
								try { out["internal__" + key] = Object.keys(value).slice(0, 120); } catch (error) { /* 忽略 */ }
							}
						}
					}
				}
			} catch (error) { out.registry = { error: String(error && error.message) }; }

			/* remote 的方法在原型上，ownKeys 看不到 */
			try {
				const remote = app.get("remote");
				if (remote) {
					const collect = (object, cap) => (object ? Reflect.ownKeys(object).map(String).filter((key) => key !== "constructor").slice(0, cap || 60) : []);
					const proto = Object.getPrototypeOf(remote);
					out.remoteProto = collect(proto, 80);
					out.remoteProto2 = collect(proto ? Object.getPrototypeOf(proto) : null, 80);
					out.remoteOwn = collect(remote, 80);
					/* $host 很可能就是"主机服务命名空间" —— 如果它是，那就能直接按名字调主机服务 */
					const host = remote.$host;
					out.remoteHostType = typeof host;
					if (host && typeof host === "object") {
						out.remoteHostKeys = Object.keys(host).slice(0, 120);
						out.remoteHostProto = collect(Object.getPrototypeOf(host), 80);
					}
					const stream = remote.$stream;
					out.remoteStreamType = typeof stream;
					if (stream && typeof stream === "object") out.remoteStreamKeys = Object.keys(stream).slice(0, 80);
					/* invoke 的形参个数能提示签名 */
					out.remoteInvokeArity = typeof remote.invoke === "function" ? remote.invoke.length : null;
					out.remoteInvokeMethodArity = typeof remote.invokeMethod === "function" ? remote.invokeMethod.length : null;
					out.remoteInvokeSelectedArity = typeof remote.invokeSelected === "function" ? remote.invokeSelected.length : null;
					/* ★ 已注册的主机命名空间 —— 这就是"能调什么"的清单 */
					const namespaces = remote.namespaces;
					if (namespaces) {
						const keys = namespaces instanceof Map ? Array.from(namespaces.keys()) : Object.keys(namespaces);
						out.namespaceNames = keys.map(String).slice(0, 80);
						const detail = {};
						for (const key of keys.slice(0, 40)) {
							try {
								const value = namespaces instanceof Map ? namespaces.get(key) : namespaces[key];
								/* 命名空间外面包了一层 { service, dispose } —— 真正的方法在 service 上 */
								const service = value && value.service;
								const collectMethods = (object) => {
									if (!object) return [];
									const found = new Set();
									let node = object;
									for (let depth = 0; node && depth < 3; depth++) {
										for (const name of Reflect.ownKeys(node)) {
											try { if (typeof object[name] === "function") found.add(String(name)); } catch (error) { /* getter 抛错就跳过 */ }
										}
										node = Object.getPrototypeOf(node);
									}
									return Array.from(found).filter((name) => name !== "constructor").slice(0, 60);
								};
								detail[String(key)] = {
									wrapper: (value && typeof value === "object") ? Reflect.ownKeys(value).map(String).slice(0, 10) : typeof value,
									serviceCtor: service && service.constructor && service.constructor.name,
									methods: collectMethods(service)
								};
							} catch (error) { detail[String(key)] = "ERR:" + (error && error.message); }
						}
						out.namespaceDetail = detail;

						/* ★ 决定性一问：llm 服务上到底有没有"一次性补全"这类方法？
						   直接列表只暴露了列模型/列供应商，但命名空间还有 invokeRemote，
						   说明没列出的方法也可能可调。has() 是只读的。 */
						try {
							const entry = namespaces instanceof Map ? namespaces.get("llm") : namespaces.llm;
							const service = entry && entry.service;
							if (service && typeof service.has === "function") {
								const wanted = ["complete", "completion", "chat", "generate", "generateText",
									"generateObject", "ask", "stream", "embed", "embeddings", "rerank",
									"invoke", "run", "models", "providers", "listProviders", "discoverModels"];
								const found = {};
								for (const name of wanted) {
									try { found[name] = service.has(name); }
									catch (error) { found[name] = "ERR:" + (error && error.message); }
								}
								out.llmHas = found;
							} else {
								out.llmHas = "no-has-method";
							}
						} catch (error) { out.llmHas = "ERR:" + (error && error.message); }
					}
				}
			} catch (error) { out.remoteError = String(error && error.message); }

			/* DSH 自己的插件声明过这些服务，确认能不能拿到（其中可能有能一次性推理的） */
			for (const name of ["uiWorkspace", "uiSession", "fileUpload", "locale", "configForms", "workspaces", "sessions", "slots"]) {
				try {
					const value = app.get(name);
					out.candidates[name] = value
						? { type: typeof value, ctor: value.constructor && value.constructor.name }
						: null;
				} catch (error) { out.candidates[name] = { error: String(error && error.message) }; }
			}
			return out;
		}

		function apply(ctx) {
			app = ctx;
			try { if (typeof window !== "undefined") window.__ZF_DEBUG__ = { dump: dumpDebug, probe: probeServices }; } catch (error) { /* 探针挂不上无所谓 */ }
			try {
				ctx.slots.inject("main", function* () {
					yield ctx.slots.register({ name: "main", key: PANEL_ID }, ZeroFrictionPage);
				});
				ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 5,
					label: () => "零摩擦"
				}, PanelIcon));
			} catch (error) {
				/* 注册失败不能拖垮整个客户端 */
				if (typeof console !== "undefined" && console.error) console.error("[zero-friction] 注册失败", error);
			}
		}

		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
