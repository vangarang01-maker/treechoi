// ── 주간보고 ──

const DEFAULT_STATUS_MAP = {
  '검토중': ['미해결', '영향도 분석'],
  '진행중': ['개발 중', '배포 계획 완료', '배포 승인 대기', '배포', '긴급 배포', '긴급배포 확인 대기', '진행 중', '변경 결재 대기', '결재 대기'],
  '완료':   ['완료'],
};

let weeklyIssues = [];
let weeklyStatusMap = {};
let weeklyDeadlineOverrides = {};

function initWeeklyReport() {
  // 날짜 기본값: 이번 주 월~금
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  document.getElementById('weekly-from').value = _weeklyFmtDate(monday);
  document.getElementById('weekly-to').value   = _weeklyFmtDate(friday);

  // 상태 매핑 로드
  try {
    const saved = localStorage.getItem('weekly_status_map');
    weeklyStatusMap = saved ? JSON.parse(saved) : _deepCopy(DEFAULT_STATUS_MAP);
  } catch(e) {
    weeklyStatusMap = _deepCopy(DEFAULT_STATUS_MAP);
  }
  renderWeeklyMapping();
}

function _weeklyFmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function _deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function _saveWeeklyStatusMap() {
  try { localStorage.setItem('weekly_status_map', JSON.stringify(weeklyStatusMap)); } catch(e) {}
}

// ── 매핑 UI ──

function toggleWeeklyMapping() {
  const body  = document.getElementById('weekly-mapping-body');
  const arrow = document.getElementById('weekly-mapping-arrow');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  arrow.textContent = isOpen ? '▶' : '▼';
}

function renderWeeklyMapping() {
  ['검토중', '진행중', '완료'].forEach(group => {
    const el = document.getElementById('mapping-tags-' + group);
    if (!el) return;
    el.innerHTML = '';
    (weeklyStatusMap[group] || []).forEach(s => {
      const tag = document.createElement('span');
      tag.className = 'user-tag';
      tag.innerHTML = `${escHtml(s)} <span class="user-tag-remove" onclick="weeklyRemoveMappingStatus('${group}','${escHtml(s)}')">×</span>`;
      el.appendChild(tag);
    });
  });
}

function weeklyAddMappingStatus(group) {
  const input = document.getElementById('mapping-input-' + group);
  const val = (input.value || '').trim();
  if (!val) return;
  if (!weeklyStatusMap[group]) weeklyStatusMap[group] = [];
  if (!weeklyStatusMap[group].includes(val)) {
    weeklyStatusMap[group].push(val);
    _saveWeeklyStatusMap();
    renderWeeklyMapping();
  }
  input.value = '';
}

function weeklyRemoveMappingStatus(group, status) {
  if (!weeklyStatusMap[group]) return;
  weeklyStatusMap[group] = weeklyStatusMap[group].filter(s => s !== status);
  _saveWeeklyStatusMap();
  renderWeeklyMapping();
}

function weeklyResetMapping() {
  weeklyStatusMap = _deepCopy(DEFAULT_STATUS_MAP);
  _saveWeeklyStatusMap();
  renderWeeklyMapping();
  showToast('기본값으로 초기화했습니다.', 'success');
}

function _weeklyGetGroup(statusName) {
  for (const [group, statuses] of Object.entries(weeklyStatusMap)) {
    if (statuses.includes(statusName)) return group;
  }
  return '기타';
}

// ── 이슈 조회 ──

async function weeklyFetch() {
  if (!requireEnv(JIRA_KEYS)) return;
  const dateFrom = document.getElementById('weekly-from').value;
  const dateTo   = document.getElementById('weekly-to').value;
  if (!dateFrom || !dateTo) { showToast('기간을 설정하세요.', 'error'); return; }

  const btn = document.getElementById('weekly-fetch-btn');
  btn.disabled = true;
  btn.textContent = '조회 중...';

  document.getElementById('weekly-empty-hint').style.display  = 'none';
  document.getElementById('weekly-issues-area').style.display = 'none';
  document.getElementById('weekly-result-area').style.display = 'none';

  try {
    const res = await fetch('/api/weekly-issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_from: dateFrom, date_to: dateTo, env: getEnv() }),
    });
    const data = await res.json();
    if (!data.ok) {
      showToast('❌ ' + data.error, 'error');
      document.getElementById('weekly-empty-hint').style.display = '';
      return;
    }
    weeklyIssues = data.issues || [];
    weeklyDeadlineOverrides = {};
    _renderWeeklyIssues();
  } catch(e) {
    showToast('❌ 네트워크 오류', 'error');
    document.getElementById('weekly-empty-hint').style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '📋 이슈 조회';
  }
}

function _renderWeeklyIssues() {
  if (!weeklyIssues.length) {
    showToast('조회된 이슈가 없습니다.', 'error');
    document.getElementById('weekly-empty-hint').style.display = '';
    return;
  }

  document.getElementById('weekly-issues-count').textContent = `${weeklyIssues.length}건`;
  const list = document.getElementById('weekly-issues-list');
  list.innerHTML = '';

  weeklyIssues.forEach(issue => {
    const group = _weeklyGetGroup(issue.status);
    const row = document.createElement('div');
    row.className = 'weekly-issue-row';

    let deadlineHtml = '';
    if (issue.deadline) {
      deadlineHtml = `<span class="weekly-deadline-set">📅 ${escHtml(issue.deadline)}</span>`;
    } else {
      deadlineHtml = `<input type="date" class="weekly-date-input weekly-deadline-input"
        data-key="${escHtml(issue.key)}"
        title="합의완료일 없음 — 직접 입력">`;
    }

    row.innerHTML = `
      <div class="weekly-issue-key">
        <a href="${JIRA_BASE_URL}/browse/${escHtml(issue.key)}" target="_blank">${escHtml(issue.key)}</a>
      </div>
      <div class="weekly-issue-summary" title="${escHtml(issue.summary)}">${escHtml(issue.summary)}</div>
      <div class="weekly-issue-meta">
        <span class="wizard-badge">${escHtml(issue.issue_type)}</span>
        <span class="wizard-badge wizard-badge-status">${escHtml(issue.status)}</span>
        <span class="weekly-group-badge weekly-group-${escHtml(group)}">${group}</span>
      </div>
      <div class="weekly-issue-deadline">${deadlineHtml}</div>
    `;
    list.appendChild(row);
  });

  // 날짜 직접 입력 이벤트
  list.querySelectorAll('.weekly-deadline-input').forEach(input => {
    input.addEventListener('change', function() {
      weeklyDeadlineOverrides[this.dataset.key] = { deadline: this.value };
    });
  });

  document.getElementById('weekly-issues-area').style.display = '';
}

// ── 주간보고 생성 ──

async function weeklyGenerate() {
  const _provider = localStorage.getItem('AI_PROVIDER') || 'gemini';
  const _aiKeys = _provider === 'devx' ? ['DEVX_API_KEY'] : ['GEMINI_API_KEY'];
  if (!requireEnv([...JIRA_KEYS, ..._aiKeys])) return;
  if (!weeklyIssues.length) { showToast('먼저 이슈를 조회하세요.', 'error'); return; }

  const btn = document.getElementById('weekly-generate-btn');
  btn.disabled = true;
  btn.textContent = '생성 중...';
  document.getElementById('weekly-result-area').style.display = 'none';

  try {
    const res = await fetch('/api/weekly-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issues: weeklyIssues,
        overrides: weeklyDeadlineOverrides,
        status_map: weeklyStatusMap,
        date_from: document.getElementById('weekly-from').value,
        date_to:   document.getElementById('weekly-to').value,
        env: getEnv(),
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      showToast('❌ ' + data.error, 'error');
      return;
    }
    document.getElementById('weekly-result-text').value = data.report || '';
    document.getElementById('weekly-result-area').style.display = '';
    btn.textContent = '🔄 재생성';
  } catch(e) {
    showToast('❌ 네트워크 오류', 'error');
  } finally {
    btn.disabled = false;
    if (btn.textContent === '생성 중...') btn.textContent = '🤖 주간보고 생성';
  }
}

async function weeklyCopy() {
  const textarea = document.getElementById('weekly-result-text');
  if (!textarea || !textarea.value) { showToast('복사할 내용이 없습니다.', 'error'); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textarea.value);
    } else {
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      document.execCommand('copy');
    }
    showToast('📋 클립보드에 복사됐습니다.', 'success');
  } catch(e) {
    showToast('❌ 복사 실패: ' + e.message, 'error');
  }
}
