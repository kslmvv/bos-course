// ─── BilimBook admin panel ──────────────────────────────────────────────
// Uses the same backend as the main WebApp (see main.js); access is gated
// server-side by ADMIN_USER_IDS (see GET /api/admin/users -> 403).

var API_BASE = 'https://bos-bot-production.up.railway.app';

// Must match the deployed bot's @username — used to deep-link into an
// "edit via chat" session (see openEditViaChat / bot.py's start() handler).
var BOT_USERNAME = 'BilimBook_bot';

// Bumped on every deploy alongside this file's own ?v= in admin.html —
// reused to cache-bust goBack()'s in-app navigation to index.html. Keep
// this in sync by hand with main.js's own FRONTEND_VERSION and both
// <script>?v= tags.
var FRONTEND_VERSION = 'etap2-33';

var tg = window.Telegram && window.Telegram.WebApp;
var INIT_DATA = tg ? tg.initData : '';

// Registry of courses an admin can grant access to. Mirrors the `courses`
// table / course_data.py's COURSES on the backend; there's no GET
// /api/courses list endpoint yet, so this is kept in sync by hand until a
// future Этап adds one.
var ADMIN_COURSES = [
  { id: 'bos', title: 'БОС Курс', icon: 'logo.jpg' },
  { id: 'roadmap', title: 'Дорожная карта: 12 шагов (live)', icon: 'roadmap_icon.png' },
  { id: 'atm', title: 'АТМ', icon: 'https://pub-633ad4e98b3c43a1a84f5168e7d6b219.r2.dev/course-materials/atm/logo.png' }
];

var USERS = [];
var CURRENT_USER_IDX = null;
var INITIAL_ACCESS = {};
// Only the super-admin can grant admin rights (server enforces this too —
// see _validate_make_admin in bot.py); populated by loadUsers() via
// GET /api/admin/whoami before the add-user form can render its role picker.
var IS_SUPER_ADMIN = false;

function apiHeaders(extra) {
  var h = extra ? Object.assign({}, extra) : {};
  h['Authorization'] = 'tma ' + INIT_DATA;
  return h;
}

// Same icon-path-vs-emoji pattern as main.js's buildMyCourses. An icon is
// either a relative image path (GitHub Pages-hosted file), a base64
// data:image/... URL (see onPublishIconSelected — uploaded at publish time,
// stored as-is in courses.icon), or an emoji/text glyph.
function isImageIcon(icon) {
  return typeof icon === 'string' && (/\.(png|jpe?g|svg|gif|webp)$/i.test(icon) || /^data:image\//i.test(icon));
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
    try {
      var whoRes = await fetch(API_BASE + '/api/admin/whoami', { headers: apiHeaders() });
      if (whoRes.ok) IS_SUPER_ADMIN = (await whoRes.json()).is_super_admin === true;
    } catch (e) { /* not critical — role picker just stays participant-only */ }
    renderUserList();
  } catch (e) {
    showFatal('⚠️', 'Не удалось загрузить пользователей. Проверьте соединение и попробуйте снова.');
  }
}

function renderUserList() {
  var h = '<div class="hdr hdr-row"><div><div class="back" onclick="goBack()">← Назад</div><h1>Админ-панель</h1><p>Пользователи и доступ к курсам</p></div>'
    + '<div class="hdr-btns">'
    + '<button class="stats-btn" onclick="renderStatsScreen()" title="Статистика">📊</button>'
    + '<button class="stats-btn" onclick="renderDraftsScreen()" title="Черновики уроков">📄</button>'
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
var ADD_ROLE = 'participant';

function renderAddUserForm() {
  ADD_MODE = 'id';
  ADD_ROLE = 'participant';
  var h = '<div class="hdr"><div class="back" onclick="renderUserList()">← К списку</div><h1>Добавить пользователя</h1></div>'
    + '<div class="tabs">'
    + '<button class="tab-btn active" id="tab-id" onclick="switchAddMode(\'id\')">По Telegram ID</button>'
    + '<button class="tab-btn" id="tab-phone" onclick="switchAddMode(\'phone\')">По номеру телефона</button>'
    + '</div>'
    + '<input class="text-input" id="add-input" type="text" inputmode="numeric" placeholder="Telegram ID, например 123456789">'
    + '<div class="section-label">Роль</div><div class="tabs">'
    + '<button class="tab-btn active" id="role-participant" onclick="switchAddRole(\'participant\')">👤 Обычный участник</button>';
  if (IS_SUPER_ADMIN) {
    h += '<button class="tab-btn" id="role-admin" onclick="switchAddRole(\'admin\')">🛠 Админ</button>';
  }
  h += '</div>'
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

function switchAddRole(role) {
  ADD_ROLE = role;
  document.getElementById('role-participant').classList.toggle('active', role === 'participant');
  var adminBtn = document.getElementById('role-admin');
  if (adminBtn) adminBtn.classList.toggle('active', role === 'admin');
}

async function submitAddUser() {
  var raw = document.getElementById('add-input').value.trim();
  var statusEl = document.getElementById('add-status');
  var courseIds = [];
  document.querySelectorAll('#app input[data-add-course]').forEach(function (cb) {
    if (cb.checked) courseIds.push(cb.getAttribute('data-add-course'));
  });

  var isAdminRole = IS_SUPER_ADMIN && ADD_ROLE === 'admin';
  var url, body;
  if (ADD_MODE === 'id') {
    var idNum = parseInt(raw, 10);
    if (!raw || isNaN(idNum)) { statusEl.textContent = '❌ Введите корректный Telegram ID (число).'; return; }
    url = API_BASE + '/api/admin/add-user-by-id';
    body = { user_id: idNum, course_ids: courseIds, is_admin: isAdminRole };
  } else {
    if (!raw) { statusEl.textContent = '❌ Введите номер телефона.'; return; }
    url = API_BASE + '/api/admin/add-user-by-phone';
    body = { phone_number: raw, course_ids: courseIds, is_admin: isAdminRole };
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

// ─── Черновики уроков (Этап 2: review + publish) ────────────────────────

var PENDING_LESSON_STATUS_LABELS = {
  processing: 'Обрабатывается',
  transcribing: 'Транскрибируется',
  grouping: 'Группировка тем',
  ready_for_review: 'Ждёт проверки',
  published: 'Опубликовано',
  failed: 'Ошибка'
};

var DRAFTS = [];
var CURRENT_LESSON = null;   // full detail of the draft being edited
var DRAFT_TOPICS = [];       // editable working copy: [{title, start_seconds}]
var ADMIN_COURSES_LIST = []; // fetched lazily for the publish screen
var PUBLISH_MODE = 'new_course';
var PUBLISH_SELECTED_COURSE = null;
var PUBLISH_ICON_DATA_URL = null; // base64 data URL of the icon picked for a new course, or null

// Rough client-side guard so an obviously-too-big file doesn't even get read/
// sent — backend re-validates the decoded size for real (see
// handle_admin_publish_pending_lesson's ICON_DATA_URL_MAX_DECODED_BYTES).
// Base64 inflates size by ~4/3, so this leaves headroom under that 500KB cap.
var ICON_FILE_MAX_BYTES = 400 * 1024;

function onPublishIconSelected(input) {
  var file = input.files && input.files[0];
  var statusEl = document.getElementById('publish-status');
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    statusEl.textContent = '❌ Выберите файл изображения.';
    input.value = '';
    return;
  }
  if (file.size > ICON_FILE_MAX_BYTES) {
    statusEl.textContent = '❌ Файл слишком большой (макс. ~' + Math.round(ICON_FILE_MAX_BYTES / 1024) + ' КБ).';
    input.value = '';
    return;
  }
  statusEl.textContent = '';
  var reader = new FileReader();
  reader.onload = function () {
    PUBLISH_ICON_DATA_URL = reader.result;
    var preview = document.getElementById('icon-preview');
    if (preview) preview.innerHTML = '<img src="' + PUBLISH_ICON_DATA_URL + '" alt="">';
  };
  reader.onerror = function () {
    statusEl.textContent = '❌ Не удалось прочитать файл.';
  };
  reader.readAsDataURL(file);
}

async function renderDraftsScreen() {
  document.getElementById('app').innerHTML = '<div class="hdr"><div class="back" onclick="renderUserList()">← Назад</div><h1>Черновики уроков</h1></div><div class="loading">Загрузка…</div>';
  try {
    var res = await fetch(API_BASE + '/api/admin/pending-lessons', { headers: apiHeaders() });
    if (res.status === 403) { showFatal('🔒', 'Доступ запрещён.'); return; }
    if (res.status === 401) { showFatal('🔒', 'Откройте панель через бота.'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DRAFTS = await res.json();
    buildDraftsScreen();
  } catch (e) {
    showFatal('⚠️', 'Не удалось загрузить черновики. Проверьте соединение и попробуйте снова.');
  }
}

function buildDraftsScreen() {
  var h = '<div class="hdr"><div class="back" onclick="renderUserList()">← Назад</div><h1>Черновики уроков</h1><p>Видео, присланные боту на обработку</p></div>';
  if (!DRAFTS.length) {
    h += '<div class="empty-state">Черновиков пока нет. Пришлите ссылку на YouTube-видео боту от имени администратора.</div>';
  } else {
    h += '<div class="tlist">';
    DRAFTS.forEach(function (d, i) {
      var clickable = d.status === 'ready_for_review';
      var label = PENDING_LESSON_STATUS_LABELS[d.status] || d.status;
      h += '<div class="titem" style="' + (clickable ? 'cursor:pointer' : 'cursor:default') + '"'
        + (clickable ? ' onclick="openDraftEditor(' + d.id + ')"' : '') + '>'
        + '<div style="flex:1"><div class="uname">' + (d.video_title || 'Без названия') + '</div>'
        + '<div class="umeta">' + label + ' · ' + d.topic_count + ' тем</div></div>'
        + (clickable ? '<button class="topic-del-btn" style="color:var(--acc)" onclick="event.stopPropagation(); openEditViaChat(' + d.id + ')" title="Редактировать через чат бота">✏️</button>' : '')
        + '<button class="topic-del-btn" onclick="event.stopPropagation(); confirmDeleteDraft(' + d.id + ')" title="Удалить черновик">🗑️</button>'
        + (clickable ? '<div class="barrow">▶</div>' : '') + '</div>';
    });
    h += '</div>';
  }
  document.getElementById('app').innerHTML = h;
}

// ─── Delete draft (destructive — confirmation required) ─────────────────
// Same confirm-modal pattern as confirmDeleteUser/performDeleteUser above.

function confirmDeleteDraft(id) {
  var d = DRAFTS.find(function (x) { return x.id === id; });
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-box">'
    + '<div class="modal-title">Удалить черновик?</div>'
    + '<div class="modal-warn">Это необратимо удалит черновик «' + (d ? (d.video_title || 'Без названия') : id) + '» и все его темы. Отменить это действие нельзя.</div>'
    + '<div class="modal-btns">'
    + '<button class="modal-btn modal-cancel" onclick="this.closest(\'.modal-overlay\').remove()">Отмена</button>'
    + '<button class="modal-btn modal-confirm" onclick="performDeleteDraft(' + id + ')">Да, удалить</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
}

async function performDeleteDraft(id) {
  var overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.innerHTML = '<div class="modal-box"><div class="modal-title">Удаление…</div></div>';
  try {
    var res = await fetch(API_BASE + '/api/admin/pending-lessons/' + id + '/delete', {
      method: 'POST',
      headers: apiHeaders()
    });
    if (!res.ok) {
      var text = await res.text().catch(function () { return ''; });
      throw new Error(text.replace(/^\d+:\s*/, ''));
    }
    if (overlay) overlay.remove();
    await renderDraftsScreen();
  } catch (e) {
    if (overlay) overlay.innerHTML = '<div class="modal-box"><div class="modal-title">Ошибка удаления</div>'
      + '<div class="modal-warn">' + (e.message || 'Попробуйте снова.') + '</div>'
      + '<div class="modal-btns"><button class="modal-btn modal-cancel" onclick="this.closest(\'.modal-overlay\').remove()">Закрыть</button></div></div>';
  }
}

// Standard Telegram deep-link pattern: opens the bot's chat with a
// "/start edit_<id>" that bot.py's start() handler picks up to begin an
// edit-via-chat session for this lesson — an alternative to the WebApp
// topic editor for admins who'd rather describe changes in plain Russian.
function openEditViaChat(id) {
  if (tg && tg.openTelegramLink) tg.openTelegramLink('https://t.me/' + BOT_USERNAME + '?start=edit_' + id);
}

async function openDraftEditor(id) {
  document.getElementById('app').innerHTML = '<div class="hdr"><div class="back" onclick="buildDraftsScreen()">← Назад</div><h1>Загрузка…</h1></div><div class="loading">Загрузка…</div>';
  try {
    var res = await fetch(API_BASE + '/api/admin/pending-lessons/' + id, { headers: apiHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    CURRENT_LESSON = await res.json();
    DRAFT_TOPICS = CURRENT_LESSON.topics.map(function (t) { return { title: t.title, start_seconds: t.start_seconds }; });
    renderTopicEditor();
  } catch (e) {
    showFatal('⚠️', 'Не удалось загрузить урок. Проверьте соединение и попробуйте снова.');
  }
}

function formatTimecode(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  var m = Math.floor(seconds / 60), s = seconds % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Accepts "m:ss" (any number of minutes, e.g. "238:43" for a 3h58m video).
// Returns null if the string doesn't parse as a valid timecode.
function parseTimecode(str) {
  var m = /^(\d+):([0-5]?\d)$/.exec(String(str).trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function renderTopicEditor() {
  var h = '<div class="hdr"><div class="back" onclick="buildDraftsScreen()">← К черновикам</div><h1>' + (CURRENT_LESSON.video_title || 'Без названия') + '</h1><p>Проверьте и отредактируйте темы перед публикацией</p></div>';
  h += '<div id="topic-rows">';
  DRAFT_TOPICS.forEach(function (t, i) {
    h += '<div class="topic-row">'
      + '<input class="text-input topic-time-input" data-idx="' + i + '" data-field="time" value="' + formatTimecode(t.start_seconds) + '" placeholder="0:00">'
      + '<input class="text-input topic-title-input" data-idx="' + i + '" data-field="title" value="' + t.title.replace(/"/g, '&quot;') + '" placeholder="Название темы">'
      + '<button class="topic-del-btn" onclick="removeTopicRow(' + i + ')" title="Удалить">✕</button>'
      + '</div>';
  });
  h += '</div>';
  h += '<button class="tab-btn" style="width:100%;margin-bottom:14px" onclick="addTopicRow()">＋ Добавить тему</button>';
  h += '<button class="tab-btn" style="width:100%;margin-bottom:14px" onclick="downloadDraftTranscript()">📄 Скачать транскрипт</button>';
  h += '<button class="save-btn" onclick="publishStep1SaveTopics()">Опубликовать</button><div id="editor-status"></div>';
  document.getElementById('app').innerHTML = h;
}

// A plain <a href> can't carry the Authorization header the API requires,
// so this fetches the file itself and downloads the response body via a
// throwaway blob: URL instead.
async function downloadDraftTranscript() {
  var statusEl = document.getElementById('editor-status');
  statusEl.textContent = 'Загрузка транскрипта…';
  try {
    var res = await fetch(API_BASE + '/api/admin/pending-lessons/' + CURRENT_LESSON.id + '/transcript', {
      headers: apiHeaders()
    });
    if (res.status === 404) {
      statusEl.textContent = '❌ Транскрипт недоступен для этого черновика (создан до появления этой функции).';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'transcript_' + CURRENT_LESSON.id + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = '';
  } catch (e) {
    statusEl.textContent = '❌ Не удалось скачать транскрипт. Попробуйте снова.';
  }
}

// Reads whatever's currently in the input fields back into DRAFT_TOPICS,
// so edits survive add/remove (which re-render the whole list) and the
// final PATCH before moving to the publish screen. Returns the list of
// (1-based) row numbers whose timecode didn't parse, so the caller can
// warn instead of silently keeping the previous value.
function syncTopicsFromInputs() {
  var badRows = [];
  document.querySelectorAll('#topic-rows .topic-time-input').forEach(function (input) {
    var i = parseInt(input.getAttribute('data-idx'), 10);
    var secs = parseTimecode(input.value);
    if (secs !== null) DRAFT_TOPICS[i].start_seconds = secs;
    else badRows.push(i + 1);
  });
  document.querySelectorAll('#topic-rows .topic-title-input').forEach(function (input) {
    var i = parseInt(input.getAttribute('data-idx'), 10);
    DRAFT_TOPICS[i].title = input.value;
  });
  return badRows;
}

function addTopicRow() {
  syncTopicsFromInputs();
  DRAFT_TOPICS.push({ title: '', start_seconds: 0 });
  renderTopicEditor();
}

function removeTopicRow(i) {
  syncTopicsFromInputs();
  DRAFT_TOPICS.splice(i, 1);
  renderTopicEditor();
}

async function publishStep1SaveTopics() {
  var statusEl = document.getElementById('editor-status');
  var badRows = syncTopicsFromInputs();
  if (badRows.length) { statusEl.textContent = '❌ Некорректный тайм-код в теме ' + badRows.join(', ') + ' (формат мм:сс).'; return; }

  if (!DRAFT_TOPICS.length) { statusEl.textContent = '❌ Должна остаться хотя бы одна тема.'; return; }
  for (var i = 0; i < DRAFT_TOPICS.length; i++) {
    if (!DRAFT_TOPICS[i].title.trim()) { statusEl.textContent = '❌ У темы ' + (i + 1) + ' пустое название.'; return; }
  }

  statusEl.textContent = 'Сохранение…';
  try {
    var res = await fetch(API_BASE + '/api/admin/pending-lessons/' + CURRENT_LESSON.id + '/topics', {
      method: 'PATCH',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(DRAFT_TOPICS.map(function (t) { return { title: t.title.trim(), start_seconds: t.start_seconds }; }))
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    renderPublishScreen();
  } catch (e) {
    statusEl.textContent = '❌ Ошибка сохранения. Попробуйте снова.';
  }
}

async function renderPublishScreen() {
  PUBLISH_MODE = 'new_course';
  PUBLISH_SELECTED_COURSE = null;
  PUBLISH_ICON_DATA_URL = null;
  document.getElementById('app').innerHTML = '<div class="hdr"><div class="back" onclick="renderTopicEditor()">← Назад</div><h1>Публикация</h1></div><div class="loading">Загрузка списка курсов…</div>';
  try {
    var res = await fetch(API_BASE + '/api/admin/courses', { headers: apiHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    ADMIN_COURSES_LIST = await res.json();
    buildPublishScreen();
  } catch (e) {
    showFatal('⚠️', 'Не удалось загрузить список курсов. Проверьте соединение и попробуйте снова.');
  }
}

function buildPublishScreen() {
  var h = '<div class="hdr"><div class="back" onclick="renderTopicEditor()">← Назад</div><h1>Публикация</h1><p>' + (CURRENT_LESSON.video_title || '') + '</p></div>';
  h += '<div class="tabs">'
    + '<button class="tab-btn' + (PUBLISH_MODE === 'new_course' ? ' active' : '') + '" onclick="switchPublishMode(\'new_course\')">Новый курс</button>'
    + '<button class="tab-btn' + (PUBLISH_MODE === 'existing_course' ? ' active' : '') + '" onclick="switchPublishMode(\'existing_course\')">В существующий</button>'
    + '</div>';

  if (PUBLISH_MODE === 'new_course') {
    h += '<input class="text-input" id="pub-title" type="text" placeholder="Название курса">'
      + '<input class="text-input" id="pub-subtitle" type="text" placeholder="Описание (необязательно)">'
      + '<div class="icon-upload-row">'
      + '<div class="icon-preview" id="icon-preview">' + (PUBLISH_ICON_DATA_URL ? '<img src="' + PUBLISH_ICON_DATA_URL + '" alt="">' : '📚') + '</div>'
      + '<label class="icon-file-label">Загрузить иконку курса<input type="file" accept="image/*" style="display:none" onchange="onPublishIconSelected(this)"></label>'
      + '</div>';
  } else {
    h += '<div class="section-label">Курс</div><div class="tlist">';
    if (!ADMIN_COURSES_LIST.length) {
      h += '<div class="empty-state">Нет курсов, куда можно добавить урок.</div>';
    } else {
      ADMIN_COURSES_LIST.forEach(function (c) {
        var checked = PUBLISH_SELECTED_COURSE === c.id ? ' checked' : '';
        h += '<label class="ccheck"><input type="radio" name="pub-course" value="' + c.id + '"' + checked + ' onclick="PUBLISH_SELECTED_COURSE=\'' + c.id + '\'">'
          + '<span class="cico">' + courseIconHtml(c.icon) + '</span><span class="ctitle">' + c.title + '</span></label>';
      });
    }
    h += '</div><input class="text-input" id="pub-day-title" type="text" placeholder="Название раздела, например «День 7»" style="margin-top:14px">';
  }

  h += '<button class="save-btn" onclick="submitPublish()">Подтвердить и опубликовать</button><div id="publish-status"></div>';
  document.getElementById('app').innerHTML = h;
}

function switchPublishMode(mode) {
  PUBLISH_MODE = mode;
  buildPublishScreen();
}

async function submitPublish() {
  var statusEl;
  var body;

  if (PUBLISH_MODE === 'new_course') {
    var title = document.getElementById('pub-title').value.trim();
    var subtitle = document.getElementById('pub-subtitle').value.trim();
    if (!title) { document.getElementById('publish-status').textContent = '❌ Введите название курса.'; return; }
    body = { mode: 'new_course', title: title, subtitle: subtitle || undefined, icon_data_url: PUBLISH_ICON_DATA_URL || undefined };
  } else {
    if (!PUBLISH_SELECTED_COURSE) { document.getElementById('publish-status').textContent = '❌ Выберите курс.'; return; }
    var dayTitle = document.getElementById('pub-day-title').value.trim();
    if (!dayTitle) { document.getElementById('publish-status').textContent = '❌ Введите название раздела.'; return; }
    body = { mode: 'existing_course', course_id: PUBLISH_SELECTED_COURSE, day_title: dayTitle };
  }

  statusEl = document.getElementById('publish-status');
  statusEl.textContent = 'Публикация…';
  try {
    var res = await fetch(API_BASE + '/api/admin/pending-lessons/' + CURRENT_LESSON.id + '/publish', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    statusEl.textContent = '✅ Опубликовано';
    setTimeout(renderDraftsScreen, 700);
  } catch (e) {
    statusEl.textContent = '❌ Ошибка публикации. Проверьте данные и попробуйте снова.';
  }
}

function goBack() {
  // See FRONTEND_VERSION's comment above — cache-busts the HTML document
  // itself, not just the .js it loads.
  location.href = 'index.html?v=' + FRONTEND_VERSION + location.hash;
}

function init() {
  if (tg) { tg.ready(); tg.expand(); }
  if (!INIT_DATA) { showFatal('🔒', 'Откройте панель через Telegram.'); return; }
  loadUsers();
}
init();
