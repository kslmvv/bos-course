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
  { id: 'bos', title: 'БОС Курс', icon: 'logo.jpg' },
  { id: 'roadmap', title: 'Дорожная карта: 12 шагов (live)', icon: 'roadmap_icon.png' }
];

var USERS = [];
var CURRENT_USER_IDX = null;
var INITIAL_ACCESS = {};

function apiHeaders(extra) {
  var h = extra ? Object.assign({}, extra) : {};
  h['Authorization'] = 'tma ' + INIT_DATA;
  return h;
}

// Same icon-path-vs-emoji pattern as main.js's buildMyCourses.
function isImageIcon(icon) {
  return typeof icon === 'string' && /\.(png|jpe?g|svg|gif|webp)$/i.test(icon);
}
function courseIconHtml(icon) {
  if (isImageIcon(icon)) return '<img src="' + icon + '" alt="">';
  return icon || '📚';
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
  var h = '<div class="hdr hdr-row"><div><div class="back" onclick="goBack()">← Назад</div><h1>Админ-панель</h1><p>Пользователи и доступ к курсам</p></div>'
    + '<div class="hdr-btns">'
    + '<button class="stats-btn" onclick="renderStatsScreen()" title="Статистика">📊</button>'
    + '<button class="add-user-btn" onclick="renderAddUserForm()" title="Добавить пользователя">＋</button>'
    + '</div></div>';
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
      + '<span class="cico">' + courseIconHtml(c.icon) + '</span><span class="ctitle">' + c.title + '</span></label>';
  });
  h += '</div><button class="save-btn" onclick="saveAccess()">Сохранить</button><div id="save-status"></div>';
  h += '<button class="danger-btn" onclick="confirmDeleteUser()">Удалить пользователя</button>';
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

// ─── Add user (by Telegram ID or phone) ────────────────────────────────

var ADD_MODE = 'id';

function renderAddUserForm() {
  ADD_MODE = 'id';
  var h = '<div class="hdr"><div class="back" onclick="renderUserList()">← К списку</div><h1>Добавить пользователя</h1></div>'
    + '<div class="tabs">'
    + '<button class="tab-btn active" id="tab-id" onclick="switchAddMode(\'id\')">По Telegram ID</button>'
    + '<button class="tab-btn" id="tab-phone" onclick="switchAddMode(\'phone\')">По номеру телефона</button>'
    + '</div>'
    + '<input class="text-input" id="add-input" type="text" inputmode="numeric" placeholder="Telegram ID, например 123456789">'
    + '<div class="section-label">Выдать доступ к курсам</div><div class="tlist">';
  ADMIN_COURSES.forEach(function (c) {
    h += '<label class="ccheck"><input type="checkbox" data-add-course="' + c.id + '">'
      + '<span class="cico">' + courseIconHtml(c.icon) + '</span><span class="ctitle">' + c.title + '</span></label>';
  });
  h += '</div><button class="save-btn" onclick="submitAddUser()">Добавить</button><div id="add-status"></div>';
  document.getElementById('app').innerHTML = h;
}

function switchAddMode(mode) {
  ADD_MODE = mode;
  document.getElementById('tab-id').classList.toggle('active', mode === 'id');
  document.getElementById('tab-phone').classList.toggle('active', mode === 'phone');
  var input = document.getElementById('add-input');
  input.value = '';
  if (mode === 'id') {
    input.type = 'text'; input.inputMode = 'numeric';
    input.placeholder = 'Telegram ID, например 123456789';
  } else {
    input.type = 'tel'; input.inputMode = 'tel';
    input.placeholder = 'Номер телефона, например +998901234567';
  }
}

async function submitAddUser() {
  var raw = document.getElementById('add-input').value.trim();
  var statusEl = document.getElementById('add-status');
  var courseIds = [];
  document.querySelectorAll('#app input[data-add-course]').forEach(function (cb) {
    if (cb.checked) courseIds.push(cb.getAttribute('data-add-course'));
  });

  var url, body;
  if (ADD_MODE === 'id') {
    var idNum = parseInt(raw, 10);
    if (!raw || isNaN(idNum)) { statusEl.textContent = '❌ Введите корректный Telegram ID (число).'; return; }
    url = API_BASE + '/api/admin/add-user-by-id';
    body = { user_id: idNum, course_ids: courseIds };
  } else {
    if (!raw) { statusEl.textContent = '❌ Введите номер телефона.'; return; }
    url = API_BASE + '/api/admin/add-user-by-phone';
    body = { phone_number: raw, course_ids: courseIds };
  }

  statusEl.textContent = 'Добавление…';
  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    statusEl.textContent = '✅ Добавлено';
    setTimeout(loadUsers, 600);
  } catch (e) {
    statusEl.textContent = '❌ Ошибка. Проверьте данные и попробуйте снова.';
  }
}

// ─── Delete user (destructive — confirmation required) ─────────────────

function confirmDeleteUser() {
  var u = USERS[CURRENT_USER_IDX];
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-box">'
    + '<div class="modal-title">Удалить пользователя?</div>'
    + '<div class="modal-warn">Это необратимо удалит ' + userLabel(u) + ', весь его доступ к курсам и всю статистику просмотров. Отменить это действие нельзя.</div>'
    + '<div class="modal-btns">'
    + '<button class="modal-btn modal-cancel" onclick="this.closest(\'.modal-overlay\').remove()">Отмена</button>'
    + '<button class="modal-btn modal-confirm" onclick="performDeleteUser()">Да, удалить</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
}

async function performDeleteUser() {
  var overlay = document.querySelector('.modal-overlay');
  var u = USERS[CURRENT_USER_IDX];
  if (overlay) overlay.innerHTML = '<div class="modal-box"><div class="modal-title">Удаление…</div></div>';
  try {
    var res = await fetch(API_BASE + '/api/admin/delete-user', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ user_id: u.user_id })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (overlay) overlay.remove();
    await loadUsers();
  } catch (e) {
    if (overlay) overlay.innerHTML = '<div class="modal-box"><div class="modal-title">Ошибка удаления</div>'
      + '<div class="modal-warn">Попробуйте снова.</div>'
      + '<div class="modal-btns"><button class="modal-btn modal-cancel" onclick="this.closest(\'.modal-overlay\').remove()">Закрыть</button></div></div>';
  }
}

// ─── Статистика ─────────────────────────────────────────────────────────

function relTime(iso) {
  var diffMs = Date.now() - new Date(iso).getTime();
  var mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return mins + ' мин. назад';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + ' ч. назад';
  var days = Math.floor(hours / 24);
  return days + ' дн. назад';
}

async function renderStatsScreen() {
  document.getElementById('app').innerHTML = '<div class="hdr"><div class="back" onclick="renderUserList()">← Назад</div><h1>Статистика</h1></div><div class="loading">Загрузка…</div>';
  try {
    var res = await fetch(API_BASE + '/api/admin/stats', { headers: apiHeaders() });
    if (res.status === 403) { showFatal('🔒', 'Доступ запрещён.'); return; }
    if (res.status === 401) { showFatal('🔒', 'Откройте панель через бота.'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    buildStatsScreen(data);
  } catch (e) {
    showFatal('⚠️', 'Не удалось загрузить статистику. Проверьте соединение и попробуйте снова.');
  }
}

function buildStatsScreen(data) {
  var ov = data.overview;
  var h = '<div class="hdr"><div class="back" onclick="renderUserList()">← Назад</div><h1>Статистика</h1></div>';

  h += '<div class="metrics-grid">'
    + '<div class="metric-card"><div class="metric-value">' + ov.total_users + '</div><div class="metric-label">Всего пользователей</div></div>'
    + '<div class="metric-card"><div class="metric-value">' + ov.users_with_progress + '</div><div class="metric-label">Есть прогресс</div></div>';
  ov.access_counts.forEach(function (c) {
    h += '<div class="metric-card"><div class="metric-value">' + c.access_count + '</div><div class="metric-label">Доступ: ' + c.title + '</div></div>';
  });
  h += '</div>';

  h += '<div class="section-label">Вовлечённость по курсам</div>';
  data.course_engagement.forEach(function (c) {
    h += '<div class="engagement-row"><div class="engagement-top"><span>' + c.title + '</span><span>' + c.watched + '/' + c.total + ' (' + c.percent + '%)</span></div>'
      + '<div class="progress-track"><div class="progress-fill" style="width:' + c.percent + '%"></div></div></div>';
  });

  h += '<div class="section-label">Последняя активность</div>';
  if (!data.recent_activity.length) {
    h += '<div class="empty-state">Пока нет активности.</div>';
  } else {
    h += '<div class="tlist">';
    data.recent_activity.forEach(function (a) {
      var label = a.username ? '@' + a.username : (a.phone_number || ('ID ' + a.user_id));
      var pct = (a.percent === null || a.percent === undefined) ? '—' : a.percent + '%';
      h += '<div class="titem" style="cursor:default">'
        + '<div style="flex:1"><div class="uname">' + label + '</div>'
        + '<div class="activity-topic">' + a.day + ' — ' + a.topic + '</div>'
        + '<div class="activity-meta">' + pct + ' · ' + relTime(a.updated_at) + '</div></div></div>';
    });
    h += '</div>';
  }

  document.getElementById('app').innerHTML = h;
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
