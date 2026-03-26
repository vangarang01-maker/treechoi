// ── 안내데스크 채팅 (Gemini / DevX AI) ──

let geminiHistory = [];

async function sendGemini() {
  const provider = localStorage.getItem('AI_PROVIDER') || 'gemini';
  const isDevx = provider === 'devx';

  // DevX 모드: 바로 helpdesk-chat으로 (intent 분석 없음)
  if (isDevx) {
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
      const res = await fetch('/api/helpdesk-chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: msg, history: geminiHistory, env: getEnv()}),
      });
      const data = await res.json();
      spinner.remove();
      if (!data.ok) {
        appendGeminiError(data.error || '응답 오류');
      } else {
        geminiHistory.push({role: 'user', text: msg});
        geminiHistory.push({role: 'model', text: data.reply});
        localStorage.setItem('gemini_chat_history', JSON.stringify(geminiHistory));
        appendGeminiBot(data.reply, data.latency_ms, data.model);
      }
    } catch(e) {
      if (spinner) spinner.remove();
      appendGeminiError('요청 실패: ' + e.message);
    } finally {
      btn.disabled = false;
      input.focus();
    }
    return;
  }

  // Gemini 모드: 기존 agent-query → gemini-chat 흐름
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
  const provider = localStorage.getItem('AI_PROVIDER') || 'gemini';
  const label = provider === 'devx' ? 'DevX AI' : 'Gemini';
  h.innerHTML = `<div class="empty-hint" id="gemini-empty-hint">
    <div class="big">🤖</div>
    <div>${label}에게 무엇이든 물어보세요</div>
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
  const provider = localStorage.getItem('AI_PROVIDER') || 'gemini';
  const label = provider === 'devx' ? 'DevX AI' : 'Gemini';
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap bot';
  wrap.innerHTML = `<div class="chat-spinner">
    <div class="dot-spin"><span></span><span></span><span></span></div>
    ${label} 응답 중...
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
