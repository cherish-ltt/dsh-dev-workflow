import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log("PASS", label);
  else {
    failures += 1;
    console.log("FAIL", label, extra);
  }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" }).trim();
}

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;
const releaseDoc = `.version/RELEASE-v${version}.md`;

check(`存在 ${releaseDoc}`, existsSync(new URL(`../${releaseDoc}`, import.meta.url)));

if (!existsSync(new URL(`../${releaseDoc}`, import.meta.url))) {
  console.log(`\n缺少 ${releaseDoc}：先写版本说明，再 bump package.json 的 version`);
  console.log("\n1 FAILED");
  process.exit(1);
}

const docText = readFileSync(new URL(`../${releaseDoc}`, import.meta.url), "utf-8");

// 文档标题需与版本号一致，避免复制上一个版本的说明后忘记改标题
check("文档标题含版本号", docText.split("\n")[0].includes(`v${version}`));

// Commit History 段落里的行首 hash
const listed = docText
  .split("\n")
  .map((line) => line.match(/^[0-9a-f]{7,40}\b/)?.[0])
  .filter(Boolean);

check("Commit History 至少列出一条 commit", listed.length > 0);

const unknown = listed.filter((h) => {
  try {
    git(["rev-parse", "--verify", "--quiet", `${h}^{commit}`]);
    return false;
  } catch {
    return true;
  }
});
check("列出的 commit 都真实存在", unknown.length === 0, unknown.join(", "));

// 浅克隆（fetch-depth: 1）下取不到历史 commit，后续区间计算必然失败，直接给出可执行的提示
if (unknown.length > 0) {
  let shallow = false;
  try {
    shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
  } catch {
    shallow = false;
  }
  console.log(
    shallow
      ? "\n当前是浅克隆，版本说明校验需要完整 git 历史。CI 请在 checkout 步骤设置 fetch-depth: 0。"
      : "\n版本说明列出的 commit 在本地不存在：可能是 hash 写错，或该 commit 尚未拉取。",
  );
  console.log("\n1 FAILED");
  process.exit(1);
}

// 覆盖终点：本版本说明文件最后一次被修改的提交（即「发布提交」）。
// 版本说明不列自己所在提交，因此从区间中排除它；此后为下一个版本做的提交也不计入。
// 文档尚未提交时（本地起草阶段）退回文档中最新的 commit。
let releaseCommit = null;
try {
  releaseCommit = git(["log", "-1", "--format=%H", "--", releaseDoc]).split("\n").filter(Boolean)[0] ?? null;
} catch {
  releaseCommit = null;
}

const tip = releaseCommit ?? listed.reduce((a, b) =>
  Number(git(["rev-list", "--count", a])) >= Number(git(["rev-list", "--count", b])) ? a : b,
);

// 上一版本 tag：本版本之外、已合并到 tip 的最高版本 tag。首个版本没有上一 tag。
const prevTag = git(["tag", "--merged", tip, "--sort=-v:refname"])
  .split("\n")
  .find((tag) => tag && tag !== `v${version}`);

const range = git(["log", "--format=%H", prevTag ? `${prevTag}..${tip}` : tip])
  .split("\n")
  .filter(Boolean)
  .filter((h) => releaseCommit === null || (!h.startsWith(releaseCommit.slice(0, 7)) && !releaseCommit.startsWith(h)));

const missing = range.filter((h) => !listed.some((l) => h.startsWith(l) || l.startsWith(h)));
check(
  `覆盖 ${prevTag ?? "初始提交"}..${releaseCommit ? "发布提交（不含自身）" : tip} 全部 ${range.length} 个 commit`,
  missing.length === 0,
  missing.map((h) => h.slice(0, 7)).join(", "),
);

// 文档不能列出未来提交：列出的 hash 必须都在 tip 及之前
const tipCount = Number(git(["rev-list", "--count", tip]));
const future = listed.filter((h) => Number(git(["rev-list", "--count", h])) > tipCount);
check("未列出晚于本版本的 commit", future.length === 0, future.join(", "));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
