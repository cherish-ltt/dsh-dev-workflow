window.__ModuleLoader__.load({
	id: "@ghyper9023/dsh-dev-workflow",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;

		var STYLE_ID = "@ghyper9023/dsh-dev-workflow/client.css";
		var BOUNDARY_TEXT = /^#{1,6}\s*选项\s*(\d+)$/;
		var BOUNDARY_HEADING = /^选项\s*(\d+)$/;
		var PAYLOAD_START = /^#{1,6}\s*选项\s*1\s/;

		var CSS = [
			'[data-dsh-dev-ask-panel]{flex-direction:row!important;flex-wrap:wrap;align-items:flex-start;gap:8px 16px}',
			'[data-dsh-dev-ask-panel]>*{flex:0 0 100%;order:3}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-options]{flex:1 1 280px;order:1;min-width:0}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview]{flex:1 1 340px;order:2;min-width:0;position:sticky;top:0;max-height:min(46vh,420px);overflow:auto;overscroll-behavior:contain;margin:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview]>:first-child{margin-top:0}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview]>:last-child{margin-bottom:0}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview] pre{overflow-x:auto;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;white-space:pre}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview] code{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview] table{border-collapse:collapse;width:100%;font-size:12px}',
			'[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview] th,[data-dsh-dev-ask-panel]>[data-dsh-dev-ask-preview] td{border:1px solid var(--dsw-alias-border-l2);padding:4px 8px;text-align:left}',
			'[data-dsh-dev-ask-panel][data-dsh-dev-ask-narrow]>[data-dsh-dev-ask-options],[data-dsh-dev-ask-panel][data-dsh-dev-ask-narrow]>[data-dsh-dev-ask-preview]{flex:0 0 100%}',
			'[data-dsh-dev-ask-panel][data-dsh-dev-ask-narrow]>[data-dsh-dev-ask-preview]{position:static;max-height:none}',
			'[data-dsh-dev-ask-panel][data-dsh-dev-ask-empty]>[data-dsh-dev-ask-options]{flex:0 0 100%}',
			'[data-dsh-dev-ask-hidden]{display:none!important}',
		].join("\n");

		function installStyle() {
			if (document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + "]") !== null) return;
			var tag = document.createElement("style");
			tag.dataset.plugin = "@ghyper9023/dsh-dev-workflow";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function hide(node) {
			if (node.nodeType !== 1) return;
			node.dataset.dshDevAskHidden = "";
			node.style.display = "none";
		}

		function boundaryIndex(node) {
			if (node.nodeType !== 1) return undefined;
			if (node.childElementCount !== 0) return undefined;
			var text = (node.textContent || "").trim();
			if (text === "") return undefined;
			var match = /^h[1-6]$/i.test(node.tagName) ? BOUNDARY_HEADING.exec(text) : BOUNDARY_TEXT.exec(text);
			return match === null ? undefined : Number(match[1]) - 1;
		}

		function optionsOf(body) {
			var children = Array.prototype.slice.call(body.children);
			for (var index = 0; index < children.length; index += 1) {
				var role = children[index].getAttribute("role");
				if (role === "radiogroup" || role === "group") return children[index];
			}
			return undefined;
		}

		function previewOf(body) {
			return body.querySelector("[data-dsh-dev-ask-preview]");
		}

		function reset(body) {
			delete body.dataset.dshDevAskPanel;
			var stale = previewOf(body);
			if (stale !== null) {
				delete stale.dataset.dshDevAskPreview;
				stale.style.display = "";
				var marked = stale.querySelectorAll("[data-dsh-dev-ask-hidden]");
				for (var index = 0; index < marked.length; index += 1) {
					delete marked[index].dataset.dshDevAskHidden;
					marked[index].style.display = "";
				}
			}
		}

		function enhance(body) {
			if (body.dataset.dshDevAskPanel !== undefined) {
				if (previewOf(body) !== null) return;
				reset(body);
			}
			var options = optionsOf(body);
			if (options === undefined) return;
			var children = Array.prototype.slice.call(body.children);
			var detail;
			for (var index = 0; index < children.length; index += 1) {
				if (children[index] === options) continue;
				if (children[index].querySelector("[data-dsh-dev-ask-preview]") !== null) continue;
				if ((children[index].textContent || "").indexOf("选项") === -1) continue;
				detail = children[index];
				break;
			}
			if (detail === undefined) return;

			var buttons = Array.prototype.slice.call(options.querySelectorAll('[role="radio"],[role="checkbox"]'));
			if (buttons.length === 0) return;

			var groups = new Map();
			var leading = [];
			var current;
			var nodes = Array.prototype.slice.call(detail.querySelectorAll("*"));
			var boundaries = nodes.filter(function (node) {
				return boundaryIndex(node) !== undefined;
			});
			if (boundaries.length === 0) return;
			var host = boundaries[0].parentElement;
			if (host === null) return;
			if (!boundaries.every(function (node) { return node.parentElement === host; })) return;

			Array.prototype.forEach.call(host.childNodes, function (node) {
				var position = boundaryIndex(node);
				if (position !== undefined) {
					current = [];
					groups.set(position, current);
					return;
				}
				(current === undefined ? leading : current).push(node);
			});
			if (groups.size === 0) return;

			leading.forEach(hide);
			boundaries.forEach(hide);

			detail.dataset.dshDevAskPreview = "";
			options.dataset.dshDevAskOptions = "";
			body.dataset.dshDevAskPanel = "";

			var shown;
			function show(position) {
				if (position === shown) return;
				shown = position;
				var present = groups.has(position);
				detail.style.display = present ? "" : "none";
				if (present) delete body.dataset.dshDevAskEmpty;
				else body.dataset.dshDevAskEmpty = "";
				groups.forEach(function (list, key) {
					list.forEach(function (node) {
						if (node.nodeType !== 1) return;
						node.style.display = key === position ? "" : "none";
					});
				});
			}

			function sync() {
				for (var at = 0; at < buttons.length; at += 1) {
					if (buttons[at].getAttribute("aria-checked") === "true") {
						show(at);
						return;
					}
				}
			}

			sync();
			if (shown === undefined) show(0);

			new MutationObserver(sync).observe(options, {
				subtree: true,
				attributes: true,
				attributeFilter: ["aria-checked"],
			});

			function resize() {
				if (body.clientWidth < 720) body.dataset.dshDevAskNarrow = "";
				else delete body.dataset.dshDevAskNarrow;
			}
			resize();
			new ResizeObserver(resize).observe(body);
		}

		function hideTranscriptPayload() {
			var nodes = document.querySelectorAll('[class*="detail"]');
			for (var index = 0; index < nodes.length; index += 1) {
				var node = nodes[index];
				if (node.dataset.dshDevAskHidden !== undefined) continue;
				if (node.childElementCount !== 0) continue;
				if (node.closest("[data-question-scroll]") !== null) continue;
				if (!PAYLOAD_START.test(node.textContent || "")) continue;
				hide(node);
			}
		}

		function scan() {
			var bodies = document.querySelectorAll("[data-question-scroll]");
			for (var index = 0; index < bodies.length; index += 1) enhance(bodies[index]);
			hideTranscriptPayload();
		}

		function apply(ctx) {
			installStyle();
			var observer = new MutationObserver(scan);
			observer.observe(document.body, { childList: true, subtree: true });
			scan();
			ctx.effect(function () {
				return function () {
					observer.disconnect();
				};
			}, "dev-workflow: question preview panel");
		}

		exports.apply = apply;
		return module.exports;
	},
});
