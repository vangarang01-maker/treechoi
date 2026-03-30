// ── 전역 상수 ──
const JIRA_KEYS  = ['JIRA_PAT_TOKEN', 'JIRA_USERNAME'];
const GEMINI_KEYS = ['GEMINI_API_KEY', 'GEMINI_MODEL'];
const DEVX_KEYS   = ['DEVX_API_KEY'];
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
    const badge = document.getElementById('gemini-model-badge');
    if (badge) {
      const provider = localStorage.getItem('AI_PROVIDER') || 'gemini';
      if (provider === 'devx') {
        badge.textContent = 'DevX AI';
      } else {
        const inp = document.getElementById('inp-GEMINI_MODEL');
        badge.textContent = (inp && inp.value) || 'gemini';
      }
    }
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
  { label: '🔍 참고 이슈 검색 사용법', q: '참고 이슈 검색은 어떻게 사용해?' },
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
  const devxEl   = document.getElementById('devx-fields-inline');
  if (jiraEl)   jiraEl.innerHTML   = FIELDS.filter(f => JIRA_KEYS.includes(f.key)).map(buildField).join('');
  if (geminiEl) geminiEl.innerHTML = FIELDS.filter(f => GEMINI_KEYS.includes(f.key)).map(buildField).join('');
  if (devxEl)   devxEl.innerHTML   = FIELDS.filter(f => DEVX_KEYS.includes(f.key)).map(buildField).join('');
}

// ── AI 제공자 토글 ──
function setProvider(provider) {
  localStorage.setItem('AI_PROVIDER', provider);

  const isDevx = provider === 'devx';
  document.getElementById('btn-provider-gemini').classList.toggle('active', !isDevx);
  document.getElementById('btn-provider-devx').classList.toggle('active', isDevx);
  document.getElementById('provider-desc-gemini').style.display = isDevx ? 'none' : '';
  document.getElementById('provider-desc-devx').style.display   = isDevx ? '' : 'none';
  document.getElementById('card-gemini').style.display = isDevx ? 'none' : '';
  document.getElementById('card-devx').style.display   = isDevx ? '' : 'none';

  // 안내데스크 model badge 갱신
  const badge = document.getElementById('gemini-model-badge');
  if (badge) {
    if (isDevx) {
      badge.textContent = 'DevX AI';
    } else {
      const modelInp = document.getElementById('inp-GEMINI_MODEL');
      badge.textContent = (modelInp && modelInp.value) || 'gemini';
    }
  }

  // 캐시구축 버튼 활성/비활성화
  _updateCacheBuildButtons(isDevx);

  // proj-badge 갱신 (Docker 환경에서 __env__ 대신 AI 제공자명 표시)
  const badgeEl = document.getElementById('proj-badge');
  if (badgeEl && (badgeEl.textContent === 'Gemini' || badgeEl.textContent === 'DevX AI')) {
    badgeEl.textContent = isDevx ? 'DevX AI' : 'Gemini';
  }

  // 서버에도 저장 시도
  fetch('/api/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({env: {AI_PROVIDER: provider}}),
  }).catch(() => {});
}

function _updateCacheBuildButtons(isDevx) {
  const tip = 'Gemini 모드에서만 사용 가능합니다.';
  ['build-btn-sr', 'build-btn-cm'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = isDevx;
    btn.title = isDevx ? tip : '';
    btn.style.opacity = isDevx ? '0.45' : '';
    btn.style.cursor  = isDevx ? 'not-allowed' : '';
  });
}

function _applyProviderUI() {
  const provider = localStorage.getItem('AI_PROVIDER') || 'gemini';
  setProvider(provider);
}

// ── 환경변수 패키징 ──
const _envManaged = new Set(); // __set__ 으로 내려온 필드 (Docker 환경)

function getEnv() {
  const env = {};
  [...JIRA_KEYS, ...GEMINI_KEYS, ...DEVX_KEYS].forEach(k => {
    env[k] = localStorage.getItem(k) || '';
  });
  env['AI_PROVIDER'] = localStorage.getItem('AI_PROVIDER') || 'gemini';
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
    }
    const serverEnv = data.env || {};

    // __set__ 필드가 새로 추가됐을 때 localStorage 구버전 값(서버에서 받은 값) 자동 제거
    const nowMasked = Object.keys(serverEnv).filter(k => serverEnv[k] === '__set__');
    const prevMasked = (localStorage.getItem('_masked_fields') || '').split(',').filter(Boolean);
    nowMasked.forEach(k => { if (!prevMasked.includes(k)) localStorage.removeItem(k); });
    localStorage.setItem('_masked_fields', nowMasked.join(','));
    const pk = data.projectKey || '';
    const provider = localStorage.getItem('AI_PROVIDER') || serverEnv['AI_PROVIDER'] || 'gemini';
    const providerLabel = provider === 'devx' ? 'DevX AI' : 'Gemini';
    if (pk === '__env__' || !pk) {
      document.getElementById('proj-badge').textContent = providerLabel;
    } else {
      document.getElementById('proj-badge').textContent = pk.split(/[\\/]/).pop() || pk;
    }

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

    // AI 제공자: 서버 값이 있으면 항상 동기화 (Docker 등 서버 설정이 우선)
    const serverProvider = serverEnv['AI_PROVIDER'];
    if (serverProvider) {
      localStorage.setItem('AI_PROVIDER', serverProvider);
    }
    _applyProviderUI();

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
async function saveGeminiSettings() {
  const env = {};
  GEMINI_KEYS.forEach(key => {
    const inp = document.getElementById('inp-' + key);
    if (inp) {
      env[key] = inp.value;
      localStorage.setItem(key, inp.value);
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
async function saveJiraSettings() {
  const env = {};
  JIRA_KEYS.forEach(key => {
    const inp = document.getElementById('inp-' + key);
    if (inp) {
      env[key] = inp.value;
      localStorage.setItem(key, inp.value);
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

// ── DevX AI 설정 저장 ──
async function saveDevxSettings() {
  const env = {};
  DEVX_KEYS.forEach(key => {
    const inp = document.getElementById('inp-' + key);
    if (inp) {
      env[key] = inp.value;
      localStorage.setItem(key, inp.value);
    }
  });
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env}),
    });
    const data = await res.json();
    showToast(data.ok ? '✓ 브라우저 및 서버 저장 완료' : '✓ 브라우저에 저장됨', data.ok ? 'success' : 'info');
  } catch(e) {
    showToast('✓ 브라우저에 저장됨', 'info');
  }
}

// ── DevX AI 상태 확인 ──
async function checkDevxAI() {
  const btn = document.getElementById('devx-check-btn');
  btn.disabled = true;
  btn.textContent = '확인 중...';
  try {
    const res = await fetch('/api/ai-check', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env: getEnv()}),
    });
    const data = await res.json();
    const area = document.getElementById('dstatus');
    const dot  = document.getElementById('dstatus-dot');
    const text = document.getElementById('dstatus-text');
    const meta = document.getElementById('dstatus-meta');
    area.style.display = 'flex';
    const now = new Date().toLocaleTimeString('ko-KR');
    if (data.ok) {
      dot.className = 'gstatus-dot ok';
      text.textContent = '정상';
      meta.textContent = `${data.latency_ms}ms · ${now}`;
    } else {
      dot.className = 'gstatus-dot ' + (data.status === 'no_key' ? 'warn' : 'err');
      text.textContent = data.status === 'no_key' ? 'API 키 미설정' : (data.message || '오류');
      meta.textContent = (data.latency_ms ? `${data.latency_ms}ms · ` : '') + now;
    }
  } catch(e) {
    showToast('❌ ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ 상태 확인';
  }
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
