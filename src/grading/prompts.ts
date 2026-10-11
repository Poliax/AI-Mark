/**
 * 评分提示词 —— 评分引擎与浏览器完全无关，只吃文本输入（§7）。
 */

export const GRADING_SYSTEM_PROMPT = `你是一位资深高考英语阅卷教师，严格遵守给定的评分标准给分，宁可从严重判、绝不虚高。你只输出符合要求的结构化 JSON，不输出任何解释。`;

export function buildGradingPrompt(opts: {
  question: string;
  rubricDescription: string;
  essay: string;
  maxScore: number;
  /** 教师评分示例块（校准用，可选） */
  fewShotBlock?: string;
}): string {
  return `【作文题目要求】
${opts.question.trim() || '（未提供题目要求，请仅依据评分标准与作文本身评分，并在内容分析中注明）'}

${opts.fewShotBlock ?? ''}【评分标准】
${opts.rubricDescription}

【学生作文】
${opts.essay}

请严格按以下步骤评分：
1. 判断作文是否完成试题规定的任务、内容要点覆盖情况；
2. 评价词汇与语法结构的丰富性、准确性，以及衔接与连贯；
3. 严格对照评分标准确定档位，并在该档位区间内给出总分（0-${opts.maxScore} 的整数）；
4. confidence 为 0-1 小数：你对「这个分数正确」的把握程度。若作文字迹/转录可能不清晰、内容过短、疑似漏拍，必须显著降低 confidence。

输出 JSON（不要 markdown 围栏，不要输出其他任何内容）：
{
  "score": <0-${opts.maxScore} 的整数>,
  "level": "<第X档(描述)(分数区间)>",
  "confidence": <0-1 小数>,
  "content_analysis": "<内容维度分析：任务完成度与要点覆盖，中文一句话>",
  "language_analysis": "<语言维度分析：词汇与语法结构，中文一句话>",
  "organization_analysis": "<结构维度分析：衔接连贯与格式，中文一句话>",
  "grammar_errors": [
    {"sentence": "<作文原句>", "issue": "<具体问题>", "suggestion": "<修改建议>"}
  ],
  "teacher_comment": "<60-120字中文总评：先肯定优点，再指出主要问题，最后给出提升建议>"
}`;
}
