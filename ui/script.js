const JIRA_KEYS  = ['JIRA_PAT_TOKEN', 'JIRA_USERNAME'];
const GEMINI_KEYS = ['GEMINI_API_KEY', 'GEMINI_MODEL'];

// ── 페이지 전환 ──
function switchPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const btn = el || document.querySelector(`.nav-item[data-page="${name}"]`);
  if (btn) btn.classList.add('active');
  if (name === 'gemini') {
    const inp = document.getElementById('inp-GEMINI_MODEL');
    const badge = document.getElementById('gemini-model-badge');
    if (inp && badge) badge.textContent = inp.value || 'gemini';
  }
}

// ── 퀵액션 칩 렌더 ──
function renderChips() {
  const area = document.getElementById('chip-area');
  area.innerHTML = SHORTCUTS.map(s =>
    `<button class="chip" onclick="sendChatQuery('${s.replace(/'/g, "\\'")}')">${s}</button>`
  ).join('');
}

// ── 설정 필드 빌드 ──
function eyeIcon(open) {
  return open
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
       </svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
       </svg>`;
}

function buildField(field) {
  if (field.type === 'select') {
    const opts = (field.options || []).map(o =>
      `<option value="${o.value}">${o.label}</option>`
    ).join('');
    return `
      <div class="field" id="wrap-${field.key}">
        <label for="inp-${field.key}">
          ${field.label}<span class="field-status ok" id="dot-${field.key}"></span>
        </label>
        <div class="input-wrap">
          <select id="inp-${field.key}" onchange="updateDot('${field.key}')">
            ${opts}
          </select>
          <span class="select-arrow">▾</span>
        </div>
      </div>`;
  }
  const isSensitive = field.sensitive;
  const inputType = isSensitive ? 'password' : 'text';
  return `
    <div class="field" id="wrap-${field.key}">
      <label for="inp-${field.key}">
        ${field.label}<span class="field-status" id="dot-${field.key}"></span>
      </label>
      <div class="input-wrap">
        <input
          id="inp-${field.key}"
          type="${inputType}"
          placeholder="${field.placeholder}"
          autocomplete="off"
          oninput="updateDot('${field.key}')"
        >
        ${isSensitive ? `<button type="button" class="eye-btn" id="eye-${field.key}" onclick="toggleEye('${field.key}')">
          <span id="eye-icon-${field.key}">${eyeIcon(false)}</span>
        </button>` : ''}
      </div>
    </div>`;
}

function toggleEye(key) {
  const inp = document.getElementById('inp-' + key);
  const icon = document.getElementById('eye-icon-' + key);
  const isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  icon.innerHTML = eyeIcon(isHidden);
}

function updateDot(key) {
  const inp = document.getElementById('inp-' + key);
  const dot = document.getElementById('dot-' + key);
  if (!dot) return;
  if (inp.value) {
    dot.className = 'field-status ok';
    if (inp.tagName === 'INPUT') inp.className = 'has-value';
  } else {
    dot.className = 'field-status empty';
    if (inp.tagName === 'INPUT') inp.className = '';
  }
}

function renderFields() {
  const jiraEl   = document.getElementById('jira-fields-inline');
  const geminiEl = document.getElementById('gemini-fields-inline');
  if (jiraEl)   jiraEl.innerHTML   = FIELDS.filter(f => JIRA_KEYS.includes(f.key)).map(buildField).join('');
  if (geminiEl) geminiEl.innerHTML = FIELDS.filter(f => GEMINI_KEYS.includes(f.key)).map(buildField).join('');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.error) {
      showToast('❌ ' + data.error, 'error');
      return;
    }
    const env = data.env || {};
    const pk = data.projectKey || '';
    document.getElementById('proj-badge').textContent = pk.split(/[\\/]/).pop() || pk || '-';
    FIELDS.forEach(f => {
      const inp = document.getElementById('inp-' + f.key);
      if (inp) {
        if (f.type === 'select') {
          inp.value = env[f.key] || (f.options && f.options[0] ? f.options[0].value : '');
        } else {
          inp.value = env[f.key] || '';
        }
        updateDot(f.key);
      }
    });
    const modelInp = document.getElementById('inp-GEMINI_MODEL');
    const badge = document.getElementById('gemini-model-badge');
    if (modelInp && badge) badge.textContent = modelInp.value || 'gemini';
  } catch(e) {
    showToast('❌ 로드 실패: ' + e.message, 'error');
  }
}

// ── Gemini 설정 저장 ──
async function saveGeminiSettings() {
  const env = {};
  GEMINI_KEYS.forEach(key => {
    const inp = document.getElementById('inp-' + key);
    if (inp) env[key] = inp.value;
  });
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env}),
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✓ 저장 완료 — Claude Code 재시작 후 적용됩니다', 'success');
      const modelInp = document.getElementById('inp-GEMINI_MODEL');
      const badge = document.getElementById('gemini-model-badge');
      if (modelInp && badge) badge.textContent = modelInp.value || 'gemini';
    } else {
      showToast('❌ ' + data.error, 'error');
    }
  } catch(e) {
    showToast('❌ 저장 실패: ' + e.message, 'error');
  }
}

// ── Jira 설정 저장 ──
async function saveJiraSettings() {
  const env = {};
  JIRA_KEYS.forEach(key => {
    const inp = document.getElementById('inp-' + key);
    if (inp) env[key] = inp.value;
  });
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env}),
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✓ 저장 완료 — Claude Code 재시작 후 적용됩니다', 'success');
    } else {
      showToast('❌ ' + data.error, 'error');
    }
  } catch(e) {
    showToast('❌ 저장 실패: ' + e.message, 'error');
  }
}

// ── Jira 채팅 ──
function sendChatQuery(q) {
  document.getElementById('chat-input').value = q;
  sendChat();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('send-btn');
  const q = input.value.trim();
  if (!q) return;

  const hint = document.getElementById('empty-hint');
  if (hint) hint.remove();

  appendUserBubble(q);
  input.value = '';
  btn.disabled = true;

  const spinner = appendSpinner();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: q}),
    });
    const data = await res.json();
    spinner.remove();
    if (data.error) {
      appendError(data.error);
    } else if (data.type === 'issue') {
      appendIssueCard(data.data);
    } else if (data.type === 'search') {
      appendSearchCard(data.data, data.jql);
    }
  } catch(e) {
    spinner.remove();
    appendError('요청 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

function getHistory() { return document.getElementById('chat-history'); }

function scrollBottom() {
  const h = getHistory();
  setTimeout(() => h.scrollTop = h.scrollHeight, 50);
}

function appendUserBubble(text) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap user';
  wrap.innerHTML = `<div class="bubble-user">${escHtml(text)}</div>`;
  getHistory().appendChild(wrap);
  scrollBottom();
}

function appendSpinner() {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `<div class="chat-spinner">
    <div class="dot-spin"><span></span><span></span><span></span></div>
    Jira 조회 중...
  </div>`;
  getHistory().appendChild(wrap);
  scrollBottom();
  return wrap;
}

function appendError(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `<div class="error-card">⚠ ${escHtml(msg)}</div>`;
  getHistory().appendChild(wrap);
  scrollBottom();
}

function statusClass(name) {
  if (!name) return '';
  const n = name.toLowerCase();
  if (n.includes('완료') || n.includes('done') || n.includes('closed') || n.includes('resolved')) return 'done';
  if (n.includes('진행') || n.includes('progress') || n.includes('active')) return 'active';
  return 'open';
}

function appendIssueCard(issue) {
  const f = issue.fields || {};
  const key = issue.key || '';
  const title = f.summary || '(제목 없음)';
  const status = (f.status && f.status.name) || '';
  const assignee = (f.assignee && f.assignee.displayName) || '미지정';
  const rawDesc = (f.description || '').replace(/\n/g, ' ');
  const desc = rawDesc.length > 200 ? rawDesc.slice(0, 200) + '…' : rawDesc;
  const uid = 'json_' + Date.now();

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `
    <div class="issue-card">
      <div class="issue-card-header">
        <span class="issue-key">${escHtml(key)}</span>
        <span class="status-badge ${statusClass(status)}">${escHtml(status)}</span>
      </div>
      <div class="issue-title">${escHtml(title)}</div>
      <div class="issue-meta">담당자: ${escHtml(assignee)}</div>
      ${desc ? `<div class="issue-desc">${escHtml(desc)}</div>` : ''}
      <div class="json-toggle" onclick="toggleJson('${uid}')">▶ JSON 보기</div>
      <div class="json-body" id="${uid}">${escHtml(JSON.stringify(issue, null, 2))}</div>
    </div>`;
  getHistory().appendChild(wrap);
  scrollBottom();
}

function appendSearchCard(data, jql) {
  const total = data.total || 0;
  const issues = data.issues || [];
  const uid = 'json_' + Date.now();

  let rows = '';
  for (const iss of issues) {
    const f = iss.fields || {};
    const status = (f.status && f.status.name) || '';
    rows += `<tr>
      <td class="key-cell">${escHtml(iss.key || '')}</td>
      <td class="title-cell">${escHtml((f.summary || '').slice(0, 60))}</td>
      <td class="status-cell"><span class="status-badge ${statusClass(status)}">${escHtml(status)}</span></td>
    </tr>`;
  }

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `
    <div class="search-card">
      <div class="search-header">
        검색 결과 <strong>${total}건</strong> (표시: ${issues.length}건)
        ${jql ? `<br><span style="font-family:monospace;font-size:11px;opacity:.7">${escHtml(jql.slice(0, 120))}</span>` : ''}
      </div>
      ${issues.length > 0 ? `
      <table class="issue-table">
        <thead><tr><th>키</th><th>제목</th><th>상태</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<div style="color:var(--text-muted);font-size:12px;">결과가 없습니다.</div>'}
      <div class="json-toggle" onclick="toggleJson('${uid}')">▶ JSON 보기</div>
      <div class="json-body" id="${uid}">${escHtml(JSON.stringify(data, null, 2))}</div>
    </div>`;
  getHistory().appendChild(wrap);
  scrollBottom();
}

function toggleJson(id) {
  const el = document.getElementById(id);
  const toggle = el.previousElementSibling;
  if (el.classList.contains('open')) {
    el.classList.remove('open');
    toggle.textContent = '▶ JSON 보기';
  } else {
    el.classList.add('open');
    toggle.textContent = '▼ JSON 접기';
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (type || '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.className = '', 3500);
}

// ── Gemini 상태 확인 ──
async function checkGemini() {
  const btn = document.getElementById('gemini-check-btn');
  btn.disabled = true;
  btn.textContent = '확인 중...';

  try {
    const res = await fetch('/api/gemini-check');
    const data = await res.json();
    showGeminiStatus(data);
  } catch(e) {
    showGeminiStatus({ ok: false, status: 'error', message: e.message });
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ 상태 확인';
  }
}

function showGeminiStatus(data) {
  const area = document.getElementById('gstatus');
  const dot  = document.getElementById('gstatus-dot');
  const text = document.getElementById('gstatus-text');
  const meta = document.getElementById('gstatus-meta');

  area.style.display = 'flex';

  const now = new Date().toLocaleTimeString('ko-KR');

  if (data.ok) {
    dot.className  = 'gstatus-dot ok';
    text.textContent = '정상';
    meta.textContent = `${data.latency_ms}ms · ${now}`;
  } else {
    const labels = {
      quota_exceeded:  '할당량 초과 (429)',
      invalid_key:     'API 키 오류',
      model_not_found: `모델 없음 (${data.model})`,
      no_key:          'API 키 미설정',
      config_error:    '설정 오류',
      error:           data.message || '알 수 없는 오류',
    };
    const isWarn = data.status === 'quota_exceeded' || data.status === 'no_key';
    dot.className  = 'gstatus-dot ' + (isWarn ? 'warn' : 'err');
    text.textContent = labels[data.status] || data.message || '오류';
    meta.textContent = (data.latency_ms ? `${data.latency_ms}ms · ` : '') + now;
  }
}

// ── Gemini 채팅 ──
let geminiHistory = [];

async function sendGemini() {
  const input = document.getElementById('gemini-input');
  const btn = document.getElementById('gemini-send-btn');
  const msg = input.value.trim();
  if (!msg) return;

  const hint = document.getElementById('gemini-empty-hint');
  if (hint) hint.remove();

  appendGeminiUser(msg);
  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;

  const spinner = appendGeminiSpinner();

  try {
    // 1. Agent Query 실행 (의도 분석 및 파라미터 추출)
    const res = await fetch('/api/agent-query', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: msg}),
    });
    const data = await res.json();
    spinner.remove();

    if (!data.ok) {
      appendGeminiError(data.error || '분석 중 오류가 발생했습니다.');
      return;
    }

    const { intent, jql, action, reason } = data.result;

    if (intent === 'SEARCH' && jql) {
      appendGeminiBot(`의도: **검색** (Reason: ${reason})\nJQL: \`${jql}\``);
      // Jira 테스트 페이지로 이동하여 검색 실행
      switchPage('chat');
      document.getElementById('chat-input').value = jql;
      sendChat();
    } else if (intent === 'ACTION' && action && action.issue_key) {
      appendAgentActionCard(action, reason);
    } else {
      // 일반 채팅으로 전달
      const chatSpinner = appendGeminiSpinner();
      const chatRes = await fetch('/api/gemini-chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: msg, history: geminiHistory}),
      });
      const chatData = await chatRes.json();
      chatSpinner.remove();
      
      if (!chatData.ok) {
        appendGeminiError(chatData.error || '응답 오류');
      } else {
        geminiHistory.push({role: 'user', text: msg});
        geminiHistory.push({role: 'model', text: chatData.reply});
        appendGeminiBot(chatData.reply, chatData.latency_ms, chatData.model);
      }
    }
  } catch(e) {
    if (spinner) spinner.remove();
    appendGeminiError('요청 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

function appendAgentActionCard(action, reason) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  const uid = 'action_' + Date.now();
  
  let details = `<li><strong>대상 이슈:</strong> ${escHtml(action.issue_key)}</li>`;
  if (action.transition) details += `<li><strong>상태 수정:</strong> ${escHtml(action.transition)}</li>`;
  if (action.fields && action.fields.assignee) details += `<li><strong>담당자 변경:</strong> ${escHtml(action.fields.assignee)}</li>`;
  if (action.comment) details += `<li><strong>댓글 추가:</strong> ${escHtml(action.comment)}</li>`;

  wrap.innerHTML = `
    <div class="bubble-gemini">
      <div>의도: **이슈 수정** (Reason: ${escHtml(reason)})</div>
      <div style="margin: 10px 0; padding: 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;">
        <ul style="margin-left: 18px; font-size: 12px;">${details}</ul>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 10px;">
        <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px; flex: none;" onclick="executeAgentAction('${uid}', ${escHtml(JSON.stringify(action))})">승인 및 실행</button>
        <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; flex: none;" onclick="this.closest('.bubble-wrap').remove()">취소</button>
      </div>
      <div id="status-${uid}" style="margin-top: 8px; font-size: 11px;"></div>
    </div>`;
  getGeminiHistory().appendChild(wrap);
  scrollGeminiBottom();
}

async function executeAgentAction(uid, action) {
  const statusEl = document.getElementById('status-' + uid);
  const btn = statusEl.previousElementSibling.querySelector('.btn-primary');
  const cancelBtn = btn.nextElementSibling;
  
  btn.disabled = true;
  cancelBtn.style.display = 'none';
  statusEl.innerHTML = `<div class="ai-verify-loading"><div class="dot-spin"><span></span><span></span><span></span></div> Jira 업데이트 중...</div>`;

  try {
    const res = await fetch('/api/agent-execute', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action}),
    });
    const data = await res.json();
    if (data.ok) {
      statusEl.innerHTML = `<span style="color:var(--success)">✅ 업데이트 성공!</span>`;
      btn.textContent = '실행 완료';
    } else {
      statusEl.innerHTML = `<span style="color:var(--error)">❌ 실패: ${escHtml(data.error)}</span>`;
      btn.disabled = false;
      btn.textContent = '재시도';
      cancelBtn.style.display = 'inline-block';
    }
  } catch(e) {
    statusEl.innerHTML = `<span style="color:var(--error)">❌ 요청 실패: ${escHtml(e.message)}</span>`;
    btn.disabled = false;
    btn.textContent = '재시도';
    cancelBtn.style.display = 'inline-block';
  }
}

function clearGeminiChat() {
  geminiHistory = [];
  const h = document.getElementById('gemini-history');
  h.innerHTML = `<div class="empty-hint" id="gemini-empty-hint">
    <div class="big">🤖</div>
    <div>Gemini에게 무엇이든 물어보세요</div>
  </div>`;
}

(function() {
  const ta = document.getElementById('gemini-input');
  if (!ta) return;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendGemini(); }
  });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });
})();

function getGeminiHistory() { return document.getElementById('gemini-history'); }

function scrollGeminiBottom() {
  const h = getGeminiHistory();
  setTimeout(() => h.scrollTop = h.scrollHeight, 50);
}

function appendGeminiUser(text) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap user';
  wrap.innerHTML = `<div class="bubble-user">${escHtml(text).replace(/\n/g,'<br>')}</div>`;
  getGeminiHistory().appendChild(wrap);
  scrollGeminiBottom();
}

function appendGeminiSpinner() {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `<div class="chat-spinner">
    <div class="dot-spin"><span></span><span></span><span></span></div>
    Gemini 응답 중...
  </div>`;
  getGeminiHistory().appendChild(wrap);
  scrollGeminiBottom();
  return wrap;
}

function appendGeminiBot(text, latency, model) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  const html = markdownToHtml(text);
  const meta = latency ? `<div class="gemini-meta">${latency}ms · ${model || ''}</div>` : '';
  wrap.innerHTML = `<div class="bubble-gemini">${html}${meta}</div>`;
  getGeminiHistory().appendChild(wrap);
  scrollGeminiBottom();
}

function appendGeminiError(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `<div class="error-card">⚠ ${escHtml(msg)}</div>`;
  getGeminiHistory().appendChild(wrap);
  scrollGeminiBottom();
}

function markdownToHtml(text) {
  let s = escHtml(text);
  s = s.replace(/```([^`]*?)```/gs, (_, code) =>
    `<pre class="gemini-code">${code.trim()}</pre>`
  );
  s = s.replace(/`([^`]+?)`/g, '<code class="gemini-inline-code">$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

// ── 유사 이슈 검색 ──
let similarUsers = [];

function initSimilarUsers() {
  const inp = document.getElementById('inp-JIRA_USERNAME');
  const username = inp ? inp.value.trim() : '';
  if (username && !similarUsers.includes(username)) {
    similarUsers = [username];
  } else if (!similarUsers.length) {
    similarUsers = [];
  }
  renderUserTags();
}

function renderUserTags() {
  const area = document.getElementById('user-tags');
  if (!area) return;
  area.innerHTML = similarUsers.map((u, i) => `
    <span class="user-tag">
      ${escHtml(u)}
      ${i === 0 ? '<span class="user-tag-me">나</span>' : `<button class="user-tag-remove" onclick="removeUser(${i})">✕</button>`}
    </span>
  `).join('');
}

function addUser() {
  const inp = document.getElementById('user-add-input');
  const val = inp.value.trim();
  if (!val) return;
  if (similarUsers.length >= 3) { showToast('최대 3명까지 추가할 수 있습니다.', 'error'); return; }
  if (similarUsers.includes(val)) { showToast('이미 추가된 사용자입니다.', 'error'); return; }
  similarUsers.push(val);
  inp.value = '';
  renderUserTags();
}

function removeUser(idx) {
  if (idx === 0) return;
  similarUsers.splice(idx, 1);
  renderUserTags();
}

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'user-add-input' && e.key === 'Enter') { e.preventDefault(); addUser(); }
});

function toggleSimilarSettings() {
  const body = document.getElementById('similar-settings-body');
  const arrow = document.getElementById('similar-settings-arrow');
  body.classList.toggle('open');
  arrow.textContent = body.classList.contains('open') ? '▼' : '▶';
}

async function loadCacheStatus() {
  const el = document.getElementById('cache-status');
  if (!el) return;
  try {
    const res = await fetch('/api/embedding-cache-status');
    const data = await res.json();
    if (!data.ok) { el.textContent = '캐시 오류: ' + data.error; return; }
    if (!data.exists) {
      el.innerHTML = '<span style="color:var(--warn)">캐시 없음 — 캐시를 구축해주세요</span>';
      return;
    }
    const meta = data.meta || {};
    const counts = Object.entries(data.type_counts || {})
      .map(([t, n]) => `${t} ${n}건`).join(', ');
    el.innerHTML = `캐시: <strong>${counts}</strong> · ${meta.created_at ? meta.created_at.slice(0, 10) : ''} 갱신`;
  } catch(e) {
    el.textContent = '캐시 상태 로드 실패';
  }
}

async function buildCache() {
  const btn = document.getElementById('build-btn');
  btn.disabled = true;
  btn.textContent = '🔄 구축 중...';
  try {
    const res = await fetch('/api/embedding-build', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({users: similarUsers}),
    });
    const data = await res.json();
    if (data.ok) {
      const detail = data.embed_error ? ` (오류: ${data.embed_error})` : '';
      const jiraInfo = data.jira_counts
        ? ' Jira: ' + Object.entries(data.jira_counts).map(([t,n]) => `${t} ${n}건`).join(', ')
        : '';
      showToast(`✓ 완료 — ${data.total}건 (신규 ${data.added}, 재사용 ${data.reused}, 실패 ${data.skipped})${jiraInfo}${detail}`, data.skipped > 0 ? 'error' : 'success');
      loadCacheStatus();
    } else {
      showToast('❌ ' + data.error, 'error');
    }
  } catch(e) {
    showToast('❌ 구축 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 캐시 구축 / 갱신';
  }
}

async function searchSimilar() {
  const btn = document.getElementById('similar-search-btn');
  const results = document.getElementById('similar-results');
  btn.disabled = true;
  btn.textContent = '검색 중...';
  const hint = document.getElementById('similar-empty-hint');
  if (hint) hint.remove();
  results.innerHTML = '<div class="similar-loading"><div class="dot-spin"><span></span><span></span><span></span></div> 미해결 이슈 임베딩 중...</div>';

  try {
    const res = await fetch('/api/similar-issues', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({users: similarUsers}),
    });
    const data = await res.json();
    if (!data.ok) {
      results.innerHTML = `<div class="error-card">⚠ ${escHtml(data.error)}</div>`;
      return;
    }
    if (!data.results || data.results.length === 0) {
      results.innerHTML = '<div class="empty-hint"><div class="big">✅</div><div>미해결 이슈가 없습니다</div></div>';
      return;
    }
    results.innerHTML = '';
    for (const item of data.results) {
      results.appendChild(buildSimilarCard(item));
    }
  } catch(e) {
    results.innerHTML = `<div class="error-card">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 유사 이슈 검색';
  }
}

function buildSimilarCard(item) {
  const wrap = document.createElement('div');
  wrap.className = 'similar-card';

  const similarHtml = item.similar && item.similar.length > 0
    ? item.similar.map(s => `
        <div class="similar-row">
          <span class="sim-score ${scoreClass(s.score)}">${s.score}%</span>
          <span class="sim-key">${escHtml(s.key)}</span>
          <span class="sim-summary">${escHtml(s.summary)}</span>
        </div>`).join('')
    : '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">유사 이슈를 찾지 못했습니다 (캐시에 같은 타입 이슈 없음)</div>';

  const errorBadge = item.error
    ? `<span style="color:var(--warn);font-size:11px;">임베딩 실패: ${escHtml(item.error)}</span>`
    : '';

  const similarKeys = (item.similar || []).map(s => s.key);
  const verifyBtnHtml = similarKeys.length > 0
    ? `<button class="btn-ai-verify" onclick="verifyIssue('${escHtml(item.key)}', this)">🤖 AI검증</button>
       <div class="ai-verify-result"></div>`
    : '';

  wrap.innerHTML = `
    <div class="similar-card-header">
      <span class="issue-key">${escHtml(item.key)}</span>
      <span class="status-badge ${statusClass(item.status)}">${escHtml(item.status)}</span>
      <span class="type-badge">${escHtml(item.issuetype)}</span>
      <span style="font-size:11px;color:var(--text-muted)">${escHtml(item.assignee || '')}</span>
    </div>
    <div class="similar-card-title">${escHtml(item.summary)}</div>
    ${errorBadge}
    <div class="similar-list">${similarHtml}</div>
    ${verifyBtnHtml}
  `;
  // 카드에 similarKeys 저장 (DOM 접근 없이 클로저 대신 data속성 사용)
  wrap.dataset.issueKey = item.key;
  wrap.dataset.similarKeys = JSON.stringify(similarKeys);
  return wrap;
}

function scoreClass(score) {
  if (score >= 90) return 'score-high';
  if (score >= 75) return 'score-mid';
  return 'score-low';
}

async function verifyIssue(issueKey, btn) {
  const card = btn.closest('.similar-card');
  const similarKeys = JSON.parse(card.dataset.similarKeys || '[]');
  const resultEl = btn.nextElementSibling;

  btn.disabled = true;
  btn.textContent = '검증 중...';
  resultEl.innerHTML = `<div class="ai-verify-loading">
    <div class="dot-spin"><span></span><span></span><span></span></div>
    Gemini가 이슈 내용을 비교 중...
  </div>`;

  try {
    const res = await fetch('/api/ai-verify', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({issue_key: issueKey, similar_keys: similarKeys}),
    });
    const data = await res.json();
    if (data.ok) {
      const bestHtml = data.best_key
        ? `<div class="ai-verify-best">✅ 최적 매칭: <span class="sim-key">${escHtml(data.best_key)}</span></div>`
        : '';
      resultEl.innerHTML = `
        ${bestHtml}
        <div class="ai-verify-reason">${escHtml(data.reason)}</div>
      `;
    } else {
      resultEl.innerHTML = `<div class="ai-verify-error">⚠ ${escHtml(data.error)}</div>`;
    }
  } catch(e) {
    resultEl.innerHTML = `<div class="ai-verify-error">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 AI검증';
  }
}

// ── init ──
renderFields();
renderChips();
loadConfig().then(() => {
  initSimilarUsers();
  loadCacheStatus();
});
switchPage('similar');
