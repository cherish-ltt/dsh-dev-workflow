import { PreCheckAbortedError, PreCheckChangedError } from "./pre-check.js";
import { projectCwd } from "./session-utils.js";

const MAX_PENDING = 32;

export function createPendingIntents(ctx) {
	const records = new Map();
	function remove(session) {
		const state = records.get(session);
		records.delete(session);
		state?.active?.controller.abort();
	}

	ctx.on("session/disposed", remove, { global: true });
	ctx.effect(() => () => {
		for (const session of records.keys()) remove(session);
	});
	ctx.on("session/event", (session, event) => {
		const state = records.get(session);
		if (!state) return;
		const externalInput = (message) => message.id !== state.messageId
			&& (message.source.kind === "user" || message.source.kind === "user-question-reply");
		const newMessage = event.type === "user/message" && externalInput(event.data);
		const queuedMessage = event.type === "agent/inbox/spliced" && event.data.inserted.some(externalInput);
		const newCommand = event.type === "command/run" && event.data.name !== "dev-resume";
		if (newMessage || queuedMessage || newCommand) {
			state.changed = true;
			state.active?.controller.abort();
		}
	}, { global: true });

	function activate(agent, state, signal, resumed) {
		const controller = new AbortController();
		const active = {
			controller,
			signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
		};
		state.active = active;
		const current = () => records.get(agent.session) === state && state.active === active;
		return {
			state,
			resumed,
			signal: active.signal,
			changed: () => state.changed || state.cwd !== projectCwd(ctx, agent),
			assertCurrent() {
				if (active.signal.aborted || !current()) throw new PreCheckAbortedError();
			},
			saveReport(intent) {
				if (!current() || active.signal.aborted || state.changed || state.cwd !== projectCwd(ctx, agent)) return;
				state.intent = intent;
				state.generatedAt = Date.now();
			},
			consume() {
				this.assertCurrent();
				if (this.changed()) throw new PreCheckChangedError();
				records.delete(agent.session);
			},
			finish(outcome) {
				if (!current()) return;
				state.active = undefined;
				if (!state.intent || !(outcome?.aborted || outcome?.noUi || outcome?.changed)) {
					records.delete(agent.session);
				}
			},
		};
	}

	return {
		begin(agent, command, attachments, signal) {
			remove(agent.session);
			if (records.size >= MAX_PENDING) remove(records.keys().next().value);
			const state = { command, attachments, corrections: [], cwd: projectCwd(ctx, agent) };
			records.set(agent.session, state);
			return activate(agent, state, signal, false);
		},
		resume(agent, signal) {
			const state = records.get(agent.session);
			if (!state?.intent) return { error: "当前会话没有可恢复的完整待确认报告，请重新发起原 dev 命令。" };
			if (state.active && !state.active.signal.aborted) {
				return { error: "当前会话已有确认流程正在进行，请先完成或中止该流程。" };
			}
			return activate(agent, state, signal, true);
		},
	};
}
