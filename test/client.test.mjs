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
	paragraphs.forEach((body, index) => {
		inner.append(el("h4", {}, `选项 ${index + 1}`));
		inner.append(el("p", {}, body));
	});
	root.append(inner);
	return root;
}

function cardBody(previews, checked = -1, labels = ["甲", "乙"]) {
	const detail = previews === null ? el("div", { class: "Mbwy4a_detail" }, el("p", {}, "普通说明")) : detailNode(previews);
	const options = el("div", { role: "radiogroup", class: "Mbwy4a_options" });
	labels.forEach((label, index) => {
		options.append(
			el(
				"button",
				{ role: "radio", "aria-checked": index === checked ? "true" : "false", "aria-label": label },
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
		this.callback = callback;
		observers.push(this);
	}
	observe() {}
	disconnect() {}
};
globalThis.ResizeObserver = class {
	observe() {}
};

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let spec;
globalThis.window = { __ModuleLoader__: { load: (value) => { spec = value; } } };

const bodies = [];
const styleTags = [];
globalThis.document = {
	head: { appendChild: (tag) => styleTags.push(tag) },
	createElement: (tagName) => el(tagName),
	querySelector: (selector) => styleTags.find((tag) => matchList(tag, selector)) ?? null,
	querySelectorAll: (selector) => (selector === "[data-question-scroll]" ? bodies.filter((body) => matchList(body, selector)) : []),
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

const ctx = { effect: () => {} };
client.apply(ctx);

// 1. 有载荷：两列布局生效，未选中时默认展示第 1 项
const body = cardBody([["结构甲"], ["结构乙"]], -1);
bodies.push(body);
client.apply(ctx);
const detail = body.children[0];
const options = body.children[1];
check("载荷卡片进入两列布局", body.dataset.dshDevAskPanel === "");
check("选项容器被标记", options.dataset.dshDevAskOptions === "");
check("detail 成为预览列", detail.dataset.dshDevAskPreview === "");
const h4s = detail.querySelectorAll("h4");
check("标题被隐藏", h4s.every((node) => node.style.display === "none"));
const paragraphs = detail.querySelectorAll("p");
check("默认展示第 1 项预览", paragraphs[0].style.display === "" && paragraphs[1].style.display === "none", JSON.stringify(paragraphs.map((p) => p.style.display)));

// 2. 选中变化后切换（驱动 MutationObserver 回调）
options.querySelectorAll('[role="radio"]')[1].setAttribute("aria-checked", "true");
observers.forEach((observer) => observer.callback());
check("选中第 2 项后切换预览", paragraphs[0].style.display === "none" && paragraphs[1].style.display === "", JSON.stringify(paragraphs.map((p) => p.style.display)));

// 2b. 只有部分选项带预览：无预览项隐藏右列
const partial = cardBody([["仅甲"]], -1, ["甲", "乙"]);
bodies.push(partial);
client.apply(ctx);
const partialDetail = partial.children[0];
const partialRadios = partial.children[1].querySelectorAll('[role="radio"]');
check("带预览项显示右列", partial.dataset.dshDevAskEmpty === undefined);
partialRadios[1].setAttribute("aria-checked", "true");
observers.forEach((observer) => observer.callback());
check("无预览项收起右列", partial.dataset.dshDevAskEmpty === "" && partialDetail.style.display === "none");

// 3. 无载荷：保持默认，不接管
const plain = cardBody(null);
bodies.push(plain);
client.apply(ctx);
check("无载荷卡片不被接管", plain.dataset.dshDevAskPanel === undefined);
check("无载荷卡片无预览列", plain.querySelector("[data-dsh-dev-ask-preview]") === null);

// 4. 幂等：重复扫描不叠加
const previewsBefore = body.querySelectorAll("[data-dsh-dev-ask-preview]").length;
client.apply(ctx);
check("重复扫描幂等", body.querySelectorAll("[data-dsh-dev-ask-preview]").length === previewsBefore);

// 5. 样式只注入一次
check("样式只注入一次", styleTags.length === 1, String(styleTags.length));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
