// ─── Backend API ──────────────────────────────────────────────────────
// Update this to your deployed bot's public URL (Railway domain).
var API_BASE = 'https://bos-bot-production.up.railway.app';

// Bumped on every deploy alongside the ?v= on this file's own <script> tag
// in index.html/admin.html — reused to cache-bust in-app HTML navigation
// (goAdmin/goBack), which a plain filename query on the <script> tag alone
// doesn't cover. Keep the three in sync by hand.
var FRONTEND_VERSION = 'etap2-32';

var tg = window.Telegram && window.Telegram.WebApp;
var INIT_DATA = tg ? tg.initData : '';
var IS_IOS = /iPhone|iPad/.test(navigator.userAgent);

// "Открыть в браузере": a one-time token (see /api/browser-token) lets this
// page load outside Telegram, where initData is unavailable but the real
// Fullscreen API isn't restricted.
var URL_PARAMS = new URLSearchParams(location.search);
var URL_TOKEN = URL_PARAMS.get('token');
var URL_DAY = URL_PARAMS.get('day');
var URL_TOPIC = URL_PARAMS.get('topic');
// Defaults to "bos" so links generated before this param existed still work.
var URL_COURSE_ID = URL_PARAMS.get('course_id') || 'bos';

var SAVE_KEY = 'bos_progress';
var SPEED_KEY = 'bos_speed';
var THEME_KEY = 'bos_theme';
var SPEEDS = [1, 1.5, 2];

var COURSE_DATA = null;
var CURRENT_COURSE_ID = null;
var MY_COURSES = [];
var CONTINUE_WATCHING = null;
var IS_ADMIN = false;

// Per-course "continue watching" key. Keeps the pre-existing 'bos_progress'
// key for the "bos" course so users don't lose their saved position across
// this update; any future course gets its own namespaced key.
function progressKey() {
  return CURRENT_COURSE_ID && CURRENT_COURSE_ID !== 'bos' ? SAVE_KEY + '_' + CURRENT_COURSE_ID : SAVE_KEY;
}

var G = {
  topics: [], idx: 0, badgeText: '', backFn: null, moduleId: null, itemIdx: null,
  player: null, mode: null, ytPlayer: null, ytReady: false, video: null, hls: null, pipSupported: false,
  playing: false, ready: false, fs: false,
  pendingVid: null, pendingPos: 0, ctrlTimer: null, progTimer: null, saveTimer: null, statsTimer: null,
  ytFallbackTimer: null,
  currentVid: null, segStart: 0, segEnd: 0, topicEndShown: false,
  dragging: false, dragPct: 0, fsCoverTimer: null, speed: 1, theme: 'dark'
};

// True once the currently-loaded backend (HLS <video> or YouTube iframe) can
// respond to getCurrentTime/seekTo/etc. The <video> element is always ready
// immediately; the YouTube iframe needs its async API to finish loading.
function playerReady() {
  return G.mode === 'hls' ? true : (G.mode === 'yt' && G.ytReady);
}

// The DOM element currently driving playback, used by the fullscreen code to
// resize/restyle whichever backend is active.
function activeMediaEl(w) {
  return G.mode === 'hls' ? G.video : w.querySelector('iframe');
}

function apiHeaders(extra) {
  var h = extra ? Object.assign({}, extra) : {};
  h['Authorization'] = 'tma ' + INIT_DATA;
  return h;
}

function reportStats(day, topic, progress) {
  var url = API_BASE + '/api/stats';
  if (URL_TOKEN) url += '?token=' + encodeURIComponent(URL_TOKEN);
  fetch(url, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ day: day, topic: topic, progress: Math.max(0, Math.floor(progress || 0)) })
  }).catch(function () {});
}

// Video-absolute resume position for "Продолжить просмотр" — separate from
// reportStats (which is topic-segment-relative and only feeds admin
// analytics). courseId is required; a call with none is a no-op (e.g. before
// a course has finished loading).
function reportWatchProgress(courseId, sectionKey, sectionLabel, topicIdx, topicTitle, positionSeconds, durationSeconds, completed) {
  if (!courseId) return;
  var url = API_BASE + '/api/watch-progress';
  if (URL_TOKEN) url += '?token=' + encodeURIComponent(URL_TOKEN);
  fetch(url, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      course_id: courseId,
      section_key: sectionKey || '',
      section_label: sectionLabel,
      topic_idx: topicIdx,
      topic_title: topicTitle,
      position_seconds: Math.max(0, Math.floor(positionSeconds || 0)),
      duration_seconds: durationSeconds ? Math.max(0, Math.floor(durationSeconds)) : null,
      completed: !!completed
    })
  }).catch(function () {});
}

function topicLabel(idx) {
  var tp = G.topics[idx];
  return 'Тема ' + (idx + 1) + ': ' + (tp ? tp.title : '');
}

function showFatalMessage(text) {
  document.body.innerHTML =
    '<div style="padding:60px 24px;text-align:center;color:#fff;font-family:sans-serif">' +
    '<div style="font-size:40px;margin-bottom:16px">🔒</div><div>' + text + '</div></div>';
}

async function loadCourseData(courseId) {
  try {
    var url = API_BASE + '/api/course?course_id=' + encodeURIComponent(courseId);
    var opts = {};
    if (URL_TOKEN) { url += '&token=' + encodeURIComponent(URL_TOKEN); }
    else { opts.headers = apiHeaders(); }
    var res = await fetch(url, opts);
    if (res.status === 401 || res.status === 403) {
      showFatalMessage('Доступ запрещён. Откройте курс через бота командой /start.');
      return false;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    COURSE_DATA = await res.json();
    return true;
  } catch (e) {
    showFatalMessage('Не удалось загрузить курс. Проверьте соединение и попробуйте снова.');
    return false;
  }
}

// ─── Progress (continue watching) ───────────────────────────────────────

function saveProgress() {
  try {
    var pos = 0;
    if (playerReady() && G.ready) { try { pos = Math.floor(G.player.getCurrentTime() || 0); } catch (e) {} }
    localStorage.setItem(progressKey(), JSON.stringify({
      badgeText: G.badgeText, idx: G.idx, pos: pos,
      title: G.topics[G.idx] ? G.topics[G.idx].title : '',
      type: G.badgeText.indexOf('ДЕНЬ') >= 0 ? 'day' : 'other',
      dayId: G.badgeText.indexOf('ДЕНЬ') >= 0 ? parseInt(G.badgeText.replace('ДЕНЬ ', '')) : null
    }));
  } catch (e) {}
}
function loadProgress() { try { return JSON.parse(localStorage.getItem(progressKey()) || 'null'); } catch (e) { return null; } }
function clearProgress() { try { localStorage.removeItem(progressKey()); } catch (e) {} }
function startSaveTimer() {
  clearInterval(G.saveTimer);
  G.saveTimer = setInterval(function () { if (G.playing) saveProgress(); }, 5000);
}
function startStatsTimer() {
  clearInterval(G.statsTimer);
  G.statsTimer = setInterval(function () { if (G.playing) reportProgress(); }, 15000);
}
function reportProgress() {
  if (!playerReady() || !G.ready) return;
  try {
    var cur = G.player.getCurrentTime();
    var segCur = Math.max(0, cur - (G.segStart || 0));
    if (G.segEnd && G.segEnd > G.segStart) segCur = Math.min(segCur, G.segEnd - G.segStart);
    reportStats(G.badgeText, topicLabel(G.idx), segCur);
    reportWatchProgress(CURRENT_COURSE_ID, currentSectionKey(), G.badgeText, G.idx,
      G.topics[G.idx] ? G.topics[G.idx].title : '', cur, pbarSegDur(), false);
  } catch (e) {}
}

// ─── Playback speed ──────────────────────────────────────────────────────

function loadSpeed() {
  try {
    var s = parseFloat(localStorage.getItem(SPEED_KEY));
    if (SPEEDS.indexOf(s) >= 0) G.speed = s;
  } catch (e) {}
}
function syncSpeedBtn() {
  var b = document.getElementById('spb'); if (b) b.textContent = G.speed + 'x';
}
function applySpeed() {
  if (G.mode === 'hls') { try { G.video.playbackRate = G.speed; } catch (e) {} }
  else if (G.mode === 'yt' && G.ytPlayer && G.ytPlayer.setPlaybackRate) { try { G.ytPlayer.setPlaybackRate(G.speed); } catch (e) {} }
}
function cycleSpeed() {
  G.speed = SPEEDS[(SPEEDS.indexOf(G.speed) + 1) % SPEEDS.length];
  try { localStorage.setItem(SPEED_KEY, String(G.speed)); } catch (e) {}
  syncSpeedBtn();
  applySpeed();
}

// ─── Theme (dark/light) ────────────────────────────────────────────────

function loadTheme() {
  try { if (localStorage.getItem(THEME_KEY) === 'light') G.theme = 'light'; } catch (e) {}
}
function syncThemeBtn() {
  var b = document.getElementById('themeBtn');
  if (b) b.innerHTML = '<svg><use href="#i-' + (G.theme === 'light' ? 'moon' : 'sun') + '"/></svg>';
}
function toggleTheme() {
  G.theme = G.theme === 'light' ? 'dark' : 'light';
  if (G.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(THEME_KEY, G.theme); } catch (e) {}
  syncThemeBtn();
}

// ─── YouTube player ──────────────────────────────────────────────────────

(function () { var t = document.createElement('script'); t.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(t); })();

function onYouTubeIframeAPIReady() {
  G.ytReady = true;
  G.ytPlayer = new YT.Player('ytpl', {
    playerVars: { controls: 0, disablekb: 1, fs: 1, modestbranding: 1, rel: 0, showinfo: 0, iv_load_policy: 3, playsinline: 1, enablejsapi: 1 },
    events: {
      onReady: function () {
        if (G.pendingVid) { G.ytPlayer.loadVideoById({ videoId: G.pendingVid, startSeconds: G.pendingPos }); G.pendingVid = null; G.pendingPos = 0; applySpeed(); }
      },
      onStateChange: function (e) {
        if (G.mode !== 'yt') return;
        G.playing = (e.data === YT.PlayerState.PLAYING);
        if (G.playing) { clearTimeout(G.ytFallbackTimer); hideYtFallback(); G.ready = true; applySpeed(); startProg(); startSaveTimer(); startStatsTimer(); scheduleHide(); }
        else { clearInterval(G.progTimer); clearInterval(G.statsTimer); saveProgress(); reportProgress(); showCtrl(false); }
        syncPB();
      },
      onError: function () { showYtFallback(); }
    }
  });
}

function resetPlayerUI() {
  clearInterval(G.progTimer); G.topicEndShown = false; hideTopicEnd(); hideYtFallback();
  var pf = document.getElementById('pf'); if (pf) pf.style.width = '0%';
  var tc = document.getElementById('tc'); if (tc) tc.textContent = '0:00';
  var td = document.getElementById('td'); if (td) td.textContent = fmt(G.segEnd && G.segEnd > G.segStart ? G.segEnd - G.segStart : 0);
  hideCtrl();
}

function setMediaMode(mode) {
  var w = document.getElementById('vw'); if (!w) return;
  w.classList.toggle('hls-mode', mode === 'hls');
  w.classList.toggle('yt-mode', mode === 'yt');
  var b = document.getElementById('pipb');
  if (b) b.style.display = (mode === 'hls' && G.pipSupported) ? '' : 'none';
}

function loadVideo(vid, startPos) {
  resetPlayerUI();
  G.ready = false; G.playing = false;
  startPos = startPos || 0;
  // Pause/release whichever backend was previously active before switching.
  if (G.mode === 'hls') { try { G.video.pause(); } catch (e) {} }
  else if (G.mode === 'yt' && G.ytPlayer) { try { G.ytPlayer.pauseVideo(); } catch (e) {} }
  var mode = /^https?:\/\//.test(vid) ? 'hls' : 'yt';
  if (mode !== 'hls' && G.hls) { try { G.hls.destroy(); } catch (e) {} G.hls = null; }
  G.mode = mode;
  setMediaMode(mode);
  if (mode === 'hls') {
    loadHlsSrc(vid, startPos);
    G.ready = true;
    startProg();
  } else if (G.ytReady && G.ytPlayer && G.ytPlayer.loadVideoById) {
    G.ytPlayer.loadVideoById({ videoId: vid, startSeconds: startPos });
    G.ready = true;
    applySpeed();
    scheduleYtFallbackCheck(vid);
  } else {
    G.pendingVid = vid; G.pendingPos = startPos;
    scheduleYtFallbackCheck(vid);
  }
  G.currentVid = vid;
}

// Страховка: YouTube иногда блокирует embed-плеер проверкой "вы не бот" без
// onError через IFrame API — если playback не начался за разумное время,
// предлагаем открыть видео напрямую на YouTube вместо висящего плеера.
function scheduleYtFallbackCheck(vid) {
  clearTimeout(G.ytFallbackTimer);
  G.ytFallbackTimer = setTimeout(function () {
    if (G.mode === 'yt' && G.currentVid === vid && !G.playing) showYtFallback();
  }, 12000);
}
function showYtFallback() {
  clearTimeout(G.ytFallbackTimer);
  var o = document.getElementById('yt-fallback'); if (o) o.classList.add('show');
}
function hideYtFallback() {
  var o = document.getElementById('yt-fallback'); if (o) o.classList.remove('show');
}
function openOnYouTube() {
  var vid = G.currentVid; if (!vid || /^https?:\/\//.test(vid)) return;
  var url = 'https://www.youtube.com/watch?v=' + encodeURIComponent(vid);
  if (tg && tg.openLink) tg.openLink(url, { try_instant_view: false });
  else window.open(url, '_blank');
}

// Same video already loaded for a different topic of the same day:
// seek in place instead of reloading the iframe (avoids a visible
// rebuffer/flash when switching between topics).
function seekWithinVideo(pos) {
  resetPlayerUI();
  try { G.player.seekTo(pos, true); G.player.playVideo(); } catch (e) {}
  G.ready = true;
  applySpeed();
  startProg();
}

function doPlay() { if (!playerReady()) return; try { G.playing ? G.player.pauseVideo() : G.player.playVideo(); } catch (e) {} }
function doSeek(d) { if (!playerReady()) return; try { G.player.seekTo(Math.max(0, G.player.getCurrentTime() + d), true); } catch (e) {} if (G.playing) scheduleHide(); }

// ─── HLS <video> player + Picture-in-Picture ─────────────────────────────

// Loads an HLS playlist into G.video: native HLS on Safari/iOS, hls.js
// elsewhere. Seeks to startPos and starts playback once the manifest/metadata
// is available.
function loadHlsSrc(url, startPos) {
  var video = G.video;
  if (G.hls) { try { G.hls.destroy(); } catch (e) {} G.hls = null; }
  var onReady = function () {
    try { video.currentTime = startPos || 0; } catch (e) {}
    applySpeed();
    video.play().catch(function () {});
  };
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.addEventListener('loadedmetadata', onReady, { once: true });
  } else if (window.Hls && window.Hls.isSupported()) {
    var hls = new window.Hls();
    G.hls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, onReady);
    hls.on(window.Hls.Events.ERROR, function (evt, data) {
      if (!data.fatal) return;
      switch (data.type) {
        case window.Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
        case window.Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
        default: try { hls.destroy(); } catch (e) {} G.hls = null;
      }
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    video.src = url;
    video.addEventListener('loadedmetadata', onReady, { once: true });
  }
}

// Real PiP for the <video> element: only offered in browser mode (URL_TOKEN),
// where the Mini App runs in a real browser (Chrome on Android, Safari on
// iOS) and requestPictureInPicture()/webkitSetPresentationMode() work.
// Inside Telegram's WebView (iOS or Android), PiP is unavailable — the
// button stays hidden there and "Открыть в браузере" (#obb) is offered instead.
function initPiP() {
  var video = G.video;
  G.pipSupported = !!URL_TOKEN && (!!(document.pictureInPictureEnabled && video.requestPictureInPicture)
    || (typeof video.webkitSupportsPresentationMode === 'function' && video.webkitSupportsPresentationMode('picture-in-picture')));
  var b = document.getElementById('pipb');
  if (!b) return;
  video.addEventListener('enterpictureinpicture', function () { b.classList.add('active'); });
  video.addEventListener('leavepictureinpicture', function () { b.classList.remove('active'); });
  video.addEventListener('webkitpresentationmodechanged', function () {
    b.classList.toggle('active', video.webkitPresentationMode === 'picture-in-picture');
  });
}
// TEMP: surfaces requestPictureInPicture() outcomes via alert() while we
// debug "Открыть в браузере" PiP on iOS Safari. Only fires there.
var PIP_DEBUG = IS_IOS && !!URL_TOKEN;
function doPiP() {
  if (G.mode !== 'hls' || !G.pipSupported) return;
  var video = G.video;
  if (typeof video.webkitSetPresentationMode === 'function') {
    video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
    return;
  }
  if (document.pictureInPictureElement === video) {
    try { document.exitPictureInPicture(); } catch (e) { if (PIP_DEBUG) alert('PiP exit error: ' + e.name + ': ' + e.message); }
    return;
  }
  try {
    video.requestPictureInPicture()
      .then(function () { if (PIP_DEBUG) alert('PiP: вошёл успешно'); })
      .catch(function (e) { if (PIP_DEBUG) alert('PiP error: ' + e.name + ': ' + e.message); });
  } catch (e) {
    if (PIP_DEBUG) alert('PiP throw: ' + e.name + ': ' + e.message);
  }
}

// Builds the G.player dispatcher (delegates to whichever backend is active)
// and wires up <video> playback events that mirror the YouTube onStateChange
// handling above.
function initPlayer() {
  G.video = document.getElementById('vplayer');
  loadSpeed();
  syncSpeedBtn();
  G.player = {
    getCurrentTime: function () {
      if (G.mode === 'hls') return G.video.currentTime || 0;
      try { return G.ytPlayer.getCurrentTime(); } catch (e) { return 0; }
    },
    getDuration: function () {
      if (G.mode === 'hls') return G.video.duration || 0;
      try { return G.ytPlayer.getDuration(); } catch (e) { return 0; }
    },
    seekTo: function (sec) {
      if (G.mode === 'hls') { try { G.video.currentTime = sec; } catch (e) {} }
      else { try { G.ytPlayer.seekTo(sec, true); } catch (e) {} }
    },
    playVideo: function () {
      if (G.mode === 'hls') { G.video.play().catch(function () {}); }
      else { try { G.ytPlayer.playVideo(); } catch (e) {} }
    },
    pauseVideo: function () {
      if (G.mode === 'hls') { G.video.pause(); }
      else { try { G.ytPlayer.pauseVideo(); } catch (e) {} }
    },
    stopVideo: function () {
      if (G.mode === 'hls') { G.video.pause(); try { G.video.currentTime = 0; } catch (e) {} }
      else { try { G.ytPlayer.stopVideo(); } catch (e) {} }
    }
  };
  G.video.addEventListener('play', function () {
    if (G.mode !== 'hls') return;
    G.playing = true; G.ready = true; startProg(); startSaveTimer(); startStatsTimer(); scheduleHide(); syncPB();
  });
  G.video.addEventListener('pause', function () {
    if (G.mode !== 'hls') return;
    G.playing = false;
    clearInterval(G.progTimer); clearInterval(G.statsTimer); saveProgress(); reportProgress(); showCtrl(false); syncPB();
  });
  G.video.addEventListener('ended', function () {
    if (G.mode !== 'hls') return;
    G.playing = false; clearInterval(G.progTimer); clearInterval(G.statsTimer); saveProgress(); reportProgress(); syncPB();
  });
  initPiP();
}
initPlayer();

function startProg() {
  clearInterval(G.progTimer);
  G.progTimer = setInterval(function () {
    if (!playerReady() || G.dragging) return;
    try {
      var cur = G.player.getCurrentTime(), dur = G.player.getDuration();
      if (!dur) return;
      var segStart = G.segStart || 0;
      var segEnd = (G.segEnd && G.segEnd > segStart) ? G.segEnd : dur;
      var segDur = Math.max(1, segEnd - segStart);
      var segCur = Math.max(0, Math.min(segDur, cur - segStart));
      var pf = document.getElementById('pf'); if (pf) pf.style.width = (segCur / segDur * 100) + '%';
      var tc = document.getElementById('tc'); if (tc) tc.textContent = fmt(segCur);
      var td = document.getElementById('td'); if (td) td.textContent = fmt(segDur);
      if (cur >= segEnd - 0.4 && !G.topicEndShown) {
        G.topicEndShown = true;
        showTopicEnd();
      }
    } catch (e) {}
  }, 500);
}
function hideTopicEnd() {
  var o = document.getElementById('topic-end'); if (o) o.classList.remove('show');
}
function showTopicEnd() {
  try { if (G.player && G.playing) G.player.pauseVideo(); } catch (e) {}
  var segStart = G.segStart || 0;
  var dur = 0; try { dur = G.player.getDuration(); } catch (e) {}
  var segEnd = (G.segEnd && G.segEnd > segStart) ? G.segEnd : dur;
  reportStats(G.badgeText, topicLabel(G.idx), Math.max(0, segEnd - segStart));
  reportWatchProgress(CURRENT_COURSE_ID, currentSectionKey(), G.badgeText, G.idx,
    G.topics[G.idx] ? G.topics[G.idx].title : '', segEnd, segEnd - segStart, true);
  var o = document.getElementById('topic-end'); if (!o) return;
  var hasNext = G.idx < G.topics.length - 1;
  var nb = document.getElementById('te-next');
  if (nb) nb.style.display = hasNext ? '' : 'none';
  o.classList.add('show');
}
function repeatTopic() {
  hideTopicEnd(); G.topicEndShown = false;
  try { if (G.player) { G.player.seekTo(G.segStart || 0, true); G.player.playVideo(); } } catch (e) {}
}
function nextTopicFromEnd() {
  hideTopicEnd();
  goNext();
}
function fmt(s) {
  s = Math.floor(s || 0);
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return h + ':' + ('0' + m).slice(-2) + ':' + ('0' + sec).slice(-2);
  return m + ':' + ('0' + sec).slice(-2);
}
function syncPB() { var b = document.getElementById('pb'); if (!b) return; b.innerHTML = G.playing ? '<svg><use href="#i-pause"/></svg>' : '<svg><use href="#i-play"/></svg>'; }

function clickBar(e) {
  if (!playerReady()) return;
  try {
    var r = e.currentTarget.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    var segStart = G.segStart || 0;
    var dur = G.player.getDuration();
    var segEnd = (G.segEnd && G.segEnd > segStart) ? G.segEnd : dur;
    var target = segStart + pct * (segEnd - segStart);
    G.topicEndShown = false; hideTopicEnd();
    G.player.seekTo(target, true);
  } catch (e) {}
  if (G.playing) scheduleHide();
}

// ─── Progress bar drag-seek ──────────────────────────────────────────────

function pbarEventPct(e, bar) {
  var r = bar.getBoundingClientRect();
  var clientX = (e.touches && e.touches.length) ? e.touches[0].clientX
    : (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
}
function pbarSegDur() {
  var segStart = G.segStart || 0;
  var dur = playerReady() ? G.player.getDuration() : 0;
  var segEnd = (G.segEnd && G.segEnd > segStart) ? G.segEnd : dur;
  return Math.max(1, segEnd - segStart);
}
function pbarRenderDrag() {
  var segDur = pbarSegDur();
  var pf = document.getElementById('pf'); if (pf) pf.style.width = (G.dragPct * 100) + '%';
  var tc = document.getElementById('tc'); if (tc) tc.textContent = fmt(G.dragPct * segDur);
  var td = document.getElementById('td'); if (td) td.textContent = fmt(segDur);
}
function pbarStartDrag(e) {
  if (!playerReady()) return;
  G.dragging = true;
  G.dragPct = pbarEventPct(e, e.currentTarget);
  pbarRenderDrag();
  e.stopPropagation();
}
function pbarMoveDrag(e) {
  if (!G.dragging) return;
  var bar = document.querySelector('.pbar'); if (!bar) return;
  G.dragPct = pbarEventPct(e, bar);
  pbarRenderDrag();
  e.preventDefault();
}
function pbarEndDrag(e) {
  if (!G.dragging) return;
  G.dragging = false;
  try {
    var segStart = G.segStart || 0;
    var target = segStart + G.dragPct * pbarSegDur();
    G.topicEndShown = false; hideTopicEnd();
    G.player.seekTo(target, true);
  } catch (err) {}
  if (G.playing) scheduleHide();
}
function showCtrl(autoHide) { var c = document.getElementById('ctrl'); if (!c) return; c.classList.add('show'); clearTimeout(G.ctrlTimer); if (autoHide !== false && G.playing) scheduleHide(); }
function hideCtrl() { var c = document.getElementById('ctrl'); if (!c) return; clearTimeout(G.ctrlTimer); c.classList.remove('show'); }
function scheduleHide() { clearTimeout(G.ctrlTimer); G.ctrlTimer = setTimeout(function () { if (G.playing) hideCtrl(); }, 3500); }
function tapVideo() { var c = document.getElementById('ctrl'); if (!c) return; if (c.classList.contains('show')) { hideCtrl(); } else { showCtrl(true); } }

// Telegram Mini Apps Fullscreen API (Bot API 8.0+) hides the Telegram header
// entirely. Only used inside Telegram (not in "Открыть в браузере" mode,
// where the regular Fullscreen API below is unrestricted anyway).
function tgFSSupported() {
  return !URL_TOKEN && !!(tg && tg.requestFullscreen && tg.exitFullscreen && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0'));
}

// Hides the iframe-resize flash (YouTube briefly shows its title/controls
// overlay) behind an opaque cover while tg.requestFullscreen() resizes the
// viewport. Removed once fullscreenChanged fires (with a safety timeout in
// case it never does).
function fsCoverOn() {
  var c = document.getElementById('ctrl'); if (!c) return;
  c.classList.add('fscover');
  clearTimeout(G.fsCoverTimer);
  G.fsCoverTimer = setTimeout(fsCoverOff, 700);
}
function fsCoverOff() {
  clearTimeout(G.fsCoverTimer);
  var c = document.getElementById('ctrl'); if (c) c.classList.remove('fscover');
}

// Applies the result of a standard Fullscreen API request: if the element
// actually entered fullscreen, syncs G.fs/icon and resizes the active media;
// otherwise falls back to the CSS-only fake fullscreen.
function onFsEnterResult(w) {
  var nowFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  if (nowFs) {
    G.fs = true; syncFS();
    var media = activeMediaEl(w);
    if (media) media.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';
  } else {
    cssFS(w);
  }
}
function doFS() {
  var w = document.getElementById('vw'); if (!w) return;
  if (tgFSSupported()) {
    if (G.fs) { try { tg.exitFullscreen(); } catch (e) {} return; }
    fsCoverOn();
    try { tg.requestFullscreen(); } catch (e) { fsCoverOff(); }
    return;
  }
  if (URL_TOKEN) {
    // Browser mode: use the standard Fullscreen API on the video container.
    // On iOS Safari (no Element.requestFullscreen), fall back to the
    // native <video> fullscreen via webkitEnterFullscreen().
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (e) {}
      return;
    }
    var video = G.video;
    var fallback = function () {
      if (video && typeof video.webkitEnterFullscreen === 'function') { try { video.webkitEnterFullscreen(); } catch (e) {} }
      else { cssFS(w); }
    };
    if (typeof w.requestFullscreen !== 'function') { fallback(); return; }
    var result;
    try { result = w.requestFullscreen(); } catch (e) { fallback(); return; }
    if (result && typeof result.then === 'function') {
      result.then(function () { setTimeout(function () { onFsEnterResult(w); }, 100); }).catch(fallback);
    } else {
      setTimeout(function () { onFsEnterResult(w); }, 100);
    }
    return;
  }
  var fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  if (fsEl) {
    var ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (ex) { try { ex.call(document); } catch (e) {} }
    return;
  }
  if (G.fs) { cssFS(w); return; }
  if (tg && tg.expand) { try { tg.expand(); } catch (e) {} }
  var req = w.requestFullscreen || w.webkitRequestFullscreen || w.mozRequestFullScreen || w.msRequestFullscreen;
  if (!req) { cssFS(w); return; }
  var result2;
  try { result2 = req.call(w); } catch (e) { cssFS(w); return; }
  if (result2 && typeof result2.then === 'function') { result2.then(function () { setTimeout(function () { onFsEnterResult(w); }, 100); }).catch(function () { cssFS(w); }); }
  else { setTimeout(function () { onFsEnterResult(w); }, 100); }
}
function applyFsState(w, isFs) {
  G.fs = isFs; w.classList.toggle('fs', G.fs);
  if (G.fs) { document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'; applyFsSize(w); }
  else { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; w.style.width = ''; w.style.height = ''; var media = activeMediaEl(w); if (media) { media.style.width = ''; media.style.height = ''; } }
  syncFS();
}
function cssFS(w) { applyFsState(w, !G.fs); }
function applyFsSize(w) { var W = window.innerWidth, H = window.innerHeight; w.style.width = W + 'px'; w.style.height = H + 'px'; var media = activeMediaEl(w); if (media) { media.style.width = W + 'px'; media.style.height = H + 'px'; } }
function syncFS() { var b = document.getElementById('fsb'); if (!b) return; b.innerHTML = G.fs ? '<svg><use href="#i-xfs"/></svg>' : '<svg><use href="#i-fs"/></svg>'; }
function exitNativeFS() {
  // Telegram's requestFullscreen()/the standard Fullscreen API are both
  // WebApp/document-wide, not per-element — only whichever screen was open
  // when fullscreen was requested can plausibly be "the" target, so this
  // (and the three tg.onEvent handlers below) check which screen is
  // currently open rather than tracking a separate ownership flag.
  if (pdfScreenOpen()) { applyPdfFsState(false); return; }
  G.fs = false; syncFS();
  var w = document.getElementById('vw'); var media = w && activeMediaEl(w);
  if (media) media.style.cssText = '';
}
document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) exitNativeFS(); });
document.addEventListener('webkitfullscreenchange', function () { if (!document.webkitFullscreenElement) exitNativeFS(); });
document.addEventListener('mozfullscreenchange', function () { if (!document.mozFullScreenElement) exitNativeFS(); });
document.addEventListener('MSFullscreenChange', function () { if (!document.msFullscreenElement) exitNativeFS(); });

if (tgFSSupported()) {
  tg.onEvent('fullscreenChanged', function () {
    if (pdfScreenOpen()) {
      clearTimeout(pdfFsWatchdog);
      reportClientError('PDF FS fullscreenChanged event fired', 'tg.isFullscreen=' + tg.isFullscreen);
      applyPdfFsState(!!tg.isFullscreen);
      try { if (tg.isFullscreen) tg.BackButton.show(); else tg.BackButton.hide(); } catch (e) {}
      return;
    }
    var w = document.getElementById('vw'); if (!w) return;
    applyFsState(w, !!tg.isFullscreen);
    // The Telegram "✕" close button can't be hidden, but the BackButton can —
    // show it while our fullscreen is active so the hardware/system back
    // gesture exits fullscreen instead of closing the WebApp.
    try { if (tg.isFullscreen) tg.BackButton.show(); else tg.BackButton.hide(); } catch (e) {}
    // Keep the cover up a bit longer: the viewport-resize animation/iframe
    // reflow (and the YouTube overlay flash it causes) is still settling
    // when this event fires.
    clearTimeout(G.fsCoverTimer);
    G.fsCoverTimer = setTimeout(fsCoverOff, 400);
  });
  tg.onEvent('fullscreenFailed', function () {
    if (pdfScreenOpen()) {
      clearTimeout(pdfFsWatchdog);
      reportClientError('PDF FS fullscreenFailed event fired', 'Telegram API gives no further detail');
      pdfCssFS();
      return;
    }
    var w = document.getElementById('vw'); if (w) cssFS(w);
    clearTimeout(G.fsCoverTimer);
    G.fsCoverTimer = setTimeout(fsCoverOff, 400);
  });
  tg.onEvent('backButtonClicked', function () {
    if (pdfScreenOpen()) { if (PDF.fs) pdfDoFS(); return; }
    if (G.fs) doFS();
  });
}

document.addEventListener('mousemove', pbarMoveDrag);
document.addEventListener('mouseup', pbarEndDrag);
document.addEventListener('touchmove', pbarMoveDrag, { passive: false });
document.addEventListener('touchend', pbarEndDrag);
document.addEventListener('touchcancel', pbarEndDrag);

// Auto-enter PiP on backgrounding — Android only. Chrome treats
// visibilitychange/pagehide on tab-switch/minimize as carrying user
// activation, so requestPictureInPicture() succeeds there; iOS Safari
// rejects it (NotAllowedError), so this stays gated to !IS_IOS.
if (!IS_IOS) {
  function autoPiP() {
    if (G.mode !== 'hls' || !G.playing || !G.pipSupported) return;
    try { G.video.requestPictureInPicture().catch(function () {}); } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') autoPiP();
  });
  window.addEventListener('pagehide', autoPiP);
}

// Flush the resume position immediately when the app is backgrounded or the
// page is about to unload, rather than relying solely on the 5s/15s timers —
// otherwise an abrupt close (Telegram WebView killed, tab closed) can lose
// up to that many seconds of progress.
function flushProgressOnExit() {
  if (!G.playing) return;
  saveProgress();
  reportProgress();
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flushProgressOnExit();
});
window.addEventListener('pagehide', flushProgressOnExit);
window.addEventListener('beforeunload', flushProgressOnExit);

function stopVideo() {
  clearInterval(G.progTimer); clearInterval(G.saveTimer); clearInterval(G.statsTimer); clearTimeout(G.ctrlTimer);
  clearTimeout(G.ytFallbackTimer); hideYtFallback();
  saveProgress(); reportProgress();
  if (playerReady()) { try { G.player.stopVideo(); } catch (e) {} }
  G.playing = false; syncPB(); hideCtrl();
}

// ─── Player screen ────────────────────────────────────────────────────

function openPlayer(topics, idx, badgeText, backFn, startPos, dayVideoId, moduleId, itemIdx) {
  G.topics = topics; G.idx = idx; G.badgeText = badgeText; G.backFn = backFn;
  G.dayVideoId = dayVideoId || null;
  G.moduleId = (moduleId === undefined) ? null : moduleId;
  G.itemIdx = (itemIdx === undefined) ? null : itemIdx;
  var tp = G.topics[G.idx]; var total = G.topics.length;
  var vid = G.dayVideoId || tp.videoId || '';
  G.segStart = tp.startSeconds || 0;
  G.segEnd = tp.endSeconds || 0;

  document.getElementById('p-back').onclick = function () { stopVideo(); G.backFn(); };
  document.getElementById('p-header').innerHTML = '<span class="pbadge">' + G.badgeText + '</span><span class="pcnt">' + (G.idx + 1) + ' из ' + total + '</span>';
  document.getElementById('p-label').textContent = G.badgeText + ' — ТЕМА ' + (G.idx + 1);
  document.getElementById('p-title').textContent = tp.title;
  document.getElementById('btn-prev').disabled = (G.idx === 0);
  document.getElementById('btn-next').disabled = (G.idx === total - 1);
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-player').classList.add('on');
  document.getElementById('s-player').classList.toggle('theme-atm', CURRENT_COURSE_ID === 'atm');

  var pos = startPos !== undefined ? startPos : G.segStart;
  if (startPos === undefined) saveProgress();
  reportStats(badgeText, topicLabel(idx), Math.max(0, Math.floor(pos - G.segStart)));
  reportWatchProgress(CURRENT_COURSE_ID, currentSectionKey(), badgeText, idx,
    tp.title, pos, (G.segEnd && G.segEnd > G.segStart) ? (G.segEnd - G.segStart) : null, false);

  if (vid === G.currentVid && playerReady() && G.ready) {
    seekWithinVideo(pos);
  } else {
    loadVideo(vid, pos);
  }
  // In "Открыть в браузере" mode there's no Telegram chrome around the
  // player, so reveal the controls immediately instead of waiting for a tap.
  if (URL_TOKEN) showCtrl(false);
}

function goPrev() {
  if (G.idx > 0) {
    var newIdx = G.idx - 1;
    openPlayer(G.topics, newIdx, G.badgeText, G.backFn, G.topics[newIdx].startSeconds || 0, G.dayVideoId, G.moduleId, G.itemIdx);
  }
}
function goNext() {
  if (G.idx < G.topics.length - 1) {
    var newIdx = G.idx + 1;
    openPlayer(G.topics, newIdx, G.badgeText, G.backFn, G.topics[newIdx].startSeconds || 0, G.dayVideoId, G.moduleId, G.itemIdx);
  }
}

// ─── PDF viewer (course_materials, module items with type==="pdf") ──────
// Renders pages on a <canvas> via pdf.js instead of a native <embed>/<iframe>
// — Telegram's in-app WebView (esp. Android) doesn't reliably ship a PDF
// plugin. getDocument() only fetches the document structure up front and
// streams individual pages via HTTP range requests, so per-page rendering
// here is naturally lazy — no extra chunking logic needed on our side.
// Pinned to the @3 major — pdfjs-dist@4 dropped the classic UMD build
// entirely (legacy/build/pdf.min.js 404s; only .mjs ES-module bundles
// remain), which is incompatible with this file's plain-script/no-bundler
// setup. @3's legacy/build/pdf.min.js is still a real UMD build exposing
// window.pdfjsLib, confirmed directly against the CDN before switching.
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3/legacy/build/pdf.worker.min.js';
}

var PDF = {
  doc: null, moduleId: null, itemIdx: null,
  pageNum: 1, pageCount: 0, zoom: 1, baseScale: 1,
  rendering: false, pending: false, fs: false
};

// Derives our own /api/pdf-proxy URL from a raw R2 storage_url —
// pub-*.r2.dev doesn't support CORS preflight, which blocks pdf.js's
// Range-based fetches before they reach R2. openPdfExternally() deliberately
// keeps using the raw R2 URL — a plain browser navigation isn't subject to
// CORS at all.
function pdfProxyUrl(rawUrl) {
  var key = rawUrl.replace(/^https?:\/\/[^/]+\//, '');
  return API_BASE + '/api/pdf-proxy?key=' + encodeURIComponent(key);
}

// Temporary diagnostic aid — Eruda (mobile console via CDN) turned out to be
// unreachable from inside Telegram's WebView, so PDF-viewer errors are
// reported over the same channel the rest of the API already uses
// successfully instead of relying on an on-device console. sendBeacon is
// fire-and-forget and non-blocking; fetch+keepalive is the fallback where
// it's unavailable. Logged server-side only, see bot.py:handle_client_error.
function reportClientError(context, err) {
  console.log('reportClientError called', context);
  var statusEl = document.getElementById('pdf-error-status');
  function setStatus(text) { if (statusEl) statusEl.textContent = text; }
  setStatus('Отправка отчёта об ошибке…');
  try {
    var payload = JSON.stringify({
      message: err && err.message ? String(err.message) : String(err),
      stack: err && err.stack ? String(err.stack) : null,
      context: context
    });
    var url = API_BASE + '/api/client-error';
    if (navigator.sendBeacon) {
      var queued = navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
      setStatus(queued ? 'Отчёт отправлен (sendBeacon)' : 'sendBeacon отклонил отправку');
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, keepalive: true })
        .then(function () { setStatus('Отчёт отправлен (fetch)'); })
        .catch(function (e) { setStatus('Не удалось отправить: ' + (e && e.message ? e.message : e)); });
    }
  } catch (e) {
    setStatus('Ошибка при подготовке отчёта: ' + (e && e.message ? e.message : e));
  }
}

function openModulePdf(moduleId, itemIdx) {
  var mod = COURSE_DATA.modules.find(function (m) { return m.id === moduleId; });
  var item = mod && mod.items[itemIdx];
  if (!item || item.type !== 'pdf') return;
  PDF.moduleId = moduleId; PDF.itemIdx = itemIdx;
  PDF.doc = null; PDF.pageNum = 1; PDF.pageCount = 0; PDF.zoom = 1; PDF.rendering = false; PDF.pending = false;

  document.getElementById('pdf-title').textContent = item.title;
  document.getElementById('pdf-pageinfo').textContent = '';
  document.getElementById('pdf-zlabel').textContent = '100%';
  document.getElementById('pdf-wrap').scrollLeft = 0;
  document.getElementById('pdf-wrap').scrollTop = 0;
  hidePdfFallback();
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  // "Liquid Glass" toolbar styling + brand color theme are opted into
  // per-course rather than applied globally — currently only "АТМ" wants it.
  document.getElementById('s-pdf').classList.toggle('pdf-glass', CURRENT_COURSE_ID === 'atm');
  document.getElementById('s-pdf').classList.toggle('theme-atm', CURRENT_COURSE_ID === 'atm');
  document.getElementById('s-pdf').classList.add('on');
  window.addEventListener('resize', pdfOnViewportChange);
  window.addEventListener('orientationchange', pdfOnViewportChange);

  if (!window.pdfjsLib) { showPdfFallback(); return; }
  document.getElementById('pdf-loading').classList.remove('hide');

  var url = pdfProxyUrl(item.url);
  pdfjsLib.getDocument(url).promise.then(function (doc) {
    PDF.doc = doc;
    PDF.pageCount = doc.numPages;
    pdfRenderCurrent();
  }).catch(function (err) {
    console.error('pdf.js getDocument failed:', err);
    reportClientError('pdf.js getDocument failed', err);
    document.getElementById('pdf-loading').classList.add('hide');
    showPdfFallback();
  });
}

function closePdf() {
  if (PDF.doc) { try { PDF.doc.destroy(); } catch (e) {} }
  var moduleId = PDF.moduleId;
  PDF.doc = null; PDF.rendering = false; PDF.pending = false; PDF.fs = false;
  window.removeEventListener('resize', pdfOnViewportChange);
  window.removeEventListener('orientationchange', pdfOnViewportChange);
  clearTimeout(pdfResizeTimer);
  clearTimeout(pdfCtrlTimer);
  document.getElementById('s-pdf').classList.remove('fs');
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  openModule(moduleId);
}

function showPdfFallback() { var o = document.getElementById('pdf-fallback'); if (o) o.classList.add('show'); }
function hidePdfFallback() {
  var o = document.getElementById('pdf-fallback'); if (o) o.classList.remove('show');
  var s = document.getElementById('pdf-error-status'); if (s) s.textContent = '';
}

function openPdfExternally() {
  var mod = COURSE_DATA.modules.find(function (m) { return m.id === PDF.moduleId; });
  var item = mod && mod.items[PDF.itemIdx];
  if (!item) return;
  var url = encodeURI(item.url);
  if (tg && tg.openLink) tg.openLink(url, { try_instant_view: false });
  else window.open(url, '_blank');
}

// Always (re-)renders PDF.pageNum at PDF.zoom — page turns and zoom changes
// both just update PDF state and call this. pdf.js throws if a second
// render starts on the same canvas before the first finishes, so overlapping
// calls (e.g. a quick zoom-then-page-turn) are coalesced via PDF.pending
// instead of firing concurrently.
function pdfRenderCurrent() {
  if (!PDF.doc) return;
  if (PDF.rendering) { PDF.pending = true; return; }
  PDF.rendering = true;
  PDF.doc.getPage(PDF.pageNum).then(function (page) {
    var wrap = document.getElementById('pdf-wrap');
    var dpr = window.devicePixelRatio || 1;
    var natural = page.getViewport({ scale: 1 });
    var scaleW = wrap.clientWidth / natural.width;
    var scaleH = wrap.clientHeight / natural.height;
    PDF.baseScale = Math.min(scaleW, scaleH);
    var effScale = PDF.baseScale * PDF.zoom;
    var viewport = page.getViewport({ scale: effScale * dpr });
    var canvas = document.getElementById('pdf-canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = (viewport.width / dpr) + 'px';
    canvas.style.height = (viewport.height / dpr) + 'px';
    var ctx = canvas.getContext('2d');
    return page.render({ canvasContext: ctx, viewport: viewport }).promise;
  }).then(function () {
    PDF.rendering = false;
    document.getElementById('pdf-loading').classList.add('hide');
    document.getElementById('pdf-pageinfo').textContent = PDF.pageNum + ' / ' + PDF.pageCount;
    document.getElementById('pdf-zlabel').textContent = Math.round(PDF.zoom * 100) + '%';
    document.getElementById('pdf-btn-prev').disabled = (PDF.pageNum <= 1);
    document.getElementById('pdf-btn-next').disabled = (PDF.pageNum >= PDF.pageCount);
    if (PDF.pending) { PDF.pending = false; pdfRenderCurrent(); }
  }).catch(function (err) {
    console.error('pdf.js page render failed:', err);
    reportClientError('pdf.js page render failed', err);
    PDF.rendering = false;
    document.getElementById('pdf-loading').classList.add('hide');
    showPdfFallback();
  });
}

function pdfGoToPage(n) {
  n = Math.max(1, Math.min(PDF.pageCount, n));
  if (n === PDF.pageNum) return;
  PDF.pageNum = n;
  document.getElementById('pdf-wrap').scrollLeft = 0;
  document.getElementById('pdf-wrap').scrollTop = 0;
  pdfRenderCurrent();
}

function pdfSetZoom(z) {
  PDF.zoom = Math.max(0.5, Math.min(3, z));
  pdfRenderCurrent();
}
function pdfZoomIn() { pdfSetZoom(PDF.zoom + 0.25); }
function pdfZoomOut() { pdfSetZoom(PDF.zoom - 0.25); }

// Same 3-tier fullscreen as the video player's doFS() (Telegram Fullscreen
// API -> standard browser Fullscreen API -> CSS-only fallback) — CSS alone
// can only stretch content within Telegram's own window chrome, it can't
// remove the native Telegram header the way the real APIs can. No URL_TOKEN
// ("Открыть в браузере") branch here — PDFs aren't reachable through that
// deep-link flow, unlike video topics. #pdf-wrap/#pdf-canvas are never
// recreated by any tier, so touch handlers (pinch/swipe/pan) keep working
// unchanged throughout.
function pdfToggleFullscreen() { pdfDoFS(); }

function pdfScreenOpen() {
  var el = document.getElementById('s-pdf');
  return !!(el && el.classList.contains('on'));
}

// Temporary — same rationale as reportClientError above: the user reported
// "fullscreen doesn't work" for PDF, which could mean the button did nothing,
// tg.requestFullscreen() threw, or it ran but fullscreenChanged/failed never
// fired. Logs each step server-side so the actual failure point is visible
// without relying on on-device DevTools. Remove once diagnosed.
var pdfFsWatchdog = null;
function pdfDoFS() {
  var w = document.getElementById('s-pdf'); if (!w) return;
  reportClientError('PDF FS click',
    'tgFSSupported=' + tgFSSupported()
    + ' typeof(tg)=' + typeof tg
    + ' typeof(tg.requestFullscreen)=' + (tg ? typeof tg.requestFullscreen : 'n/a')
    + ' isVersionAtLeast(8.0)=' + (tg && tg.isVersionAtLeast ? tg.isVersionAtLeast('8.0') : 'n/a')
    + ' tg.platform=' + (tg ? tg.platform : 'n/a')
    + ' tg.version=' + (tg ? tg.version : 'n/a')
    + ' PDF.fs=' + PDF.fs);
  if (tgFSSupported()) {
    if (PDF.fs) {
      try { tg.exitFullscreen(); } catch (e) { reportClientError('PDF FS tg.exitFullscreen() threw', e); }
      return;
    }
    clearTimeout(pdfFsWatchdog);
    pdfFsWatchdog = setTimeout(function () {
      reportClientError('PDF FS watchdog', 'no fullscreenChanged/fullscreenFailed event within 3000ms of tg.requestFullscreen()');
    }, 3000);
    try {
      var ret = tg.requestFullscreen();
      reportClientError('PDF FS tg.requestFullscreen() called', 'return=' + (ret === undefined ? 'undefined' : String(ret)));
    } catch (e) {
      clearTimeout(pdfFsWatchdog);
      reportClientError('PDF FS tg.requestFullscreen() threw', e);
    }
    return;
  }
  var fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  if (fsEl) {
    var ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (ex) { try { ex.call(document); } catch (e) {} }
    return;
  }
  if (PDF.fs) { pdfCssFS(); return; }
  if (tg && tg.expand) { try { tg.expand(); } catch (e) {} }
  var req = w.requestFullscreen || w.webkitRequestFullscreen || w.mozRequestFullScreen || w.msRequestFullscreen;
  if (!req) { pdfCssFS(); return; }
  var result;
  try { result = req.call(w); } catch (e) { pdfCssFS(); return; }
  if (result && typeof result.then === 'function') {
    result.then(function () { setTimeout(pdfOnFsEnterResult, 100); }).catch(pdfCssFS);
  } else {
    setTimeout(pdfOnFsEnterResult, 100);
  }
}
function pdfOnFsEnterResult() {
  var nowFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  if (nowFs) { applyPdfFsState(true); }
  else { pdfCssFS(); }
}
// Temporary — computed style read back "correct" (display:none) at both t=0
// and t=500ms in the previous round, yet the on-device screenshot still
// shows "← Назад". Two remaining explanations: (a) the diagnostic was
// reading the wrong .back node (there are two in the document — #p-back on
// the video screen, and PDF's own unlabeled .back), or (b) the DOM/CSS state
// really is correct and this is a stale-paint/compositing bug (iOS WebKit is
// known to sometimes not repaint a position:fixed subtree whose sibling was
// hidden mid-viewport-resize). scopedBackParentIsW + the full allBacksInDoc
// dump settles (a); getBoundingClientRect settles (b) — display:none must
// collapse it to a 0x0 rect regardless of any paint/compositing bug.
function pdfDumpBackState(label) {
  var w = document.getElementById('s-pdf'); if (!w) return;
  var back = w.querySelector('.back');
  var rect = back ? back.getBoundingClientRect() : null;
  var all = document.querySelectorAll('.back');
  var allInfo = Array.prototype.map.call(all, function (el) {
    return '[id=' + (el.id || 'none') + ' parentId=' + (el.parentElement ? el.parentElement.id : 'none')
      + ' parentClass=' + (el.parentElement ? el.parentElement.className : 'none')
      + ' display=' + getComputedStyle(el).display + ']';
  }).join(' ');
  reportClientError('PDF FS ' + label,
    'className=' + w.className
    + ' computedPosition=' + getComputedStyle(w).position
    + ' computedInset=' + getComputedStyle(w).top + '/' + getComputedStyle(w).right + '/' + getComputedStyle(w).bottom + '/' + getComputedStyle(w).left
    + ' scopedBackParentIsW=' + (back ? (back.parentElement === w) : 'no-back-found-in-w')
    + ' scopedBackDisplay=' + (back ? getComputedStyle(back).display : 'n/a')
    + ' scopedBackRect=' + (rect ? (rect.width + 'x' + rect.height + '@' + rect.top + ',' + rect.left) : 'n/a')
    + ' allBacksInDoc=' + all.length + ' ' + allInfo);
}
function applyPdfFsState(isFs) {
  var w = document.getElementById('s-pdf'); if (!w) return;
  PDF.fs = isFs; w.classList.toggle('fs', PDF.fs);
  pdfDumpBackState('applyPdfFsState applied');
  setTimeout(function () { pdfDumpBackState('applyPdfFsState +500ms readback'); }, 500);
  if (PDF.fs) { pdfShowCtrl(true); } else { clearTimeout(pdfCtrlTimer); }
  syncPdfFS();
  if (PDF.doc) pdfRenderCurrent();
}
function pdfCssFS() { applyPdfFsState(!PDF.fs); }
function syncPdfFS() {
  var b = document.getElementById('pdf-fsb'); if (!b) return;
  b.innerHTML = PDF.fs ? '<svg><use href="#i-xfs"/></svg>' : '<svg><use href="#i-fs"/></svg>';
}

// Fullscreen-only toolbar visibility — same show/hide/auto-hide pattern as
// the video player's showCtrl/hideCtrl/scheduleHide/tapVideo (see above).
// Outside fullscreen #pdf-ctrl has no special CSS, so these are inert there.
var pdfCtrlTimer = null;
function pdfShowCtrl(autoHide) {
  var c = document.getElementById('pdf-ctrl'); if (!c) return;
  c.classList.add('show');
  clearTimeout(pdfCtrlTimer);
  if (autoHide !== false) pdfScheduleHideCtrl();
}
function pdfHideCtrl() {
  var c = document.getElementById('pdf-ctrl'); if (!c) return;
  clearTimeout(pdfCtrlTimer);
  c.classList.remove('show');
}
function pdfScheduleHideCtrl() {
  clearTimeout(pdfCtrlTimer);
  pdfCtrlTimer = setTimeout(pdfHideCtrl, 3500);
}
function pdfTapToggleCtrl() {
  var c = document.getElementById('pdf-ctrl'); if (!c) return;
  if (c.classList.contains('show')) pdfHideCtrl(); else pdfShowCtrl(true);
}

// Touch handling: two fingers always pinch-zoom (live CSS-transform preview,
// real pdf.js re-render only on release — re-rasterizing on every touchmove
// would be far too slow). One finger only turns pages, and only at 100%
// zoom; above that, single-finger drags are left alone so the wrap's native
// overflow:auto scroll pans the enlarged page instead.
var pdfTouch = { mode: null, startX: 0, startY: 0, startTime: 0, startDist: 0, startZoom: 1 };

function pdfTouchDist(touches) {
  var dx = touches[0].clientX - touches[1].clientX, dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
function pdfTouchStart(e) {
  if (e.touches.length === 2) {
    pdfTouch.mode = 'pinch';
    pdfTouch.startDist = pdfTouchDist(e.touches);
    pdfTouch.startZoom = PDF.zoom;
  } else if (e.touches.length === 1) {
    // Zoomed in -> mode stays null (native overflow:auto panning takes
    // over), but start position/time are still recorded so touchend below
    // can tell a real drag apart from a tap regardless of zoom level.
    pdfTouch.mode = (PDF.zoom <= 1.001) ? 'swipe' : null;
    pdfTouch.startX = e.touches[0].clientX;
    pdfTouch.startY = e.touches[0].clientY;
    pdfTouch.startTime = Date.now();
  } else {
    pdfTouch.mode = null;
  }
}
function pdfTouchMove(e) {
  if (pdfTouch.mode === 'pinch' && e.touches.length === 2) {
    e.preventDefault();
    var factor = pdfTouchDist(e.touches) / pdfTouch.startDist;
    document.getElementById('pdf-canvas').style.transform = 'scale(' + factor + ')';
  } else if (pdfTouch.mode === 'swipe' && e.touches.length === 1) {
    var dx = e.touches[0].clientX - pdfTouch.startX, dy = e.touches[0].clientY - pdfTouch.startY;
    if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
  }
}
function pdfTouchEnd(e) {
  if (pdfTouch.mode === 'pinch') {
    var canvas = document.getElementById('pdf-canvas');
    var m = /scale\(([\d.]+)\)/.exec(canvas.style.transform || '');
    canvas.style.transform = '';
    pdfSetZoom(pdfTouch.startZoom * (m ? parseFloat(m[1]) : 1));
  } else {
    var t = (e.changedTouches && e.changedTouches[0]) || { clientX: pdfTouch.startX, clientY: pdfTouch.startY };
    var dx = t.clientX - pdfTouch.startX, dy = t.clientY - pdfTouch.startY;
    if (pdfTouch.mode === 'swipe' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      pdfGoToPage(PDF.pageNum + (dx < 0 ? 1 : -1));
    } else if (PDF.fs && Math.abs(dx) < 10 && Math.abs(dy) < 10 && (Date.now() - pdfTouch.startTime) < 300) {
      // Fullscreen-only tap-to-toggle — small enough movement and short
      // enough duration to rule out both a real swipe (>50px) and a
      // zoomed-in pan drag, so this never fires alongside either.
      pdfTapToggleCtrl();
    }
  }
  pdfTouch.mode = null;
}

function initPdfViewer() {
  var wrap = document.getElementById('pdf-wrap');
  wrap.addEventListener('touchstart', pdfTouchStart, { passive: true });
  wrap.addEventListener('touchmove', pdfTouchMove, { passive: false });
  wrap.addEventListener('touchend', pdfTouchEnd, { passive: true });
}
initPdfViewer();

// Rotating the device while a PDF is open otherwise leaves the canvas at its
// old (portrait) pixel size — pdfRenderCurrent() re-measures #pdf-wrap and
// re-renders at the new size, but only needs to run once resize/orientation
// settles (both fire, sometimes repeatedly, especially on iOS mid-rotation)
// and PDF.pageNum/PDF.zoom are untouched, so the user stays on the same page
// at the same zoom. Listener lifetime is scoped to the PDF screen itself —
// attached in openModulePdf, detached in closePdf — instead of running for
// the whole app, so it never piles up across repeated PDF opens.
var pdfResizeTimer = null;
function pdfOnViewportChange() {
  clearTimeout(pdfResizeTimer);
  pdfResizeTimer = setTimeout(function () {
    // One more tick after the debounce delay — avoids a race where
    // #pdf-wrap's clientWidth is read a frame before the browser has
    // actually finished reflow/layout for the new orientation.
    requestAnimationFrame(function () { if (PDF.doc) pdfRenderCurrent(); });
  }, 180);
}

// ─── Navigation / screens ────────────────────────────────────────────────

function goTab(t) {
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-' + t).classList.add('on'); document.getElementById('n-' + t).classList.add('on'); stopVideo();
}

function buildHome() {
  var h = '<div class="back" onclick="backToMyCourses()">← Мои курсы</div>'
    + '<div class="hdr hdr-logo"><img class="logo" src="logo.jpg" alt="Business Booster"><div><h1>БОС Курс</h1><p>Бизнес Операционная Система<br>от Александра Высоцкого</p></div>'
    + '<button class="theme-btn" id="themeBtn" onclick="toggleTheme()"><svg><use href="#i-' + (G.theme === 'light' ? 'moon' : 'sun') + '"/></svg></button></div>';
  var prog = loadProgress();
  if (prog && prog.type === 'day' && prog.dayId) {
    var posStr = prog.pos > 0 ? ' (' + fmt(prog.pos) + ')' : '';
    h += '<div class="continue-card"><div class="continue-label">▶ Продолжить просмотр</div>'
      + '<div class="continue-title">' + prog.badgeText + ' — Тема ' + (prog.idx + 1) + posStr + '<br><span style="font-size:13px;font-weight:400;color:var(--tx2)">' + prog.title + '</span></div>'
      + '<div class="continue-btns"><button class="cbtn-cont" onclick="continueWatch(event)">Продолжить</button>'
      + '<button class="cbtn-new" onclick="startNew(event)">С начала</button></div></div>';
  }
  h += '<div class="stitle">Программа курса</div><div class="grid">';
  COURSE_DATA.days.forEach(function (d) {
    h += '<div class="dcard" onclick="openDay(' + d.id + ')"><div class="n">' + d.id + '</div><div class="l">' + d.title + '</div><div class="c">' + d.topics.length + ' тем</div></div>';
  });
  h += '</div>';
  document.getElementById('s-home').innerHTML = h;
  document.getElementById('s-home').classList.toggle('theme-atm', CURRENT_COURSE_ID === 'atm');
}

function continueWatch(e) {
  e.stopPropagation(); var prog = loadProgress(); if (!prog || !prog.dayId) return;
  var day = COURSE_DATA.days.find(function (d) { return d.id === prog.dayId; });
  if (!day) return;
  var sp = prog.pos || day.topics[prog.idx].startSeconds || 0;
  openPlayer(day.topics, prog.idx, 'ДЕНЬ ' + prog.dayId, function () { openDay(prog.dayId); }, sp, day.videoHlsUrl);
}
function startNew(e) { e.stopPropagation(); clearProgress(); buildHome(); }

function openDay(id) {
  var day = COURSE_DATA.days.find(function (d) { return d.id === id; });
  if (!day) return;
  var prog = loadProgress(); var savedIdx = (prog && prog.dayId === id) ? prog.idx : -1;
  var h = '<div class="back" onclick="goHome()">← Назад</div>'
    + '<div style="margin-bottom:16px"><div style="font-size:22px;font-weight:700">День ' + day.id + '</div>'
    + '<div style="color:var(--tx2);font-size:13px;margin-top:4px">' + day.title + '</div></div><div class="tlist">';
  day.topics.forEach(function (tp, i) {
    var cls = i === savedIdx ? ' current' : '';
    h += '<div class="titem' + cls + '" onclick="openDayVideo(' + day.id + ',' + i + ')"><div class="tnum">' + (i + 1) + '</div><div class="tname">' + tp.title + (i === savedIdx ? ' ▶' : '') + '</div></div>';
  });
  document.getElementById('s-days').innerHTML = h + '</div>';
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-days').classList.add('on'); document.getElementById('n-home').classList.add('on');
}
function openDayVideo(dayId, idx) {
  var day = COURSE_DATA.days.find(function (d) { return d.id === dayId; });
  if (!day) return;
  var startPos = day.topics[idx].startSeconds || 0;
  openPlayer(day.topics, idx, 'ДЕНЬ ' + dayId, function () { openDay(dayId); }, startPos, day.videoHlsUrl);
}
function goHome() {
  stopVideo();
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  buildHome(); document.getElementById('s-home').classList.add('on'); document.getElementById('n-home').classList.add('on');
}
function buildBonus() {
  var h = '<div class="hdr"><h1>Бонусы</h1><p>Дополнительные материалы</p></div>';
  // Pure-DB courses (Этап 2) have no bonuses/tools — see syncSectionNav(),
  // which hides these tabs entirely for such courses; this fallback just
  // keeps things from crashing if this ever renders anyway.
  (COURSE_DATA.bonuses || []).forEach(function (b, i) {
    h += '<div class="bcard" onclick="openBonus(' + i + ')"><div class="bico">' + b.icon + '</div><div class="binfo"><h3>' + b.title + '</h3><p>' + b.desc + '</p></div><div class="barrow">▶</div></div>';
  });
  document.getElementById('s-bonus').innerHTML = h;
}
function openBonus(i) { var b = COURSE_DATA.bonuses[i]; openPlayer(b.topics, 0, 'БОНУС ' + (i + 1), function () { goTab('bonus'); }); }
function buildTools() {
  var h = '<div class="hdr"><h1>Инструменты</h1><p>Менеджмент практикум</p></div>';
  (COURSE_DATA.tools || []).forEach(function (t, i) {
    h += '<div class="bcard" onclick="openTool(' + i + ')"><div class="bico">' + t.icon + '</div><div class="binfo"><h3>' + t.title + '</h3><p>' + t.desc + '</p></div><div class="barrow">▶</div></div>';
  });
  document.getElementById('s-tools').innerHTML = h;
}

// Pure-DB multi-day courses (Этап 2) ship with no bonuses/tools at all —
// hide those nav tabs rather than show an empty screen. Must re-run on
// every course switch since the nav DOM persists across them.
function syncSectionNav() {
  var hasBonus = !!(COURSE_DATA.bonuses && COURSE_DATA.bonuses.length);
  var hasTools = !!(COURSE_DATA.tools && COURSE_DATA.tools.length);
  var nb = document.getElementById('n-bonus'); if (nb) nb.style.display = hasBonus ? '' : 'none';
  var nt = document.getElementById('n-tools'); if (nt) nt.style.display = hasTools ? '' : 'none';
}
function openTool(i) {
  var t = COURSE_DATA.tools[i];
  if (t.playlistUrl) {
    if (tg && tg.openLink) tg.openLink(t.playlistUrl, { try_instant_view: false });
    else window.open(t.playlistUrl, '_blank');
  }
  else if (t.topics && t.topics.length > 0) { openPlayer(t.topics, 0, t.title.toUpperCase(), function () { goTab('tools'); }); }
}

// ─── Открыть в браузере ───────────────────────────────────────────────

function currentSectionKey() {
  if (G.moduleId != null && G.itemIdx != null) return 'module-' + G.moduleId + '-' + G.itemIdx;
  var m = /^ДЕНЬ (\d+)$/.exec(G.badgeText);
  if (m) return 'day-' + m[1];
  m = /^БОНУС (\d+)$/.exec(G.badgeText);
  if (m) return 'bonus-' + (parseInt(m[1], 10) - 1);
  if (COURSE_DATA && COURSE_DATA.tools) {
    for (var i = 0; i < COURSE_DATA.tools.length; i++) {
      if (COURSE_DATA.tools[i].title.toUpperCase() === G.badgeText) return 'tool-' + i;
    }
  }
  return null;
}

function openFromParams(sectionKey, topicIdx) {
  if (!sectionKey || !COURSE_DATA) return false;
  var idx = parseInt(topicIdx, 10); if (!(idx >= 0)) idx = 0;
  var m = /^day-(\d+)$/.exec(sectionKey);
  if (m) {
    var day = COURSE_DATA.days.find(function (d) { return d.id === parseInt(m[1], 10); });
    if (!day || !day.topics[idx]) return false;
    openPlayer(day.topics, idx, 'ДЕНЬ ' + day.id, function () { openDay(day.id); }, day.topics[idx].startSeconds || 0, day.videoHlsUrl);
    return true;
  }
  m = /^bonus-(\d+)$/.exec(sectionKey);
  if (m) {
    var b = COURSE_DATA.bonuses[parseInt(m[1], 10)];
    if (!b || !b.topics[idx]) return false;
    openPlayer(b.topics, idx, 'БОНУС ' + (parseInt(m[1], 10) + 1), function () { goTab('bonus'); });
    return true;
  }
  m = /^tool-(\d+)$/.exec(sectionKey);
  if (m) {
    var t = COURSE_DATA.tools[parseInt(m[1], 10)];
    if (!t || !t.topics || !t.topics[idx]) return false;
    openPlayer(t.topics, idx, t.title.toUpperCase(), function () { goTab('tools'); });
    return true;
  }
  return false;
}

async function openInBrowser() {
  var section = currentSectionKey();
  try {
    var res = await fetch(API_BASE + '/api/browser-token', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ day: section, topic: topicLabel(G.idx) })
    });
    if (!res.ok) return;
    var data = await res.json();
    var url = location.origin + location.pathname + '?token=' + encodeURIComponent(data.token) + '&topic=' + G.idx
      + '&course_id=' + encodeURIComponent(CURRENT_COURSE_ID);
    if (section) url += '&day=' + encodeURIComponent(section);
    if (tg && tg.openLink) tg.openLink(url, { try_instant_view: false });
    else window.open(url, '_blank');
  } catch (e) {}
}
window.addEventListener('orientationchange', function () { setTimeout(function () { var w = document.getElementById('vw'); if (w && G.fs) applyFsSize(w); }, 400); });
window.addEventListener('resize', function () { if (G.fs) { var w = document.getElementById('vw'); if (w) applyFsSize(w); } });

// ─── "Мои курсы" (course picker) ────────────────────────────────────────

function setNavVisible(visible) {
  var nav = document.querySelector('.nav'); if (!nav) return;
  nav.classList.toggle('hidden', !visible);
}

// Course icons are either an emoji/text glyph, a relative path to an image
// file shipped alongside index.html, or a base64 data:image/... URL
// (uploaded by an admin at publish time — see admin.js's onPublishIconSelected
// and handle_admin_publish_pending_lesson in bot.py) — this is the shared
// pattern for telling them apart, used by every course card renderer (see
// also admin.js's own copy for the checkbox list).
function isImageIcon(icon) {
  return typeof icon === 'string' && (/\.(png|jpe?g|svg|gif|webp)$/i.test(icon) || /^data:image\//i.test(icon));
}
function courseIconHtml(icon) {
  if (isImageIcon(icon)) return '<img src="' + icon + '" alt="">';
  return icon || '📚';
}

// ─── "Продолжить просмотр" card (across all of the user's courses) ──────

async function loadContinueWatching() {
  try {
    var res = await fetch(API_BASE + '/api/continue-watching', { headers: apiHeaders() });
    if (!res.ok) return null;
    var data = await res.json();
    return (data && data.course_id) ? data : null;
  } catch (e) {
    return null;
  }
}

function continueWatchingCardHtml(cw) {
  if (!cw) return '';
  var pct = cw.duration_seconds ? Math.max(0, Math.min(100, Math.round(cw.position_seconds / cw.duration_seconds * 100))) : 0;
  return '<div class="continue-card cw-card" onclick="openContinueWatching()">'
    + '<div class="continue-label">▶ Продолжить просмотр</div>'
    + '<div class="cw-body"><div class="course-ico cw-ico">' + courseIconHtml(cw.course_icon) + '</div>'
    + '<div class="continue-title">' + cw.course_title + ' — ' + cw.section_label + '<br>'
    + '<span style="font-size:13px;font-weight:400;color:var(--tx2)">' + cw.topic_title + '</span></div></div>'
    + '<div class="cw-pbar"><div class="cw-pfill" style="width:' + pct + '%"></div></div>'
    + '<div class="continue-btns"><button class="cbtn-cont" onclick="openContinueWatching(event)">Продолжить просмотр</button></div>'
    + '</div>';
}

// Opens the exact (day/bonus/tool, topic) the saved progress points at, with
// startPos set to the saved position instead of the topic's own startSeconds
// — mirrors openFromParams's section_key parsing, but resuming rather than
// starting the topic from its beginning.
function openContinueWatchingTarget(cw) {
  if (!COURSE_DATA) return false;
  var idx = cw.topic_idx || 0;
  var m = /^day-(\d+)$/.exec(cw.section_key || '');
  if (m) {
    var day = COURSE_DATA.days.find(function (d) { return d.id === parseInt(m[1], 10); });
    if (!day || !day.topics[idx]) return false;
    openPlayer(day.topics, idx, 'ДЕНЬ ' + day.id, function () { openDay(day.id); }, cw.position_seconds, day.videoHlsUrl);
    return true;
  }
  m = /^bonus-(\d+)$/.exec(cw.section_key || '');
  if (m) {
    var b = COURSE_DATA.bonuses && COURSE_DATA.bonuses[parseInt(m[1], 10)];
    if (!b || !b.topics[idx]) return false;
    openPlayer(b.topics, idx, 'БОНУС ' + (parseInt(m[1], 10) + 1), function () { goTab('bonus'); }, cw.position_seconds);
    return true;
  }
  m = /^tool-(\d+)$/.exec(cw.section_key || '');
  if (m) {
    var t = COURSE_DATA.tools && COURSE_DATA.tools[parseInt(m[1], 10)];
    if (!t || !t.topics || !t.topics[idx]) return false;
    openPlayer(t.topics, idx, t.title.toUpperCase(), function () { goTab('tools'); }, cw.position_seconds);
    return true;
  }
  m = /^module-(\d+)-(\d+)$/.exec(cw.section_key || '');
  if (m) {
    var modId = parseInt(m[1], 10), itmIdx = parseInt(m[2], 10);
    var mod = COURSE_DATA.modules && COURSE_DATA.modules.find(function (mm) { return mm.id === modId; });
    var item = mod && mod.items[itmIdx];
    if (!item || item.type !== 'video') return false;
    var topics = item.topics.length ? item.topics : [{ title: item.title, startSeconds: 0 }];
    openPlayer(topics, idx, item.title.toUpperCase(), function () { openModule(modId); }, cw.position_seconds, item.videoHlsUrl, modId, itmIdx);
    return true;
  }
  if (isSingleVideoCourse(COURSE_DATA) && COURSE_DATA.topics[idx]) {
    openSingleVideoCourse();
    openPlayer(COURSE_DATA.topics, idx, COURSE_DATA.title.toUpperCase(), openSingleVideoCourse, cw.position_seconds, COURSE_DATA.videoId);
    return true;
  }
  return false;
}

async function openContinueWatching(e) {
  if (e) e.stopPropagation();
  var cw = CONTINUE_WATCHING;
  if (!cw) return;
  CURRENT_COURSE_ID = cw.course_id;
  if (!(await loadCourseData(cw.course_id))) return;
  if (isModularCourse(COURSE_DATA)) {
    openModulesHome();
  } else if (!isSingleVideoCourse(COURSE_DATA)) {
    buildHome(); buildBonus(); buildTools(); syncSectionNav();
    document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
    document.getElementById('s-home').classList.add('on');
    document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
    document.getElementById('n-home').classList.add('on');
    setNavVisible(true);
  }
  openContinueWatchingTarget(cw);
}

function buildMyCourses(courses, isAdmin) {
  var h = '<div class="mc-hdr"><div><h1>Мои курсы</h1><p>BilimBook</p></div>';
  if (isAdmin) h += '<button class="admin-btn" onclick="goAdmin()" title="Админ-панель">⚙️</button>';
  h += '</div>';
  h += continueWatchingCardHtml(CONTINUE_WATCHING);
  if (!courses || !courses.length) {
    h += '<div class="empty-state">Пока нет доступных курсов.<br>Обратитесь к администратору.</div>';
  } else {
    courses.forEach(function (c) {
      h += '<div class="course-card' + (c.id === 'atm' ? ' theme-atm' : '') + '" onclick="selectCourse(\'' + c.id + '\')">'
        + '<div class="course-ico">' + courseIconHtml(c.icon) + '</div>'
        + '<div class="course-info"><h3>' + c.title + '</h3>' + (c.subtitle ? '<p>' + c.subtitle + '</p>' : '') + '</div>'
        + '<div class="course-arrow">▶</div></div>';
    });
  }
  document.getElementById('s-mycourses').innerHTML = h;
}

async function initMyCoursesScreen() {
  var adminCheck = fetch(API_BASE + '/api/admin/users', { headers: apiHeaders() })
    .then(function (r) { return r.ok; })
    .catch(function () { return false; });
  var cwCheck = loadContinueWatching();

  var mcRes;
  try {
    mcRes = await fetch(API_BASE + '/api/my-courses', { headers: apiHeaders() });
  } catch (e) {
    showFatalMessage('Не удалось загрузить список курсов. Проверьте соединение и попробуйте снова.');
    return;
  }
  if (mcRes.status === 401) {
    showFatalMessage('Доступ запрещён. Откройте приложение через бота командой /start.');
    return;
  }
  if (!mcRes.ok) {
    showFatalMessage('Не удалось загрузить список курсов. Проверьте соединение и попробуйте снова.');
    return;
  }
  MY_COURSES = await mcRes.json();
  IS_ADMIN = await adminCheck;
  CONTINUE_WATCHING = await cwCheck;
  buildMyCourses(MY_COURSES, IS_ADMIN);
}

// A course whose content is a single video with timecoded topics (no
// days/bonuses/tools) — e.g. "roadmap". Detected structurally so any future
// course of this shape gets the same single-topics-list treatment for free.
function isSingleVideoCourse(data) {
  return !!(data && Array.isArray(data.topics) && data.videoId);
}

// A course whose content is grouped into modules (course_data Этап 3, e.g.
// "atm") — each module is a flat, position-ordered mix of videos and
// non-video materials (PDFs). Detected structurally, same convention as
// isSingleVideoCourse.
function isModularCourse(data) {
  return !!(data && Array.isArray(data.modules));
}

// Level 0 for a modular course: a card grid of its modules, reusing the
// exact "day card" look from buildHome()'s COURSE_DATA.days grid.
function openModulesHome() {
  var h = '<div class="back" onclick="backToMyCourses()">← Мои курсы</div>'
    + '<div class="hdr"><h1>' + (COURSE_DATA.title || '') + '</h1></div>'
    + '<div class="stitle">Модули курса</div><div class="grid">';
  COURSE_DATA.modules.forEach(function (m) {
    h += '<div class="dcard" onclick="openModule(' + m.id + ')"><div class="n">' + m.id + '</div><div class="l">' + m.title + '</div><div class="c">' + m.items.length + ' элементов</div></div>';
  });
  h += '</div>';
  document.getElementById('s-home').innerHTML = h;
  document.getElementById('s-home').classList.toggle('theme-atm', CURRENT_COURSE_ID === 'atm');
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.getElementById('s-home').classList.add('on');
  setNavVisible(false);
}

// Level 1: a module's flat items list (position-ordered mix of video and
// pdf items), reusing the .bcard row look from buildBonus()/buildTools().
// Video items drill into openModuleVideo (level 2, below); pdf items are a
// stub for now — opening the file itself is a separate task.
// Gold-outlined SVGs used in place of the 🎬/📄 emoji when a module's items
// render under the "АТМ" brand theme — plain emoji (esp. the white 📄 page)
// don't read well against the dark green/gold palette. Only ever inserted
// when isAtm is true, so other courses keep the emoji unchanged.
var ATM_VIDEO_ICON_SVG = '<svg viewBox="0 0 24 24" class="bico-svg"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 8l6 4-6 4V8z" fill="currentColor"/></svg>';
var ATM_PDF_ICON_SVG = '<svg viewBox="0 0 24 24" class="bico-svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v5h5"/></svg>';

function openModule(id) {
  var mod = COURSE_DATA.modules.find(function (m) { return m.id === id; });
  if (!mod) return;
  var isAtm = CURRENT_COURSE_ID === 'atm';
  var h = '<div class="back" onclick="openModulesHome()">← Назад</div>'
    + '<div style="margin-bottom:16px"><div style="font-size:22px;font-weight:700">' + mod.title + '</div></div>';
  mod.items.forEach(function (item, i) {
    if (item.type === 'video') {
      h += '<div class="bcard" onclick="openModuleVideo(' + id + ',' + i + ')"><div class="bico">' + (isAtm ? ATM_VIDEO_ICON_SVG : '🎬') + '</div><div class="binfo"><h3>' + item.title + '</h3><p>' + (item.topics.length ? item.topics.length + ' тем' : 'Видео') + '</p></div><div class="barrow">▶</div></div>';
    } else if (item.type === 'pdf') {
      h += '<div class="bcard" onclick="openModulePdf(' + id + ',' + i + ')"><div class="bico">' + (isAtm ? ATM_PDF_ICON_SVG : '📄') + '</div><div class="binfo"><h3>' + item.title + '</h3><p>PDF</p></div><div class="barrow">Открыть</div></div>';
    }
  });
  document.getElementById('s-module').innerHTML = h;
  document.getElementById('s-module').classList.toggle('theme-atm', CURRENT_COURSE_ID === 'atm');
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.getElementById('s-module').classList.add('on');
}

// Level 2 for a video item inside a module: exactly openDay()'s topics-list
// rendering (same markup/classes into #s-days), just sourced from the
// module item instead of COURSE_DATA.days.find(...).
function openModuleVideo(moduleId, itemIdx) {
  var mod = COURSE_DATA.modules.find(function (m) { return m.id === moduleId; });
  var item = mod && mod.items[itemIdx];
  if (!item || item.type !== 'video') return;
  // Тем ещё нет (админ не разбил видео на темы) — сразу плеер на всё видео,
  // без промежуточного пустого списка тем.
  if (item.topics.length === 0) {
    openModuleVideoTopic(moduleId, itemIdx, 0);
    return;
  }
  var h = '<div class="back" onclick="openModule(' + moduleId + ')">← Назад</div>'
    + '<div style="margin-bottom:16px"><div style="font-size:22px;font-weight:700">' + item.title + '</div></div><div class="tlist">';
  item.topics.forEach(function (tp, i) {
    h += '<div class="titem" onclick="openModuleVideoTopic(' + moduleId + ',' + itemIdx + ',' + i + ')"><div class="tnum">' + (i + 1) + '</div><div class="tname">' + tp.title + '</div></div>';
  });
  document.getElementById('s-days').innerHTML = h + '</div>';
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.getElementById('s-days').classList.add('on');
}

// Level 3: hands off to the existing, unmodified openPlayer() — identical
// to what openDayVideo() does for a plain day.
function openModuleVideoTopic(moduleId, itemIdx, topicIdx) {
  var mod = COURSE_DATA.modules.find(function (m) { return m.id === moduleId; });
  var item = mod && mod.items[itemIdx];
  if (!item) return;
  // No topics yet -> one synthetic topic spanning the whole video (openPlayer
  // already treats a topic with no endSeconds as "play to the end").
  var hasTopics = item.topics.length > 0;
  var topics = hasTopics ? item.topics : [{ title: item.title, startSeconds: 0 }];
  var startPos = topics[topicIdx].startSeconds || 0;
  var backFn = hasTopics ? function () { openModuleVideo(moduleId, itemIdx); } : function () { openModule(moduleId); };
  openPlayer(topics, topicIdx, item.title.toUpperCase(), backFn, startPos, item.videoHlsUrl, moduleId, itemIdx);
}

function openSingleVideoCourse() {
  var d = COURSE_DATA;
  var prog = loadProgress();
  var savedIdx = prog ? prog.idx : -1;
  var h = '<div class="back" onclick="backToMyCourses()">← Мои курсы</div>'
    + '<div style="margin-bottom:16px"><div style="font-size:22px;font-weight:700">' + d.title + '</div></div><div class="tlist">';
  d.topics.forEach(function (tp, i) {
    var cls = i === savedIdx ? ' current' : '';
    h += '<div class="titem' + cls + '" onclick="openSingleVideoTopic(' + i + ')"><div class="tnum">' + (i + 1) + '</div><div class="tname">' + tp.title + (i === savedIdx ? ' ▶' : '') + '</div></div>';
  });
  document.getElementById('s-days').innerHTML = h + '</div>';
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-days').classList.add('on');
  setNavVisible(false);
}

function openSingleVideoTopic(idx) {
  var d = COURSE_DATA;
  var startPos = d.topics[idx].startSeconds || 0;
  openPlayer(d.topics, idx, d.title.toUpperCase(), openSingleVideoCourse, startPos, d.videoId);
}

async function selectCourse(courseId) {
  CURRENT_COURSE_ID = courseId;
  if (!(await loadCourseData(courseId))) return;
  if (isSingleVideoCourse(COURSE_DATA)) {
    openSingleVideoCourse();
    return;
  }
  if (isModularCourse(COURSE_DATA)) {
    openModulesHome();
    return;
  }
  buildHome(); buildBonus(); buildTools(); syncSectionNav();
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.getElementById('s-home').classList.add('on');
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('n-home').classList.add('on');
  setNavVisible(true);
}

function backToMyCourses() {
  stopVideo();
  CURRENT_COURSE_ID = null;
  COURSE_DATA = null;
  setNavVisible(false);
  document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-mycourses').classList.add('on');
  refreshContinueWatching();
}

// "Мои курсы" is only built once at bootstrap (initMyCoursesScreen) — without
// this, watching a video and backing out wouldn't refresh the "Продолжить
// просмотр" card until the WebApp itself was reopened.
async function refreshContinueWatching() {
  CONTINUE_WATCHING = await loadContinueWatching();
  buildMyCourses(MY_COURSES, IS_ADMIN);
}

function goAdmin() {
  // Cache-bust the HTML document itself, not just the .js it loads — GitHub
  // Pages sends Cache-Control: max-age=600 on .html too, and same-tab
  // in-app navigation (unlike a hard reload) can serve that straight from
  // the browser/WebView cache without ever re-checking the network.
  location.href = 'admin.html?v=' + FRONTEND_VERSION + location.hash;
}

// ─── Bootstrap ────────────────────────────────────────────────────────

async function init() {
  loadTheme();
  if (tg) { tg.ready(); tg.expand(); }
  if (!INIT_DATA && !URL_TOKEN) { showFatalMessage('Откройте приложение через Telegram.'); return; }

  if (URL_TOKEN) {
    // "Открыть в браузере" deep link: skip the course picker and go
    // straight into the course/topic it was generated for.
    CURRENT_COURSE_ID = URL_COURSE_ID;
    if (!(await loadCourseData(CURRENT_COURSE_ID))) return;
    var ob = document.getElementById('obb');
    if (ob) ob.style.display = 'none';
    if (isSingleVideoCourse(COURSE_DATA)) {
      openSingleVideoCourse();
      if (URL_TOPIC !== null) openSingleVideoTopic(parseInt(URL_TOPIC, 10) || 0);
    } else if (isModularCourse(COURSE_DATA)) {
      // Deep-linking into a specific module/item isn't supported yet —
      // opens the modules list, same as a plain course-picker selection.
      openModulesHome();
    } else {
      buildHome(); buildBonus(); buildTools(); syncSectionNav();
      document.querySelectorAll('.sc,#s-player,#s-pdf').forEach(function (s) { s.classList.remove('on'); });
      document.getElementById('s-home').classList.add('on');
      setNavVisible(true);
      openFromParams(URL_DAY, URL_TOPIC);
    }
    return;
  }

  await initMyCoursesScreen();
}
init();
