/**
 * dev_ask 工具：从 pi-dev-workflow 的 extensions/dev-ask.ts 移植。
 *
 * pi 用 TUI 逐题渲染（带返回上一题、自定义输入选项）；DSH 的提问卡片一次
 * 提交整批问题，自由输入由界面自带，因此这里改成一次 ask 问完整批。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { NoAnswererError, readAnswer, tryAsk } from "./ask.js";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_LABEL_LENGTH = 60;
const MAX_HEADER_LENGTH = 16;

const DEV_ASK_DESCRIPTION = [
	"默认可用的结构化提问工具，用于需求澄清、方案取舍、用户偏好和 grilling 分轮追问，不依赖 /dev-pre-check。",
	"",
	"用法：",
	"- 只问需要用户决定的关键问题：能从代码、文档或环境查到的事实先自己查，不要问琐碎细节或重复询问已回答的问题。",
	"- 每轮只询问前置条件已明确、当前可回答的问题，题数不限，一次调用问完；等待答案后再组织依赖这些答案的下一轮，不要提前猜测。",
	"- 在 grilling 技能指导下强烈推荐直接调用 dev_ask：每轮把设计树当前 frontier 的问题一起提交，收到答案后重算 frontier，再开展下一轮。",
	`- 每题给 ${MIN_OPTIONS}-${MAX_OPTIONS} 个互斥选项，每个选项都有 label（1-5 个词，最多 ${MAX_LABEL_LENGTH} 字符）和 description（含义或取舍）。推荐项放第一个，在 label 末尾加「（推荐）」。`,
	"- 不要自行添加自定义输入或返回选项，界面会自动提供；用户可在任一题直接打字自由作答，也可放弃提问。",
	"- 选项的 description 与 label 显示在同一行，写清该选项的含义或取舍；普通偏好问题不必展开。",
	"- 需要展示结构图、对比布局或代码时，用选项的 preview 字段提供 Markdown：它会显示在卡片右侧面板，并随高亮的选项切换；ASCII 图和代码放进代码块以保留对齐。",
	"- 答案表示用户对所问决策的选择，不等于授权执行未被要求的操作；未作答不等于同意推荐项。当前会话没有交互界面时改用文字说明待决问题。",
	"- 工具仅供模型直接调用，不通过 codemode 或其他工具间接调用。",
].join("\n");

function validateQuestions(questions) {
	if (questions.length === 0) return "questions 不能为空：至少提 1 个问题";

	for (let index = 0; index < questions.length; index += 1) {
		const question = questions[index];
		const at = `第 ${index + 1} 题`;

		if (question.header.length > MAX_HEADER_LENGTH) {
			return `${at}的 header 超过 ${MAX_HEADER_LENGTH} 字符：${question.header}`;
		}
		const count = question.options.length;
		if (count < MIN_OPTIONS || count > MAX_OPTIONS) {
			return `${at}需要 ${MIN_OPTIONS}-${MAX_OPTIONS} 个选项，实际 ${count} 个`;
		}
		for (const option of question.options) {
			if (option.label.length > MAX_LABEL_LENGTH) {
				return `${at}的选项 label 超过 ${MAX_LABEL_LENGTH} 字符：${option.label}`;
			}
		}
	}

	return undefined;
}

function detailOf(question) {
	const sections = [];
	question.options.forEach((option, index) => {
		if (option.preview === undefined) return;
		sections.push(`#### 选项 ${index + 1}\n\n${option.preview}`);
	});
	return sections.length === 0 ? {} : { detail: sections.join("\n\n") };
}

function buildAnswers(questions, chosen) {
	return questions.map((question, index) => ({
		header: question.header,
		question: question.question,
		answer: chosen.get(index) ?? null,
	}));
}

function formatResult(answers, cancelled) {
	const answered = answers.filter((item) => item.answer !== null);
	const lines = [];

	if (answered.length > 0) {
		lines.push("用户已作答：");
		answers.forEach((item, index) => {
			if (item.answer === null) return;
			lines.push(`${index + 1}. 「${item.question}」→ ${item.answer}`);
		});
	}

	if (cancelled) {
		lines.push(answered.length > 0 ? "用户随后放弃了剩余提问。" : "用户放弃了提问，没有提供答案。");
		lines.push(
			"未作答的问题仍是开放问题，不代表用户同意推荐项；列出待决问题，不要把它们当作已确认决策。",
		);
	} else {
		lines.push("以上答案视为用户已确认的前提，不要就同一件事再次提问或臆测。");
	}

	return lines.join("\n");
}

const optionSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		label: {
			type: "string",
			required: true,
			description: `选项标签，1-5 个词，最多 ${MAX_LABEL_LENGTH} 字符；推荐项放第一个并在末尾加「（推荐）」`,
		},
		description: {
			type: "string",
			required: true,
			description: "该选项的含义或取舍，与 label 显示在同一行",
		},
		preview: {
			type: "string",
			description:
				"可选的 Markdown 预览，随该选项展示在卡片右侧面板；ASCII 结构图、代码或配置请放在代码块中以保留缩进与对齐",
		},
	},
};

const questionSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		header: {
			type: "string",
			required: true,
			description: `该问题的短标签，最多 ${MAX_HEADER_LENGTH} 字符`,
		},
		question: {
			type: "string",
			required: true,
			description:
				"完整的决策问题，以问号结尾；仅询问前置条件已明确、当前可回答的问题。需要背景、结构图或代码时写进这里，卡片只显示这一段正文",
		},
		options: {
			type: "array",
			required: true,
			items: optionSchema,
			description: `${MIN_OPTIONS}-${MAX_OPTIONS} 个互斥选项，推荐的放第一个并在 label 末尾加「（推荐）」`,
		},
	},
};

export function createDevAskTool(ctx) {
	return defineTool({
		name: "dev_ask",
		description: DEV_ASK_DESCRIPTION,
		parameters: {
			questions: {
				type: "array",
				required: true,
				items: questionSchema,
				description: "本轮前置条件已明确的全部关键问题，一次问完；依赖本轮答案的问题留到收到答案后的下一轮",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					answers: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								header: { type: "string", required: true },
								question: { type: "string", required: true },
								answer: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
							},
						},
					},
					cancelled: { type: "boolean", required: true },
				},
			},
			render: (_args, value) => [{ type: "text", text: formatResult(value.answers, value.cancelled) }],
		},
		async execute(args, exec) {
			const invalid = validateQuestions(args.questions);
			if (invalid !== undefined) throw new Error(invalid);

			const request = args.questions.map((question, index) => ({
				id: `q${index + 1}`,
				header: question.header,
				question: question.question,
				options: question.options.map((option) => ({
					label: option.label,
					description: option.description,
				})),
				...detailOf(question),
			}));

			let answer;
			try {
				answer = await tryAsk(ctx, request, { agent: exec.agent, signal: exec.signal });
			} catch (error) {
				if (error instanceof NoAnswererError) return { answers: buildAnswers(args.questions, new Map()), cancelled: true };
				throw error;
			}

			const chosen = new Map();
			if (answer !== undefined) {
				args.questions.forEach((question, index) => {
					const picked = readAnswer(answer, `q${index + 1}`);
					const value = picked.custom ?? picked.label;
					if (value !== undefined) chosen.set(index, value);
				});
			}

			return { answers: buildAnswers(args.questions, chosen), cancelled: answer === undefined };
		},
	});
}
