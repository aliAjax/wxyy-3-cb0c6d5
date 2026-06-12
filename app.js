const storageKey = "wxyy-3-kunqu-sleeve-board";
const state = JSON.parse(localStorage.getItem(storageKey) || '{"actions":[],"activeId":null,"sessions":[],"activeSessionId":null,"choreographies":[],"activeChoreographyId":null}');

window.__appState = state;
window.__saveAppState = save;
window.__switchMainTab = switchMainTab;

const actionForm = document.querySelector("#actionForm");
const frameForm = document.querySelector("#frameForm");
const mediaInput = document.querySelector("#mediaInput");
const actionList = document.querySelector("#actionList");
const mediaBox = document.querySelector("#mediaBox");
const timeline = document.querySelector("#timeline");
const mirrorPane = document.querySelector("#mirrorPane");
const tagFilter = document.querySelector("#tagFilter");
const sessionsList = document.querySelector("#sessionsList");
const actionHistoryList = document.querySelector("#actionHistoryList");
const practicePanel = document.querySelector("#practicePanel");
const sessionModal = document.querySelector("#sessionModal");
const sessionForm = document.querySelector("#sessionForm");
const sessionActionSelect = document.querySelector("#sessionActionSelect");
const framePickerList = document.querySelector("#framePickerList");
const tempoPresetSelect = document.querySelector("#tempoPresetSelect");
const sidebarTabs = document.querySelector("#sidebarTabs");
const mainTabs = document.querySelector("#mainTabs");
const annotationLayer = document.querySelector("#annotationLayer");
const annotationCount = document.querySelector("#annotationCount");
const addAnnotationBtn = document.querySelector("#addAnnotationBtn");
const toggleAnnotationsBtn = document.querySelector("#toggleAnnotationsBtn");
const annotationModal = document.querySelector("#annotationModal");
const annotationForm = document.querySelector("#annotationForm");
const annotationModalTitle = document.querySelector("#annotationModalTitle");
const bodyPartSelect = document.querySelector("#bodyPartSelect");
const directionSelect = document.querySelector("#directionSelect");
const annotationNote = document.querySelector("#annotationNote");
const annotationVideoInfo = document.querySelector("#annotationVideoInfo");
const annotationTimestamp = document.querySelector("#annotationTimestamp");
const deleteAnnotationBtn = document.querySelector("#deleteAnnotationBtn");

let pendingMedia = null;
let timerInterval = null;
let metronomeAudio = null;
let metronomeInterval = null;
let metronomePlaying = false;
let annotationCreatingMode = false;
let annotationsHidden = false;
let editingAnnotationId = null;
let draggingAnnotationId = null;
let dragOffset = { x: 0, y: 0 };

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function activeAction() {
  return state.actions.find((action) => action.id === state.activeId) || null;
}

function activeSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId) || null;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getMediaDisplayRect() {
  const mediaEl = getCurrentMediaElement();
  if (!mediaEl) {
    const layerRect = annotationLayer.getBoundingClientRect();
    return { left: layerRect.left, top: layerRect.top, width: layerRect.width, height: layerRect.height };
  }

  const layerRect = annotationLayer.getBoundingClientRect();
  const naturalW = mediaEl.videoWidth || mediaEl.naturalWidth || layerRect.width;
  const naturalH = mediaEl.videoHeight || mediaEl.naturalHeight || layerRect.height;

  const containerW = layerRect.width;
  const containerH = layerRect.height;
  const containerRatio = containerW / containerH;
  const mediaRatio = naturalW / naturalH;

  let displayW, displayH;
  if (mediaRatio > containerRatio) {
    displayW = containerW;
    displayH = containerW / mediaRatio;
  } else {
    displayH = containerH;
    displayW = containerH * mediaRatio;
  }

  const displayLeft = layerRect.left + (containerW - displayW) / 2;
  const displayTop = layerRect.top + (containerH - displayH) / 2;

  return { left: displayLeft, top: displayTop, width: displayW, height: displayH };
}

function clientToMediaPercent(clientX, clientY) {
  const rect = getMediaDisplayRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: 50, y: 50 };
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y))
  };
}

function mediaPercentToLayerStyle(mediaX, mediaY) {
  const rect = getMediaDisplayRect();
  const layerRect = annotationLayer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || layerRect.width <= 0 || layerRect.height <= 0) {
    return { left: `${mediaX}%`, top: `${mediaY}%` };
  }
  const pixelX = rect.left - layerRect.left + (rect.width * mediaX) / 100;
  const pixelY = rect.top - layerRect.top + (rect.height * mediaY) / 100;
  return {
    left: `${(pixelX / layerRect.width) * 100}%`,
    top: `${(pixelY / layerRect.height) * 100}%`
  };
}

function ensureActionAnnotations(action) {
  if (!action) return null;
  if (!Array.isArray(action.annotations)) {
    action.annotations = [];
  }
  return action;
}

function getAnnotations() {
  const action = activeAction();
  if (!action) return [];
  ensureActionAnnotations(action);
  return action.annotations;
}

function getCurrentMediaElement() {
  return mediaBox.querySelector("img, video");
}

function isVideoMedia() {
  const action = activeAction();
  return action?.media?.type?.startsWith("video/") || false;
}

function getCurrentVideoTime() {
  const video = mediaBox.querySelector("video");
  if (!video) return null;
  return video.currentTime;
}

function openAnnotationModal(annotation = null) {
  editingAnnotationId = annotation ? annotation.id : null;
  annotationModalTitle.textContent = annotation ? "编辑批注" : "新建批注";
  deleteAnnotationBtn.hidden = !annotation;

  if (annotation) {
    bodyPartSelect.value = annotation.bodyPart || "左手";
    directionSelect.value = annotation.direction || "";
    annotationNote.value = annotation.note || "";
  } else {
    bodyPartSelect.value = "左手";
    directionSelect.value = "";
    annotationNote.value = "";
  }

  const isVideo = isVideoMedia();
  annotationVideoInfo.hidden = !isVideo;
  if (isVideo) {
    const time = annotation?.timestamp != null ? annotation.timestamp : getCurrentVideoTime();
    annotationTimestamp.value = time != null ? formatDuration(time) : "--:--";
  }

  annotationModal.hidden = false;
  setTimeout(() => annotationNote.focus(), 50);
}

function closeAnnotationModal() {
  annotationModal.hidden = true;
  editingAnnotationId = null;
  annotationForm.reset();
}

function createAnnotation(x, y) {
  const action = activeAction();
  if (!action) return;
  ensureActionAnnotations(action);

  const isVideo = isVideoMedia();
  const annotation = {
    id: crypto.randomUUID(),
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    bodyPart: "左手",
    direction: "",
    note: "",
    timestamp: isVideo ? getCurrentVideoTime() : null,
    createdAt: new Date().toISOString()
  };

  action.annotations.push(annotation);
  save();
  openAnnotationModal(annotation);
  renderAnnotations();
}

function updateAnnotationFromForm() {
  const action = activeAction();
  if (!action) return;
  ensureActionAnnotations(action);

  const data = {
    bodyPart: bodyPartSelect.value,
    direction: directionSelect.value,
    note: annotationNote.value.trim()
  };

  if (editingAnnotationId) {
    const ann = action.annotations.find((a) => a.id === editingAnnotationId);
    if (ann) {
      Object.assign(ann, data);
    }
  }
  save();
  closeAnnotationModal();
  renderAnnotations();
}

function deleteAnnotation() {
  if (!editingAnnotationId) return;
  if (!confirm("确定删除该批注？")) return;
  const action = activeAction();
  if (!action) return;
  ensureActionAnnotations(action);
  action.annotations = action.annotations.filter((a) => a.id !== editingAnnotationId);
  save();
  closeAnnotationModal();
  renderAnnotations();
}

function startDrag(e, annotationId) {
  e.preventDefault();
  e.stopPropagation();
  draggingAnnotationId = annotationId;
  const point = annotationLayer.querySelector(`[data-annotation-id="${annotationId}"]`);
  if (point) point.classList.add("dragging");

  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
  document.addEventListener("touchmove", onDrag, { passive: false });
  document.addEventListener("touchend", stopDrag);
}

function onDrag(e) {
  if (!draggingAnnotationId) return;
  e.preventDefault();

  const action = activeAction();
  if (!action) return;
  ensureActionAnnotations(action);

  const ann = action.annotations.find((a) => a.id === draggingAnnotationId);
  if (!ann) return;

  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const pos = clientToMediaPercent(clientX, clientY);

  ann.x = pos.x;
  ann.y = pos.y;

  const pointEl = annotationLayer.querySelector(`[data-annotation-id="${draggingAnnotationId}"]`);
  if (pointEl) {
    const style = mediaPercentToLayerStyle(ann.x, ann.y);
    pointEl.style.left = style.left;
    pointEl.style.top = style.top;
  }
}

function stopDrag() {
  if (draggingAnnotationId) {
    const point = annotationLayer.querySelector(`[data-annotation-id="${draggingAnnotationId}"]`);
    if (point) point.classList.remove("dragging");
    save();
  }
  draggingAnnotationId = null;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
  document.removeEventListener("touchmove", onDrag);
  document.removeEventListener("touchend", stopDrag);
}

function setAnnotationCreatingMode(active) {
  annotationCreatingMode = active;
  annotationLayer.classList.toggle("creating-mode", active);
  annotationLayer.classList.toggle("active", active || getAnnotations().length > 0);
  addAnnotationBtn.textContent = active ? "✓ 点击图片添加" : "+ 添加批注";
  addAnnotationBtn.classList.toggle("btn-accent", !active);
  addAnnotationBtn.classList.toggle("btn-secondary", active);
}

function handleAnnotationLayerClick(e) {
  if (!annotationCreatingMode) return;
  const mediaEl = getCurrentMediaElement();
  if (!mediaEl) return;

  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const pos = clientToMediaPercent(clientX, clientY);

  createAnnotation(pos.x, pos.y);
  setAnnotationCreatingMode(false);
}

function toggleAnnotationsVisibility() {
  annotationsHidden = !annotationsHidden;
  annotationLayer.classList.toggle("hidden-mode", annotationsHidden);
  toggleAnnotationsBtn.textContent = annotationsHidden ? "显示批注" : "隐藏批注";
}

function renderAnnotations() {
  const annotations = getAnnotations();
  annotationCount.textContent = `${annotations.length} 个批注`;

  const isVideo = isVideoMedia();
  const currentTime = isVideo ? getCurrentVideoTime() : null;

  annotationLayer.innerHTML = annotations.map((ann, idx) => {
    const showForVideo = !isVideo || currentTime == null || Math.abs((ann.timestamp || 0) - currentTime) < 0.5;
    const stylePos = mediaPercentToLayerStyle(ann.x, ann.y);
    const timeLabel = ann.timestamp != null ? `<div class="annotation-time">⏱ ${escapeHtml(formatDuration(ann.timestamp))}</div>` : "";
    const dirLabel = ann.direction ? `<span class="annotation-direction">${escapeHtml(ann.direction)}</span>` : "";
    const noteText = ann.note ? `<p class="annotation-note">${escapeHtml(ann.note)}</p>` : "";

    return `
      <div class="annotation-point ${ann.id === editingAnnotationId ? "selected" : ""}" 
           data-annotation-id="${escapeHtml(ann.id)}"
           style="left:${stylePos.left};top:${stylePos.top};${!showForVideo ? "opacity:0.35;" : ""}">
        <div class="annotation-dot">${idx + 1}</div>
        <div class="annotation-tooltip">
          <div class="annotation-tooltip-header">
            <span class="annotation-body-part">${escapeHtml(ann.bodyPart || "未指定")}</span>
            ${dirLabel}
          </div>
          ${noteText}
          ${timeLabel}
        </div>
      </div>
    `;
  }).join("");

  annotationLayer.classList.toggle("active", annotations.length > 0 || annotationCreatingMode);
  bindAnnotationPointEvents();
}

function bindAnnotationPointEvents() {
  annotationLayer.querySelectorAll(".annotation-point").forEach((point) => {
    const id = point.dataset.annotationId;

    point.addEventListener("mousedown", (e) => {
      if (e.button === 0) startDrag(e, id);
    });
    point.addEventListener("touchstart", (e) => startDrag(e, id), { passive: false });

    point.addEventListener("click", (e) => {
      if (draggingAnnotationId) return;
      e.stopPropagation();
      const action = activeAction();
      if (!action) return;
      ensureActionAnnotations(action);
      const ann = action.annotations.find((a) => a.id === id);
      if (ann) openAnnotationModal(ann);
    });
  });
}

function bindVideoAnnotationSync() {
  const video = mediaBox.querySelector("video");
  if (!video) return;
  video.addEventListener("timeupdate", renderAnnotations);
  video.addEventListener("pause", () => {
    const hint = document.createElement("div");
  });
}

function readMedia(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve({ src: reader.result, type: file.type }));
    reader.readAsDataURL(file);
  });
}

function formatDuration(secs) {
  const s = Math.floor(secs || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusBadge(status) {
  const map = {
    "in_progress": { text: "进行中", cls: "st-progress" },
    "completed": { text: "已完成", cls: "st-done" },
    "abandoned": { text: "已放弃", cls: "st-abandon" }
  };
  const info = map[status] || { text: status, cls: "" };
  return `<span class="status-badge ${info.cls}">${info.text}</span>`;
}

function switchSidebarTab(tab) {
  sidebarTabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
}

function switchMainTab(mtab) {
  mainTabs.querySelectorAll(".m-tab").forEach((t) => t.classList.toggle("active", t.dataset.mtab === mtab));
  document.querySelectorAll(".m-tab-panel").forEach((p) => p.classList.toggle("active", p.id === `mtab-${mtab}`));
}

function renderList() {
  const filter = tagFilter.value.trim();
  const actions = state.actions.filter((action) => !filter || action.tags.includes(filter));
  actionList.innerHTML = actions.length ? actions.map((action) => {
    const choreoRefs = window.Choreography?.checkActionReferences(action.id);
    const refBadge = choreoRefs?.hasReferences
      ? `<span class="action-ref-badge" title="被 ${choreoRefs.references.length} 个编排引用">📋 ${choreoRefs.references.length}</span>`
      : "";
    return `
      <div class="action-item-wrapper">
        <button class="action-item ${action.id === state.activeId ? "active" : ""}" type="button" data-action="${action.id}">
          <div class="action-item-head">
            <strong>${escapeHtml(action.name)}</strong>
            ${refBadge}
          </div>
          <span>${escapeHtml(action.tags || "无标签")} · ${action.frames.length}个关键帧</span>
        </button>
        <div class="action-item-controls">
          <button type="button" class="btn-small btn-secondary" data-edit-action="${action.id}" title="编辑">✎</button>
          <button type="button" class="btn-small btn-danger" data-delete-action="${action.id}" title="删除">×</button>
        </div>
      </div>
    `;
  }).join("") : "<p>还没有动作条目。</p>";
}

function renderSessionsList() {
  if (!state.sessions.length) {
    sessionsList.innerHTML = `<p class="muted">还没有练习课次，点击右上角"+ 新建课次"开始。</p>`;
    return;
  }
  const sorted = [...state.sessions].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  sessionsList.innerHTML = sorted.map((s) => {
    const act = state.actions.find((a) => a.id === s.actionId);
    const actName = act ? act.name : s.actionSnapshotName || "未知动作";
    return `
      <article class="session-card ${s.id === state.activeSessionId ? "active" : ""}" data-session="${s.id}">
        <header class="session-head">
          <strong>${actName}</strong>
          ${statusBadge(s.status)}
        </header>
        <p class="session-meta">
          ${formatDate(s.startTime)} · ${formatDuration(s.duration)} · ${s.tempoBPM || "-"} BPM
        </p>
        <p class="session-meta">
          ${s.selectedFrameIds.length} 个关键帧
          ${s.reviewNote ? ` · 有复盘` : ""}
        </p>
        <div class="session-actions">
          <button type="button" class="btn-small btn-secondary" data-open-session="${s.id}">${s.status === "in_progress" ? "继续" : "查看"}</button>
          <button type="button" class="btn-small btn-danger" data-delete-session="${s.id}">删除</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderActionHistory() {
  const action = activeAction();
  if (!action) {
    actionHistoryList.innerHTML = `<p class="muted">选择一个动作查看关联课次</p>`;
    return;
  }
  const sessions = state.sessions.filter((s) => s.actionId === action.id);
  if (!sessions.length) {
    actionHistoryList.innerHTML = `<p class="muted">该动作暂无练习记录</p>`;
    return;
  }
  const sorted = [...sessions].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  actionHistoryList.innerHTML = sorted.map((s) => `
    <article class="history-item" data-jump-session="${s.id}">
      <div class="h-left">
        ${statusBadge(s.status)}
        <span class="h-date">${formatDate(s.startTime)}</span>
      </div>
      <div class="h-right">
        <span>${formatDuration(s.duration)} · ${s.tempoBPM || "-"} BPM</span>
        <span>${s.selectedFrameIds.length}帧</span>
      </div>
      ${s.reviewNote ? `<p class="h-note">${s.reviewNote}</p>` : ""}
    </article>
  `).join("");
}

function renderDetail() {
  const action = activeAction();
  if (!action) {
    mediaBox.innerHTML = `<p>选择或新建一个水袖动作</p><div class="annotation-layer" id="annotationLayer"></div>`;
    const newLayer = document.querySelector("#annotationLayer");
    if (newLayer) newLayer.replaceWith(annotationLayer);
    timeline.innerHTML = "<p>暂无关键帧。</p>";
    mirrorPane.innerHTML = "<p>暂无对照内容。</p>";
    frameForm.style.display = "none";
    renderAnnotations();
    renderActionHistory();
    setAnnotationCreatingMode(false);
    return;
  }

  ensureActionAnnotations(action);
  frameForm.style.display = "block";

  const existingLayer = mediaBox.querySelector(".annotation-layer");
  if (existingLayer) existingLayer.remove();

  if (action.media?.src) {
    const isVideo = action.media.type.startsWith("video/");
    const mediaHtml = isVideo
      ? `<video src="${action.media.src}" controls preload="metadata"></video>`
      : `<img src="${action.media.src}" alt="${action.name}练习素材">`;
    mediaBox.innerHTML = mediaHtml;
    mediaBox.appendChild(annotationLayer);
    const mediaEl = mediaBox.querySelector("img, video");
    if (mediaEl) {
      const rerender = () => renderAnnotations();
      if (isVideo) {
        bindVideoAnnotationSync();
        mediaEl.addEventListener("loadedmetadata", rerender);
        mediaEl.addEventListener("seeked", rerender);
      } else {
        if (mediaEl.complete) {
          setTimeout(rerender, 0);
        } else {
          mediaEl.addEventListener("load", rerender);
        }
      }
      mediaEl.addEventListener("resize", rerender);
    }
  } else {
    mediaBox.innerHTML = `<p>${action.name}还没有上传练习素材</p>`;
    mediaBox.appendChild(annotationLayer);
  }

  setAnnotationCreatingMode(false);
  renderAnnotations();

  timeline.innerHTML = action.frames.length ? action.frames.map((frame) => `
    <article class="frame-card">
      <header><span>${frame.stage} · ${frame.time || "未定时点"}</span><button type="button" data-delete-frame="${frame.id}">删除</button></header>
      <p>重心：${frame.weight || "未记录"}</p>
      <p>手腕：${frame.wrist || "未记录"}</p>
      <p>节奏：${frame.tempo || "未记录"}</p>
      <p>${frame.note || "未填写批注"}</p>
    </article>
  `).join("") : "<p>还没有关键帧。</p>";

  const left = action.frames.filter((frame) => /左|偏左|左手/.test(`${frame.weight}${frame.wrist}${frame.note}`));
  const right = action.frames.filter((frame) => /右|偏右|右手/.test(`${frame.weight}${frame.wrist}${frame.note}`));
  mirrorPane.innerHTML = `
    <div class="hand"><strong>左手线索</strong>${(left.length ? left : action.frames).slice(0, 4).map((frame) => `<p>${frame.stage}: ${frame.wrist || frame.note || "待补充"}</p>`).join("") || "<p>暂无</p>"}</div>
    <div class="hand"><strong>右手线索</strong>${(right.length ? right : action.frames).slice(0, 4).map((frame) => `<p>${frame.stage}: ${frame.wrist || frame.note || "待补充"}</p>`).join("") || "<p>暂无</p>"}</div>
  `;

  renderActionHistory();
}

function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    const sess = activeSession();
    if (!sess) { stopTimer(); return; }
    if (sess.status !== "in_progress") { stopTimer(); return; }
    sess.duration = (sess.duration || 0) + 1;
    save();
    const el = document.querySelector("#timerDisplay");
    if (el) el.textContent = formatDuration(sess.duration);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startMetronome(bpm) {
  stopMetronome();
  if (!bpm || bpm < 40) return;
  if (!metronomeAudio) {
    try {
      metronomeAudio = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return;
    }
  }
  const intervalMs = 60000 / bpm;
  const tick = () => {
    const ctx = metronomeAudio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  };
  tick();
  metronomeInterval = setInterval(tick, intervalMs);
  metronomePlaying = true;
}

function stopMetronome() {
  if (metronomeInterval) {
    clearInterval(metronomeInterval);
    metronomeInterval = null;
  }
  metronomePlaying = false;
  updateMetronomeButton();
}

function updateMetronomeButton() {
  const btn = document.querySelector("#metronomeToggle");
  if (btn) {
    btn.textContent = metronomePlaying ? "⏸ 暂停节拍" : "▶ 播放节拍";
  }
}

function renderPracticePanel() {
  const session = activeSession();
  if (!session) {
    practicePanel.innerHTML = `
      <div class="practice-empty">
        <p>选择一个课次进入练习，或从左侧课次记录新建课次</p>
      </div>`;
    stopTimer();
    stopMetronome();
    return;
  }
  const action = state.actions.find((a) => a.id === session.actionId);
  const actionName = action ? action.name : session.actionSnapshotName || "未知动作";
  const frames = session.selectedFrames || [];

  if (session.status === "in_progress") {
    startTimer();
  }

  practicePanel.innerHTML = `
    <div class="practice-head">
      <div class="ph-info">
        <h3>${actionName}</h3>
        <p>开始于 ${formatDate(session.startTime)} · ${statusBadge(session.status)}</p>
      </div>
      <div class="ph-timer">
        <span id="timerDisplay" class="timer">${formatDuration(session.duration)}</span>
      </div>
    </div>

    <div class="practice-controls">
      <div class="tempo-box">
        <label>节拍 BPM
          <input type="number" id="tempoInput" min="40" max="200" value="${session.tempoBPM || 80}">
        </label>
        <button type="button" id="metronomeToggle" class="btn-secondary">
          ${metronomePlaying ? "⏸ 暂停节拍" : "▶ 播放节拍"}
        </button>
      </div>
      <div class="status-box">
        ${session.status === "in_progress"
          ? `<button type="button" id="completeBtn" class="btn-accent">✓ 标记完成</button>
             <button type="button" id="abandonBtn" class="btn-secondary">放弃课次</button>`
          : `<button type="button" id="resumeBtn" class="btn-accent">重新开始</button>`
        }
      </div>
    </div>

    <div class="practice-frames">
      <h4>本次练习关键帧 (${frames.length})</h4>
      <div class="pf-grid">
        ${frames.length ? frames.map((f, i) => `
          <article class="pf-card ${session.status !== "in_progress" ? "done" : ""}">
            <div class="pf-num">${i + 1}</div>
            <div class="pf-body">
              <strong>${f.stage} · ${f.time || "未定时点"}</strong>
              <p>重心：${f.weight || "未记录"}</p>
              <p>手腕：${f.wrist || "未记录"}</p>
              <p>节奏：${f.tempo || "未记录"}</p>
              ${f.note ? `<p class="pf-note">${f.note}</p>` : ""}
            </div>
          </article>
        `).join("") : `<p class="muted">没有选择关键帧</p>`}
      </div>
    </div>

    ${session.status !== "in_progress" ? `
      <div class="review-box">
        <h4>复盘备注</h4>
        <textarea id="reviewNoteInput" rows="4" placeholder="记录本次练习的感受、需要改进的地方...">${session.reviewNote || ""}</textarea>
        <div class="review-actions">
          <button type="button" id="saveReviewBtn" class="btn-accent">保存复盘</button>
        </div>
      </div>
    ` : ""}
  `;

  bindPracticePanelEvents();
}

function bindPracticePanelEvents() {
  const tempoInput = document.querySelector("#tempoInput");
  if (tempoInput) {
    tempoInput.addEventListener("input", () => {
      const sess = activeSession();
      if (!sess) return;
      const val = parseInt(tempoInput.value, 10);
      sess.tempoBPM = isNaN(val) ? 80 : val;
      save();
      if (metronomePlaying) {
        startMetronome(sess.tempoBPM);
      }
    });
  }

  const metronomeBtn = document.querySelector("#metronomeToggle");
  if (metronomeBtn) {
    metronomeBtn.addEventListener("click", () => {
      const sess = activeSession();
      if (!sess) return;
      if (metronomePlaying) {
        stopMetronome();
      } else {
        startMetronome(sess.tempoBPM || 80);
        updateMetronomeButton();
      }
    });
  }

  const completeBtn = document.querySelector("#completeBtn");
  if (completeBtn) {
    completeBtn.addEventListener("click", () => {
      const sess = activeSession();
      if (!sess) return;
      sess.status = "completed";
      sess.endTime = new Date().toISOString();
      save();
      stopTimer();
      stopMetronome();
      renderAll();
    });
  }

  const abandonBtn = document.querySelector("#abandonBtn");
  if (abandonBtn) {
    abandonBtn.addEventListener("click", () => {
      if (!confirm("确定放弃本次练习？")) return;
      const sess = activeSession();
      if (!sess) return;
      sess.status = "abandoned";
      sess.endTime = new Date().toISOString();
      save();
      stopTimer();
      stopMetronome();
      renderAll();
    });
  }

  const resumeBtn = document.querySelector("#resumeBtn");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      const sess = activeSession();
      if (!sess) return;
      sess.status = "in_progress";
      sess.startTime = new Date().toISOString();
      sess.duration = 0;
      sess.reviewNote = "";
      delete sess.endTime;
      save();
      renderAll();
    });
  }

  const reviewInput = document.querySelector("#reviewNoteInput");
  const saveReviewBtn = document.querySelector("#saveReviewBtn");
  if (saveReviewBtn) {
    saveReviewBtn.addEventListener("click", () => {
      const sess = activeSession();
      if (!sess) return;
      sess.reviewNote = reviewInput.value.trim();
      save();
      renderAll();
      alert("复盘已保存");
    });
  }
}

function renderAll() {
  renderList();
  renderDetail();
  renderSessionsList();
  renderPracticePanel();
  populateSessionActionSelect();
  if (window.Choreography) {
    window.Choreography.renderAll();
  }
}

function openActionEditModal(actionId) {
  const action = state.actions.find((a) => a.id === actionId);
  if (!action) return;

  const modal = document.querySelector("#actionEditModal");
  if (!modal) return;

  document.querySelector("#editActionName").value = action.name;
  document.querySelector("#editActionTags").value = action.tags || "";
  document.querySelector("#editActionId").value = action.id;

  const choreoRefs = window.Choreography?.checkActionReferences(actionId);
  const refWarning = document.querySelector("#editActionRefWarning");
  if (refWarning) {
    if (choreoRefs?.hasReferences) {
      refWarning.innerHTML = `
        <div class="choreo-timeline-warning renamed">
          ⚠ 该动作被 ${choreoRefs.references.length} 个编排引用：
          ${choreoRefs.references.map((c) => `「${escapeHtml(c.name)}」`).join("、")}
          <br>修改名称后，编排中将显示名称变更提示。
        </div>
      `;
      refWarning.hidden = false;
    } else {
      refWarning.innerHTML = "";
      refWarning.hidden = true;
    }
  }

  modal.hidden = false;
}

function closeActionEditModal() {
  const modal = document.querySelector("#actionEditModal");
  if (modal) modal.hidden = true;
}

function updateActionFromModal() {
  const actionId = document.querySelector("#editActionId").value;
  const newName = document.querySelector("#editActionName").value.trim();
  const newTags = document.querySelector("#editActionTags").value.trim();

  if (!newName) {
    alert("请输入动作名称");
    return;
  }

  const action = state.actions.find((a) => a.id === actionId);
  if (!action) return;

  const oldName = action.name;
  action.name = newName;
  action.tags = newTags;
  action.updatedAt = new Date().toISOString();

  save();
  closeActionEditModal();
  renderAll();
}

function deleteActionWithCheck(actionId) {
  const action = state.actions.find((a) => a.id === actionId);
  if (!action) return;

  const choreoRefs = window.Choreography?.checkActionReferences(actionId);
  let confirmMsg = `确定删除动作「${action.name}」？`;

  if (choreoRefs?.hasReferences) {
    const refNames = choreoRefs.references.map((c) => `「${c.name}」`).join("、");
    confirmMsg += `\n\n⚠ 该动作被 ${choreoRefs.references.length} 个编排引用：${refNames}\n删除后，这些编排中将显示动作已删除的提示。`;
  }

  if (!confirm(confirmMsg)) return;

  state.actions = state.actions.filter((a) => a.id !== actionId);
  if (state.activeId === actionId) {
    state.activeId = null;
  }

  const relatedSessions = state.sessions.filter((s) => s.actionId === actionId);
  if (relatedSessions.length > 0) {
    if (!confirm(`该动作关联 ${relatedSessions.length} 个练习课次，是否同时删除这些课次？\n点击「确定」删除关联课次，点击「取消」保留课次（将显示动作已删除）。`)) {
    } else {
      state.sessions = state.sessions.filter((s) => s.actionId !== actionId);
      if (relatedSessions.some((s) => s.id === state.activeSessionId)) {
        state.activeSessionId = null;
      }
    }
  }

  save();
  renderAll();
}

function openSessionModal() {
  sessionModal.hidden = false;
  populateSessionActionSelect();
  sessionForm.reset();
  sessionForm.querySelector('input[name="tempo"]').value = 80;
  framePickerList.innerHTML = `<p class="muted">请先选择一个动作</p>`;
}

function closeSessionModal() {
  sessionModal.hidden = true;
}

function populateSessionActionSelect() {
  sessionActionSelect.innerHTML = `<option value="">请选择动作</option>` +
    state.actions.map((a) => `<option value="${a.id}">${a.name} (${a.frames.length}帧)</option>`).join("");
}

function renderFramePicker(actionId) {
  const action = state.actions.find((a) => a.id === actionId);
  if (!action || !action.frames.length) {
    framePickerList.innerHTML = `<p class="muted">该动作暂无关键帧</p>`;
    return;
  }
  framePickerList.innerHTML = action.frames.map((f) => `
    <label class="picker-item">
      <input type="checkbox" name="frameIds" value="${f.id}">
      <div class="picker-body">
        <strong>${f.stage} · ${f.time || "未定时点"}</strong>
        <span>重心: ${f.weight || "-"} · 手腕: ${f.wrist || "-"}</span>
      </div>
    </label>
  `).join("");
}

sidebarTabs.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]")?.dataset.tab;
  if (tab) switchSidebarTab(tab);
});

mainTabs.addEventListener("click", (e) => {
  const mtab = e.target.closest("[data-mtab]")?.dataset.mtab;
  if (mtab) switchMainTab(mtab);
});

sessionsList.addEventListener("click", (e) => {
  const openId = e.target.closest("[data-open-session]")?.dataset.openSession;
  const deleteId = e.target.closest("[data-delete-session]")?.dataset.deleteSession;
  if (deleteId) {
    if (!confirm("确定删除该课次？")) return;
    const sess = state.sessions.find((s) => s.id === deleteId);
    if (sess && sess.id === state.activeSessionId) {
      state.activeSessionId = null;
      stopTimer();
      stopMetronome();
    }
    state.sessions = state.sessions.filter((s) => s.id !== deleteId);
    save();
    renderAll();
    return;
  }
  if (openId) {
    state.activeSessionId = openId;
    save();
    switchMainTab("practice");
    renderAll();
    return;
  }
  const cardId = e.target.closest("[data-session]")?.dataset.session;
  if (cardId) {
    state.activeSessionId = cardId;
    save();
    renderSessionsList();
    renderPracticePanel();
  }
});

actionHistoryList.addEventListener("click", (e) => {
  const id = e.target.closest("[data-jump-session]")?.dataset.jumpSession;
  if (!id) return;
  state.activeSessionId = id;
  save();
  switchMainTab("practice");
  switchSidebarTab("sessions");
  renderAll();
});

document.querySelector("#openSessionsBtn").addEventListener("click", () => {
  switchSidebarTab("sessions");
});

document.querySelector("#newSessionBtn").addEventListener("click", () => {
  const active = activeAction();
  openSessionModal();
  if (active) {
    sessionActionSelect.value = active.id;
    renderFramePicker(active.id);
  }
});

sessionModal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close-modal") || e.target === sessionModal) {
    closeSessionModal();
  }
});

sessionActionSelect.addEventListener("change", () => {
  const id = sessionActionSelect.value;
  if (id) renderFramePicker(id);
  else framePickerList.innerHTML = `<p class="muted">请先选择一个动作</p>`;
});

tempoPresetSelect.addEventListener("change", () => {
  const preset = tempoPresetSelect.value;
  if (preset) {
    sessionForm.querySelector('input[name="tempo"]').value = preset;
  }
});

sessionForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = new FormData(sessionForm);
  const actionId = data.get("actionId");
  const action = state.actions.find((a) => a.id === actionId);
  if (!action) {
    alert("请选择一个动作");
    return;
  }
  const frameIds = data.getAll("frameIds");
  const tempo = parseInt(data.get("tempo"), 10) || 80;

  const selectedFrames = frameIds.length
    ? action.frames.filter((f) => frameIds.includes(f.id))
    : [...action.frames];

  if (!selectedFrames.length) {
    alert("请至少选择一个关键帧，或该动作无关键帧");
    return;
  }

  const session = {
    id: crypto.randomUUID(),
    actionId: action.id,
    actionSnapshotName: action.name,
    selectedFrameIds: selectedFrames.map((f) => f.id),
    selectedFrames: selectedFrames.map((f) => ({ ...f })),
    startTime: new Date().toISOString(),
    duration: 0,
    tempoBPM: tempo,
    status: "in_progress",
    reviewNote: ""
  };

  state.sessions.unshift(session);
  state.activeSessionId = session.id;
  save();
  closeSessionModal();
  switchSidebarTab("sessions");
  switchMainTab("practice");
  renderAll();
});

mediaInput.addEventListener("change", async () => {
  pendingMedia = await readMedia(mediaInput.files[0]);
});

actionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(actionForm);
  if (!pendingMedia && mediaInput.files[0]) {
    pendingMedia = await readMedia(mediaInput.files[0]);
  }
  const action = {
    id: crypto.randomUUID(),
    name: data.get("name").trim(),
    tags: data.get("tags").trim(),
    media: pendingMedia,
    frames: [],
    annotations: [],
    createdAt: new Date().toISOString()
  };
  state.actions.unshift(action);
  state.activeId = action.id;
  pendingMedia = null;
  mediaInput.value = "";
  actionForm.reset();
  save();
  renderAll();
});

frameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const action = activeAction();
  if (!action) return;
  const data = new FormData(frameForm);
  action.frames.push({
    id: crypto.randomUUID(),
    stage: data.get("stage"),
    time: data.get("time").trim(),
    weight: data.get("weight").trim(),
    wrist: data.get("wrist").trim(),
    tempo: data.get("tempo").trim(),
    note: data.get("note").trim()
  });
  frameForm.reset();
  save();
  renderAll();
});

actionList.addEventListener("click", (event) => {
  const editId = event.target.closest("[data-edit-action]")?.dataset.editAction;
  const deleteId = event.target.closest("[data-delete-action]")?.dataset.deleteAction;
  const actionId = event.target.closest("[data-action]")?.dataset.action;

  if (editId) {
    event.stopPropagation();
    openActionEditModal(editId);
    return;
  }
  if (deleteId) {
    event.stopPropagation();
    deleteActionWithCheck(deleteId);
    return;
  }
  if (actionId) {
    state.activeId = actionId;
    save();
    renderAll();
  }
});

timeline.addEventListener("click", (event) => {
  const id = event.target.dataset.deleteFrame;
  const action = activeAction();
  if (!id || !action) return;
  action.frames = action.frames.filter((frame) => frame.id !== id);
  save();
  renderAll();
});

document.querySelector("#newActionBtn").addEventListener("click", () => {
  state.activeId = null;
  save();
  renderAll();
  actionForm.querySelector("input[name='name']").focus();
});

tagFilter.addEventListener("input", renderList);

addAnnotationBtn.addEventListener("click", () => {
  const action = activeAction();
  if (!action || !action.media?.src) {
    alert("请先选择一个动作并上传练习图片或视频");
    return;
  }
  if (isVideoMedia()) {
    const video = mediaBox.querySelector("video");
    if (video && !video.paused) {
      video.pause();
    }
  }
  setAnnotationCreatingMode(!annotationCreatingMode);
});

toggleAnnotationsBtn.addEventListener("click", toggleAnnotationsVisibility);

annotationLayer.addEventListener("click", handleAnnotationLayerClick);

annotationForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (editingAnnotationId) {
    updateAnnotationFromForm();
  }
});

deleteAnnotationBtn.addEventListener("click", deleteAnnotation);

annotationModal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close-annotation") || e.target === annotationModal) {
    closeAnnotationModal();
  }
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderAnnotations(), 100);
});

window.addEventListener("beforeunload", () => {
  stopTimer();
  stopMetronome();
  stopDrag();
});

const actionEditModal = document.querySelector("#actionEditModal");
if (actionEditModal) {
  actionEditModal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close-action-edit") || e.target === actionEditModal) {
      closeActionEditModal();
    }
  });
}

const actionEditForm = document.querySelector("#actionEditForm");
if (actionEditForm) {
  actionEditForm.addEventListener("submit", (e) => {
    e.preventDefault();
    updateActionFromModal();
  });
}

if (window.Choreography) {
  window.Choreography.init(state.choreographies || []);
  const changes = window.Choreography.detectActionChanges();
  if (changes.length > 0) {
    const deleted = changes.filter((c) => c.type === "deleted").length;
    const renamed = changes.filter((c) => c.type === "renamed").length;
    let msg = "检测到动作数据变化：\n";
    if (deleted > 0) msg += `• ${deleted} 个动作已被删除\n`;
    if (renamed > 0) msg += `• ${renamed} 个动作已改名\n`;
    msg += "\n编排页面会显示相应提示。";
    console.log(msg);
  }
}

renderAll();
