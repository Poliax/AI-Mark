import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ActionLogEntry, EssayRecord } from '../types/contracts.js';

/**
 * 阅卷日志（§15）—— 每份作文一个 JSON 记录 + 会话清单 + 图片存档。
 * 无数据库依赖，logs/<session-id>/essay-XXXX.json 可直接用任何工具查看。
 */

export interface Logger {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly startedAt: string;
  /** 为一份新作文建立日志记录（返回记录本体，供流程中持续追加 action_log） */
  createRecord(studentIndex: number): EssayRecord;
  /** 保存图片，返回相对日志目录的路径 */
  saveImage(kind: string, studentIndex: number, buffer: Buffer): string;
  /** 保存作文文本 */
  saveText(kind: string, studentIndex: number, text: string): string;
  /** 写入最终记录文件 */
  commitRecord(record: EssayRecord): void;
  /** 追加动作日志并落盘 */
  appendAction(record: EssayRecord, state: string, action: string, detail?: unknown): void;
  /** 已提交记录列表（面板用） */
  listRecords(): EssayRecord[];
  /** 读取记录 */
  getRecord(studentIndex: number): EssayRecord | null;
  /** 会话清单（完整痕迹） */
  writeManifest(): void;
}

export function createLogger(logDir: string): Logger {
  const now = new Date();
  const sessionId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(
    2,
    '0',
  )}${String(now.getSeconds()).padStart(2, '0')}`;
  const sessionDir = path.join(logDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const records = new Map<number, EssayRecord>();

  const recordPath = (i: number) => path.join(sessionDir, `essay-${String(i).padStart(4, '0')}.json`);
  const imagePath = (kind: string, i: number, ext: string) =>
    path.posix.join('logs', sessionId, `${kind}-${String(i).padStart(4, '0')}.${ext}`);

  const commit = (record: EssayRecord) => {
    record.timestamp = new Date().toISOString();
    records.set(record.student_index, record);
    writeFileSync(recordPath(record.student_index), JSON.stringify(record, null, 2), 'utf-8');
  };

  return {
    sessionId,
    sessionDir,
    startedAt: now.toISOString(),
    createRecord(studentIndex: number): EssayRecord {
      return {
        student_index: studentIndex,
        question_number: null,
        essay_image: '',
        essay_image_preprocessed: '',
        ocr_text: null,
        vision_text: '',
        final_text: '',
        recognition_confidence: 0,
        ai_score: 0,
        max_score: 0,
        confidence: 0,
        ai_raw_score: null,
        rubric_version: '',
        model_version: '',
        action_log: [],
        final_teacher_score: null,
        submission_status: 'pending_teacher',
        timestamp: '',
        verdict: { kind: 'manual', reason: '未完成' },
        level: '',
        content_analysis: '',
        language_analysis: '',
        organization_analysis: '',
        grammar_errors: [],
        teacher_comment: '',
        suggested_button: null,
        score_button_method: null,
      };
    },
    saveImage(kind, studentIndex, buffer): string {
      const rel = imagePath(kind, studentIndex, 'png');
      writeFileSync(path.join(sessionDir, `${kind}-${String(studentIndex).padStart(4, '0')}.png`), buffer);
      return rel;
    },
    saveText(kind, studentIndex, text): string {
      const rel = path.posix.join('logs', sessionId, `${kind}-${String(studentIndex).padStart(4, '0')}.txt`);
      writeFileSync(path.join(sessionDir, `${kind}-${String(studentIndex).padStart(4, '0')}.txt`), text, 'utf-8');
      return rel;
    },
    commitRecord(record) {
      commit(record);
    },
    appendAction(record, state, action, detail) {
      const entry: ActionLogEntry = { t: new Date().toISOString(), state, action, detail };
      record.action_log.push(entry);
      commit(record);
    },
    listRecords() {
      return [...records.values()];
    },
    getRecord(studentIndex) {
      const r = records.get(studentIndex);
      if (r) return r;
      if (existsSync(recordPath(studentIndex))) {
        return JSON.parse(readFileSync(recordPath(studentIndex), 'utf-8')) as EssayRecord;
      }
      return null;
    },
    writeManifest() {
      writeFileSync(
        path.join(sessionDir, 'manifest.json'),
        JSON.stringify(
          {
            sessionId,
            startedAt: now.toISOString(),
            records: [...records.keys()].sort((a, b) => a - b),
          },
          null,
          2,
        ),
        'utf-8',
      );
    },
  };
}
