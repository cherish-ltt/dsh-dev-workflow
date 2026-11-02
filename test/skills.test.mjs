import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import CommandRuntime from "@deepseek-ai/dsh-commands";
import { createScope } from "@deepseek-ai/dsh-scope";
import SkillRegistry, { renderSkillContent } from "@deepseek-ai/dsh-skill";
import * as filesystemSkills from "@deepseek-ai/dsh-skill-filesystem";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import * as workflow from "../lib/index.js";
import { loadPromptCheck, registerBundledSkills } from "../lib/skills.js";

const names = ["issue-to-pr", "project-audit-review", "prompt-check"];
const directory = fileURLToPath(new URL("../skills/", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "dsh-dev-workflow-skills-"));
const root = new Context();

try {
	await root.plugin(SkillRegistry);
	const bundled = registerBundledSkills(root);
	await bundled;
	const catalog = await root.skills.list();
	assert.deepEqual(catalog.map((skill) => skill.name), names);
	for (const name of names) {
		const path = join(directory, name, "SKILL.md");
		const raw = await readFile(path, "utf8");
		const parsed = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(raw);
		assert.ok(parsed, `${name}: frontmatter is present`);
		const skill = await root.skills.get(name);
		assert.ok(skill, `${name}: body is loadable`);
		assert.equal(skill.name, /^name: (.+)$/mu.exec(parsed[1])?.[1]);
		assert.equal(skill.description, /^description: (.+)$/mu.exec(parsed[1])?.[1]);
		assert.equal(skill.content, parsed[2].trim());
		assert.equal(skill.source, "bundled");
		assert.equal(skill.provider, "dev-workflow");
		assert.equal(skill.metadata, undefined);
		assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true });
		assert.deepEqual(skill.resourceBase, { kind: "directory", path: join(directory, name) });
		assert.equal(await readFile(skill.path, "utf8"), raw);
		assert.equal(catalog.find((entry) => entry.name === name).path, skill.path);
		assert.ok(renderSkillContent(skill).includes(skill.content));
	}
	console.log("PASS bundled skills expose all three complete bodies and metadata");

	const project = join(temporary, "project");
	const userHome = join(temporary, "user");
	const userPath = join(userHome, "skills", "prompt-check", "SKILL.md");
	await mkdir(join(project, ".git"), { recursive: true });
	await mkdir(join(userHome, "skills", "prompt-check"), { recursive: true });
	const frontmatter = "---\nname: prompt-check\ndescription: Fixture prompt check\nmetadata:\n  owner: fixture\n---\n";
	await writeFile(userPath, `${frontmatter}User instructions, first revision.\n`);
	const localConfig = {
		providerName: "test-local-skills",
		dshHome: join(temporary, "dsh-home"),
		agentsHome: userHome,
		bundledSkillDir: join(temporary, "unused-bundled"),
		watch: false,
	};
	const local = root.plugin(filesystemSkills, localConfig);
	await local;
	const lookup = { cwd: project };
	const userSkill = await root.skills.get("prompt-check", lookup);
	assert.equal(userSkill.source, "user-agents");
	assert.equal(userSkill.provider, "test-local-skills");
	assert.equal(userSkill.content, "User instructions, first revision.");
	assert.deepEqual(userSkill.metadata, { owner: "fixture" });
	await writeFile(userPath, `${frontmatter}User instructions, second revision.\n`);
	assert.equal((await root.skills.get("prompt-check", lookup)).content, "User instructions, second revision.");
	console.log("PASS user skills outrank bundled skills and body edits load without restart");

	await local.dispose();
	const projectSkillDirectory = join(project, ".agents", "skills", "prompt-check");
	await mkdir(projectSkillDirectory, { recursive: true });
	await writeFile(join(projectSkillDirectory, "SKILL.md"), `${frontmatter}Project instructions.\n`);
	const projectLocal = root.plugin(filesystemSkills, localConfig);
	await projectLocal;
	const projectSkill = await root.skills.get("prompt-check", lookup);
	assert.equal(projectSkill.source, "project-agents");
	assert.equal(projectSkill.provider, "test-local-skills");
	assert.equal(projectSkill.content, "Project instructions.");
	const agent = { session: { header: { cwd: project }, meta: {} } };
	assert.deepEqual(await loadPromptCheck(root, agent), { instruction: renderSkillContent(projectSkill) });
	console.log("PASS project skills outrank user and bundled skills for command lookups");

	let scope;
	const scopedPlugin = root.plugin({
		inject: ["skills"],
		apply(ctx) { scope = createScope(ctx, agent); },
	});
	await scopedPlugin;
	const scopedDefinition = {
		name: "prompt-check",
		description: "Scoped instructions",
		source: "runtime",
		content: "Instructions visible only to the selected agent.",
	};
	const unregister = scope.ctx.skills.register(scopedDefinition);
	const scopedSkill = await root.skills.get("prompt-check", { ...lookup, scope: agent });
	assert.equal(scopedSkill.content, scopedDefinition.content);
	assert.equal((await root.skills.get("prompt-check", lookup)).content, "Project instructions.");
	assert.deepEqual(await loadPromptCheck(root, agent), { instruction: renderSkillContent(scopedSkill) });
	const otherAgent = { session: { header: { cwd: project }, meta: {} } };
	assert.deepEqual(await loadPromptCheck(root, otherAgent), { instruction: renderSkillContent(projectSkill) });
	unregister();
	scope.ctx.skills.register({
		...scopedDefinition,
		invocation: { modelInvocable: false, userInvocable: true },
	});
	const unavailable = await loadPromptCheck(root, agent);
	assert.equal(unavailable.instruction, undefined);
	assert.match(unavailable.warning, /prompt-check.*禁止模型调用/u);
	await scope.dispose();
	await scopedPlugin.dispose();
	assert.deepEqual(await loadPromptCheck(root, agent), { instruction: renderSkillContent(projectSkill) });
	console.log("PASS command loading honors agent scope and disabled model invocation");

	await projectLocal.dispose();
	assert.equal((await root.skills.get("prompt-check", lookup)).provider, "dev-workflow");
	await bundled.dispose();
	assert.deepEqual(await root.skills.list(lookup), []);
	assert.equal(await root.skills.get("prompt-check", lookup), undefined);
	const missing = await loadPromptCheck(root, agent);
	assert.equal(missing.instruction, undefined);
	assert.match(missing.warning, /未找到 prompt-check/u);
	const remounted = registerBundledSkills(root);
	await remounted;
	assert.deepEqual((await root.skills.list(lookup)).map((skill) => skill.name), names);
	assert.equal((await root.skills.get("prompt-check", lookup)).provider, "dev-workflow");
	await remounted.dispose();
	assert.deepEqual(await root.skills.list(lookup), []);
	console.log("PASS provider disposal removes skills and remount registers them again");

	await root.plugin(SystemPrompt);
	await root.plugin(CommandRuntime);
	await root.plugin(ToolRuntime);
	const entry = root.plugin(workflow);
	await entry;
	assert.deepEqual((await root.skills.list()).map((skill) => skill.name), names);
	assert.deepEqual(root.commands.list(agent).map((command) => command.name), [
		"dev-feat", "dev-fix", "dev-pre-check", "dev-refactor", "dev-test",
	]);
	assert.ok(root.tools.get("dev_ask"));
	const entrySkill = await root.skills.get("prompt-check");
	assert.deepEqual(await loadPromptCheck(entry.ctx, agent), { instruction: renderSkillContent(entrySkill) });
	await entry.dispose();
	assert.deepEqual(await root.skills.list(), []);
	assert.deepEqual(root.commands.list(agent), []);
	assert.equal(root.tools.get("dev_ask"), undefined);
	const reloadedEntry = root.plugin(workflow);
	await reloadedEntry;
	assert.equal((await root.skills.list()).length, 3);
	assert.equal(root.commands.list(agent).length, 5);
	await reloadedEntry.dispose();
	console.log("PASS real plugin entry mounts its skill child and permits optional registry reads");
	console.log("\nALL PASS");
} finally {
	try {
		await root.fiber.dispose();
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
