import { describe, it, expect } from 'vitest';
import { StateMachine, type IAgent, type AgentState } from '../../src/state_machine/machine.js';
import type { AgentStatus } from '../../src/types/contracts.js';

/** 记录调用顺序的假 Agent */
function fakeAgent(overrides: Partial<IAgent> = {}): { agent: IAgent; calls: string[] } {
  const calls: string[] = [];
  const agent: IAgent = {
    beginStudent: () => void calls.push('beginStudent'),
    checkPage: async () => void calls.push('checkPage'),
    captureEssay: async () => void calls.push('captureEssay'),
    recognize: async () => void calls.push('recognize'),
    grade: async () => void calls.push('grade'),
    validate: async () => void calls.push('validate'),
    inputScore: async () => void calls.push('inputScore'),
    verifyScore: async () => void calls.push('verifyScore'),
    submit: async () => {
      calls.push('submit');
      return false; // 等待教师 → 跳过 VERIFY_SUBMISSION
    },
    verifySubmission: async () => void calls.push('verifySubmission'),
    nextEssay: async () => {
      calls.push('nextEssay');
      return true;
    },
    manualGrade: async () => void calls.push('manualGrade'),
    readTeacherScore: async () => void calls.push('readTeacherScore'),
    skip: async () => void calls.push('skip'),
    setInterruptCheck: () => {},
    status: (state: AgentState) => ({ state } as AgentStatus),
    ...overrides,
  };
  return { agent, calls };
}

const fastTick = () => new Promise<void>((r) => setTimeout(r, 1));

async function runUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!predicate()) throw new Error('状态机未在超时内到达预期状态');
}

describe('状态机（§12/§14）', () => {
  it('主流程顺序：CHECK_PAGE → … → NEXT_ESSAY → 循环', async () => {
    const { agent, calls } = fakeAgent();
    const machine = new StateMachine(agent, {}, fastTick);
    const run = machine.run();
    machine.enqueue('start');
    await runUntil(() => calls.filter((c) => c === 'checkPage').length >= 2);
    machine.enqueue('stop');
    await run;
    const seq = calls.join(',');
    expect(seq).toContain(
      'checkPage,captureEssay,recognize,grade,validate,inputScore,verifyScore,submit,nextEssay,beginStudent,checkPage',
    );
  });

  it('步骤失败 → PAUSE 并记录错误；continue → 重试该步骤', async () => {
    let fail = true;
    const { calls } = fakeAgent({
      grade: async () => {
        calls.push('grade');
        if (fail) throw new Error('评分模型超时');
      },
    });
    const m2 = new StateMachine(
      fakeAgent({
        grade: async () => {
          calls.push('grade');
          if (fail) throw new Error('评分模型超时');
        },
      }).agent,
      {},
      fastTick,
    );
    const run = m2.run();
    m2.enqueue('start');
    await runUntil(() => m2.state === 'PAUSE');
    expect(m2.lastError).toContain('评分模型超时');
    fail = false;
    m2.enqueue('continue');
    await runUntil(() => calls.filter((c) => c === 'grade').length >= 2);
    m2.enqueue('stop');
    await run;
  });

  it('pause 命令 → PAUSE；continue → 恢复', async () => {
    let inGrade = false;
    const { agent } = fakeAgent({
      grade: async () => {
        inGrade = true;
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    const machine = new StateMachine(agent, {}, fastTick);
    const run = machine.run();
    machine.enqueue('start');
    await runUntil(() => inGrade);
    machine.enqueue('pause');
    await runUntil(() => machine.state === 'PAUSE');
    machine.enqueue('continue');
    await runUntil(() => machine.state !== 'PAUSE' && machine.state !== 'STOPPED');
    machine.enqueue('stop');
    await run;
  });

  it('manual_grade → continue → 读取教师分数 → 下一份', async () => {
    const { agent, calls } = fakeAgent();
    const m2 = new StateMachine(agent, {}, fastTick);
    const run = m2.run();
    m2.enqueue('start');
    await runUntil(() => calls.includes('submit'));
    m2.enqueue('pause');
    await runUntil(() => m2.state === 'PAUSE');
    m2.enqueue('manual_grade');
    await runUntil(() => calls.includes('manualGrade'));
    m2.enqueue('continue');
    await runUntil(() => calls.includes('readTeacherScore'));
    m2.enqueue('stop');
    await run;
    expect(calls.join(',')).toContain('manualGrade,readTeacherScore,nextEssay');
  });

  it('regrade 从 PAUSE 回到 GRADE 重评', async () => {
    const calls: string[] = [];
    const agent: IAgent = fakeAgent({
      grade: async () => {
        calls.push('grade');
        throw new Error('x');
      },
    }).agent;
    const machine = new StateMachine(agent, {}, fastTick);
    const run = machine.run();
    machine.enqueue('start');
    await runUntil(() => machine.state === 'PAUSE');
    const before = calls.filter((c) => c === 'grade').length;
    machine.enqueue('regrade');
    await runUntil(() => calls.filter((c) => c === 'grade').length > before);
    machine.enqueue('stop');
    await run;
  });

  it('stop → STOPPED 且 run() 退出', async () => {
    const { agent } = fakeAgent();
    const machine = new StateMachine(agent, {}, fastTick);
    const run = machine.run();
    machine.enqueue('stop');
    await run;
    expect(machine.state).toBe('STOPPED');
  });

  it('事件回调收到状态变化', async () => {
    const states: string[] = [];
    const { agent } = fakeAgent();
    const machine = new StateMachine(agent, { onState: (s) => states.push(s) }, fastTick);
    const run = machine.run();
    machine.enqueue('start');
    await runUntil(() => states.includes('CAPTURE_ESSAY'));
    machine.enqueue('stop');
    await run;
    expect(states).toContain('CHECK_PAGE');
  });
});
