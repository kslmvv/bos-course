// ─── Backend API ──────────────────────────────────────────────────────
// Update this to your deployed bot's public URL (Railway domain).
var API_BASE = 'https://bos-bot-production.up.railway.app';

var tg = window.Telegram && window.Telegram.WebApp;
var INIT_DATA = tg ? tg.initData : '';

// "Открыть в браузере": a one-time token (see /api/browser-token) lets this
// page load outside Telegram, where initData is unavailable but the real
// Fullscreen API isn't restricted.
var URL_PARAMS = new URLSearchParams(location.search);
var URL_TOKEN = URL_PARAMS.get('token');
var URL_DAY = URL_PARAMS.get('day');
var URL_TOPIC = URL_PARAMS.get('topic');

var SAVE_KEY = 'bos_progress';

var COURSE_DATA = null;

var G = {
  topics: [], idx: 0, badgeText: '', backFn: null,
  player: null, ytReady: false, playing: false, ready: false, fs: false,
  pendingVid: null, pendingPos: 0, ctrlTimer: null, progTimer: null, saveTimer: null, statsTimer: null,
  currentVid: null, segStart: 0, segEnd: 0, topicEndShown: false,
  dragging: false, dragPct: 0, fsCoverTimer: null
};

function apiHeaders(extra) {
  var h = extra ? Object.assign({}, extra) : {};
  h['Authorization'] = 'tma ' + INIT_DATA;
  return h;
}

function reportStats(day, topic, progress) {
  fetch(API_BASE + '/api/stats', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ day: day, topic: topic, progress: Math.max(0, Math.floor(progress || 0)) })
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

async function loadCourseData() {
  try {
    var url = API_BASE + '/api/course';
    var opts = {};
    if (URL_TOKEN) { url += '?token=' + encodeURIComponent(URL_TOKEN); }
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
    if (G.player && G.ytReady && G.ready) { try { pos = Math.floor(G.player.getCurrentTime() || 0); } catch (e) {} }
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      badgeText: G.badgeText, idx: G.idx, pos: pos,
      title: G.topics[G.idx] ? G.topics[G.idx].title : '',
      type: G.badgeText.indexOf('ДЕНЬ') >= 0 ? 'day' : 'other',
      dayId: G.badgeText.indexOf('ДЕНЬ') >= 0 ? parseInt(G.badgeText.replace('ДЕНЬ ', '')) : null
    }));
  } catch (e) {}
}
function loadProgress() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; } }
function clearProgress() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
function startSaveTimer() {
  clearInterval(G.saveTimer);
  G.saveTimer = setInterval(function () { if (G.playing) saveProgress(); }, 5000);
}
function startStatsTimer() {
  clearInterval(G.statsTimer);
  G.statsTimer = setInterval(function () { if (G.playing) reportProgress(); }, 15000);
}
function reportProgress() {
  if (!G.player || !G.ytReady || !G.ready) return;
  try {
    var cur = G.player.getCurrentTime();
    var segCur = Math.max(0, cur - (G.segStart || 0));
    if (G.segEnd && G.segEnd > G.segStart) segCur = Math.min(segCur, G.segEnd - G.segStart);
    reportStats(G.badgeText, topicLabel(G.idx), segCur);
  } catch (e) {}
}

// ─── YouTube player ──────────────────────────────────────────────────────

(function () { var t = document.createElement('script'); t.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(t); })();

function onYouTubeIframeAPIReady() {
  G.ytReady = true;
  G.player = new YT.Player('ytpl', {
    playerVars: { controls: 0, disablekb: 1, fs: 1, modestbranding: 1, rel: 0, showinfo: 0, iv_load_policy: 3, playsinline: 1, enablejsapi: 1 },
    events: {
      onReady: function () {
        if (G.pendingVid) { G.player.loadVideoById({ videoId: G.pendingVid, startSeconds: G.pendingPos }); G.pendingVid = null; G.pendingPos = 0; }
        setupPiP();
      },
      onStateChange: function (e) {
        G.playing = (e.data === YT.PlayerState.PLAYING);
        if (G.playing) { G.ready = true; startProg(); startSaveTimer(); startStatsTimer(); scheduleHide(); }
        else { clearInterval(G.progTimer); clearInterval(G.statsTimer); saveProgress(); reportProgress(); showCtrl(false); }
        syncPB();
      }
    }
  });
}

function resetPlayerUI() {
  clearInterval(G.progTimer); G.topicEndShown = false; hideTopicEnd();
  var pf = document.getElementById('pf'); if (pf) pf.style.width = '0%';
  var tc = document.getElementById('tc'); if (tc) tc.textContent = '0:00';
  var td = document.getElementById('td'); if (td) td.textContent = fmt(G.segEnd && G.segEnd > G.segStart ? G.segEnd - G.segStart : 0);
  hideCtrl();
}

function loadVideo(vid, startPos) {
  resetPlayerUI();
  G.ready = false; G.playing = false;
  startPos = startPos || 0;
  if (G.ytReady && G.player && G.player.loadVideoById) { G.player.loadVideoById({ videoId: vid, startSeconds: startPos }); G.ready = true; }
  else { G.pendingVid = vid; G.pendingPos = startPos; }
  G.currentVid = vid;
}

// Same video already loaded for a different topic of the same day:
// seek in place instead of reloading the iframe (avoids a visible
// rebuffer/flash when switching between topics).
function seekWithinVideo(pos) {
  resetPlayerUI();
  try { G.player.seekTo(pos, true); G.player.playVideo(); } catch (e) {}
  G.ready = true;
}

function doPlay() { if (!G.player || !G.ytReady) return; try { G.playing ? G.player.pauseVideo() : G.player.playVideo(); } catch (e) {} }
function doSeek(d) { if (!G.player || !G.ytReady) return; try { G.player.seekTo(Math.max(0, G.player.getCurrentTime() + d), true); } catch (e) {} if (G.playing) scheduleHide(); }

// ─── Picture-in-Picture ──────────────────────────────────────────────────

// Ensures the YouTube iframe allows PiP, hides the button when the browser
// doesn't support iframe PiP, and keeps the button state in sync.
function setupPiP() {
  var w = document.getElementById('vw'); var iframe = w && w.querySelector('iframe');
  var b = document.getElementById('pipb'); if (!iframe || !b) return;
  var allow = iframe.getAttribute('allow') || '';
  if (allow.indexOf('picture-in-picture') === -1) iframe.setAttribute('allow', (allow ? allow + '; ' : '') + 'picture-in-picture');
  if (!document.pictureInPictureEnabled || typeof iframe.requestPictureInPicture !== 'function') { b.style.display = 'none'; return; }
  iframe.addEventListener('enterpictureinpicture', function () { b.classList.add('active'); });
  iframe.addEventListener('leavepictureinpicture', function () { b.classList.remove('active'); });
}
function doPiP() {
  var w = document.getElementById('vw'); var iframe = w && w.querySelector('iframe'); if (!iframe) return;
  if (!document.pictureInPictureEnabled || typeof iframe.requestPictureInPicture !== 'function') {
    var b = document.getElementById('pipb'); if (b) b.style.display = 'none';
    return;
  }
  if (document.pictureInPictureElement === iframe) { try { document.exitPictureInPicture(); } catch (e) {} }
  else { try { iframe.requestPictureInPicture().catch(function () {}); } catch (e) {} }
}

function startProg() {
  clearInterval(G.progTimer);
  G.progTimer = setInterval(function () {
    if (!G.player || !G.ytReady || G.dragging) return;
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
      if (G.segEnd && cur >= G.segEnd - 0.4 && !G.topicEndShown) {
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
  var segDur = (G.segEnd && G.segEnd > G.segStart) ? (G.segEnd - G.segStart) : null;
  reportStats(G.badgeText, topicLabel(G.idx), segDur != null ? segDur : 0);
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
function fmt(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
function syncPB() { var b = document.getElementById('pb'); if (!b) return; b.innerHTML = G.playing ? '<svg><use href="#i-pause"/></svg>' : '<svg><use href="#i-play"/></svg>'; }

function clickBar(e) {
  if (!G.player || !G.ytReady) return;
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
  var dur = (G.player && G.ytReady) ? G.player.getDuration() : 0;
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
  if (!G.player || !G.ytReady) return;
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

function doFS() {
  var w = document.getElementById('vw'); if (!w) return;
  if (tgFSSupported()) {
    if (G.fs) { try { tg.exitFullscreen(); } catch (e) {} return; }
    fsCoverOn();
    try { tg.requestFullscreen(); } catch (e) { fsCoverOff(); }
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
  var onEnter = function () {
    var nowFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    if (nowFs) {
      G.fs = true; syncFS();
      var iframe = w.querySelector('iframe');
      if (iframe) iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';
    } else {
      cssFS(w);
    }
  };
  var result;
  try { result = req.call(w); } catch (e) { cssFS(w); return; }
  if (result && typeof result.then === 'function') { result.then(function () { setTimeout(onEnter, 100); }).catch(function () { cssFS(w); }); }
  else { setTimeout(onEnter, 100); }
}
function applyFsState(w, isFs) {
  G.fs = isFs; w.classList.toggle('fs', G.fs);
  if (G.fs) { document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'; applyFsSize(w); }
  else { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; w.style.width = ''; w.style.height = ''; var iframe = w.querySelector('iframe'); if (iframe) { iframe.style.width = ''; iframe.style.height = ''; } }
  syncFS();
}
function cssFS(w) { applyFsState(w, !G.fs); }
function applyFsSize(w) { var W = window.innerWidth, H = window.innerHeight; w.style.width = W + 'px'; w.style.height = H + 'px'; var iframe = w.querySelector('iframe'); if (iframe) { iframe.style.width = W + 'px'; iframe.style.height = H + 'px'; } }
function syncFS() { var b = document.getElementById('fsb'); if (!b) return; b.innerHTML = G.fs ? '<svg><use href="#i-xfs"/></svg>' : '<svg><use href="#i-fs"/></svg>'; }
function exitNativeFS() {
  G.fs = false; syncFS();
  var w = document.getElementById('vw'); var iframe = w && w.querySelector('iframe');
  if (iframe) iframe.style.cssText = '';
}
document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) exitNativeFS(); });
document.addEventListener('webkitfullscreenchange', function () { if (!document.webkitFullscreenElement) exitNativeFS(); });
document.addEventListener('mozfullscreenchange', function () { if (!document.mozFullScreenElement) exitNativeFS(); });
document.addEventListener('MSFullscreenChange', function () { if (!document.msFullscreenElement) exitNativeFS(); });

if (tgFSSupported()) {
  tg.onEvent('fullscreenChanged', function () {
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
    var w = document.getElementById('vw'); if (w) cssFS(w);
    clearTimeout(G.fsCoverTimer);
    G.fsCoverTimer = setTimeout(fsCoverOff, 400);
  });
  tg.onEvent('backButtonClicked', function () {
    if (G.fs) doFS();
  });
}

document.addEventListener('mousemove', pbarMoveDrag);
document.addEventListener('mouseup', pbarEndDrag);
document.addEventListener('touchmove', pbarMoveDrag, { passive: false });
document.addEventListener('touchend', pbarEndDrag);
document.addEventListener('touchcancel', pbarEndDrag);

function stopVideo() {
  clearInterval(G.progTimer); clearInterval(G.saveTimer); clearInterval(G.statsTimer); clearTimeout(G.ctrlTimer);
  saveProgress(); reportProgress();
  if (G.player && G.ytReady) { try { G.player.stopVideo(); } catch (e) {} }
  G.playing = false; syncPB(); hideCtrl();
}

// ─── Player screen ────────────────────────────────────────────────────

function openPlayer(topics, idx, badgeText, backFn, startPos, dayVideoId) {
  G.topics = topics; G.idx = idx; G.badgeText = badgeText; G.backFn = backFn;
  G.dayVideoId = dayVideoId || null;
  var tp = G.topics[G.idx]; var total = G.topics.length;
  var vid = G.dayVideoId || tp.videoId || '';
  G.segStart = tp.startSeconds || 0;
  G.segEnd = tp.endSeconds || 0;

  document.getElementById('p-back').onclick = G.backFn;
  document.getElementById('p-header').innerHTML = '<span class="pbadge">' + G.badgeText + '</span><span class="pcnt">' + (G.idx + 1) + ' из ' + total + '</span>';
  document.getElementById('p-label').textContent = G.badgeText + ' — ТЕМА ' + (G.idx + 1);
  document.getElementById('p-title').textContent = tp.title;
  document.getElementById('btn-prev').disabled = (G.idx === 0);
  document.getElementById('btn-next').disabled = (G.idx === total - 1);
  document.querySelectorAll('.sc,#s-player').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-player').classList.add('on');

  var pos = startPos !== undefined ? startPos : G.segStart;
  if (startPos === undefined) saveProgress();
  reportStats(badgeText, topicLabel(idx), Math.max(0, Math.floor(pos - G.segStart)));

  if (vid === G.currentVid && G.ytReady && G.player && G.ready) {
    seekWithinVideo(pos);
  } else {
    loadVideo(vid, pos);
  }
}

function goPrev() {
  if (G.idx > 0) {
    var newIdx = G.idx - 1;
    openPlayer(G.topics, newIdx, G.badgeText, G.backFn, G.topics[newIdx].startSeconds || 0, G.dayVideoId);
  }
}
function goNext() {
  if (G.idx < G.topics.length - 1) {
    var newIdx = G.idx + 1;
    openPlayer(G.topics, newIdx, G.badgeText, G.backFn, G.topics[newIdx].startSeconds || 0, G.dayVideoId);
  }
}

// ─── Navigation / screens ────────────────────────────────────────────────

function goTab(t) {
  document.querySelectorAll('.sc,#s-player').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-' + t).classList.add('on'); document.getElementById('n-' + t).classList.add('on'); stopVideo();
}

function buildHome() {
  var h = '<div class="hdr"><h1>БОС Курс</h1><p>Бизнес Операционная Система</p></div>';
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
  document.getElementById('s-home').innerHTML = h + '</div>';
}

function continueWatch(e) {
  e.stopPropagation(); var prog = loadProgress(); if (!prog || !prog.dayId) return;
  var day = COURSE_DATA.days.find(function (d) { return d.id === prog.dayId; });
  if (!day) return;
  var sp = prog.pos || day.topics[prog.idx].startSeconds || 0;
  openPlayer(day.topics, prog.idx, 'ДЕНЬ ' + prog.dayId, function () { openDay(prog.dayId); }, sp, day.videoId);
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
  document.querySelectorAll('.sc,#s-player').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  document.getElementById('s-days').classList.add('on'); document.getElementById('n-home').classList.add('on');
}
function openDayVideo(dayId, idx) {
  var day = COURSE_DATA.days.find(function (d) { return d.id === dayId; });
  if (!day) return;
  var startPos = day.topics[idx].startSeconds || 0;
  openPlayer(day.topics, idx, 'ДЕНЬ ' + dayId, function () { openDay(dayId); }, startPos, day.videoId);
}
function goHome() {
  stopVideo();
  document.querySelectorAll('.sc,#s-player').forEach(function (s) { s.classList.remove('on'); });
  document.querySelectorAll('.ni').forEach(function (n) { n.classList.remove('on'); });
  buildHome(); document.getElementById('s-home').classList.add('on'); document.getElementById('n-home').classList.add('on');
}
function buildBonus() {
  var h = '<div class="hdr"><h1>Бонусы</h1><p>Дополнительные материалы</p></div>';
  COURSE_DATA.bonuses.forEach(function (b, i) {
    h += '<div class="bcard" onclick="openBonus(' + i + ')"><div class="bico">' + b.icon + '</div><div class="binfo"><h3>' + b.title + '</h3><p>' + b.desc + '</p></div><div class="barrow">▶</div></div>';
  });
  document.getElementById('s-bonus').innerHTML = h;
}
function openBonus(i) { var b = COURSE_DATA.bonuses[i]; openPlayer(b.topics, 0, 'БОНУС ' + (i + 1), function () { goTab('bonus'); }); }
function buildTools() {
  var h = '<div class="hdr"><h1>Инструменты</h1><p>Менеджмент практикум</p></div>';
  COURSE_DATA.tools.forEach(function (t, i) {
    h += '<div class="bcard" onclick="openTool(' + i + ')"><div class="bico">' + t.icon + '</div><div class="binfo"><h3>' + t.title + '</h3><p>' + t.desc + '</p></div><div class="barrow">▶</div></div>';
  });
  document.getElementById('s-tools').innerHTML = h;
}
function openTool(i) {
  var t = COURSE_DATA.tools[i];
  if (t.playlistUrl) { window.open(t.playlistUrl, '_blank'); }
  else if (t.topics && t.topics.length > 0) { openPlayer(t.topics, 0, t.title.toUpperCase(), function () { goTab('tools'); }); }
}

// ─── Открыть в браузере ───────────────────────────────────────────────

function currentSectionKey() {
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
    openPlayer(day.topics, idx, 'ДЕНЬ ' + day.id, function () { openDay(day.id); }, day.topics[idx].startSeconds || 0, day.videoId);
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
    var url = location.origin + location.pathname + '?token=' + encodeURIComponent(data.token) + '&topic=' + G.idx;
    if (section) url += '&day=' + encodeURIComponent(section);
    if (tg && tg.openLink) tg.openLink(url, { try_instant_view: false });
    else window.open(url, '_blank');
  } catch (e) {}
}
window.addEventListener('orientationchange', function () { setTimeout(function () { var w = document.getElementById('vw'); if (w && G.fs) applyFsSize(w); }, 400); });
window.addEventListener('resize', function () { if (G.fs) { var w = document.getElementById('vw'); if (w) applyFsSize(w); } });

// ─── Bootstrap ────────────────────────────────────────────────────────

async function init() {
  if (tg) { tg.ready(); tg.expand(); }
  if (!INIT_DATA && !URL_TOKEN) { showFatalMessage('Откройте приложение через Telegram.'); return; }
  if (!(await loadCourseData())) return;
  buildHome(); buildBonus(); buildTools();
  if (URL_TOKEN) {
    var ob = document.getElementById('obb'); if (ob) ob.style.display = 'none';
    openFromParams(URL_DAY, URL_TOPIC);
  }
}
init();
