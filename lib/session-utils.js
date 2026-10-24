/**
 * 项目探测：从 pi-dev-workflow 的 extensions/session-utils.ts 移植。
 * 只做只读探测，用于拼装默认验收标准。
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".pi-dev-output"]);

function safeReaddir(dir) {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function scanExtensions(cwd, depth) {
	const found = new Set();

	const walk = (dir, d) => {
		if (d > depth) return;
		for (const entry of safeReaddir(dir)) {
			if (SKIP_DIRS.has(entry)) continue;
			const full = join(dir, entry);
			if (isDirectory(full)) {
				walk(full, d + 1);
				continue;
			}
			const match = /\.([a-z0-9]+)$/i.exec(entry);
			if (match) found.add(match[1].toLowerCase());
		}
	};

	walk(cwd, 1);
	return found;
}

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

export function detectProjectDefaults(cwd) {
	const defaults = {
		language: "",
		testCmd: "",
		lintCmd: "",
		packageManager: "",
		hasPreCommit: false,
		hasCI: false,
	};

	const pkg = readJson(join(cwd, "package.json"));
	if (pkg) {
		const scripts = pkg.scripts ?? {};
		const testScript = typeof scripts.test === "string" ? scripts.test : "";
		if (testScript && !/no test specified/.test(testScript)) defaults.testCmd = "npm test";
		defaults.lintCmd = scripts.lint ?? scripts["lint:fix"] ?? scripts.format ?? "";
		const pm = typeof pkg.packageManager === "string" ? pkg.packageManager : "";
		if (/pnpm/.test(pm)) defaults.packageManager = "pnpm";
		else if (/yarn/.test(pm)) defaults.packageManager = "yarn";
		else defaults.packageManager = "npm";

		const meta = [
			pkg.name ?? "",
			Object.keys(pkg.dependencies ?? {}),
			Object.keys(pkg.devDependencies ?? {}),
		]
			.flat()
			.join(" ")
			.toLowerCase();

		const hasTsconfig = existsSync(join(cwd, "tsconfig.json"));
		if (hasTsconfig || /typescript|tsx/.test(meta)) defaults.language = "TypeScript";
		else if (/javascript|next|react|vue|node|nest/.test(meta)) defaults.language = "JavaScript";
	}

	if (existsSync(join(cwd, "Cargo.toml"))) {
		defaults.language = "Rust";
		defaults.testCmd = "cargo test";
	} else if (existsSync(join(cwd, "go.mod"))) {
		defaults.language = "Go";
		defaults.testCmd = "go test ./...";
	} else if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
		defaults.language = "Python";
		defaults.testCmd = "pytest";
	} else if (existsSync(join(cwd, "pom.xml")) || existsSync(join(cwd, "build.gradle"))) {
		defaults.language = "Java";
		defaults.testCmd = existsSync(join(cwd, "pom.xml")) ? "mvn test" : "./gradlew test";
	} else if (safeReaddir(cwd).some((file) => file.endsWith(".csproj"))) {
		defaults.language = "C#";
		defaults.testCmd = "dotnet test";
	}

	if (!defaults.language) {
		const exts = scanExtensions(cwd, 2);
		if (exts.has("rs")) defaults.language = "Rust";
		else if (exts.has("go")) defaults.language = "Go";
		else if (exts.has("py")) defaults.language = "Python";
		else if (exts.has("ts") || exts.has("tsx")) defaults.language = "TypeScript";
		else if (exts.has("js") || exts.has("mjs") || exts.has("cjs") || exts.has("jsx")) defaults.language = "JavaScript";
	}

	defaults.hasPreCommit =
		existsSync(join(cwd, ".pre-commit-config.yaml")) || existsSync(join(cwd, ".pre-commit-config.yml"));
	defaults.hasCI = safeReaddir(join(cwd, ".github", "workflows")).some((file) => /\.ya?ml$/.test(file));

	return defaults;
}

export function defaultAcceptanceItems(d) {
	const items = [];

	if (d.testCmd) items.push(`运行 ${d.testCmd} 确认全部测试通过、无回归`);
	else items.push(`按 ${d.language || "项目"} 的常规测试方式编写并运行测试，确认核心逻辑正确、无回归`);

	if (d.lintCmd) items.push(`运行 ${d.lintCmd} 符合代码规范`);
	if (d.hasPreCommit) items.push("通过本地 pre-commit 钩子检查");
	if (d.hasCI) items.push("通过 CI 检查");

	return items;
}
