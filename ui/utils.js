// ── 공통 유틸리티 ──

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

function statusClass(name) {
  if (!name) return '';
  const n = name.toLowerCase();
  if (n.includes('완료') || n.includes('done') || n.includes('closed') || n.includes('resolved')) return 'done';
  if (n.includes('진행') || n.includes('progress') || n.includes('active')) return 'active';
  return 'open';
}

function scoreClass(score) {
  if (score >= 90) return 'score-high';
  if (score >= 75) return 'score-mid';
  return 'score-low';
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
