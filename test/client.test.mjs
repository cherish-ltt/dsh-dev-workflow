import { readFileSync } from "node:fs";

function matches(el, sel) {
	if (sel === "*") return true;
	const withTag = /^([a-zA-Z][a-zA-Z0-9]*)?\[([a-zA-Z-]+)(?:\*?="([^"]*)")?\]$/.exec(sel);
	if (withTag !== null) {
		if (withTag[1] !== undefined && el.tagName.toLowerCase() !== withTag[1].toLowerCase()) return false;
		const value = el.attrs[withTag[2]];
		if (value === undefined) return false;
		if (withTag[3] === undefined) return true;
		return sel.includes("*=") ? value.includes(withTag[3]) : value === withTag[3];
	}
	const withClass = /^([a-zA-Z][a-zA-Z0-9]*)?\[class\*="([^"]*)"\]$/.exec(sel);
	if (withClass !== null) {
		const value = el.attrs.class ?? "";
		return value.includes(withClass[2]);
	}
	return el.tagName.toLowerCase() === sel.toLowerCase();
}

function matchList(el, selector) {
	return selector.split(",").some((part) => matches(el, part.trim()));
}

class Node {
	constructor(nodeType, tagName) {
		this.nodeType = nodeType;
		this.tagName = tagName;
		this.childNodes = [];
		this.parentElement = null;
		this.attrs = {};
		this.style = {};
		this.listeners = new Map();
		const attrs = this.attrs;
		const dataset = new Proxy(
			{},
			{
				get: (target, key) => {
					if (typeof key !== "string") return undefined;
					return attrs["data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())];
				},
				set: (target, key, value) => {
					attrs["data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())] = value;
					return true;
				},
				has: (target, key) => typeof key === "string" && attrs["data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())] !== undefined,
				deleteProperty: (target, key) => {
					delete attrs["data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())];
					return true;
				},
			},
		);
		Object.defineProperty(this, "dataset", { get: () => dataset });
	}
	append(...nodes) {
		for (const node of nodes) {
			node.parentElement = this;
			this.childNodes.push(node);
		}
	}
	replaceChildren(...nodes) {
		this.childNodes.forEach((node) => { node.parentElement = null; });
		this.childNodes = [];
		this.append(...nodes);
	}
	addEventListener(type, listener) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	removeEventListener(type, listener) {
		this.listeners.get(type)?.delete(listener);
	}
	fire(type, fields = {}) {
		const event = { type, ...fields, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
		for (const listener of this.listeners.get(type) ?? []) listener(event);
		return event;
	}
	get children() {
		return this.childNodes.filter((node) => node.nodeType === 1);
	}
	get childElementCount() {
		return this.children.length;
	}
	get textContent() {
		if (this.nodeType === 3) return this.value;
		return this.childNodes.map((node) => node.textContent).join("");
	}
	getAttribute(name) {
		return this.attrs[name] ?? null;
	}
	setAttribute(name, value) {
		this.attrs[name] = value;
	}
	closest(selector) {
		let node = this;
		while (node !== null) {
			if (node.nodeType === 1 && matchList(node, selector)) return node;
			node = node.parentElement;
		}
		return null;
	}
	querySelectorAll(selector) {
		const found = [];
		const walk = (node) => {
			for (const child of node.children) {
				if (matchList(child, selector)) found.push(child);
				walk(child);
			}
		};
		walk(this);
		return found;
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
}

function text(value) {
	return Object.assign(new Node(3, "#text"), { value });
}

function el(tagName, attrs = {}, ...children) {
	const node = new Node(1, tagName);
	Object.assign(node.attrs, attrs);
	const cls = attrs.class;
	if (cls !== undefined) node.attrs.class = cls;
	for (const child of children) {
		if (typeof child === "string") node.append(text(child));
		else node.append(child);
	}
	return node;
}

function detailNode(paragraphs) {
	const root = el("div", { class: "Mbwy4a_detail" });
	const inner = el("div");
	inner.append(el("p", {}, el("code", {}, "dsh-dev-ask-preview-v1")));
	paragraphs.forEach((body, index) => {
		inner.append(el("h4", {}, el("code", {}, `dsh-dev-ask-option-${index + 1}`)));
		inner.append(el("p", {}, body));
	});
	root.append(inner);
	return root;
}

function renderedNode(value) {
	if (typeof value === "string") return text(value);
	const [tagName, ...children] = value;
	return el(tagName, {}, ...children.map(renderedNode));
}

function cardBody(previews, checked = -1, labels = ["甲", "乙"], multiSelect = false) {
	const detail = previews === null ? el("div", { class: "Mbwy4a_detail" }, el("p", {}, "普通说明")) : detailNode(previews);
	const options = el("div", { role: multiSelect ? "group" : "radiogroup", class: "Mbwy4a_options" });
	labels.forEach((label, index) => {
		options.append(
			el(
				"button",
				{ role: multiSelect ? "checkbox" : "radio", "aria-checked": (Array.isArray(checked) ? checked.includes(index) : index === checked) ? "true" : "false", "aria-label": label },
				el("span", { class: "Mbwy4a_optionLabel" }, label),
			),
		);
	});
	return el("div", { "data-question-scroll": "", class: "Mbwy4a_body" }, detail, options);
}

globalThis.Element = Node;
const observers = [];
globalThis.MutationObserver = class {
	constructor(callback) {
		this.callback = () => { if (this.active) callback(); };
		observers.push(this);
	}
	observe(_target, options) { this.active = true; this.options = options; }
	disconnect() { this.active = false; }
};
const resizeObservers = [];
globalThis.ResizeObserver = class {
	constructor(callback) {
		this.callback = () => { if (this.active) callback(); };
		resizeObservers.push(this);
	}
	observe() { this.active = true; }
	disconnect() { this.active = false; }
};

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let spec;
globalThis.window = { __ModuleLoader__: { load: (value) => { spec = value; } } };

const bodies = [];
const transcripts = [];
const styleTags = [];
globalThis.document = {
	head: { appendChild: (tag) => styleTags.push(tag) },
	createElement: (tagName) => el(tagName),
	querySelector: (selector) => styleTags.find((tag) => matchList(tag, selector)) ?? null,
	querySelectorAll: (selector) => (selector === "[data-question-scroll]" ? bodies.filter((body) => matchList(body, selector)) : transcripts.filter((node) => matchList(node, selector))),
	body: el("body"),
};

new Function("window", "document", source)(globalThis.window, globalThis.document);
const client = spec.factory();

let failures = 0;
function check(name, condition, extra = "") {
	if (condition) console.log(`PASS ${name}`);
	else {
		failures += 1;
		console.log(`FAIL ${name} ${extra}`);
	}
}

const disposers = [];
const ctx = { effect: (create) => disposers.push(create()) };
client.apply(ctx);

// 1. 有载荷：两列布局生效，未选中时默认展示第 1 项
const body = cardBody([["结构甲"], ["结构乙"]], -1);
bodies.push(body);
observers[0].callback();
const detail = body.children[0];
const options = body.children[1];
check("载荷卡片进入两列布局", body.dataset.dshDevAskPanel === "");
check("选项容器被标记", options.dataset.dshDevAskOptions === "");
check("detail 成为预览列", detail.dataset.dshDevAskPreview === "");
const h4s = detail.querySelectorAll("h4");
check("标题被隐藏", h4s.every((node) => node.style.display === "none"));
const paragraphs = detail.querySelectorAll("p").slice(1);
check("默认展示第 1 项预览", paragraphs[0].style.display === "" && paragraphs[1].style.display === "none", JSON.stringify(paragraphs.map((p) => p.style.display)));

// 2. 选中变化后切换（驱动 MutationObserver 回调）
options.querySelectorAll('[role="radio"]')[1].setAttribute("aria-checked", "true");
observers.forEach((observer) => observer.callback());
check("选中第 2 项后切换预览", paragraphs[0].style.display === "none" && paragraphs[1].style.display === "", JSON.stringify(paragraphs.map((p) => p.style.display)));

// 2b. 只有部分选项带预览：无预览项隐藏右列
const partial = cardBody([["仅甲"]], -1, ["甲", "乙"]);
bodies.push(partial);
observers[0].callback();
const partialDetail = partial.children[0];
const partialRadios = partial.children[1].querySelectorAll('[role="radio"]');
check("带预览项显示右列", partial.dataset.dshDevAskEmpty === undefined);
partialRadios[1].setAttribute("aria-checked", "true");
observers.forEach((observer) => observer.callback());
check("无预览项收起右列", partial.dataset.dshDevAskEmpty === "" && partialDetail.style.display === "none");

// 3. 无载荷：保持默认，不接管
const plain = cardBody(null);
bodies.push(plain);
observers[0].callback();
check("无载荷卡片不被接管", plain.dataset.dshDevAskPanel === undefined);
check("无载荷卡片无预览列", plain.querySelector("[data-dsh-dev-ask-preview]") === null);

const report = cardBody(null);
report.children[0].childNodes = [el("div", {}, el("p", {}, "报告范围"), el("h4", {}, "选项 1"), el("p", {}, "正文甲"), el("h4", {}, "选项 2"), el("p", {}, "正文乙"))];
report.children[0].childNodes[0].parentElement = report.children[0];
bodies.push(report);
const headingReport = cardBody(null);
headingReport.children[0].childNodes = [el("div", {}, el("h4", {}, "选项 1"), el("p", {}, "完整报告"))];
headingReport.children[0].childNodes[0].parentElement = headingReport.children[0];
bodies.push(headingReport);
const ordinaryHistory = el("div", { class: "detail" }, "#### 选项 1\n\n完整报告\n\n#### 选项 2\n\n正文");
const previewHistory = el("div", { class: "detail" }, "`dsh-dev-ask-preview-v1`\n\n#### `dsh-dev-ask-option-1`\n\n预览");
transcripts.push(ordinaryHistory, previewHistory);
observers[0].callback();
check("含选项标题的普通报告不被接管", report.dataset.dshDevAskPanel === undefined && report.querySelectorAll("*").every((node) => node.style.display !== "none"));
check("从选项标题开始的报告保持完整", headingReport.dataset.dshDevAskPanel === undefined && headingReport.querySelectorAll("*").every((node) => node.style.display !== "none"));
check("普通历史详情不被隐藏", ordinaryHistory.style.display !== "none");
check("专属预览历史载荷被隐藏", previewHistory.style.display === "none");

const reusedHistory = el("span", { class: "detail" }, previewHistory.textContent);
reusedHistory.style.display = "inline";
transcripts.push(reusedHistory);
observers[0].callback();
check("历史节点复用前隐藏专属载荷", reusedHistory.style.display === "none");
reusedHistory.childNodes[0].value = "复用后的普通完整报告";
observers.filter((observer) => observer.options.characterData).forEach((observer) => observer.callback());
check("历史节点原地更新为普通正文后恢复显示", reusedHistory.style.display === "inline" && reusedHistory.dataset.dshDevAskHidden === undefined && reusedHistory.textContent === "复用后的普通完整报告");

const collision = cardBody(["预览甲", "预览乙"]);
const collisionRoot = collision.children[0].children[0];
collisionRoot.childNodes.splice(3, 0, el("h4", {}, "选项 2"), el("p", {}, "甲中的合法选项标题正文"));
collisionRoot.childNodes.forEach((node) => { node.parentElement = collisionRoot; });
bodies.push(collision);
observers[0].callback();
check("预览内部同名选项标题保留", collisionRoot.children[3].style.display === "" && collisionRoot.children[4].style.display === "");

const multi = cardBody(["预览甲", "预览乙", "预览丙"], [0, 1], ["甲", "乙", "丙"], true);
multi.clientWidth = 500;
bodies.push(multi);
observers[0].callback();
const multiOptions = multi.children[1];
const checkboxes = multiOptions.querySelectorAll('[role="checkbox"]');
const multiParagraphs = multi.children[0].querySelectorAll("p").slice(1);
const checkedState = () => checkboxes.map((button) => button.getAttribute("aria-checked")).join(",");
checkboxes[1].fire("focus");
observers.forEach((observer) => observer.callback());
check("多选后焦点预览不锁定首个勾选项", multiParagraphs[1].style.display === "" && multiParagraphs[0].style.display === "none" && checkedState() === "true,true,false");
checkboxes[2].fire("pointerenter");
check("浏览未选项不改变勾选集合", multiParagraphs[2].style.display === "" && checkedState() === "true,true,false");
checkboxes[1].setAttribute("aria-checked", "false");
checkboxes[1].fire("click");
observers.forEach((observer) => observer.callback());
check("取消勾选后仍可查看该项", multiParagraphs[1].style.display === "" && multiParagraphs[0].style.display === "none" && checkedState() === "true,false,false");
check("窄窗口仍保留多选与预览", multi.dataset.dshDevAskNarrow === "" && multi.children[0].dataset.dshDevAskPreview === "");
multi.clientWidth = 900;
resizeObservers.forEach((observer) => observer.callback());
check("扩宽窗口恢复分栏标记", multi.dataset.dshDevAskNarrow === undefined);
let submitted = 0;
checkboxes[1].addEventListener("keydown", (event) => { if (event.key === "Enter") submitted += 1; });
const enter = checkboxes[1].fire("keydown", { key: "Enter" });
check("预览增强不抢占宿主提交键", submitted === 1 && !enter.defaultPrevented && checkedState() === "true,false,false");

const multiPartial = cardBody(["只有甲有预览"], [0], ["甲", "乙"], true);
bodies.push(multiPartial);
observers[0].callback();
const partialCheckboxes = multiPartial.children[1].querySelectorAll('[role="checkbox"]');
partialCheckboxes[1].fire("focus");
check("浏览无预览多选项收起右列", multiPartial.children[0].style.display === "none" && multiPartial.dataset.dshDevAskEmpty === "" && partialCheckboxes[0].getAttribute("aria-checked") === "true");
const partialBoundary = multiPartial.children[0].querySelector("h4").querySelector("code");
partialBoundary.childNodes[0].value = "dsh-dev-ask-option-2";
observers.filter((observer) => observer.options.characterData).forEach((observer) => observer.callback());
partialCheckboxes[1].fire("focus");
check("复用预览标题时重新绑定实际选项", multiPartial.children[0].style.display === "" && multiPartial.children[0].querySelectorAll("p")[1].style.display === "" && partialCheckboxes[0].getAttribute("aria-checked") === "true");

const replacement = cardBody(["新预览甲", "新预览乙"], [1], ["新甲", "新乙"], true);
multi.replaceChildren(...replacement.childNodes);
observers.forEach((observer) => observer.callback());
const replacedParagraphs = multi.children[0].querySelectorAll("p").slice(1);
check("切题复用卡片后初始化新预览", replacedParagraphs[0].style.display === "none" && replacedParagraphs[1].style.display === "");
multi.children[1].querySelectorAll('[role="checkbox"]')[0].fire("focus");
check("切题后新按钮可独立浏览", replacedParagraphs[0].style.display === "" && replacedParagraphs[1].style.display === "none");
const refreshed = detailNode(["重绘甲", "重绘乙"]);
multi.children[0].replaceChildren(...refreshed.childNodes);
observers.forEach((observer) => observer.callback());
const refreshedParagraphs = multi.children[0].querySelectorAll("p").slice(1);
check("原详情节点重绘后重建预览分组", refreshedParagraphs[0].style.display === "none" && refreshedParagraphs[1].style.display === "");
multi.children[1].querySelectorAll('[role="checkbox"]')[0].fire("pointerenter");
check("重绘后预览操作作用于当前正文", refreshedParagraphs[0].style.display === "" && refreshedParagraphs[1].style.display === "none");
multi.children[0].replaceChildren(el("div", {}, el("h4", {}, "选项 1"), el("p", {}, "切题后的普通报告")));
observers.forEach((observer) => observer.callback());
check("复用卡片显示普通报告时移除增强", multi.dataset.dshDevAskPanel === undefined && multi.querySelectorAll("*").every((node) => node.style.display !== "none"));

// 4. 幂等：重复扫描不叠加
const previewsBefore = body.querySelectorAll("[data-dsh-dev-ask-preview]").length;
observers[0].callback();
check("重复扫描幂等", body.querySelectorAll("[data-dsh-dev-ask-preview]").length === previewsBefore);

// 5. 样式只注入一次
check("样式只注入一次", styleTags.length === 1, String(styleTags.length));

const previewFixture = JSON.parse(readFileSync(new URL("./fixtures/dsh-preview-0.2.1-rc.5.json", import.meta.url), "utf8"));
const renderedBody = cardBody(null, [0, 1], previewFixture.question.options.map((option) => option.label), true);
const renderedDetail = renderedBody.children[0];
renderedDetail.replaceChildren(el("div", {}, ...previewFixture.rendered.map(renderedNode)));
bodies.push(renderedBody);
observers[0].callback();
const renderedParagraphs = renderedDetail.querySelectorAll("p").slice(1);
const renderedHeadings = renderedDetail.querySelectorAll("h4");
const renderedButtons = renderedBody.children[1].querySelectorAll('[role="checkbox"]');
check("官方渲染结果的行内代码标识可识别", renderedBody.dataset.dshDevAskPanel === "" && renderedParagraphs[0].style.display === "" && renderedParagraphs[1].style.display === "none");
check("官方渲染结果中同名普通标题保持可见", renderedHeadings[0].style.display === "none" && renderedHeadings[1].textContent === "选项 2" && renderedHeadings[1].style.display === "");
renderedButtons[1].fire("focus");
check("官方渲染结果可逐项浏览且不改变多选", renderedParagraphs[0].style.display === "none" && renderedParagraphs[1].style.display === "" && renderedButtons.map((button) => button.getAttribute("aria-checked")).join(",") === "true,true,false");
renderedButtons[2].fire("pointerenter");
check("官方渲染结果无预览选项收起右栏", renderedDetail.style.display === "none");
const legacyBody = cardBody(null);
legacyBody.children[0].replaceChildren(el("div", {}, ...previewFixture.legacy.rendered.map(renderedNode)));
bodies.push(legacyBody);
observers[0].callback();
check("官方渲染移除锚点后的普通文字不被猜测接管", legacyBody.dataset.dshDevAskPanel === undefined && legacyBody.querySelectorAll("*").every((node) => node.style.display !== "none"));

const removedBody = cardBody(["仅甲有预览"], -1, ["甲", "乙"], true);
const removedDetail = removedBody.children[0];
const removedButtons = removedBody.children[1].querySelectorAll('[role="checkbox"]');
let hostClicks = 0;
removedButtons[0].addEventListener("click", () => { hostClicks += 1; });
const removedSelectionIndex = observers.length;
const removedResizeIndex = resizeObservers.length;
bodies.push(removedBody);
observers[0].callback();
removedButtons[1].fire("focus");
check("移除前无预览选项收起正文", removedDetail.style.display === "none");
bodies.splice(bodies.indexOf(removedBody), 1);
observers[0].callback();
check("移除卡片后释放每卡观察器", !observers[removedSelectionIndex].active && !resizeObservers[removedResizeIndex].active);
check("移除卡片后恢复布局和正文", removedBody.dataset.dshDevAskPanel === undefined && removedDetail.dataset.dshDevAskPreview === undefined && removedBody.querySelectorAll("*").every((node) => node.dataset.dshDevAskHidden === undefined && node.style.display !== "none"));
removedButtons[0].fire("click");
removedButtons[1].fire("focus");
check("移除卡片后仅保留宿主监听器", hostClicks === 1 && removedButtons.every((button) => ["pointerenter", "focus", "click"].every((type) => (button.listeners.get(type)?.size ?? 0) === (button === removedButtons[0] && type === "click" ? 1 : 0))) && removedDetail.style.display !== "none");

bodies.push(removedBody);
observers[0].callback();
removedButtons[1].fire("focus");
check("重新挂载卡片后恢复预览交互", removedBody.dataset.dshDevAskPanel === "" && removedDetail.style.display === "none");
disposers.forEach((dispose) => dispose());
check("插件卸载后断开全部观察器", observers.every((observer) => !observer.active) && resizeObservers.every((observer) => !observer.active));
check("插件卸载后恢复全部卡片和历史正文", bodies.every((node) => node.dataset.dshDevAskPanel === undefined && node.querySelectorAll("*").every((child) => child.dataset.dshDevAskHidden === undefined && child.style.display !== "none")) && previewHistory.dataset.dshDevAskHidden === undefined && previewHistory.style.display !== "none");
removedDetail.replaceChildren(el("p", {}, "切题后的普通完整报告"));
removedButtons[0].fire("click");
removedButtons[1].fire("focus");
observers.forEach((observer) => observer.callback());
resizeObservers.forEach((observer) => observer.callback());
check("卸载后复用节点的普通报告保持可见", removedDetail.textContent === "切题后的普通完整报告" && removedDetail.style.display !== "none" && removedBody.dataset.dshDevAskPanel === undefined && hostClicks === 2);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
