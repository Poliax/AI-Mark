/**
 * 悬浮控制面板（§16）—— 注入到阅卷页面内的 shadow DOM，默认左上角，不遮挡右侧评分区。
 * 健壮性：
 * - addInitScript 在文档早期执行时 document.body 可能尚未就绪 → 等待后再挂载；
 * - SPA（如好分数）路由切换可能移除注入元素 → 定时自愈重新挂载；
 * - 通信：WebSocket 推送（失败自动降级为轮询）；命令通过 POST /api/command 发给本地服务。
 * 若目标平台 CSP 阻止连接，请使用独立面板页 http://127.0.0.1:<port>/panel。
 */

const STATE_LABELS: Record<string, string> = {
  IDLE: '空闲（等待开始）',
  CHECK_PAGE: '检查页面',
  CAPTURE_ESSAY: '截取作文',
  OCR: '识别作文',
  GRADE: 'AI 评分',
  VALIDATE_SCORE: '校验分数',
  INPUT_SCORE: '定位/填写分数',
  VERIFY_SCORE: '验证分数',
  SUBMIT: '提交',
  VERIFY_SUBMISSION: '验证提交',
  NEXT_ESSAY: '等待下一份',
  PAUSE: '已暂停',
  STOPPED: '已停止',
};

export function buildPanelScript(origin: string): string {
  const o = JSON.stringify(origin);
  return `(() => {
  // 面板已挂载才视为注入成功；被移除则允许重新挂载（防止旧标记卡死后续注入）
  if (window.__essayAgentPanelV2 && document.getElementById('__essay_agent_panel_host__')) return;
  window.__essayAgentPanelV2 = true;
  const ORIGIN = ${o};
  const WS = ORIGIN.replace(/^http/, 'ws') + '/ws';

  let host = null, shadow = null, bound = false;

  const build = () => {
    if (!document.body) return false;               // 文档尚未就绪，稍后重试
    if (host && host.isConnected) return true;      // 已挂载
    if (!host) {
      host = document.createElement('div');
      host.id = '__essay_agent_panel_host__';
      host.style.cssText = 'position:fixed;left:16px;top:80px;z-index:2147483000;';
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>' + [
        '.p{width:300px;background:#1e293b;color:#e2e8f0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);font:13px/1.5 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden}',
        '.hd{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#0f172a;cursor:move;user-select:none}',
        '.hd b{font-size:14px}',
        '.badge{font-size:11px;padding:2px 8px;border-radius:10px;background:#f59e0b;color:#111}',
        '.badge.off{background:#22c55e}',
        '.bd{padding:10px 12px;display:grid;gap:6px}',
        '.row{display:flex;justify-content:space-between;gap:8px}',
        '.row span{color:#94a3b8}',
        '.row b{color:#f1f5f9;font-weight:600;text-align:right;word-break:break-all}',
        '.msg{margin-top:4px;padding:8px;border-radius:8px;background:#7f1d1d;color:#fecaca;display:none;white-space:pre-wrap}',
        '.msg.ok{background:#14532d;color:#bbf7d0}',
        '.btns{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 12px}',
        'button{flex:1 1 auto;min-width:64px;padding:6px 8px;border:1px solid #334155;border-radius:8px;background:#334155;color:#e2e8f0;cursor:pointer;font-size:12px}',
        'button:hover{background:#475569}',
        'button.primary{background:#2563eb;border-color:#2563eb;color:#fff}',
        'button.danger{background:#7f1d1d;border-color:#7f1d1d;color:#fecaca}',
        'details{padding:0 12px}',
        'summary{cursor:pointer;color:#93c5fd;font-size:12px;padding:4px 0}',
        '.ed{padding:0 12px 12px;display:grid;gap:6px}',
        '.ed input,.ed textarea,.ed select{background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;padding:6px;font-size:12px;font-family:inherit}',
        '.ed textarea{min-height:90px;resize:vertical}',
        '.ed label{font-size:11px;color:#94a3b8}',
      ].join('') + '</style>' +
      '<div class="p">' +
        '<div class="hd"><b>AI 英语作文阅卷助手</b><span class="badge" id="mode">DRY RUN</span></div>' +
        '<div class="bd">' +
          '<div class="row"><span>目标页面</span><b id="turl" style="font-size:11px;max-width:180px">-</b></div>' +
          '<div class="row"><span>本页考试</span><b id="exam" style="font-size:11px;max-width:180px">-</b></div>' +
          '<div class="row"><span>平台进度</span><b id="prog">-</b></div>' +
          '<div class="row"><span>状态</span><b id="st">空闲</b></div>' +
          '<div class="row"><span>当前</span><b id="cur">-</b></div>' +
          '<div class="row"><span>AI评分</span><b id="score">-</b></div>' +
          '<div class="row"><span>置信度</span><b id="conf">-</b></div>' +
          '<div class="row"><span>教师打分</span><b id="tscore" style="color:#4ade80">-</b></div>' +
          '<div class="row"><span>校准</span><b id="cal" style="font-size:11px">-</b></div>' +
          '<div class="msg" id="msg"></div>' +
        '</div>' +
        '<details><summary>本次作文评分标准（点击展开）</summary><div class="ed">' +
          '<label>题目要求（作文原题）</label><input id="rq" placeholder="粘贴作文题目要求…">' +
          '<label>评分标准全文</label><textarea id="rd" placeholder="粘贴本次考试评分标准…"></textarea>' +
          '<div class="row"><span>满分</span><input id="rm" type="number" min="1" max="100" value="15" style="width:70px"></div>' +
          '<button class="primary" id="rsave">保存评分标准</button>' +
        '</div></details>' +
        '<details><summary>大模型设置（换 Key / 换模型）</summary><div class="ed">' +
          '<label>服务商预设</label>' +
          '<select id="apreset">' +
            '<option value="zhipu">智谱 GLM（视觉免费）</option>' +
            '<option value="qwen">通义千问</option>' +
            '<option value="openai">OpenAI</option>' +
            '<option value="ollama">本地 Ollama</option>' +
            '<option value="custom">自定义</option>' +
          '</select>' +
          '<label>视觉模型（识别手写作文）</label>' +
          '<input id="avurl" placeholder="接口地址，如 https://open.bigmodel.cn/api/paas/v4">' +
          '<input id="avmodel" placeholder="模型名，如 glm-4v-flash">' +
          '<label>评分模型</label>' +
          '<input id="agurl" placeholder="接口地址，如 https://open.bigmodel.cn/api/paas/v4">' +
          '<input id="agmodel" placeholder="模型名，如 glm-4-flash">' +
          '<label>API Key（留空=不修改）</label>' +
          '<input id="akey" type="password" placeholder="留空=不修改">' +
          '<button class="primary" id="asave">保存大模型设置</button>' +
          '<button id="calreset">重置校准数据（重新学习教师尺度）</button>' +
        '</div></details>' +
        '<div class="btns">' +
          '<button class="primary" id="b-start">开始</button>' +
          '<button id="b-pause">暂停</button>' +
          '<button id="b-cont">继续</button>' +
          '<button id="b-manual">人工评分</button>' +
          '<button id="b-reid">重新识别</button>' +
          '<button id="b-regrade">重新评分</button>' +
          '<button id="b-skip">跳过</button>' +
          '<button class="danger" id="b-stop">停止</button>' +
        '</div>' +
      '</div>';
    }
    document.body.appendChild(host);
    return true;
  };

  const bind = () => {
    if (bound) return;
    bound = true;
    const $ = (id) => shadow.getElementById(id);
    const post = (path, body) => fetch(ORIGIN + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).catch(() => {});

    const render = (s) => {
      if (!s) return;
      $('mode').textContent = s.dry_run ? 'DRY RUN' : 'LIVE';
      $('mode').className = 'badge' + (s.dry_run ? '' : ' off');
      $('st').textContent = (${JSON.stringify(STATE_LABELS)})[s.state] || s.state;
      $('cur').textContent = (s.total_students ? s.student_index + ' / ' + s.total_students : '第 ' + s.student_index + ' 份');
      $('score').textContent = s.ai_score != null ? (s.max_score != null ? s.ai_score + ' / ' + s.max_score : s.ai_score + ' 分') : '-';
      $('tscore').textContent = s.teacher_score != null ? (s.max_score != null ? s.teacher_score + ' / ' + s.max_score : s.teacher_score + ' 分') : '-';
      const c = s.calibration;
      $('cal').textContent = !c
        ? '未启用'
        : c.sample_count >= c.min_samples
          ? '样本' + c.sample_count + ' · 偏差' + (c.avg_deviation >= 0 ? '+' : '') + c.avg_deviation
          : '样本不足 ' + c.sample_count + '/' + c.min_samples;
      $('conf').textContent = s.confidence != null ? Math.round(s.confidence * 100) + '%' : '-';
      const turl = s.target && s.target.url ? s.target.url : '';
      const isTarget = turl && location.href.split('?')[0] === turl.split('?')[0];
      $('turl').textContent = turl ? decodeURIComponent(turl).slice(-45) : '-';
      $('turl').style.color = isTarget ? '#4ade80' : '#fbbf24';
      if (turl && !isTarget) {
        $('st').textContent = '⚠ 此页非目标页';
      }
      // 本页考试/平台进度：优先解析「面板所在页面」自己（与左上角严格同步），解析不到再用 Agent 数据
      refreshLocal();
      if ($('exam').textContent === '-' && s.exam_info) {
        const ex = s.exam_info;
        const zh = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };
        $('exam').textContent = [
          ex.subject || null,
          ex.block != null ? '题块' + ex.block : null,
          ex.question_number != null
            ? ex.part != null && zh[ex.part]
              ? zh[ex.part] + '.' + ex.question_number
              : String(ex.question_number)
            : null,
        ]
          .filter(Boolean)
          .join(' · ');
      }
      if ($('prog').textContent === '-' && s.progress) {
        $('prog').textContent = s.progress.done + ' / ' + s.progress.total;
      }
      const msg = s.paused_reason || s.last_error;
      const box = $('msg');
      if (s.state === 'IDLE' && !s.page_ready) {
        box.style.display = 'block';
        box.textContent = '请点开具体某份试卷，进入打分页面（页面地址含 mark）。进入后工具会自动绑定并准备就绪。';
        box.className = 'msg ok';
      } else if (msg) {
        box.style.display = 'block';
        box.textContent = msg;
        box.className = 'msg' + (s.state === 'PAUSE' ? '' : ' ok');
      } else box.style.display = 'none';
    };

    // ---- 面板所在页面自身的信息解析（与页面左上角严格同步，实时跟随）----
    const refreshLocal = () => {
      try {
        const leaves = [];
        document.querySelectorAll('span,div,b,i,p').forEach((el) => {
          if (!el.children.length) {
            const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
            if (t && t.length <= 40) leaves.push(t);
          }
        });
        let subject = '', block = null, partTxt = null, qn = null, prog = null;
        for (const el of Array.from(document.querySelectorAll('div,span,p,li,h1,h2,h3,h4'))) {
          const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
          if (t.includes('题块') && t.length <= 80) {
            const bm = t.match(/题块\\s*(\\d+)/);
            if (bm) block = bm[1];
            const qm = t.match(/([一二三四五六七八九十]+)[.、．]\\s*(\\d{1,3})/);
            if (qm) { partTxt = qm[1]; qn = qm[2]; }
            const sm = t.match(/^([\\u4e00-\\u9fa5A-Za-z0-9]+?)\\s*(?=题块)/);
            if (sm) subject = sm[1].replace(/(单评|双评|三评|仲裁|复评|初评)/g, '').trim();
            break;
          }
        }
        if (block === null || qn === null) {
          for (const t of leaves) {
            if (block === null && /^题块\\s*(\\d+)$/.test(t)) block = t.match(/^题块\\s*(\\d+)$/)[1];
            if (qn === null) {
              const qm = t.match(/^([一二三四五六七八九十]+)[.、．]\\s*(\\d{1,3})\\s*$/);
              if (qm) { partTxt = qm[1]; qn = qm[2]; }
            }
            if (block !== null && qn !== null) break;
          }
        }
        for (const t of leaves) {
          const pm = t.match(/(?:进度|已评)[^0-9]{0,8}(\\d{1,6})\\s*\\/\\s*(\\d{1,6})/);
          if (pm) { prog = pm[1] + ' / ' + pm[2]; break; }
        }
        if (block !== null || qn !== null) {
          $('exam').textContent = [subject || null, block ? '题块' + block : null, qn ? (partTxt ? partTxt + '.' + qn : qn) : null]
            .filter(Boolean)
            .join(' · ');
        }
        if (prog) $('prog').textContent = prog;
      } catch (e) { /* 页面切换中忽略 */ }
    };

    // 页面 DOM 变化（翻页/切换学生/进度更新）→ 立即重新解析（150ms 防抖，实时跟随）
    let localTimer = null;
    try {
      const mo = new MutationObserver(() => {
        if (localTimer) return;
        localTimer = setTimeout(() => { localTimer = null; refreshLocal(); }, 150);
      });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    } catch (e) { /* 不支持则仅靠轮询 */ }

    const cmd = (name) => {
      // 按钮即时反馈：点击后立即显示「✓ 已请求」，让教师知道命令已送达
      const map = { start: 'b-start', pause: 'b-pause', continue: 'b-cont', manual_grade: 'b-manual', reidentify: 'b-reid', regrade: 'b-regrade', skip: 'b-skip', stop: 'b-stop' };
      const btn = map[name] ? $(map[name]) : null;
      if (btn) {
        const old = btn.textContent;
        btn.textContent = '✓ 已请求';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 900);
      }
      post('/api/command', { command: name });
    };
    $('b-start').onclick = () => cmd('start');
    $('b-pause').onclick = () => cmd('pause');
    $('b-cont').onclick = () => cmd('continue');
    $('b-manual').onclick = () => cmd('manual_grade');
    $('b-reid').onclick = () => cmd('reidentify');
    $('b-regrade').onclick = () => cmd('regrade');
    $('b-skip').onclick = () => cmd('skip');
    $('b-stop').onclick = () => cmd('stop');
    $('rsave').onclick = () => post('/api/rubric', {
      question: $('rq').value.trim(),
      description: $('rd').value.trim(),
      max_score: parseInt($('rm').value, 10) || 15,
    }).then(() => { $('rsave').textContent = '已保存 ✓'; setTimeout(() => $('rsave').textContent = '保存评分标准', 1500); });

    // 拉取当前评分标准回填
    fetch(ORIGIN + '/api/rubric').then(r => r.json()).then(r => {
      if (r && r.description) $('rd').value = r.description;
      if (r && r.question) $('rq').value = r.question;
      if (r && r.max_score) $('rm').value = r.max_score;
    }).catch(() => {});

    // 大模型设置
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

    // WebSocket 推送；失败降级为轮询
    let poll = null;
    const startPoll = () => { if (poll) return; poll = setInterval(() => fetch(ORIGIN + '/api/status').then(r => r.json()).then(s => render(s.status || s)).catch(() => {}), 400); };
    try {
      const ws = new WebSocket(WS);
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.status) render(d.status); };
      ws.onclose = startPoll; ws.onerror = startPoll;
    } catch (e) { startPoll(); }
    fetch(ORIGIN + '/api/status').then(r => r.json()).then(s => render(s.status || s)).catch(() => {});

    // 拖拽（仅标题栏）
    const hd = shadow.querySelector('.hd');
    let dragging = false, dx = 0, dy = 0;
    hd.addEventListener('pointerdown', (e) => { dragging = true; dx = e.clientX - host.offsetLeft; dy = e.clientY - host.offsetTop; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      host.style.left = Math.min(window.innerWidth - 60, Math.max(0, e.clientX - dx)) + 'px';
      host.style.top = Math.min(window.innerHeight - 40, Math.max(0, e.clientY - dy)) + 'px';
    });
    window.addEventListener('pointerup', () => { dragging = false; });
  };

  // 挂载 + 事件绑定；页面未就绪/被 SPA 移除时自动恢复
  const tick = () => { try { if (build()) bind(); } catch (e) {} };
  tick();
  setInterval(tick, 1000);
})();`;
}
