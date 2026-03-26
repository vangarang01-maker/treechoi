// ── 유사 이슈 검색 ──

let similarUsers = [];

function _saveSimilarUsers() {
  try { localStorage.setItem('similar_users', JSON.stringify(similarUsers)); } catch(e) {}
}

function initSimilarUsers() {
  // 사용자 목록 복원
  try {
    const saved = localStorage.getItem('similar_users');
    if (saved) similarUsers = JSON.parse(saved);
  } catch(e) {}
  renderUserTags();

  // 검색 결과 복원
  try {
    const savedResults = localStorage.getItem('similar_results');
    if (savedResults) {
      const results = JSON.parse(savedResults);
      if (results && results.length > 0) {
        const hint = document.getElementById('similar-empty-hint');
        if (hint) hint.remove();
        _renderSimilarResults(results);
      }
    }
  } catch(e) {}
}

function _renderSimilarResults(results) {
  const resultsEl = document.getElementById('similar-results');
  resultsEl.innerHTML = '';
  const groups = {};
  for (const item of results) {
    const type = item.issuetype || '기타';
    if (!groups[type]) groups[type] = [];
    groups[type].push(item);
  }
  const sortedTypes = Object.keys(groups).sort();
  for (const type of sortedTypes) {
    resultsEl.appendChild(buildTypeSection(type, groups[type]));
  }
}

function clearSimilarResults() {
  localStorage.removeItem('similar_results');
  document.getElementById('similar-results').innerHTML = `<div class="empty-hint" id="similar-empty-hint">
    <div class="big">🔍</div>
    <div>캐시 구축 후 검색하면 미해결 이슈별 유사 완료 이슈를 보여줍니다</div>
  </div>`;
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
  _saveSimilarUsers();
  renderUserTags();
}

function removeUser(idx) {
  similarUsers.splice(idx, 1);
  _saveSimilarUsers();
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
  if ((localStorage.getItem('AI_PROVIDER') || 'gemini') === 'devx') {
    showToast('⚠ 캐시 구축은 Gemini 모드에서만 사용 가능합니다.', 'error');
    return;
  }
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
  if ((localStorage.getItem('AI_PROVIDER') || 'gemini') === 'devx' && !localStorage.getItem('GEMINI_API_KEY')) {
    showToast('❌ 유사이슈검색은 임베딩에 Gemini를 사용합니다. 환경설정에서 Gemini API Key를 입력해주세요.', 'error');
    return;
  }
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
      localStorage.removeItem('similar_results');
      return;
    }

    // 결과 저장
    try { localStorage.setItem('similar_results', JSON.stringify(data.results)); } catch(e) {}

    _renderSimilarResults(data.results);
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
  wrap.dataset.issueKey = item.key;
  wrap.dataset.similarKeys = JSON.stringify(similarKeys);
  return wrap;
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
