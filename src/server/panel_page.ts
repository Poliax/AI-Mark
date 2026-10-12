/**
 * 独立面板页（兜底）—— 当阅卷平台 CSP 阻止注入面板连接本地服务时使用。
 * 页面地址: http://127.0.0.1:<port>/panel
 * 与注入面板功能一致，并附带阅卷记录列表与最近作文图片预览。
 */
export const PANEL_PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 英语作文阅卷助手 · 控制面板</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
         background: #f1f5f9; color: #0f172a; }
  .wrap { max-width: 960px; margin: 24px auto; padding: 0 16px; display: grid; gap: 16px; }
  .card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
  .badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; background: #f59e0b; color: #111; }
  .badge.off { background: #22c55e; color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .kv { background: #f8fafc; border-radius: 8px; padding: 8px 12px; }
  .kv span { display: block; font-size: 12px; color: #64748b; }
  .kv b { font-size: 15px; }
  .msg { margin-top: 10px; padding: 10px; border-radius: 8px; background: #fef2f2; color: #b91c1c; display: none; white-space: pre-wrap; }
  .msg.ok { background: #f0fdf4; color: #166534; }
  .btns { display: flex; flex-wrap: wrap; gap: 8px; }
  button { padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; cursor: pointer; font-size: 13px; }
  button:hover { background: #f1f5f9; }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button.primary:hover { background: #1d4ed8; }
  button.danger { background: #b91c1c; border-color: #b91c1c; color: #fff; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: #2563eb; }
  .ed { display: grid; gap: 8px; margin-top: 10px; }
  .ed input, .ed textarea { padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
  .ed textarea { min-height: 120px; }
  .ed label { font-size: 12px; color: #64748b; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  .preview { margin-top: 12px; max-width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; display: none; }
  .foot { color: #64748b; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>AI 英语作文阅卷助手 <span class="badge" id="mode">DRY RUN</span></h1>
    <div class="grid">
      <div class="kv"><span>目标页面</span><b id="target" style="font-size:12px">-</b></div>
      <div class="kv"><span>本页考试</span><b id="exam" style="font-size:12px">-</b></div>
      <div class="kv"><span>平台进度</span><b id="prog">-</b></div>
      <div class="kv"><span>状态</span><b id="st">-</b></div>
      <div class="kv"><span>自动监听</span><b id="watch" style="font-size:12px">-</b></div>
      <div class="kv"><span>当前</span><b id="cur">-</b></div>
      <div class="kv"><span>AI评分</span><b id="score">-</b></div>
      <div class="kv"><span>置信度</span><b id="conf">-</b></div>
      <div class="kv"><span>教师打分</span><b id="tscore" style="color:#166534">-</b></div>
      <div class="kv"><span>校准</span><b id="cal" style="font-size:12px">-</b></div>
    </div>
    <div class="msg" id="msg"></div>
    <div class="btns" style="margin-top:12px">
      <button class="primary" id="b-start">开始</button>
      <button id="b-pause">暂停</button>
      <button id="b-cont">继续</button>
      <button id="b-manual">人工评分</button>
      <button id="b-reid">重新识别</button>
      <button id="b-regrade">重新评分</button>
      <button id="b-watch">自动监听</button>
      <button id="b-skip">跳过</button>
      <button class="danger" id="b-stop">停止</button>
    </div>
    <details>
      <summary>本次作文评分标准（点击展开编辑）</summary>
      <div class="ed">
        <label>题目要求（作文原题）</label><input id="rq" placeholder="粘贴作文题目要求…">
        <label>评分标准全文</label><textarea id="rd" placeholder="粘贴本次考试评分标准…"></textarea>
        <div style="display:flex;align-items:center;gap:8px"><label>满分</label><input id="rm" type="number" min="1" max="100" value="15" style="width:80px">
        <button class="primary" id="rsave">保存评分标准</button></div>
      </div>
    </details>
    <details>
      <summary>大模型设置（换 Key / 换模型，保存后立即生效）</summary>
      <div class="ed">
        <label>服务商预设</label>
        <select id="apreset">
          <option value="zhipu">智谱 GLM（视觉免费）</option>
          <option value="qwen">通义千问</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">本地 Ollama</option>
          <option value="custom">自定义</option>
        </select>
        <label>视觉模型（识别手写作文）</label>
        <input id="avurl" placeholder="接口地址，如 https://open.bigmodel.cn/api/paas/v4">
        <input id="avmodel" placeholder="模型名，如 glm-4v-flash">
        <label>评分模型</label>
        <input id="agurl" placeholder="接口地址，如 https://open.bigmodel.cn/api/paas/v4">
        <input id="agmodel" placeholder="模型名，如 glm-4-flash">
        <label>API Key（留空=不修改）</label>
        <input id="akey" type="password" placeholder="留空=不修改">
        <button class="primary" id="asave">保存大模型设置</button>
        <button id="calreset">重置校准数据（重新学习教师尺度）</button>
      </div>
    </details>
  </div>
  <div class="card">
    <h1>阅卷记录</h1>
    <table><thead><tr><th>序号</th><th>AI 分数</th><th>置信度</th><th>提交状态</th><th>时间</th></tr></thead><tbody id="rows"></tbody></table>
    <img class="preview" id="prev" alt="最近作文截图">
  </div>
  <div class="foot">本面板仅与本机 Agent 通信（127.0.0.1）。阅卷平台页面内也已注入悬浮面板；若平台 CSP 阻止注入面板连接，请保持本页打开。</div>
</div>
<script>
const ORIGIN = '__ORIGIN__';
const STATE_LABELS = { IDLE:'空闲（等待开始）', CHECK_PAGE:'检查页面', CAPTURE_ESSAY:'截取作文', OCR:'识别作文',
  GRADE:'AI 评分', VALIDATE_SCORE:'校验分数', INPUT_SCORE:'定位/填写分数', VERIFY_SCORE:'验证分数',
  SUBMIT:'提交', VERIFY_SUBMISSION:'验证提交', NEXT_ESSAY:'等待下一份', PAUSE:'已暂停', STOPPED:'已停止' };
const $ = (id) => document.getElementById(id);
const post = (path, body) => fetch(ORIGIN + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
function render(s) {
  if (!s) return;
  $('mode').textContent = s.dry_run ? 'DRY RUN' : 'LIVE';
  $('mode').className = 'badge' + (s.dry_run ? '' : ' off');
  $('st').textContent = STATE_LABELS[s.state] || s.state;
  $('cur').textContent = s.total_students ? s.student_index + ' / ' + s.total_students : '第 ' + s.student_index + ' 份';
  $('score').textContent = s.ai_score != null ? (s.max_score != null ? s.ai_score + ' / ' + s.max_score : s.ai_score + ' 分') : '-';
  $('tscore').textContent = s.teacher_score != null ? (s.max_score != null ? s.teacher_score + ' / ' + s.max_score : s.teacher_score + ' 分') : '-';
  const c = s.calibration;
  $('cal').textContent = !c
    ? '未启用'
    : c.sample_count >= c.min_samples
      ? '样本' + c.sample_count + ' · 偏差' + (c.avg_deviation >= 0 ? '+' : '') + c.avg_deviation
      : '样本不足 ' + c.sample_count + '/' + c.min_samples;
  $('conf').textContent = s.confidence != null ? Math.round(s.confidence * 100) + '%' : '-';
  $('prog').textContent = s.progress ? s.progress.done + ' / ' + s.progress.total : '-';
  const ex = s.exam_info;
  const zh = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };
  $('exam').textContent = ex
    ? [
        ex.subject || null,
        ex.block != null ? '题块' + ex.block : null,
        ex.question_number != null
          ? ex.part != null && zh[ex.part]
            ? zh[ex.part] + '.' + ex.question_number
            : String(ex.question_number)
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '-';
  $('target').textContent = s.target && s.target.url ? s.target.url : '-';
  const msg = s.paused_reason || s.last_error;
  const box = $('msg');
  if (!s.ai_key_configured) { box.style.display = 'block'; box.textContent = '⚠ 请展开下方「大模型设置」，粘贴你自己的智谱 API Key（免费注册 open.bigmodel.cn）→ 保存。'; box.className = 'msg'; }
  else if (msg) { box.style.display = 'block'; box.textContent = msg; box.className = 'msg' + (s.state === 'PAUSE' ? '' : ' ok'); }
  else box.style.display = 'none';
  const rows = $('rows');
  rows.innerHTML = (s.records || []).slice(-30).reverse().map(r =>
    '<tr><td>' + r.student_index + '</td><td>' + (r.ai_score != null ? r.ai_score : '-') + '</td><td>' +
    (r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-') + '</td><td>' + r.submission_status + '</td><td>' +
    (r.timestamp || '').slice(11, 19) + '</td></tr>').join('');
  const last = (s.records || []).slice(-1)[0];
  const prev = $('prev');
  if (last) { prev.style.display = 'block'; prev.src = ORIGIN + '/api/records/' + last.student_index + '/image?type=preprocessed&ts=' + Date.now(); }
}
const cmd = (name) => post('/api/command', { command: name });
$('b-start').onclick = () => cmd('start');
$('b-pause').onclick = () => cmd('pause');
$('b-cont').onclick = () => cmd('continue');
$('b-manual').onclick = () => cmd('manual_grade');
$('b-reid').onclick = () => cmd('reidentify');
$('b-regrade').onclick = () => cmd('regrade');
let autoWatch = false;
const watchBtn = $('b-watch');
const paintWatch = (on) => {
  autoWatch = on;
  if (!watchBtn) return;
  watchBtn.textContent = on ? '自动监听：开 ✓' : '自动监听：关';
  watchBtn.style.background = on ? '#166534' : '';
  watchBtn.style.color = on ? '#fff' : '';
  watchBtn.style.borderColor = on ? '#166534' : '';
};
if (watchBtn) watchBtn.onclick = () => post('/api/auto-watch', { enabled: !autoWatch });
$('b-skip').onclick = () => cmd('skip');
$('b-stop').onclick = () => cmd('stop');
$('rsave').onclick = () => post('/api/rubric', {
  question: $('rq').value.trim(), description: $('rd').value.trim(),
  max_score: parseInt($('rm').value, 10) || 15
}).then(() => { $('rsave').textContent = '已保存 ✓'; setTimeout(() => $('rsave').textContent = '保存评分标准', 1500); });
const AI_PRESETS = {
  zhipu: { av: 'https://open.bigmodel.cn/api/paas/v4', avm: 'glm-4v-flash', ag: 'https://open.bigmodel.cn/api/paas/v4', agm: 'glm-4-flash' },
  qwen: { av: 'https://dashscope.aliyuncs.com/compatible-mode/v1', avm: 'qwen-vl-max', ag: 'https://dashscope.aliyuncs.com/compatible-mode/v1', agm: 'qwen-plus' },
  openai: { av: 'https://api.openai.com/v1', avm: 'gpt-4o-mini', ag: 'https://api.openai.com/v1', agm: 'gpt-4o-mini' },
  ollama: { av: 'http://127.0.0.1:11434/v1', avm: 'qwen2.5-vl', ag: 'http://127.0.0.1:11434/v1', agm: 'qwen2.5' },
};
$('apreset').onchange = () => {
  const p = AI_PRESETS[$('apreset').value];
  if (!p) return;
  $('avurl').value = p.av; $('avmodel').value = p.avm;
  $('agurl').value = p.ag; $('agmodel').value = p.agm;
};
$('asave').onclick = () => post('/api/ai', {
  vision: { baseUrl: $('avurl').value.trim(), model: $('avmodel').value.trim(), apiKey: $('akey').value.trim() },
  grading: { baseUrl: $('agurl').value.trim(), model: $('agmodel').value.trim(), apiKey: $('akey').value.trim() },
}).then(() => { $('asave').textContent = '已保存 ✓（下次识别/评分立即生效）'; setTimeout(() => $('asave').textContent = '保存大模型设置', 2000); });
$('calreset').onclick = () => {
  if (confirm('确定重置校准数据吗？AI 将重新开始学习你的打分尺度。')) {
    post('/api/calibration/reset').then(() => { $('calreset').textContent = '已重置 ✓'; setTimeout(() => $('calreset').textContent = '重置校准数据（重新学习教师尺度）', 2000); });
  }
};
fetch(ORIGIN + '/api/ai').then(r => r.json()).then(c => {
  if (c && c.vision) {
    $('avurl').value = c.vision.baseUrl || '';
    $('avmodel').value = c.vision.model || '';
    $('agurl').value = c.grading ? c.grading.baseUrl : '';
    $('agmodel').value = c.grading ? c.grading.model : '';
    $('akey').placeholder = c.vision.apiKey ? '当前 Key: ' + c.vision.apiKey + '（留空=不修改）' : '未设置 Key';
  }
}).catch(() => {});
fetch(ORIGIN + '/api/rubric').then(r => r.json()).then(r => {
  if (r && r.description) $('rd').value = r.description;
  if (r && r.question) $('rq').value = r.question;
  if (r && r.max_score) $('rm').value = r.max_score;
}).catch(() => {});
let ws = null;
const startPoll = () => { if (window.__poll) return; window.__poll = setInterval(() => fetch(ORIGIN + '/api/status').then(r => r.json()).then(s => render(s.status || s)).catch(() => {}), 1500); };
try {
  ws = new WebSocket(ORIGIN.replace(/^http/, 'ws') + '/ws');
  ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.status) render(d.status); };
  ws.onclose = startPoll; ws.onerror = startPoll;
} catch (e) { startPoll(); }
fetch(ORIGIN + '/api/status').then(r => r.json()).then(s => render(s.status || s)).catch(() => {});
</script>
</body>
</html>`;
