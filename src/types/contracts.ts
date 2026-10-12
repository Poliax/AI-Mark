/**
 * 共享数据契约 —— 所有模块之间的数据格式约定。
 * 浏览器自动化（automation/、browser/）与 AI 评分（grading/、scoring/、arbiter/、vision/、ocr/）
 * 只通过这里的类型交换数据，保证彻底解耦。
 */

/** §4 页面识别结果（字段名与规格保持一致） */
export interface PageAnalysis {
  /** 是否确认处于正确的阅卷页面；无法确认时禁止自动评分 */
  is_grading_page: boolean;
  /** 当前题号（如 66），无法识别为 null */
  question_number: number | null;
  /** 当前已填入的分数，未评分/无法识别为 null */
  current_score: number | null;
  /** 页面上是否存在提交按钮 */
  has_submission_button: boolean;
  /** 页面上是否存在评分面板（分数按钮区） */
  has_score_panel: boolean;
  /** 页面上是否存在学生作文图像区域 */
  has_essay_image: boolean;
  /** 学生标识（姓名/考号等，仅用于日志与防错，不用于任何登录） */
  student_identity: string | null;
  /** 平台「自动提交」开关状态；我们绝不修改它 */
  auto_submit_state: 'on' | 'off' | 'unknown';
  /** 需要人工介入（登录过期/验证码/二次认证等） */
  intervention_needed: {
    type: 'login' | 'captcha' | 'auth_expired' | 'security' | 'other';
    detail: string;
  } | null;
  /** 检测到的分数按钮数值列表（如 0..15） */
  score_panel_scores: number[];
  /** 平台阅卷进度（如「进度：302/302」），页面未显示为 null */
  progress: { done: number; total: number } | null;
  /** 页面左上角考试信息（如「高三英语 题块2 五.66」→ subject/block/part=5/question=66），未识别为 null */
  exam_info: { subject: string; block: number | null; part: number | null; question_number: number | null } | null;
  /** 各要素的定位证据（selector / 启发式 / 文本匹配），用于调试与审计 */
  evidence: Record<string, string>;
}

/** 页面状态快照 —— 用于「页面变化检测」与防误打分校验 */
export interface PageSnapshot {
  identity: string | null;
  questionNumber: number | null;
  currentScore: number | null;
  /** 作文区域内容签名（SVG/图片内容随学生变化；平台不显示学生信息时的切换检测兜底） */
  essaySignature: string | null;
  capturedAt: string;
}

/** 作文区域截图结果 */
export interface EssayCapture {
  /** 原始区域截图（保存路径，相对日志目录） */
  original_image: string;
  /** 预处理后的截图（保存路径） */
  preprocessed_image: string;
  /** 原始截图的 base64（内存用，发送给视觉模型） */
  original_data_url: string;
  /** 预处理截图的 base64 */
  preprocessed_data_url: string;
  /** 作文区域在页面中的位置（仅记录/调试，绝不用作点击坐标） */
  region: { x: number; y: number; width: number; height: number };
  /** 定位方法 */
  method: 'selector' | 'heuristic' | 'visual';
  /** 区域占视口比例（>0.75 会被安全闸门拒绝） */
  viewport_fraction: number;
}

/** §6 作文识别结果 */
export interface EssayRecognition {
  /** 原始作文图（路径） */
  original_image: string;
  /** 传统 OCR 输出（未启用为 null） */
  ocr_text: string | null;
  /** Vision LLM 输出 */
  vision_text: string;
  /** 合并后的最终作文文本 */
  final_text: string;
  /** 识别置信度 0-1 */
  confidence: number;
  /** OCR 与 Vision 的文本重合度（无 OCR 为 null） */
  agreement: number | null;
  /** 模型版本信息 */
  model_versions: { ocr: string | null; vision: string };
  /** 识别告警（如两通道分歧过大） */
  warnings: string[];
}

/** 评分标准（教师提供；rubric_version = id） */
export interface Rubric {
  id: string;
  title: string;
  max_score: number;
  /** 评分标准全文（档位描述等） */
  description: string;
  /** 作文题目要求（可选，但强烈建议提供） */
  question: string;
}

export interface GrammarError {
  sentence: string;
  issue: string;
  suggestion: string;
}

/** §7 评分引擎输出 */
export interface GradeResult {
  score: number;
  max_score: number;
  /** 评分置信度 0-1（模型自评 + 识别质量折算） */
  confidence: number;
  /** 档位，如「第三档(适当)(11-15分)」 */
  level: string;
  content_analysis: string;
  language_analysis: string;
  organization_analysis: string;
  grammar_errors: GrammarError[];
  teacher_comment: string;
  rubric_version: string;
  model_version: string;
  /** 模型原始分数（应用教师尺度校准前的分数） */
  raw_score: number | null;
  /** 校准信息（应用了教师尺度修正时非空） */
  calibration: { sample_count: number; avg_deviation: number; adjusted_by: number } | null;
  /** 模型原始返回（审计用） */
  raw: unknown;
}

export type ScoreVerdict =
  | { kind: 'auto'; reason?: string }
  | { kind: 'teacher_confirm'; reason?: string }
  | { kind: 'manual'; reason?: string };

/** §8 评分校验结果 */
export interface ScoreValidation {
  ok: boolean;
  score: number;
  max_score: number;
  /** 综合置信度（取识别与评分置信度的较小值，保守策略） */
  combined_confidence: number;
  verdict: ScoreVerdict;
  reasons: string[];
  /** 多模型最大分差（单模型为 null） */
  disagreement: number | null;
}

/** 防误打保护检查项（§13 的 7 项） */
export interface SafetyCheck {
  id:
    | 'question_number'
    | 'student_identity'
    | 'essay_area'
    | 'score_panel'
    | 'current_score_state'
    | 'submission_state'
    | 'page_change';
  label: string;
  ok: boolean;
  detail: string;
}

export interface ActionLogEntry {
  t: string;
  state: string;
  action: string;
  detail?: unknown;
}

/** §15 阅卷日志记录 */
export interface EssayRecord {
  student_index: number;
  question_number: number | null;
  /** 原始作文图路径 */
  essay_image: string;
  essay_image_preprocessed: string;
  ocr_text: string | null;
  vision_text: string;
  final_text: string;
  recognition_confidence: number;
  ai_score: number;
  max_score: number;
  /** 评分置信度 */
  confidence: number;
  /** AI 原始分（校准前；无校准为 null） */
  ai_raw_score: number | null;
  rubric_version: string;
  model_version: string;
  action_log: ActionLogEntry[];
  /** 教师最终手改分数（人工评分时记录） */
  final_teacher_score: number | null;
  submission_status:
    | 'pending_teacher'
    | 'submitted_auto'
    | 'platform_auto'
    | 'teacher_manual'
    | 'skipped'
    | 'blocked';
  timestamp: string;
  verdict: { kind: string; reason?: string };
  level: string;
  content_analysis: string;
  language_analysis: string;
  organization_analysis: string;
  grammar_errors: GrammarError[];
  teacher_comment: string;
  /** DRY RUN 模式下定位到的建议点击分数 */
  suggested_button: number | null;
  /** 分数按钮定位方法 */
  score_button_method: string | null;
}

/** 面板展示用的整体状态 */
export interface AgentStatus {
  state: string;
  mode: 'dry-run' | 'live';
  phase: number;
  dry_run: boolean;
  student_index: number;
  total_students: number | null;
  completed: number;
  question_number: number | null;
  current_score: number | null;
  ai_score: number | null;
  max_score: number | null;
  confidence: number | null;
  verdict: string | null;
  suggestion: string | null;
  last_message: string | null;
  auto_submit_state: string;
  /** 平台阅卷进度（页面显示时） */
  progress: { done: number; total: number } | null;
  /** 页面左上角考试信息（与页面显示对应） */
  exam_info: { subject: string; block: number | null; part: number | null; question_number: number | null } | null;
  /** 教师实际打分（从平台接口读取；页面未提供为 null） */
  teacher_score: number | null;
  /** 学生考号（从平台接口读取） */
  student_kaohao: string | null;
  /** 当前绑定页是否为可批改的阅卷页（供面板提示） */
  page_ready: boolean;
  /** 自动监听模式（无需教师点工具按钮，页面换学生即自动批改并高亮） */
  auto_watch: boolean;
  /** 校准（学习教师尺度）状态 */
  calibration: { enabled: boolean; sample_count: number; avg_deviation: number; min_samples: number } | null;
  target: { url: string; title: string; student_identity: string | null };
  last_record_id: string | null;
  records: Array<{
    student_index: number;
    ai_score: number | null;
    max_score: number;
    confidence: number | null;
    submission_status: string;
    timestamp: string;
  }>;
}

/** 定位到的分数按钮（含定位方法，便于审计与测试断言） */
export interface ScoreButtonLocation {
  selector: string;
  method: 'selector' | 'role' | 'text' | 'aria' | 'heuristic' | 'visual';
  label: string;
}
