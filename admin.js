// ─── BilimBook admin panel ──────────────────────────────────────────────
// Uses the same backend as the main WebApp (see main.js); access is gated
// server-side by ADMIN_USER_IDS (see GET /api/admin/users -> 403).

var API_BASE = 'https://bos-bot-production.up.railway.app';

var tg = window.Telegram && window.Telegram.WebApp;
var INIT_DATA = tg ? tg.initData : '';

// Registry of courses an admin can grant access to. Mirrors the `courses`
// table / course_data.py's COURSES on the backend; there's no GET
// /api/courses list endpoint yet, so this is kept in sync by hand until a
// future Этап adds one.
var ADMIN_COURSES = [
  { id: 'bos', title: 'БОС Курс', icon: '📚' }
];

var USERS = [];
var CURRENT_USER_IDX = null;
var INITIAL_ACCESS = {};

function apiHeaders(extra) {
  var h = extra ? Object.assign({}, extra) : {};
  h['Authorization'] = 'tma ' + INIT_DATA;
  return h;
}

function showFatal(icon, text) {
  document.getElementById('app').innerHTML =
    '<div style="padding:60px 24px;text-align:center">'
    + '<div style="font-size:40px;margin-bottom:16px">' + icon + '</div><div style="color:var(--tx2)">' + text + '</div>'
    + '<div class="back" style="margin-top:20px" onclick="goBack()">← Назад</div></div>';
}

function userLabel(u) {
  if (u.username) return '@' + u.username;
  if (u.phone_number) return u.phone_number;
  return 'ID ' + u.user_id;
}

async function loadUsers() {
  try {
    var res = await fetch(API_BASE + '/api/admin/users', { headers: apiHeaders() });
    if (res.status === 403) { showFatal('🔒', 'Доступ запрещён.'); return; }
    if (res.status === 401) { showFatal('🔒', 'Откройте панель через бота.'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    USERS = await res.json();
    renderUserList();
  } catch (e) {
    showFatal('⚠️', 'Не удалось загрузить пользователей. Проверьте соединение и попробуйте снова.');
  }
}

function renderUserList() {
  var h = '<div class="hdr"><div class="back" onclick="goBack()">← Назад</div><h1>Админ-панель</h1><p>Пользователи и доступ к курсам</p></div>';
  if (!USERS.length) {
    h += '<div class="empty-state">Пользователей пока нет.</div>';
  } else {
    h += '<div class="tlist">';
    USERS.forEach(function (u, i) {
      var n = u.course_ids ? u.course_ids.length : 0;
      h += '<div class="titem" onclick="openUser(' + i + ')">'
        + '<div><div class="uname">' + userLabel(u) + '</div>'
        + '<div class="umeta">' + (u.is_admin ? 'админ · ' : '') + n + ' курс(ов)</div></div>'
        + '<div class="barrow">▶</div></div>';
    });
    h += '</div>';
  }
  document.getElementById('app').innerHTML = h;
}

function openUser(i) {
  CURRENT_USER_IDX = i;
  var u = USERS[i];
  INITIAL_ACCESS = {};
  ADMIN_COURSES.forEach(function (c) { INITIAL_ACCESS[c.id] = u.course_ids.indexOf(c.id) >= 0; });
  renderUserDetail();
}

function renderUserDetail() {
  var u = USERS[CURRENT_USER_IDX];
  var h = '<div class="hdr"><div class="back" onclick="renderUserList()">← К списку</div><h1>' + userLabel(u) + '</h1><p>user_id ' + u.user_id + '</p></div>'
    + '<div class="tlist">';
  ADMIN_COURSES.forEach(function (c) {
    var checked = INITIAL_ACCESS[c.id] ? ' checked' : '';
    h += '<label class="ccheck"><input type="checkbox" data-course="' + c.id + '"' + checked + '>'
      + '<span class="cico">' + c.icon + '</span><span class="ctitle">' + c.title + '</span></label>';
  });
  h += '</div><button class="save-btn" onclick="saveAccess()">Сохранить</button><div id="save-status"></div>';
  document.getElementById('app').innerHTML = h;
}

async function saveAccess() {
  var u = USERS[CURRENT_USER_IDX];
  var checkboxes = document.querySelectorAll('#app input[type=checkbox]');
  var changes = [];
  checkboxes.forEach(function (cb) {
    var courseId = cb.getAttribute('data-course');
    var wantGrant = cb.checked;
    if (!!INITIAL_ACCESS[courseId] !== wantGrant) changes.push({ course_id: courseId, grant: wantGrant });
  });
  if (!changes.length) { renderUserList(); return; }

  var statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Сохранение…';
  try {
    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i];
      var res = await fetch(API_BASE + '/api/admin/grant-access', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ user_id: u.user_id, course_id: ch.course_id, grant: ch.grant })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var idx = u.course_ids.indexOf(ch.course_id);
      if (ch.grant && idx < 0) u.course_ids.push(ch.course_id);
      else if (!ch.grant && idx >= 0) u.course_ids.splice(idx, 1);
    }
    statusEl.textContent = '✅ Сохранено';
    setTimeout(renderUserList, 600);
  } catch (e) {
    statusEl.textContent = '❌ Ошибка сохранения. Попробуйте снова.';
  }
}

function goBack() {
  location.href = 'index.html' + location.hash;
}

function init() {
  if (tg) { tg.ready(); tg.expand(); }
  if (!INIT_DATA) { showFatal('🔒', 'Откройте панель через Telegram.'); return; }
  loadUsers();
}
init();
