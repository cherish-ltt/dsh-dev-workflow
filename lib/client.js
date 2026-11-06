window.__ModuleLoader__.load({
	id: "@ghyper9023/dsh-dev-workflow",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;

		var STYLE_ID = "@ghyper9023/dsh-dev-workflow/client.css";
		var PAYLOAD_MARKER = "dsh-dev-ask-preview-v1";
		var PAYLOAD_START = "`" + PAYLOAD_MARKER + "`\n\n";
		var panels = new Map();
		var hiddenTranscripts = new Map();

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
			if (node.nodeType !== 1 || !/^h[1-6]$/i.test(node.tagName)) return undefined;
			if (node.childElementCount !== 1) return undefined;
			var code = node.children[0];
			if (code.tagName.toLowerCase() !== "code" || node.textContent !== code.textContent) return undefined;
			var match = /^dsh-dev-ask-option-(\d+)$/.exec(code.textContent);
			return match === null ? undefined : Number(match[1]) - 1;
		}

		function markerOf(node) {
			var codes = node.querySelectorAll("code");
			for (var index = 0; index < codes.length; index += 1) {
				var code = codes[index];
				var block = code.parentElement;
				if (code.textContent !== PAYLOAD_MARKER || block === null || block.tagName.toLowerCase() !== "p") continue;
				if (block.childElementCount !== 1 || block.textContent !== PAYLOAD_MARKER) continue;
				if (block.parentElement !== null && block.parentElement.children[0] === block) return code;
			}
			return null;
		}

		function optionsOf(body) {
			var children = Array.prototype.slice.call(body.children);
			for (var index = 0; index < children.length; index += 1) {
				var role = children[index].getAttribute("role");
				if (role === "radiogroup" || role === "group") return children[index];
			}
			return undefined;
		}

		function enhance(body) {
			var options = optionsOf(body);
			var buttons = options === undefined ? [] : Array.prototype.slice.call(options.querySelectorAll('[role="radio"],[role="checkbox"]'));
			var previous = panels.get(body);
			if (previous !== undefined) {
				if (previous.options === options && previous.role === options.getAttribute("role") &&
					previous.detail.parentElement === body &&
					markerOf(body) === previous.marker &&
					previous.content.length === previous.host.childNodes.length &&
					previous.content.every(function (node, at) { return node === previous.host.childNodes[at]; }) &&
					previous.boundaries.every(function (node, at) { return boundaryIndex(node) === previous.positions[at]; }) &&
					previous.buttons.length === buttons.length &&
					previous.buttons.every(function (button, at) { return button === buttons[at]; })) return;
				previous.cleanup();
				panels.delete(body);
			}
			if (options === undefined) return;
			var children = Array.prototype.slice.call(body.children);
			var detail;
			var marker;
			for (var index = 0; index < children.length; index += 1) {
				if (children[index] === options) continue;
				if (children[index].querySelector("[data-dsh-dev-ask-preview]") !== null) continue;
				marker = markerOf(children[index]);
				if (marker === null) continue;
				detail = children[index];
				break;
			}
			if (detail === undefined) return;

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
			if (host === null || marker.parentElement.parentElement !== host) return;
			if (!boundaries.every(function (node) { return node.parentElement === host; })) return;

			var content = Array.prototype.slice.call(host.childNodes);
			content.forEach(function (node) {
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
				if (options.getAttribute("role") === "group" && shown !== undefined) return;
				for (var at = 0; at < buttons.length; at += 1) {
					if (buttons[at].getAttribute("aria-checked") === "true") {
						show(at);
						return;
					}
				}
			}

			sync();
			if (shown === undefined) show(0);

			var listeners = buttons.map(function (button, at) {
				function browse() { show(at); }
				button.addEventListener("pointerenter", browse);
				button.addEventListener("focus", browse);
				button.addEventListener("click", browse);
				return browse;
			});

			var selectionObserver = new MutationObserver(sync);
			selectionObserver.observe(options, {
				subtree: true,
				attributes: true,
				attributeFilter: ["aria-checked"],
			});

			function resize() {
				if (body.clientWidth < 720) body.dataset.dshDevAskNarrow = "";
				else delete body.dataset.dshDevAskNarrow;
			}
			resize();
			var resizeObserver = new ResizeObserver(resize);
			resizeObserver.observe(body);
			panels.set(body, {
				options: options,
				role: options.getAttribute("role"),
				buttons: buttons,
				detail: detail,
				marker: marker,
				host: host,
				content: content,
				boundaries: boundaries,
				positions: boundaries.map(boundaryIndex),
				cleanup: function () {
					selectionObserver.disconnect();
					resizeObserver.disconnect();
					buttons.forEach(function (button, at) {
						button.removeEventListener("pointerenter", listeners[at]);
						button.removeEventListener("focus", listeners[at]);
						button.removeEventListener("click", listeners[at]);
					});
					content.forEach(function (node) {
						if (node.nodeType !== 1) return;
						delete node.dataset.dshDevAskHidden;
						node.style.display = "";
					});
					delete body.dataset.dshDevAskPanel;
					delete body.dataset.dshDevAskEmpty;
					delete body.dataset.dshDevAskNarrow;
					delete options.dataset.dshDevAskOptions;
					delete detail.dataset.dshDevAskPreview;
					detail.style.display = "";
				},
			});
		}

		function hideTranscriptPayload() {
			var nodes = Array.from(document.querySelectorAll('[class*="detail"]')).filter(function (node) {
				return node.childElementCount === 0 &&
					node.closest("[data-question-scroll]") === null &&
					(node.textContent || "").startsWith(PAYLOAD_START);
			});
			var current = new Set(nodes);
			hiddenTranscripts.forEach(function (display, node) {
				if (current.has(node)) return;
				delete node.dataset.dshDevAskHidden;
				node.style.display = display;
				hiddenTranscripts.delete(node);
			});
			for (var index = 0; index < nodes.length; index += 1) {
				var node = nodes[index];
				if (node.dataset.dshDevAskHidden !== undefined) continue;
				hiddenTranscripts.set(node, node.style.display);
				hide(node);
			}
		}

		function scan() {
			var bodies = document.querySelectorAll("[data-question-scroll]");
			var current = new Set(bodies);
			panels.forEach(function (panel, body) {
				if (current.has(body)) return;
				panel.cleanup();
				panels.delete(body);
			});
			for (var index = 0; index < bodies.length; index += 1) enhance(bodies[index]);
			hideTranscriptPayload();
		}

		function apply(ctx) {
			installStyle();
			var observer = new MutationObserver(scan);
			observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			scan();
			ctx.effect(function () {
				return function () {
					observer.disconnect();
					panels.forEach(function (panel) { panel.cleanup(); });
					panels.clear();
					hiddenTranscripts.forEach(function (display, node) {
						delete node.dataset.dshDevAskHidden;
						node.style.display = display;
					});
					hiddenTranscripts.clear();
				};
			}, "dev-workflow: question preview panel");
		}

		exports.apply = apply;
		return module.exports;
	},
});
