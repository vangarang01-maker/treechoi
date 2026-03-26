// ── 처리 마법사 ──

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
    if (dtype === 'safe_query') {
      section.innerHTML = `
        <div class="wizard-draft-header">
          <span class="wizard-draft-label">${escHtml(label)}</span>
          <button class="btn btn-secondary wizard-draft-btn" onclick="wizardGenerateDraft('${dtype}')">🤖 AI 초안 생성</button>
        </div>
        <div class="safe-query-split">
          <div class="safe-query-pane">
            <label class="wizard-label">실행할 DML 쿼리 (UPDATE / DELETE)</label>
            <textarea class="wizard-textarea safe-query-textarea" id="safe-query-dml-input" spellcheck="false" placeholder="UPDATE 테이블명&#10;SET 컬럼 = 값&#10;WHERE 조건;"></textarea>
          </div>
          <div class="safe-query-pane" id="draft-body-${dtype}" style="display:none">
            <label class="wizard-label">생성된 안전 쿼리 세트</label>
            <textarea class="wizard-textarea safe-query-textarea" id="draft-text-${dtype}" spellcheck="false" readonly></textarea>
            <div class="wizard-draft-actions">
              <span class="wizard-fallback-note" id="draft-fallback-${dtype}" style="display:none">⚠ AI 생성 실패 — 템플릿 사용됨</span>
              <button class="btn btn-secondary" onclick="wizardCopyDraft('${dtype}')">📋 복사</button>
            </div>
          </div>
        </div>`;
    } else {
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
    }
    draftsEl.appendChild(section);
  });

  document.getElementById('wizard-result').style.display = '';
}

async function wizardGenerateDraft(draftType) {
  const _provider = localStorage.getItem('AI_PROVIDER') || 'gemini';
  const _aiKeys = _provider === 'devx' ? ['DEVX_API_KEY'] : ['GEMINI_API_KEY'];
  if (!requireEnv([...JIRA_KEYS, ..._aiKeys])) return;
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
  if (draftType === 'safe_query') {
    const dmlInput = document.getElementById('safe-query-dml-input');
    const dml = dmlInput ? dmlInput.value.trim() : '';
    if (!dml) {
      showToast('❌ 실행할 DML 쿼리를 입력해주세요.', 'error');
      btn.disabled = false;
      btn.textContent = '🤖 AI 초안 생성';
      return;
    }
    overrides.dml_query = dml;
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
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      document.execCommand('copy');
    }
    showToast('📋 클립보드에 복사됐습니다.', 'success');
  } catch(e) {
    showToast('❌ 복사 실패: ' + e.message, 'error');
  }
}
