const JIRA_KEYS  = ['JIRA_PAT_TOKEN', 'JIRA_USERNAME'];
const GEMINI_KEYS = ['GEMINI_API_KEY', 'GEMINI_MODEL'];
const JIRA_BASE_URL = "https://jira.sinc.co.kr";

// ── 테마 ──
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'light' ? '🌙 다크' : '☀ 라이트';
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
}
(function () {
  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);
})();

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

// ── 안내데스크 칩 렌더 ──
const _HELPDESK_CHIPS = [
  { label: '🚀 처음 시작하는 방법', q: '처음 시작하는 방법을 알려줘. 어떤 설정이 필요해?' },
  { label: '🔑 API 키 발급 방법', q: 'Gemini API 키랑 Jira PAT Token은 어떻게 발급해?' },
  { label: '🪄 처리 마법사 사용법', q: '처리 마법사는 어떻게 사용해?' },
  { label: '🔍 유사 이슈 검색 사용법', q: '유사 이슈 검색은 어떻게 사용해?' },
  { label: '💬 이슈 조회 / JQL', q: 'Jira 이슈 조회하는 방법이랑 JQL 검색 방법 알려줘.' },
  { label: '📋 기능 전체 목록', q: 'sbe-jira-ui에 어떤 기능들이 있어? 전체 기능을 설명해줘.' },
];

function renderHelpdeskChips() {
  const area = document.getElementById('gemini-chip-area');
  if (!area) return;
  area.innerHTML = _HELPDESK_CHIPS.map(c =>
    `<button class="chip" onclick="sendHelpdeskChip('${c.q.replace(/'/g, "\\'")}')">${c.label}</button>`
  ).join('');
}

function sendHelpdeskChip(q) {
  const input = document.getElementById('gemini-input');
  if (input) { input.value = q; sendGemini(); }
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

// ── 환경변수 패키징 ──
const _envManaged = new Set(); // __set__ 으로 내려온 필드 (Docker 환경)

function getEnv() {
  const env = {};
  [...JIRA_KEYS, ...GEMINI_KEYS].forEach(k => {
    env[k] = localStorage.getItem(k) || '';
  });
  return env;
}

// 필수 키가 비어있으면 토스트 후 false 반환
function requireEnv(keys) {
  const missing = keys.filter(k => _envManaged.has(k) && !localStorage.getItem(k));
  if (missing.length === 0) return true;
  const labels = { JIRA_PAT_TOKEN: 'Jira PAT Token', JIRA_USERNAME: 'Jira 사용자명(사번)', GEMINI_API_KEY: 'Gemini API Key' };
  const names = missing.map(k => labels[k] || k).join(', ');
  showToast(`❌ ${names}을(를) 환경설정에서 먼저 입력해주세요.`, 'error');
  return false;
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.error) {
      showToast('❌ ' + data.error, 'error');
      // 에러가 나더라도 localStorage 값은 로드 시도
    }
    const serverEnv = data.env || {};

    // __set__ 필드가 새로 추가됐을 때 localStorage 구버전 값(서버에서 받은 값) 자동 제거
    const nowMasked = Object.keys(serverEnv).filter(k => serverEnv[k] === '__set__');
    const prevMasked = (localStorage.getItem('_masked_fields') || '').split(',').filter(Boolean);
    nowMasked.forEach(k => { if (!prevMasked.includes(k)) localStorage.removeItem(k); });
    localStorage.setItem('_masked_fields', nowMasked.join(','));
    const pk = data.projectKey || '';
    document.getElementById('proj-badge').textContent = pk.split(/[\\/]/).pop() || pk || '-';
    
    FIELDS.forEach(f => {
      const inp = document.getElementById('inp-' + f.key);
      if (inp) {
        const serverVal = serverEnv[f.key] || '';
        if (serverVal === '__set__') {
          // Docker 환경: 개인 키를 직접 입력해야 작동
          _envManaged.add(f.key);
          const localVal = localStorage.getItem(f.key) || '';
          inp.value = localVal;
          inp.placeholder = f.docker_placeholder || '직접 입력 필요';
          inp.classList.add('env-managed');
          const dot = document.getElementById('dot-' + f.key);
          if (dot) dot.className = 'field-status ok';
        } else {
          // localStorage 우선, 없으면 서버 값
          const val = localStorage.getItem(f.key) || serverVal;
          if (f.type === 'select') {
            inp.value = val || (f.options && f.options[0] ? f.options[0].value : '');
          } else {
            inp.value = val;
          }
          updateDot(f.key);
        }
      }
    });
    const modelInp = document.getElementById('inp-GEMINI_MODEL');
    const badge = document.getElementById('gemini-model-badge');
    if (modelInp && badge) badge.textContent = modelInp.value || 'gemini';

    // 히스토리 로드
    const saved = localStorage.getItem('gemini_chat_history');
    if (saved) {
      geminiHistory = JSON.parse(saved);
      if (geminiHistory.length > 0) {
        const hint = document.getElementById('gemini-empty-hint');
        if (hint) hint.remove();
        geminiHistory.forEach(h => {
          if (h.role === 'user') appendGeminiUser(h.text, false);
          else appendGeminiBot(h.text, 0, '', false);
        });
      }
    }
  } catch(e) {
    showToast('❌ 로드 실패: ' + e.message, 'error');
  }
}

// ── Gemini 설정 저장 ──
// ── Gemini 설정 저장 ──
async function saveGeminiSettings() {
  const env = {};
  GEMINI_KEYS.forEach(key => {
    const inp = document.getElementById('inp-' + key);
    if (inp) {
      env[key] = inp.value;
      localStorage.setItem(key, inp.value); // 브라우저 저장
    }
  });

  // 서버 동기화 시도 (선택 사항)
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env}),
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✓ 브라우저 및 서버 저장 완료', 'success');
    } else {
      // 서버 저장 실패해도 브라우저에는 저장됨
      showToast('✓ 브라우저에 저장됨 (서버 저장 skip: ' + data.error + ')', 'info');
    }
    const modelInp = document.getElementById('inp-GEMINI_MODEL');
    const badge = document.getElementById('gemini-model-badge');
    if (modelInp && badge) badge.textContent = modelInp.value || 'gemini';
  } catch(e) {
    showToast('✓ 브라우저에 저장됨', 'info');
  }
}

// ── Jira 설정 저장 ──
// ── Jira 설정 저장 ──
async function saveJiraSettings() {
  const env = {};
  JIRA_KEYS.forEach(key => {
    const inp = document.getElementById('inp-' + key);
    if (inp) {
      env[key] = inp.value;
      localStorage.setItem(key, inp.value); // 브라우저 저장
    }
  });
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env}),
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✓ 브라우저 및 서버 저장 완료', 'success');
    } else {
      showToast('✓ 브라우저에 저장됨', 'info');
    }
  } catch(e) {
    showToast('✓ 브라우저에 저장됨', 'info');
  }
}

// ── Jira 채팅 ──
function sendChatQuery(q) {
  document.getElementById('chat-input').value = q;
  sendChat();
}

async function sendChat() {
  if (!requireEnv(JIRA_KEYS)) return;
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
      body: JSON.stringify({query: q, env: getEnv()}),
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
  let guide = '';
  if (msg.includes('401')) guide = '<br><small>Jira PAT Token이 만료되었거나 잘못되었습니다.</small>';
  if (msg.includes('403')) guide = '<br><small>Jira 프로젝트/이슈에 대한 접근 권한이 없습니다.</small>';
  
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `<div class="error-card">⚠ ${escHtml(msg)}${guide}</div>`;
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
    const res = await fetch('/api/gemini-check', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env: getEnv()}),
    });
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

// ── Jira 상태 확인 ──
async function checkJira() {
  const btn = document.getElementById('jira-check-btn');
  btn.disabled = true;
  btn.textContent = '확인 중...';

  try {
    const res = await fetch('/api/jira-check', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env: getEnv()}),
    });
    const data = await res.json();
    showJiraStatus(data);
  } catch(e) {
    showJiraStatus({ ok: false, error: e.message });
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ 연결 확인';
  }
}

function showJiraStatus(data) {
  const area = document.getElementById('jstatus');
  const dot  = document.getElementById('jstatus-dot');
  const text = document.getElementById('jstatus-text');
  const meta = document.getElementById('jstatus-meta');

  area.style.display = 'flex';
  const now = new Date().toLocaleTimeString('ko-KR');

  if (data.ok) {
    dot.className  = 'gstatus-dot ok';
    text.textContent = '정상';
    meta.textContent = `${data.displayName} (${data.name}) · ${now}`;
  } else {
    dot.className  = 'gstatus-dot err';
    text.textContent = '연결 실패';
    meta.textContent = (data.error || '오류') + ' · ' + now;
  }
}

// ── Gemini 채팅 ──
let geminiHistory = [];

async function sendGemini() {
  if (!requireEnv(GEMINI_KEYS)) return;
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
      body: JSON.stringify({message: msg, env: getEnv()}),
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
        body: JSON.stringify({message: msg, history: geminiHistory, env: getEnv()}),
      });
      const chatData = await chatRes.json();
      chatSpinner.remove();
      
      if (!chatData.ok) {
        appendGeminiError(chatData.error || '응답 오류');
      } else {
        geminiHistory.push({role: 'user', text: msg});
        geminiHistory.push({role: 'model', text: chatData.reply});
        localStorage.setItem('gemini_chat_history', JSON.stringify(geminiHistory));
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
      body: JSON.stringify({action, env: getEnv()}),
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
  localStorage.removeItem('gemini_chat_history');
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

function appendGeminiUser(text, scroll = true) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap user';
  wrap.innerHTML = `<div class="bubble-user">${escHtml(text).replace(/\n/g,'<br>')}</div>`;
  getGeminiHistory().appendChild(wrap);
  if (scroll) scrollGeminiBottom();
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

function appendGeminiBot(text, latency, model, scroll = true) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  const html = markdownToHtml(text);
  const meta = latency ? `<div class="gemini-meta">${latency}ms · ${model || ''}</div>` : '';
  wrap.innerHTML = `<div class="bubble-gemini">${html}${meta}</div>`;
  getGeminiHistory().appendChild(wrap);
  if (scroll) scrollGeminiBottom();
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
  renderUserTags();
}

function renderUserTags() {
  const area = document.getElementById('user-tags');
  if (!area) return;
  area.innerHTML = similarUsers.map((u, i) => `
    <span class="user-tag">
      ${escHtml(u)}
      <button class="user-tag-remove" onclick="removeUser(${i})">✕</button>
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

async function buildCache(issuetype) {
  if (!requireEnv([...JIRA_KEYS, 'GEMINI_API_KEY'])) return;
  const btnId = issuetype === '서비스요청관리' ? 'build-btn-sr' : 'build-btn-cm';
  const btn = document.getElementById(btnId);
  const otherBtnId = issuetype === '서비스요청관리' ? 'build-btn-cm' : 'build-btn-sr';
  const otherBtn = document.getElementById(otherBtnId);
  const progressArea = document.getElementById('build-progress-area');
  const buildMsg = document.getElementById('build-msg');
  const buildBar = document.getElementById('build-bar');
  const buildPercent = document.getElementById('build-percent');

  if (!similarUsers || similarUsers.length === 0) {
    showToast('⚠ 대상 사용자를 1명 이상 추가해주세요.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '🔄 구축 중...';
  otherBtn.disabled = true;
  progressArea.style.display = 'block';
  buildBar.style.width = '0%';
  buildPercent.textContent = '0%';
  buildMsg.textContent = '준비 중...';

  const userParams = similarUsers.map(u => `users=${encodeURIComponent(u)}`).join('&');
  const wsUrl = `/api/embedding-build-stream?${userParams}&issuetype=${encodeURIComponent(issuetype)}`;
  
  const ev = new EventSource(wsUrl);

  ev.onmessage = (e) => {
    const data = JSON.parse(e.data);
    
    if (data.ok === false) {
      showToast('❌ ' + data.error, 'error');
      ev.close();
      btn.disabled = false;
      btn.textContent = issuetype === '서비스요청관리' ? '🔄 서비스요청관리' : '🔄 변경관리';
      otherBtn.disabled = false;
      return;
    }

    if (data.step === 'jira_search') {
      buildMsg.textContent = data.msg;
    } else if (data.step === 'start') {
      buildMsg.textContent = data.msg;
    } else if (data.step === 'progress') {
      const p = Math.floor((data.current / data.total) * 100);
      buildBar.style.width = p + '%';
      buildPercent.textContent = p + '%';
      buildMsg.textContent = `${data.key} 처리 중...`;
    } else if (data.step === 'done') {
      const res = data.result;
      const detail = res.embed_error ? ` (오류: ${res.embed_error})` : '';
      const jiraInfo = res.jira_counts
        ? ' Jira: ' + Object.entries(res.jira_counts).map(([t,n]) => `${t} ${n}건`).join(', ')
        : '';
      
      showToast(`✓ 완료 — ${res.total}건 (신규 ${res.added}, 재사용 ${res.reused}, 실패 ${res.skipped})${jiraInfo}${detail}`, res.skipped > 0 ? 'error' : 'success');
      
      buildMsg.textContent = '구축 완료!';
      buildBar.style.width = '100%';
      buildPercent.textContent = '100%';
      
      ev.close();
      btn.disabled = false;
      btn.textContent = issuetype === '서비스요청관리' ? '🔄 서비스요청관리' : '🔄 변경관리';
      otherBtn.disabled = false;
      loadCacheStatus();
      
      setTimeout(() => {
        progressArea.style.display = 'none';
      }, 3000);
    }
  };

  ev.onerror = (e) => {
    showToast('❌ 연결 오류 또는 중단됨', 'error');
    console.error('SSE Error:', e);
    ev.close();
    btn.disabled = false;
    btn.textContent = issuetype === '서비스요청관리' ? '🔄 서비스요청관리' : '🔄 변경관리';
    otherBtn.disabled = false;
    progressArea.style.display = 'none';
  };
}

async function searchSimilar() {
  if (!requireEnv([...JIRA_KEYS, 'GEMINI_API_KEY'])) return;
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
      body: JSON.stringify({users: similarUsers, env: getEnv()}),
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

    // 유형별 그룹화
    const groups = {};
    for (const item of data.results) {
      const type = item.issuetype || '기타';
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    }

    results.innerHTML = '';
    // 유형명으로 정렬하여 출력
    const sortedTypes = Object.keys(groups).sort();
    for (const type of sortedTypes) {
      results.appendChild(buildTypeSection(type, groups[type]));
    }
  } catch(e) {
    results.innerHTML = `<div class="error-card">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 유사 이슈 검색';
  }
}

function buildTypeSection(type, items) {
  const section = document.createElement('div');
  section.className = 'type-section';
  
  const header = document.createElement('div');
  header.className = 'type-section-header';
  header.onclick = () => toggleTypeSection(header);
  header.innerHTML = `
    <span class="type-section-title">${escHtml(type)}</span>
    <span class="type-section-count">${items.length}건</span>
    <span class="type-section-arrow">▼</span>
  `;
  
  const body = document.createElement('div');
  body.className = 'type-section-body active';
  for (const item of items) {
    body.appendChild(buildSimilarCard(item));
  }
  
  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function toggleTypeSection(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector('.type-section-arrow');
  const isActive = body.classList.toggle('active');
  arrow.textContent = isActive ? '▼' : '▶';
  header.classList.toggle('collapsed', !isActive);
}

function buildSimilarCard(item) {
  const wrap = document.createElement('div');
  wrap.className = 'similar-card';

  const similarHtml = item.similar && item.similar.length > 0
    ? item.similar.map(s => `
        <div class="similar-row">
          <span class="sim-score ${scoreClass(s.score)}">${s.score}%</span>
          <a class="sim-key" href="${JIRA_BASE_URL}/browse/${escHtml(s.key)}" target="_blank" rel="noopener">${escHtml(s.key)}</a>
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
      <a class="issue-key" href="${JIRA_BASE_URL}/browse/${escHtml(item.key)}" target="_blank" rel="noopener">${escHtml(item.key)}</a>
      <span class="status-badge ${statusClass(item.status)}">${escHtml(item.status)}</span>
      <span class="type-badge">${escHtml(item.issuetype)}</span>
      <span style="font-size:11px;color:var(--text-muted)">${escHtml(item.assignee || '')}</span>
    </div>
    <div class="similar-card-title">${escHtml(item.summary)}</div>
    ${errorBadge}
    <div class="similar-list">${similarHtml}</div>
    ${verifyBtnHtml}
    
    <div class="card-actions">
      <button class="btn-action" onclick="toggleCommentForm('${escHtml(item.key)}', this)">
        <i class="far fa-comment-dots"></i> 댓글
      </button>
      <button class="btn-action" onclick="toggleTransitionForm('${escHtml(item.key)}', this)">
        <i class="fas fa-exchange-alt"></i> 상태
      </button>
      <a href="${JIRA_BASE_URL}/browse/${escHtml(item.key)}" target="_blank" class="btn-action" style="text-decoration:none">
        <i class="fas fa-external-link-alt"></i> Jira
      </a>
    </div>

    <!-- 액션 폼 영역 (기본 숨김) -->
    <div id="comment-form-${escHtml(item.key)}" class="action-form" style="display:none">
      <textarea placeholder="댓글 내용을 입력하세요..." rows="2"></textarea>
      <div class="action-form-footer">
        <button class="btn-form-cancel" onclick="toggleCommentForm('${escHtml(item.key)}')">취소</button>
        <button class="btn-form-submit" onclick="submitComment('${escHtml(item.key)}')">등록</button>
      </div>
    </div>

    <div id="transition-form-${escHtml(item.key)}" class="action-form" style="display:none">
      <select id="trans-select-${escHtml(item.key)}">
        <option value="">불러오는 중...</option>
      </select>
      <div class="action-form-footer">
        <button class="btn-form-cancel" onclick="toggleTransitionForm('${escHtml(item.key)}')">취소</button>
        <button class="btn-form-submit" onclick="submitTransition('${escHtml(item.key)}')">변경</button>
      </div>
    </div>
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
      body: JSON.stringify({
        issue_key: issueKey, 
        similar_keys: similarKeys,
        env: getEnv()
      }),
    });
    const data = await res.json();
    if (data.ok) {
      const bestHtml = data.best_key
        ? `<div class="ai-verify-best">✅ 최적 매칭: <a class="sim-key" href="https://jira.sinc.co.kr/browse/${escHtml(data.best_key)}" target="_blank" rel="noopener">${escHtml(data.best_key)}</a></div>`
        : '';
      const draftBtnHtml = data.best_key
        ? `<button class="btn-draft" onclick="draftComment('${escHtml(issueKey)}', '${escHtml(data.best_key)}', this)">✍ 처리 초안 작성</button>
           <div class="draft-area"></div>`
        : '';
      resultEl.innerHTML = `
        ${bestHtml}
        <div class="ai-verify-reason">${escHtml(data.reason)}</div>
        ${draftBtnHtml}
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

// ── 처리 초안 자동 생성 ──

async function draftComment(issueKey, bestKey, btn) {
  const draftArea = btn.nextElementSibling;
  btn.disabled = true;
  btn.textContent = '초안 생성 중...';
  draftArea.innerHTML = `<div class="ai-verify-loading">
    <div class="dot-spin"><span></span><span></span><span></span></div>
    Gemini가 처리 초안을 작성 중...
  </div>`;

  try {
    const res = await fetch('/api/draft-comment', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        issue_key: issueKey,
        best_key: bestKey,
        env: getEnv()
      }),
    });
    const data = await res.json();
    if (data.ok) {
      const meta = data.latency_ms ? `<span class="draft-meta">${data.latency_ms}ms · ${data.model || ''}</span>` : '';
      draftArea.innerHTML = `
        <div class="draft-box">
          <div class="draft-header">
            <span>✍ AI 처리 초안</span>
            ${meta}
          </div>
          <textarea class="draft-textarea" rows="5">${escHtml(data.draft)}</textarea>
          <div class="draft-footer">
            <button class="btn-form-cancel" onclick="this.closest('.draft-box').remove()">취소</button>
            <button class="btn-draft-submit" onclick="submitDraft('${escHtml(issueKey)}', this)">📝 Jira에 댓글 등록</button>
          </div>
        </div>
      `;
      btn.style.display = 'none';
    } else {
      draftArea.innerHTML = `<div class="ai-verify-error">⚠ ${escHtml(data.error)}</div>`;
    }
  } catch(e) {
    draftArea.innerHTML = `<div class="ai-verify-error">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '✍ 처리 초안 작성';
  }
}

async function submitDraft(issueKey, btn) {
  const draftBox = btn.closest('.draft-box');
  const textarea = draftBox.querySelector('.draft-textarea');
  const comment = textarea.value.trim();
  if (!comment) { showToast('⚠ 댓글 내용이 비어있습니다.', 'error'); return; }

  btn.disabled = true;
  btn.textContent = '등록 중...';

  try {
    const res = await fetch('/api/jira-update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        key: issueKey,
        comment: comment,
        env: getEnv()
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✅ ${issueKey} 댓글 등록 완료`, 'success');
      draftBox.innerHTML = `<div class="draft-success">✅ 댓글이 성공적으로 등록되었습니다.</div>`;
    } else {
      showToast(`❌ 오류: ${data.error}`, 'error');
      btn.disabled = false;
      btn.textContent = '📝 Jira에 댓글 등록';
    }
  } catch(e) {
    showToast('❌ 네트워크 오류', 'error');
    btn.disabled = false;
    btn.textContent = '📝 Jira에 댓글 등록';
  }
}

// ── 이슈 인라인 액션 핸들러 ──

function toggleCommentForm(key, btn) {
  const form = document.getElementById(`comment-form-${key}`);
  const transForm = document.getElementById(`transition-form-${key}`);
  if (transForm) transForm.style.display = 'none';

  if (form) {
    if (form.style.display === 'none') {
      form.style.display = 'flex';
      form.querySelector('textarea').focus();
    } else {
      form.style.display = 'none';
    }
  }
}

async function submitComment(key) {
  const form = document.getElementById(`comment-form-${key}`);
  const textarea = form.querySelector('textarea');
  const comment = textarea.value.trim();
  const btn = form.querySelector('.btn-form-submit');

  if (!comment) return;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/jira-update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        key: key,
        comment: comment,
        env: getEnv()
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✅ ${key} 댓글 등록 완료`, 'success');
      form.style.display = 'none';
      textarea.value = '';
    } else {
      showToast(`❌ 오류: ${data.error}`, 'error');
    }
  } catch(e) {
    showToast(`❌ 네트워크 오류`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '등록';
  }
}

async function toggleTransitionForm(key, btn) {
  const form = document.getElementById(`transition-form-${key}`);
  const commForm = document.getElementById(`comment-form-${key}`);
  if (commForm) commForm.style.display = 'none';

  if (!form) return;

  if (form.style.display === 'none') {
    form.style.display = 'flex';
    const select = document.getElementById(`trans-select-${key}`);
    // 아직 안불러왔으면(기본옵션이 '불러오는 중...') 가져오기
    if (select.options.length === 1 && select.options[0].value === "") {
      try {
        const res = await fetch(`/api/jira-transitions?key=${key}`);
        const data = await res.json();
        if (data.ok) {
          select.innerHTML = data.transitions.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
          if (data.transitions.length === 0) {
            select.innerHTML = '<option value="">변경 가능한 상태 없음</option>';
          }
        } else {
          select.innerHTML = `<option value="">불러오기 실패</option>`;
        }
      } catch(e) {
        select.innerHTML = `<option value="">에러 발생</option>`;
      }
    }
  } else {
    form.style.display = 'none';
  }
}

async function submitTransition(key) {
  const form = document.getElementById(`transition-form-${key}`);
  const select = document.getElementById(`trans-select-${key}`);
  const tid = select.value;
  const btn = form.querySelector('.btn-form-submit');

  if (!tid) return;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/jira-update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        key: key,
        transition: tid,
        env: getEnv()
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✅ ${key} 상태 변경 완료`, 'success');
      form.style.display = 'none';
      // UI상의 현재 상태 뱃지도 업데이트해주면 좋지만, 일단 토스트로 만족
    } else {
      showToast(`❌ 오류: ${data.error}`, 'error');
    }
  } catch(e) {
    showToast(`❌ 네트워크 오류`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '변경';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 처리 마법사
// ══════════════════════════════════════════════════════════════════════════════

let wizardCurrentKey = '';
let wizardCurrentData = null;

async function wizardDetect() {
  if (!requireEnv(JIRA_KEYS)) return;
  const input = document.getElementById('wizard-key-input');
  const key = input.value.trim().toUpperCase();
  if (!key) { showToast('이슈 키를 입력하세요.', 'error'); return; }

  const btn = document.getElementById('wizard-detect-btn');
  btn.disabled = true;
  btn.textContent = '조회 중...';

  document.getElementById('wizard-result').style.display = 'none';
  document.getElementById('wizard-empty-hint').style.display = 'none';
  document.getElementById('wizard-drafts').innerHTML = '';

  try {
    const res = await fetch(`/api/wizard-detect?key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if (!data.ok) {
      showToast('❌ ' + data.error, 'error');
      document.getElementById('wizard-empty-hint').style.display = '';
      return;
    }
    wizardCurrentKey = key;
    wizardCurrentData = data;
    renderWizardResult(data);
  } catch(e) {
    showToast('❌ 네트워크 오류', 'error');
    document.getElementById('wizard-empty-hint').style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '조회';
  }
}

function renderWizardResult(data) {
  // 이슈 제목 (Jira 링크)
  document.getElementById('wizard-issue-title').innerHTML =
    `<a href="${JIRA_BASE_URL}/browse/${data.key}" target="_blank">${escHtml(data.key)}</a> ${escHtml(data.summary)}`;

  // 배지
  document.getElementById('wizard-type-badge').textContent = data.issue_type || '알 수 없음';
  document.getElementById('wizard-status-badge').textContent = data.status || '';
  const urgentBadge = document.getElementById('wizard-urgent-badge');
  urgentBadge.style.display = data.is_urgent ? '' : 'none';

  // pre-flight (변경관리)
  const preflight = document.getElementById('wizard-preflight');
  if (data.issue_type === '변경관리') {
    preflight.style.display = '';
    const sel = document.getElementById('wizard-change-type');
    if (data.change_type) sel.value = data.change_type;
    document.getElementById('wizard-is-urgent').checked = data.is_urgent;
  } else {
    preflight.style.display = 'none';
  }

  // pre-flight (서비스요청관리 — 업무유형 선택)
  const srPreflight = document.getElementById('wizard-sr-preflight');
  if (data.issue_type === '서비스요청관리') {
    srPreflight.style.display = '';
    const srSel = document.getElementById('wizard-sr-work-type');
    if (data.sr_work_type) srSel.value = data.sr_work_type;
  } else {
    srPreflight.style.display = 'none';
  }

  // 다음 할 일
  document.getElementById('wizard-next-text').textContent = data.next_action;

  // 초안 버튼 렌더
  const draftsEl = document.getElementById('wizard-drafts');
  draftsEl.innerHTML = '';
  (data.available_drafts || []).forEach(dtype => {
    const label = (data.draft_labels || {})[dtype] || dtype;
    const section = document.createElement('div');
    section.className = 'wizard-draft-section';
    section.id = 'draft-section-' + dtype;
    section.innerHTML = `
      <div class="wizard-draft-header">
        <span class="wizard-draft-label">${escHtml(label)}</span>
        <button class="btn btn-secondary wizard-draft-btn" onclick="wizardGenerateDraft('${dtype}')">🤖 AI 초안 생성</button>
      </div>
      <div class="wizard-draft-body" id="draft-body-${dtype}" style="display:none">
        <textarea class="wizard-textarea" id="draft-text-${dtype}" rows="10" spellcheck="false"></textarea>
        <div class="wizard-draft-actions">
          <span class="wizard-fallback-note" id="draft-fallback-${dtype}" style="display:none">⚠ AI 생성 실패 — 템플릿 사용됨</span>
          <button class="btn btn-secondary" onclick="wizardCopyDraft('${dtype}')">📋 복사</button>
        </div>
      </div>`;
    draftsEl.appendChild(section);
  });

  document.getElementById('wizard-result').style.display = '';
}

async function wizardGenerateDraft(draftType) {
  if (!requireEnv([...JIRA_KEYS, 'GEMINI_API_KEY'])) return;
  const btn = document.querySelector(`#draft-section-${draftType} .wizard-draft-btn`);
  btn.disabled = true;
  btn.textContent = '생성 중...';

  const overrides = {};
  if (wizardCurrentData && wizardCurrentData.issue_type === '변경관리') {
    overrides.change_type = document.getElementById('wizard-change-type').value;
    overrides.is_urgent = document.getElementById('wizard-is-urgent').checked;
  }
  if (wizardCurrentData && wizardCurrentData.issue_type === '서비스요청관리') {
    overrides.sr_work_type = document.getElementById('wizard-sr-work-type').value;
  }

  try {
    const res = await fetch('/api/wizard-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issue_key: wizardCurrentKey,
        draft_type: draftType,
        overrides,
        env: getEnv(),
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      showToast('❌ ' + data.error, 'error');
      return;
    }
    const textarea = document.getElementById('draft-text-' + draftType);
    const body = document.getElementById('draft-body-' + draftType);
    const fallbackNote = document.getElementById('draft-fallback-' + draftType);
    textarea.value = data.content || '';
    fallbackNote.style.display = data.fallback ? '' : 'none';
    body.style.display = '';
    btn.textContent = '🔄 재생성';
  } catch(e) {
    showToast('❌ 네트워크 오류', 'error');
  } finally {
    btn.disabled = false;
    if (btn.textContent === '생성 중...') btn.textContent = '🤖 AI 초안 생성';
  }
}

async function wizardCopyDraft(draftType) {
  const textarea = document.getElementById('draft-text-' + draftType);
  if (!textarea || !textarea.value) { showToast('복사할 내용이 없습니다.', 'error'); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textarea.value);
    } else {
      // HTTP 환경 fallback
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      document.execCommand('copy');
    }
    showToast('📋 클립보드에 복사됐습니다.', 'success');
  } catch(e) {
    showToast('❌ 복사 실패: ' + e.message, 'error');
  }
}

// ── init ──
renderFields();
renderChips();
renderHelpdeskChips();
loadConfig().then(() => {
  initSimilarUsers();
  loadCacheStatus();
});
switchPage('gemini');
