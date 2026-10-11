import type { AgentStatus } from '../types/contracts.js';

/**
 * 状态机（§12/§14）—— IDLE → CHECK_PAGE → CAPTURE_ESSAY → OCR → GRADE
 * → VALIDATE_SCORE → INPUT_SCORE → VERIFY_SCORE → SUBMIT → VERIFY_SUBMISSION
 * → NEXT_ESSAY → CHECK_PAGE → ...
 * 任何一步失败 → PAUSE（显示错误，等待教师处理）→ CONTINUE。
 */

export type AgentState =
  | 'IDLE'
  | 'CHECK_PAGE'
  | 'CAPTURE_ESSAY'
  | 'OCR'
  | 'GRADE'
  | 'VALIDATE_SCORE'
  | 'INPUT_SCORE'
  | 'VERIFY_SCORE'
  | 'SUBMIT'
  | 'VERIFY_SUBMISSION'
  | 'NEXT_ESSAY'
  | 'PAUSE'
  | 'STOPPED';

export type AgentCommand =
  | 'start'
  | 'pause'
  | 'continue'
  | 'manual_grade'
  | 'reidentify'
  | 'regrade'
  | 'skip'
  | 'stop';

export interface IAgent {
  beginStudent(): void;
  checkPage(): Promise<void>;
  captureEssay(): Promise<void>;
  recognize(): Promise<void>;
  grade(): Promise<void>;
  validate(): Promise<void>;
  inputScore(): Promise<void>;
  verifyScore(): Promise<void>;
  /** 返回 true 表示已提交（或平台自动提交） */
  submit(): Promise<boolean>;
  verifySubmission(): Promise<void>;
  /** 返回 true 表示已检测到学生切换 */
  nextEssay(): Promise<boolean>;
  manualGrade(): Promise<void>;
  readTeacherScore(): Promise<void>;
  skip(): Promise<void>;
  setInterruptCheck(fn: (() => boolean) | null): void;
  status(state: AgentState): AgentStatus;
}

export interface MachineEvents {
  onState?(state: AgentState, detail?: string): void;
  onPause?(reason: string): void;
  onMessage?(message: string): void;
}

const ACTIVE_STATES: AgentState[] = [
  'CHECK_PAGE',
  'CAPTURE_ESSAY',
  'OCR',
  'GRADE',
  'VALIDATE_SCORE',
  'INPUT_SCORE',
  'VERIFY_SCORE',
  'SUBMIT',
  'VERIFY_SUBMISSION',
  'NEXT_ESSAY',
];

export class StateMachine {
  state: AgentState = 'IDLE';
  lastError: string | null = null;
  lastMessage: string | null = null;

  private commands: AgentCommand[] = [];
  private resumeState: AgentState = 'CHECK_PAGE';
  private pausedReason: string | null = null;
  private manualMode = false;
  private pauseRequested = false;
  private stopped = false;
  private maxAutoRetries = 3;
  private retryCount = 0;

  constructor(
    private readonly agent: IAgent,
    private readonly events: MachineEvents = {},
    private readonly tick: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.agent.setInterruptCheck(() => this.pauseRequested || this.commands.length > 0);
  }

  enqueue(cmd: AgentCommand): void {
    this.commands.push(cmd);
  }

  get isPaused(): boolean {
    return this.state === 'PAUSE';
  }

  get pausedReasonText(): string | null {
    return this.pausedReason;
  }

  private setState(s: AgentState, detail?: string): void {
    if (this.state === s && !detail) return;
    this.state = s;
    this.events.onState?.(s, detail);
  }

  private async handleCommand(cmd: AgentCommand): Promise<void> {
    switch (cmd) {
      case 'start': {
        if (this.state === 'IDLE' || this.state === 'PAUSE' || this.state === 'STOPPED') {
          if (this.state === 'STOPPED') this.stopped = false;
          this.pauseRequested = false;
          this.manualMode = false;
          this.retryCount = 0;
          this.lastError = null;
          this.resumeState = 'CHECK_PAGE';
          this.agent.beginStudent();
          this.events.onMessage?.('开始自动阅卷');
          this.setState('CHECK_PAGE');
        }
        break;
      }
      case 'pause': {
        if (this.state === 'PAUSE' || this.state === 'IDLE' || this.state === 'STOPPED') break;
        this.pauseRequested = true;
        this.resumeState = this.state;
        break;
      }
      case 'continue': {
        if (this.state !== 'PAUSE') break;
        this.pauseRequested = false;
        this.lastError = null;
        if (this.manualMode) {
          // 教师已人工评分：读取教师分数 → 下一份
          this.manualMode = false;
          try {
            await this.agent.readTeacherScore();
            this.setState('NEXT_ESSAY');
          } catch (e) {
            this.lastError = (e as Error).message;
            this.events.onPause?.(this.lastError);
            this.setState('PAUSE');
          }
        } else {
          this.setState(this.resumeState);
        }
        break;
      }
      case 'manual_grade': {
        if (this.state !== 'PAUSE') break;
        this.manualMode = true;
        this.lastError = null;
        this.pausedReason = '教师人工评分中（AI 已停止操作当前学生）。教师完成评分后点击[继续]。';
        this.events.onMessage?.(this.pausedReason);
        await this.agent.manualGrade();
        break;
      }
      case 'reidentify': {
        if (this.state !== 'PAUSE') break;
        this.lastError = null;
        this.resumeState = 'OCR';
        this.setState('OCR');
        break;
      }
      case 'regrade': {
        if (this.state !== 'PAUSE') break;
        this.lastError = null;
        this.resumeState = 'GRADE';
        this.setState('GRADE');
        break;
      }
      case 'skip': {
        if (this.state !== 'PAUSE') break;
        this.lastError = null;
        this.pausedReason = null;
        try {
          await this.agent.skip();
          this.setState('NEXT_ESSAY');
        } catch (e) {
          this.lastError = (e as Error).message;
          this.setState('PAUSE');
        }
        break;
      }
      case 'stop': {
        this.stopped = true;
        this.events.onMessage?.('已停止');
        this.setState('STOPPED');
        break;
      }
    }
  }

  private async step(): Promise<AgentState> {
    switch (this.state) {
      case 'CHECK_PAGE':
        await this.agent.checkPage();
        return 'CAPTURE_ESSAY';
      case 'CAPTURE_ESSAY':
        await this.agent.captureEssay();
        return 'OCR';
      case 'OCR':
        await this.agent.recognize();
        return 'GRADE';
      case 'GRADE':
        await this.agent.grade();
        return 'VALIDATE_SCORE';
      case 'VALIDATE_SCORE':
        await this.agent.validate();
        return 'INPUT_SCORE';
      case 'INPUT_SCORE':
        await this.agent.inputScore();
        return 'VERIFY_SCORE';
      case 'VERIFY_SCORE':
        await this.agent.verifyScore();
        return 'SUBMIT';
      case 'SUBMIT': {
        const submitted = await this.agent.submit();
        return submitted ? 'VERIFY_SUBMISSION' : 'NEXT_ESSAY';
      }
      case 'VERIFY_SUBMISSION':
        await this.agent.verifySubmission();
        return 'NEXT_ESSAY';
      case 'NEXT_ESSAY': {
        const advanced = await this.agent.nextEssay();
        if (advanced) {
          this.agent.beginStudent();
          return 'CHECK_PAGE';
        }
        this.pausedReason = '等待切换到下一份作文：请教师切换学生后点击[继续]（或[跳过]当前学生）。';
        this.resumeState = 'NEXT_ESSAY';
        this.events.onMessage?.(this.pausedReason);
        return 'PAUSE';
      }
      default:
        return 'IDLE';
    }
  }

  /** 主循环：命令处理 → 状态执行；出错 → PAUSE（§12） */
  async run(): Promise<void> {
    while (!this.stopped) {
      while (this.commands.length > 0 && !this.stopped) {
        const cmd = this.commands.shift()!;
        await this.handleCommand(cmd);
      }
      if (this.stopped) break;

      if (this.pauseRequested && ACTIVE_STATES.includes(this.state)) {
        this.pauseRequested = false;
        this.pausedReason = '教师请求暂停。可点击[继续]恢复。';
        this.events.onMessage?.(this.pausedReason);
        this.setState('PAUSE');
      }

      if (this.state === 'IDLE' || this.state === 'PAUSE' || this.state === 'STOPPED') {
        await this.tick(100);
        continue;
      }

      try {
        const next = await this.step();
        this.retryCount = 0;
        this.setState(next);
        // 让出事件循环：保证命令能及时处理，也避免状态间空转占满 CPU
        await this.tick(0);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        this.lastError = msg;
        this.retryCount += 1;
        if (this.retryCount >= this.maxAutoRetries) {
          this.pausedReason = `连续失败 ${this.retryCount} 次：${msg}`;
        } else {
          this.pausedReason = msg;
        }
        this.resumeState = this.state;
        this.events.onPause?.(this.pausedReason);
        this.setState('PAUSE');
      }
    }
  }
}
