// ── 진입점 (entry) ──
// 모듈 로드 순서: utils.js → settings.js → jira.js → helpdesk.js → similar.js → wizard.js → weekly.js → script.js

renderFields();
_applyProviderUI();
renderChips();
renderHelpdeskChips();
initJiraChat();
initWeeklyReport();
loadConfig().then(() => {
  initSimilarUsers();
  loadCacheStatus();
});
switchPage('gemini');
