// ── Jira 채팅 ──

let jiraChatLog = [];

function _saveJiraLog() {
  try { localStorage.setItem('jira_chat_log', JSON.stringify(jiraChatLog)); } catch(e) {}
}

function initJiraChat() {
  const saved = localStorage.getItem('jira_chat_log');
  if (!saved) return;
  try {
    jiraChatLog = JSON.parse(saved);
  } catch(e) { return; }
  if (jiraChatLog.length === 0) return;
  const hint = document.getElementById('empty-hint');
  if (hint) hint.remove();
  for (const entry of jiraChatLog) {
    if (entry.type === 'user')   appendUserBubble(entry.text, false);
    else if (entry.type === 'issue')  appendIssueCard(entry.data, false);
    else if (entry.type === 'search') appendSearchCard(entry.data, entry.jql, false);
    else if (entry.type === 'error')  appendError(entry.msg, false);
  }
  scrollBottom();
}

function clearJiraChat() {
  jiraChatLog = [];
  localStorage.removeItem('jira_chat_log');
  getHistory().innerHTML = `<div class="empty-hint" id="empty-hint">
    <div class="big">🔍</div>
    <div>이슈 키(SCM3-1234), 단축어, JQL을 입력해보세요</div>
  </div>`;
}

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
  jiraChatLog.push({type: 'user', text: q});
  _saveJiraLog();

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
      jiraChatLog.push({type: 'error', msg: data.error});
    } else if (data.type === 'issue') {
      appendIssueCard(data.data);
      jiraChatLog.push({type: 'issue', data: data.data});
    } else if (data.type === 'search') {
      appendSearchCard(data.data, data.jql);
      jiraChatLog.push({type: 'search', data: data.data, jql: data.jql});
    }
    _saveJiraLog();
  } catch(e) {
    spinner.remove();
    appendError('요청 실패: ' + e.message);
    jiraChatLog.push({type: 'error', msg: '요청 실패: ' + e.message});
    _saveJiraLog();
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

function appendUserBubble(text, scroll = true) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap user';
  wrap.innerHTML = `<div class="bubble-user">${escHtml(text)}</div>`;
  getHistory().appendChild(wrap);
  if (scroll) scrollBottom();
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

function appendError(msg, scroll = true) {
  let guide = '';
  if (msg.includes('401')) guide = '<br><small>Jira PAT Token이 만료되었거나 잘못되었습니다.</small>';
  if (msg.includes('403')) guide = '<br><small>Jira 프로젝트/이슈에 대한 접근 권한이 없습니다.</small>';

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `<div class="error-card">⚠ ${escHtml(msg)}${guide}</div>`;
  getHistory().appendChild(wrap);
  if (scroll) scrollBottom();
}

function appendIssueCard(issue, scroll = true) {
  const f = issue.fields || {};
  const key = issue.key || '';
  const title = f.summary || '(제목 없음)';
  const status = (f.status && f.status.name) || '';
  const assignee = (f.assignee && f.assignee.displayName) || '미지정';
  const rawDesc = (f.description || '').replace(/\n/g, ' ');
  const desc = rawDesc.length > 200 ? rawDesc.slice(0, 200) + '…' : rawDesc;
  const uid = 'json_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

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
  if (scroll) scrollBottom();
}

function appendSearchCard(data, jql, scroll = true) {
  const total = data.total || 0;
  const issues = data.issues || [];
  const uid = 'json_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

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
  if (scroll) scrollBottom();
}
