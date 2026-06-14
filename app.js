const storageKey = "wxyy-3-kunqu-sleeve-board";
const state = JSON.parse(localStorage.getItem(storageKey) || '{"actions":[],"activeId":null,"sessions":[],"activeSessionId":null,"choreographies":[],"activeChoreographyId":null,"scores":[]}');

window.__appState = state;
window.__saveAppState = save;
window.__switchMainTab = switchMainTab;
window.__renderAll = () => renderAll();
window.showToast = showToast;

const actionForm = document.querySelector("#actionForm");
const frameForm = document.querySelector("#frameForm");
const mediaInput = document.querySelector("#mediaInput");
const mediaPreview = document.querySelector("#mediaPreview");
const mediaPreviewInner = mediaPreview?.querySelector(".media-preview-inner");
const clearMediaBtn = document.querySelector("#clearMediaBtn");
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

const editMediaInput = document.querySelector("#editMediaInput");
const editMediaPreview = document.querySelector("#editMediaPreview");
const editMediaPreviewInner = editMediaPreview?.querySelector(".media-preview-inner");
const editClearMediaBtn = document.querySelector("#editClearMediaBtn");

const mediaLibraryModal = document.querySelector("#mediaLibraryModal");
const mediaLibraryGrid = document.querySelector("#mediaLibraryGrid");
const storageInfoEl = document.querySelector("#storageInfo");
const mediaLibWarnings = document.querySelector("#mediaLibWarnings");
const cleanupOrphanBtn = document.querySelector("#cleanupOrphanBtn");
const mediaLibStats = document.querySelector("#mediaLibStats");
const mediaSortSelect = document.querySelector("#mediaSortSelect");
const toastContainer = document.querySelector("#toastContainer");

let mediaFilter = "all";
let mediaSort = "createdAt-desc";

let pendingMedia = null;
let pendingEditMedia = null;
let timerInterval = null;
let metronomeAudio = null;
let metronomeInterval = null;
let metronomePlaying = false;
let annotationCreatingMode = false;
let annotationsHidden = false;
let editingAnnotationId = null;
let draggingAnnotationId = null;
let dragOffset = { x: 0, y: 0 };

function showToast(message, type = "info", duration = 3000) {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function formatSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (window.KnowledgeSearch && typeof window.KnowledgeSearch.refreshIndex === "function") {
    if (!save._throttleTimer) {
      save._throttleTimer = setTimeout(() => {
        save._throttleTimer = null;
        window.KnowledgeSearch.refreshIndex();
      }, 300);
    }
  }
}

if (!Array.isArray(state.scores)) {
  state.scores = [];
  save();
}

function getActionMediaId(action) {
  if (!action) return null;
  return action.mediaId || (action.mediaRef && action.mediaRef.id) || (action.media && action.media.id) || null;
}

function getActionMediaRef(action) {
  if (!action) return null;
  if (action.mediaRef) return action.mediaRef;
  if (action.mediaId) return { id: action.mediaId };
  if (action.media && action.media.id) return { id: action.media.id, type: action.media.type };
  return null;
}

function setActionMediaRef(action, mediaMeta) {
  if (!action) return;
  if (mediaMeta) {
    action.mediaId = mediaMeta.id;
    action.mediaRef = {
      id: mediaMeta.id,
      type: mediaMeta.type,
      name: mediaMeta.name
    };
  } else {
    delete action.mediaId;
    delete action.mediaRef;
  }
  delete action.media;
}

function removePersistedMediaThumbnails(appState) {
  if (!Array.isArray(appState?.actions)) return 0;
  let removed = 0;
  appState.actions.forEach((action) => {
    if (action?.mediaRef && Object.prototype.hasOwnProperty.call(action.mediaRef, "thumbnail")) {
      delete action.mediaRef.thumbnail;
      removed++;
    }
  });
  return removed;
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
  if (!action) return false;
  const ref = getActionMediaRef(action);
  if (ref?.type) return MediaLibrary.isVideoType(ref.type);
  if (action.media?.type) return MediaLibrary.isVideoType(action.media.type);
  return false;
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
}

function readMedia(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve({ src: reader.result, type: file.type, file: file }));
    reader.readAsDataURL(file);
  });
}

function renderLocalMediaPreview(container, data, isVideo) {
  if (!container) return;
  if (!data) {
    container.innerHTML = "";
    return;
  }
  if (isVideo) {
    container.innerHTML = `<video src="${data}" controls muted preload="metadata"></video>`;
  } else {
    container.innerHTML = `<img src="${data}" alt="预览">`;
  }
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
  if (mtab === "storyboard" && window.StoryboardTimeline) {
    window.StoryboardTimeline.renderAll();
  }
  if (mtab === "calendar" && window.PracticeCalendar) {
    window.PracticeCalendar.renderAll();
  }
}

async function renderList() {
  const filter = tagFilter.value.trim();
  const actions = state.actions.filter((action) => !filter || action.tags.includes(filter));

  const thumbCache = {};
  const mediaIds = [...new Set(actions.map(getActionMediaId).filter(Boolean))];
  if (mediaIds.length) {
    await Promise.all(mediaIds.map(async (id) => {
      const thumb = await MediaLibrary.getMediaThumbnail(id);
      if (thumb) thumbCache[id] = thumb;
    }));
  }

  actionList.innerHTML = actions.length ? actions.map((action) => {
    const choreoRefs = window.Choreography?.checkActionReferences(action.id);
    const refBadge = choreoRefs?.hasReferences
      ? `<span class="action-ref-badge" title="被 ${choreoRefs.references.length} 个编排引用">📋 ${choreoRefs.references.length}</span>`
      : "";
    const mediaRef = getActionMediaRef(action);
    const mediaId = getActionMediaId(action);
    const thumb = mediaId ? thumbCache[mediaId] : null;
    const thumbHtml = thumb
      ? `<div class="action-item-thumb"><img src="${thumb}" alt=""></div>`
      : (mediaRef ? `<div class="action-item-thumb placeholder">${MediaLibrary.isVideoType(mediaRef.type) ? "🎬" : "🖼"}</div>` : "");
    return `
      <div class="action-item-wrapper">
        ${thumbHtml}
        <button class="action-item ${action.id === state.activeId ? "active" : ""}" type="button" data-action="${action.id}">
          <div class="action-item-head">
            <strong>${escapeHtml(action.name)}</strong>
            ${refBadge}
          </div>
          <span>${escapeHtml(action.tags || "无标签")} · ${action.frames.length}个关键帧</span>
        </button>
        <div class="action-item-controls">
          <button type="button" class="btn-small btn-secondary" data-copy-action="${action.id}" title="复制为新动作">⎘</button>
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
  const calendarPlans = window.PracticeCalendar
    ? window.PracticeCalendar.getPlansByRef(action.id, "action")
    : [];

  const hasData = sessions.length > 0 || calendarPlans.length > 0;

  if (!hasData) {
    actionHistoryList.innerHTML = `<p class="muted">该动作暂无练习记录</p>`;
    return;
  }

  let html = "";

  if (calendarPlans.length > 0) {
    const sortedPlans = [...calendarPlans].sort((a, b) => a.date.localeCompare(b.date));
    html += `<h4 style="margin:0 0 8px;font-size:13px;color:var(--muted);">📅 日历计划</h4>`;
    html += sortedPlans.map((p) => {
      const statusLabel = p.completed ? "已完成" : (p.date < new Date().toISOString().slice(0, 10) ? "已逾期" : "待完成");
      const statusCls = p.completed ? "st-done" : (p.date < new Date().toISOString().slice(0, 10) ? "st-abandon" : "st-progress");
      const invalidCls = p._invalid ? " plan-invalid" : "";
      return `
        <article class="plan-history-item${invalidCls}" data-jump-plan="${p.id}" data-plan-date="${p.date}">
          <div class="ph-left">
            <span class="status-badge ${statusCls}">${statusLabel}</span>
            <span class="ph-date">${p.date}</span>
          </div>
          ${p.goal ? `<div class="ph-goal">🎯 ${escapeHtml(p.goal)}</div>` : ""}
          ${p._invalid ? `<div class="ph-invalid-hint" style="font-size:12px;color:var(--muted);margin-top:4px;">⚠ 关联动作已不存在</div>` : ""}
        </article>
      `;
    }).join("");
  }

  if (sessions.length > 0) {
    if (calendarPlans.length > 0) {
      html += `<h4 style="margin:12px 0 8px;font-size:13px;color:var(--muted);">🏋️ 练习课次</h4>`;
    }
    const sorted = [...sessions].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    html += sorted.map((s) => `
      <article class="history-item" data-jump-session="${s.id}">
        <div class="h-left">
          ${statusBadge(s.status)}
          <span class="h-date">${formatDate(s.startTime)}</span>
        </div>
        <div class="h-right">
          <span>${formatDuration(s.duration)} · ${s.tempoBPM || "-"} BPM</span>
          <span>${s.selectedFrameIds.length}帧</span>
        </div>
        ${s.reviewNote ? `<p class="h-note">${escapeHtml(s.reviewNote)}</p>` : ""}
      </article>
    `).join("");
  }

  actionHistoryList.innerHTML = html;
}

async function renderDetail() {
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

  const mediaId = getActionMediaId(action);
  const mediaRef = getActionMediaRef(action);
  const hasLegacyMedia = action.media && action.media.src && typeof action.media.src === "string" && action.media.src.startsWith("data:");

  if (mediaId || hasLegacyMedia) {
    let mediaSrc = null;
    let mediaType = null;

    if (hasLegacyMedia) {
      mediaSrc = action.media.src;
      mediaType = action.media.type;
    } else if (mediaId) {
      try {
        mediaSrc = await MediaLibrary.getMediaDataURL(mediaId);
        const m = await MediaLibrary.getMedia(mediaId);
        mediaType = m?.type || (mediaRef && mediaRef.type);
      } catch {
        mediaSrc = null;
      }
    }

    if (mediaSrc) {
      const isVideo = MediaLibrary.isVideoType(mediaType);
      const mediaHtml = isVideo
        ? `<video src="${mediaSrc}" controls preload="metadata"></video>`
        : `<img src="${mediaSrc}" alt="${action.name}练习素材">`;
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
      mediaBox.innerHTML = `<p class="media-missing">素材加载失败或已被清理</p>`;
      mediaBox.appendChild(annotationLayer);
    }
  } else {
    mediaBox.innerHTML = `<p>${action.name}还没有上传练习素材</p>`;
    mediaBox.appendChild(annotationLayer);
  }

  setAnnotationCreatingMode(false);
  renderAnnotations();

  const sortedFrames = Array.isArray(action.frames) ? [...action.frames].sort((a, b) => {
    const parseTime = (t) => {
      if (!t) return null;
      const s = String(t).trim();
      const m1 = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
      if (m1) return Number(m1[1]) * 60 + Number(m1[2]) + (m1[3] ? Number(m1[3]) / 1000 : 0);
      const m2 = s.match(/^(\d{1,2})(\d{2})$/);
      if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
      const n = Number(s);
      return !isNaN(n) && isFinite(n) ? n : null;
    };
    const at = parseTime(a.time);
    const bt = parseTime(b.time);
    if (at != null && bt != null) return at - bt;
    if (at != null) return -1;
    if (bt != null) return 1;
    const aOrder = typeof a.order === "number" ? a.order : Infinity;
    const bOrder = typeof b.order === "number" ? b.order : Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  }) : [];

  timeline.innerHTML = sortedFrames.length ? sortedFrames.map((frame) => `
    <article class="frame-card">
      <header><span>${frame.stage} · ${frame.time || "未定时点"}</span><button type="button" data-delete-frame="${frame.id}">删除</button></header>
      <p>重心：${frame.weight || "未记录"}</p>
      <p>手腕：${frame.wrist || "未记录"}</p>
      <p>节奏：${frame.tempo || "未记录"}</p>
      <p>${frame.note || "未填写批注"}</p>
    </article>
  `).join("") : "<p>还没有关键帧。</p>";

  const left = sortedFrames.filter((frame) => /左|偏左|左手/.test(`${frame.weight}${frame.wrist}${frame.note}`));
  const right = sortedFrames.filter((frame) => /右|偏右|右手/.test(`${frame.weight}${frame.wrist}${frame.note}`));
  mirrorPane.innerHTML = `
    <div class="hand"><strong>左手线索</strong>${(left.length ? left : sortedFrames).slice(0, 4).map((frame) => `<p>${frame.stage}: ${frame.wrist || frame.note || "待补充"}</p>`).join("") || "<p>暂无</p>"}</div>
    <div class="hand"><strong>右手线索</strong>${(right.length ? right : sortedFrames).slice(0, 4).map((frame) => `<p>${frame.stage}: ${frame.wrist || frame.note || "待补充"}</p>`).join("") || "<p>暂无</p>"}</div>
  `;

  renderActionHistory();
  if (window.ReviewScoring) {
    window.ReviewScoring.renderScoreSummary();
  }
}

window.__renderActionDetail = renderDetail;
window.__renderActionAnnotations = renderAnnotations;
window.__openAnnotationModal = openAnnotationModal;
window.__activeAction = activeAction;

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
      showToast("复盘已保存", "success");
    });
  }
}

async function renderAll() {
  await renderList();
  await renderDetail();
  renderSessionsList();
  renderPracticePanel();
  populateSessionActionSelect();
  if (window.Choreography) {
    window.Choreography.renderAll();
  }
  if (window.ReviewScoring) {
    window.ReviewScoring.renderAll();
  }
  if (window.StoryboardTimeline) {
    window.StoryboardTimeline.renderAll();
  }
  if (window.PracticeCalendar) {
    const activeTab = document.querySelector('.m-tab.active');
    if (activeTab && activeTab.dataset.mtab === 'calendar') {
      window.PracticeCalendar.renderAll();
    }
  }
}

async function openActionEditModal(actionId) {
  const action = state.actions.find((a) => a.id === actionId);
  if (!action) return;

  const modal = document.querySelector("#actionEditModal");
  if (!modal) return;

  document.querySelector("#editActionName").value = action.name;
  document.querySelector("#editActionTags").value = action.tags || "";
  document.querySelector("#editActionId").value = action.id;

  pendingEditMedia = null;
  if (editMediaInput) editMediaInput.value = "";
  if (editMediaPreview && editMediaPreviewInner) {
    const ref = getActionMediaRef(action);
    if (ref) {
      editMediaPreview.hidden = false;
      const mediaId = getActionMediaId(action);
      const thumb = mediaId ? await MediaLibrary.getMediaThumbnail(mediaId) : null;
      if (thumb) {
        editMediaPreviewInner.innerHTML = `<img src="${thumb}" alt="缩略图">`;
      } else {
        const typeIcon = MediaLibrary.isVideoType(ref.type) ? "🎬" : "🖼";
        editMediaPreviewInner.innerHTML = `<div class="preview-placeholder">${typeIcon}<span>${escapeHtml(ref.name || "已有素材")}</span></div>`;
      }
    } else if (action.media && action.media.src) {
      editMediaPreview.hidden = false;
      const isVideo = MediaLibrary.isVideoType(action.media.type);
      if (isVideo) {
        editMediaPreviewInner.innerHTML = `<video src="${action.media.src}" muted preload="metadata"></video>`;
      } else {
        editMediaPreviewInner.innerHTML = `<img src="${action.media.src}" alt="缩略图">`;
      }
    } else {
      editMediaPreview.hidden = true;
      editMediaPreviewInner.innerHTML = "";
    }
  }

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
  pendingEditMedia = null;
}

async function updateActionFromModal() {
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

  if (pendingEditMedia !== null) {
    const oldMediaId = getActionMediaId(action);
    if (pendingEditMedia === false) {
      setActionMediaRef(action, null);
      if (oldMediaId) {
        await MediaLibrary.deleteMedia(oldMediaId);
      }
    } else {
      try {
        const file = pendingEditMedia.file || pendingEditMedia;
        const saved = await MediaLibrary.addMedia(file, pendingEditMedia.type, `${newName}素材`);
        setActionMediaRef(action, saved);
        if (oldMediaId && oldMediaId !== saved.id) {
          await MediaLibrary.deleteMedia(oldMediaId);
        }
        showToast("素材已更新", "success");
      } catch (err) {
        const storageInfo = await MediaLibrary.getStorageInfo();
        if (storageInfo.usageRatio > 0.9) {
          showToast(`存储容量不足（已使用 ${(storageInfo.usageRatio * 100).toFixed(0)}%），素材保存失败，请清理空间后重试`, "error", 5000);
        } else {
          showToast("素材保存失败：" + (err.message || err), "error");
        }
        return;
      }
    }
  }

  save();
  await MediaLibrary.syncUsedByReferences(state);
  closeActionEditModal();
  await renderAll();
}

async function deleteActionWithCheck(actionId) {
  const action = state.actions.find((a) => a.id === actionId);
  if (!action) return;

  const choreoRefs = window.Choreography?.checkActionReferences(actionId);
  let confirmMsg = `确定删除动作「${action.name}」？`;

  if (choreoRefs?.hasReferences) {
    const refNames = choreoRefs.references.map((c) => `「${c.name}」`).join("、");
    confirmMsg += `\n\n⚠ 该动作被 ${choreoRefs.references.length} 个编排引用：${refNames}\n删除后，这些编排中将显示动作已删除的提示。`;
  }

  if (!confirm(confirmMsg)) return;

  const mediaId = getActionMediaId(action);

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

  const relatedScores = Array.isArray(state.scores) ? state.scores.filter((s) => s.actionId === actionId) : [];
  if (relatedScores.length > 0) {
    state.scores = state.scores.filter((s) => s.actionId !== actionId);
  }

  if (mediaId) {
    await MediaLibrary.deleteMedia(mediaId);
  }

  save();
  await renderAll();
}

async function duplicateAction(actionId) {
  const source = state.actions.find((a) => a.id === actionId);
  if (!source) return null;

  const frameIdMap = new Map();
  const frames = Array.isArray(source.frames)
    ? source.frames.map((f) => {
        const newFrameId = crypto.randomUUID();
        if (f.id) frameIdMap.set(f.id, newFrameId);
        return { ...f, id: newFrameId };
      })
    : [];

  const annotations = Array.isArray(source.annotations)
    ? source.annotations.map((a) => {
        const annotation = { ...a, id: crypto.randomUUID() };
        if (annotation.frameId) {
          const newFrameId = frameIdMap.get(annotation.frameId);
          if (newFrameId) {
            annotation.frameId = newFrameId;
          } else {
            delete annotation.frameId;
          }
        }
        return annotation;
      })
    : [];

  const newAction = {
    id: crypto.randomUUID(),
    name: `${source.name}副本`,
    tags: source.tags || "",
    frames,
    annotations,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mediaRef = getActionMediaRef(source);
  if (mediaRef) {
    newAction.mediaId = mediaRef.id;
    newAction.mediaRef = { ...mediaRef };
  }
  if (source.media && source.media.src) {
    newAction.media = { ...source.media };
  }

  state.actions.unshift(newAction);
  state.activeId = newAction.id;

  save();
  await MediaLibrary.syncUsedByReferences(state);
  await renderAll();

  showToast(`已复制为新动作「${newAction.name}」`, "success");
  return newAction;
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
  const sessionId = e.target.closest("[data-jump-session]")?.dataset.jumpSession;
  if (sessionId) {
    state.activeSessionId = sessionId;
    save();
    switchMainTab("practice");
    switchSidebarTab("sessions");
    renderAll();
    return;
  }
  const planEl = e.target.closest("[data-jump-plan]");
  if (planEl) {
    const planId = planEl.dataset.jumpPlan;
    const planDate = planEl.dataset.planDate;
    switchMainTab("calendar");
    if (window.PracticeCalendar && planDate) {
      window.PracticeCalendar.navigateToDate(planDate);
    }
  }
});

function handleAddToCalendar() {
  const action = activeAction();
  if (!action) {
    showToast("请先选择一个动作", "warning");
    return;
  }
  if (window.PracticeCalendar) {
    window.PracticeCalendar.openPlanModalForAction(action.id, action.name);
  }
}

document.querySelector("#addToCalendarFromDetailBtn")?.addEventListener("click", handleAddToCalendar);
document.querySelector("#addToCalendarFromReviewBtn")?.addEventListener("click", handleAddToCalendar);

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
  const file = mediaInput.files[0];
  if (!file) {
    pendingMedia = null;
    if (mediaPreview) mediaPreview.hidden = true;
    if (mediaPreviewInner) mediaPreviewInner.innerHTML = "";
    return;
  }
  pendingMedia = { file: file, type: file.type, name: file.name };
  const isVideo = MediaLibrary.isVideoType(file.type);
  const data = await readMedia(file);
  if (mediaPreview && mediaPreviewInner) {
    renderLocalMediaPreview(mediaPreviewInner, data?.src, isVideo);
    mediaPreview.hidden = false;
  }
});

if (clearMediaBtn) {
  clearMediaBtn.addEventListener("click", () => {
    pendingMedia = null;
    mediaInput.value = "";
    if (mediaPreview) mediaPreview.hidden = true;
    if (mediaPreviewInner) mediaPreviewInner.innerHTML = "";
  });
}

if (editMediaInput) {
  editMediaInput.addEventListener("change", async () => {
    const file = editMediaInput.files[0];
    if (!file) {
      pendingEditMedia = null;
      return;
    }
    pendingEditMedia = { file: file, type: file.type, name: file.name };
    const isVideo = MediaLibrary.isVideoType(file.type);
    const data = await readMedia(file);
    if (editMediaPreview && editMediaPreviewInner) {
      renderLocalMediaPreview(editMediaPreviewInner, data?.src, isVideo);
      editMediaPreview.hidden = false;
    }
  });
}

if (editClearMediaBtn) {
  editClearMediaBtn.addEventListener("click", () => {
    pendingEditMedia = false;
    if (editMediaInput) editMediaInput.value = "";
    if (editMediaPreview && editMediaPreviewInner) {
      editMediaPreviewInner.innerHTML = `<div class="preview-placeholder">✕<span>将移除素材</span></div>`;
      editMediaPreview.hidden = false;
    }
  });
}

actionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(actionForm);
  let savedMedia = null;

  if (pendingMedia) {
    try {
      const file = pendingMedia.file || pendingMedia;
      savedMedia = await MediaLibrary.addMedia(file, pendingMedia.type, `${data.get("name").trim() || "新动作"}素材`);
    } catch (err) {
      const storageInfo = await MediaLibrary.getStorageInfo();
      if (storageInfo.usageRatio > 0.9) {
        alert(`存储容量不足（已使用 ${(storageInfo.usageRatio * 100).toFixed(0)}%），素材保存失败，请清理空间后重试。`);
      } else {
        alert("素材保存失败：" + (err.message || err));
      }
      return;
    }
  }

  const action = {
    id: crypto.randomUUID(),
    name: data.get("name").trim(),
    tags: data.get("tags").trim(),
    frames: [],
    annotations: [],
    createdAt: new Date().toISOString()
  };

  if (savedMedia) {
    setActionMediaRef(action, savedMedia);
  }

  state.actions.unshift(action);
  state.activeId = action.id;
  pendingMedia = null;
  mediaInput.value = "";
  if (mediaPreview) mediaPreview.hidden = true;
  if (mediaPreviewInner) mediaPreviewInner.innerHTML = "";
  actionForm.reset();
  save();
  await MediaLibrary.syncUsedByReferences(state);
  await renderAll();
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

actionList.addEventListener("click", async (event) => {
  const copyId = event.target.closest("[data-copy-action]")?.dataset.copyAction;
  const editId = event.target.closest("[data-edit-action]")?.dataset.editAction;
  const deleteId = event.target.closest("[data-delete-action]")?.dataset.deleteAction;
  const actionId = event.target.closest("[data-action]")?.dataset.action;

  if (copyId) {
    event.stopPropagation();
    await duplicateAction(copyId);
    return;
  }
  if (editId) {
    event.stopPropagation();
    await openActionEditModal(editId);
    return;
  }
  if (deleteId) {
    event.stopPropagation();
    await deleteActionWithCheck(deleteId);
    return;
  }
  if (actionId) {
    state.activeId = actionId;
    save();
    await renderAll();
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

tagFilter.addEventListener("input", async () => {
  await renderList();
});

addAnnotationBtn.addEventListener("click", async () => {
  const action = activeAction();
  if (!action) {
    alert("请先选择一个动作并上传练习图片或视频");
    return;
  }
  const mediaId = getActionMediaId(action);
  const hasLegacy = action.media && action.media.src;
  if (!mediaId && !hasLegacy) {
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
  actionEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await updateActionFromModal();
  });
}

const copyActionBtn = document.querySelector("#copyActionBtn");
if (copyActionBtn) {
  copyActionBtn.addEventListener("click", async () => {
    const actionId = document.querySelector("#editActionId").value;
    if (!actionId) return;
    closeActionEditModal();
    await duplicateAction(actionId);
  });
}

async function openMediaLibrary() {
  if (!mediaLibraryModal) return;
  mediaLibraryModal.hidden = false;
  await renderMediaLibrary();
}

function closeMediaLibrary() {
  if (mediaLibraryModal) mediaLibraryModal.hidden = true;
}

function applyMediaFilter(mediaList, usedIds) {
  return mediaList.filter((m) => {
    switch (mediaFilter) {
      case "image":
        return MediaLibrary.isImageType(m.type);
      case "video":
        return MediaLibrary.isVideoType(m.type);
      case "used":
        return usedIds.has(m.id);
      case "orphan":
        return !usedIds.has(m.id);
      default:
        return true;
    }
  });
}

function sortMediaList(mediaList) {
  const [field, order] = mediaSort.split("-");
  const sorted = [...mediaList];
  sorted.sort((a, b) => {
    let valA, valB;
    if (field === "size") {
      valA = a.size || 0;
      valB = b.size || 0;
    } else {
      valA = new Date(a.createdAt).getTime();
      valB = new Date(b.createdAt).getTime();
    }
    return order === "desc" ? valB - valA : valA - valB;
  });
  return sorted;
}

async function renderMediaLibrary() {
  const allMedia = await MediaLibrary.getAllMedia();
  const storageInfo = await MediaLibrary.getStorageInfo();
  const usedIds = new Set(MediaLibrary.getUsedMediaIds(state));

  if (storageInfoEl) {
    const pct = storageInfo.quota ? ((storageInfo.used / storageInfo.quota) * 100).toFixed(1) : 0;
    storageInfoEl.innerHTML = `<span>已用 ${formatSize(storageInfo.used)}</span>${storageInfo.quota ? `<span> / ${formatSize(storageInfo.quota)} (${pct}%)</span>` : ""}`;
    if (storageInfo.usageRatio > 0.9) {
      storageInfoEl.classList.add("warning");
    } else {
      storageInfoEl.classList.remove("warning");
    }
  }

  const totalOrphanCount = allMedia.filter((m) => !usedIds.has(m.id)).length;
  const filteredMedia = applyMediaFilter(allMedia, usedIds);
  const filteredOrphanCount = filteredMedia.filter((m) => !usedIds.has(m.id)).length;

  if (mediaLibWarnings) {
    const warnings = [];
    if (storageInfo.usageRatio > 0.9) {
      warnings.push(`<div class="media-lib-warning danger">⚠ 存储容量警告：已使用 ${(storageInfo.usageRatio * 100).toFixed(0)}%，请及时清理不需要的素材</div>`);
    }
    if (filteredOrphanCount > 0 && mediaFilter !== "orphan") {
      warnings.push(`<div class="media-lib-warning info">ℹ 当前视图中有 ${filteredOrphanCount} 个孤立素材（未被任何动作引用），可点击清理按钮释放空间</div>`);
    }
    if (warnings.length) {
      mediaLibWarnings.innerHTML = warnings.join("");
      mediaLibWarnings.hidden = false;
    } else {
      mediaLibWarnings.innerHTML = "";
      mediaLibWarnings.hidden = true;
    }
  }

  if (cleanupOrphanBtn) {
    cleanupOrphanBtn.disabled = filteredOrphanCount === 0;
    cleanupOrphanBtn.style.opacity = filteredOrphanCount === 0 ? "0.5" : "1";
    cleanupOrphanBtn.style.cursor = filteredOrphanCount === 0 ? "not-allowed" : "pointer";
    let btnLabel = "清理孤立素材";
    if (mediaFilter === "image") {
      btnLabel = `清理 ${filteredOrphanCount} 个孤立图片`;
    } else if (mediaFilter === "video") {
      btnLabel = `清理 ${filteredOrphanCount} 个孤立视频`;
    } else if (filteredOrphanCount > 0) {
      btnLabel = `清理 ${filteredOrphanCount} 个孤立素材`;
    }
    cleanupOrphanBtn.textContent = btnLabel;
  }

  const sortedMedia = sortMediaList(filteredMedia);

  if (mediaLibStats) {
    const filteredSize = filteredMedia.reduce((sum, m) => sum + (m.size || 0), 0);
    mediaLibStats.innerHTML = `
      <span>共 <strong>${filteredMedia.length}</strong> 个素材</span>
      <span>合计 <strong>${formatSize(filteredSize)}</strong></span>
      ${mediaFilter !== "all" ? `<span class="media-lib-filter-hint">（筛选自 ${allMedia.length} 个全部素材）</span>` : ""}
    `;
  }

  if (mediaLibraryGrid) {
    if (!sortedMedia.length) {
      let emptyText = "素材库为空";
      let subText = "上传动作时，素材会自动保存到此处";
      if (mediaFilter !== "all") {
        emptyText = "没有找到符合条件的素材";
        subText = "试试切换筛选条件";
      }
      mediaLibraryGrid.innerHTML = `<div class="media-lib-empty"><p>${emptyText}</p><p class="muted">${subText}</p></div>`;
      return;
    }

    mediaLibraryGrid.innerHTML = sortedMedia.map((m) => {
      const isOrphan = !usedIds.has(m.id);
      const isVideo = MediaLibrary.isVideoType(m.type);
      const thumb = m.thumbnail;
      let thumbHtml = "";
      if (thumb) {
        thumbHtml = `<img src="${thumb}" alt="">`;
      } else if (isVideo) {
        thumbHtml = `<div class="lib-thumb-placeholder video">🎬</div>`;
      } else {
        thumbHtml = `<div class="lib-thumb-placeholder image">🖼</div>`;
      }

      const usedByCount = m.usedBy?.length || 0;
      return `
        <div class="lib-media-card ${isOrphan ? "orphan" : ""}" data-media="${m.id}">
          <div class="lib-media-thumb">
            ${thumbHtml}
            ${isOrphan ? `<span class="orphan-badge">孤立</span>` : ""}
            ${usedByCount > 0 ? `<span class="used-badge">${usedByCount} 引用</span>` : ""}
          </div>
          <div class="lib-media-info">
            <div class="lib-media-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
            <div class="lib-media-meta">
              <span>${formatSize(m.size)}</span>
              <span>${isVideo ? "视频" : "图片"}</span>
            </div>
          </div>
          <div class="lib-media-actions">
            <button type="button" class="btn-small btn-danger" data-delete-media="${m.id}">删除</button>
          </div>
        </div>
      `;
    }).join("");
  }
}

mediaLibraryGrid?.addEventListener("click", async (e) => {
  const deleteId = e.target.closest("[data-delete-media]")?.dataset.deleteMedia;
  if (deleteId) {
    const usedIds = new Set(MediaLibrary.getUsedMediaIds(state));
    const isOrphan = !usedIds.has(deleteId);
    let msg = "确定删除该素材？";
    if (!isOrphan) {
      msg = "该素材正在被动作引用，删除后动作中的素材将无法显示。\n" + msg;
    }
    if (!confirm(msg)) return;
    await MediaLibrary.deleteMedia(deleteId);
    if (!isOrphan) {
      state.actions.forEach((action) => {
        if (action.mediaId === deleteId) {
          delete action.mediaId;
          delete action.mediaRef;
        }
        if (action.mediaRef && action.mediaRef.id === deleteId) {
          delete action.mediaRef;
        }
      });
      save();
      await renderAll();
    }
    await renderMediaLibrary();
    showToast("素材已删除", "success");
  }
});

cleanupOrphanBtn?.addEventListener("click", async () => {
  const allMedia = await MediaLibrary.getAllMedia();
  const usedIds = new Set(MediaLibrary.getUsedMediaIds(state));
  const filteredMedia = applyMediaFilter(allMedia, usedIds);
  const orphansToClean = filteredMedia.filter((m) => !usedIds.has(m.id));

  if (!orphansToClean.length) {
    showToast("当前视图中没有孤立素材", "info");
    return;
  }

  let typeLabel = "个孤立素材";
  if (mediaFilter === "image") typeLabel = "个孤立图片";
  else if (mediaFilter === "video") typeLabel = "个孤立视频";
  else if (mediaFilter === "orphan") typeLabel = "个孤立素材";

  if (!confirm(`确定清理当前视图中的 ${orphansToClean.length}${typeLabel}？此操作不可恢复。`)) return;

  const deleted = [];
  for (const m of orphansToClean) {
    const ok = await MediaLibrary.deleteMedia(m.id);
    if (ok) deleted.push(m.id);
  }

  showToast(`已清理 ${deleted.length}${typeLabel}`, "success");
  await renderMediaLibrary();
});

document.querySelectorAll(".media-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".media-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    mediaFilter = btn.dataset.filter;
    renderMediaLibrary();
  });
});

mediaSortSelect?.addEventListener("change", () => {
  mediaSort = mediaSortSelect.value;
  renderMediaLibrary();
});

mediaLibraryModal?.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close-media-lib") || e.target === mediaLibraryModal) {
    closeMediaLibrary();
  }
});

document.querySelector("#openMediaLibraryBtn")?.addEventListener("click", openMediaLibrary);

const MirrorTraining = (function () {
  let mirrorEnabled = false;
  let compareMode = false;
  let pauseMarkers = [];
  let currentVideoTime = 0;

  const leftRightMap = {
    "左手": "右手",
    "右手": "左手",
    "左": "右",
    "右": "左",
    "偏左": "偏右",
    "偏右": "偏左",
    "左侧": "右侧",
    "右侧": "左侧",
    "左边": "右边",
    "右边": "左边",
    "左移": "右移",
    "右移": "左移",
    "内旋": "外旋",
    "外旋": "内旋",
    "外翻": "内翻",
    "内翻": "外翻",
    "顺时针": "逆时针",
    "逆时针": "顺时针",
    "左腿": "右腿",
    "右腿": "左腿",
    "左肩": "右肩",
    "右肩": "左肩",
    "左袖": "右袖",
    "右袖": "左袖",
    "上提": "上提",
    "下压": "下压",
    "平送": "平送",
    "向前": "向前",
    "向后": "向后"
  };

  function mirrorText(text) {
    if (!text) return text;
    let result = text;
    const sortedKeys = Object.keys(leftRightMap).sort((a, b) => b.length - a.length);
    const placeholders = {};
    let counter = 0;
    sortedKeys.forEach((key) => {
      if (result.includes(key)) {
        const placeholder = `__MIRROR_${counter}__`;
        placeholders[placeholder] = leftRightMap[key];
        result = result.split(key).join(placeholder);
        counter++;
      }
    });
    Object.entries(placeholders).forEach(([ph, value]) => {
      result = result.split(ph).join(value);
    });
    return result;
  }

  function hasDirectionContent(text) {
    if (!text) return false;
    return Object.keys(leftRightMap).some((key) => text.includes(key));
  }

  function getMirrorMediaBox() {
    return document.querySelector("#mirrorMediaBox");
  }

  function getMirrorMediaWrapper() {
    return document.querySelector("#mirrorMediaWrapper");
  }

  function getMirrorMediaElement() {
    const box = getMirrorMediaBox();
    return box ? box.querySelector("img, video") : null;
  }

  function getMirrorVideo() {
    const box = getMirrorMediaBox();
    return box ? box.querySelector("video") : null;
  }

  function isMirrorVideo() {
    const action = activeAction();
    if (!action) return false;
    const ref = getActionMediaRef(action);
    if (ref?.type) return MediaLibrary.isVideoType(ref.type);
    if (action.media?.type) return MediaLibrary.isVideoType(action.media.type);
    return false;
  }

  function toggleMirror() {
    mirrorEnabled = !mirrorEnabled;
    const btn = document.querySelector("#mirrorToggleBtn");
    const box = getMirrorMediaBox();

    if (btn) {
      btn.textContent = mirrorEnabled ? "🔄 关闭镜像" : "🔄 开启镜像";
      btn.classList.toggle("btn-accent", !mirrorEnabled);
      btn.classList.toggle("btn-secondary", mirrorEnabled);
    }
    if (box) {
      box.classList.toggle("mirrored", mirrorEnabled);
    }
    updateCompareLabels();
    renderMirrorFrames();
    showToast(mirrorEnabled ? "镜像模式已开启" : "镜像模式已关闭", "info", 1500);
  }

  function toggleCompareMode() {
    compareMode = !compareMode;
    const btn = document.querySelector("#mirrorCompareBtn");
    const wrapper = getMirrorMediaWrapper();
    const box = getMirrorMediaBox();

    if (btn) {
      btn.textContent = compareMode ? "⇔ 退出对照" : "⇔ 左右对照";
      btn.classList.toggle("btn-accent", compareMode);
      btn.classList.toggle("btn-secondary", !compareMode);
    }

    renderMirrorMedia();
    showToast(compareMode ? "左右对照模式已开启" : "已退出左右对照模式", "info", 1500);
  }

  function updateCompareLabels() {
    const labels = document.querySelectorAll(".mirror-compare-label");
    labels.forEach((label) => {
      const isMirrored = label.parentElement.classList.contains("mirrored");
      label.textContent = isMirrored ? "镜像视图" : "原始视图";
    });
  }

  async function renderMirrorMedia() {
    const action = activeAction();
    const box = getMirrorMediaBox();
    const controls = document.querySelector(".mirror-media-controls");
    if (controls) controls.style.display = "none";

    if (!box) return;

    if (!action) {
      box.innerHTML = '<p class="mirror-empty-hint">选择一个动作开始镜像训练</p>';
      return;
    }

    const mediaId = getActionMediaId(action);
    const mediaRef = getActionMediaRef(action);
    const hasLegacyMedia = action.media && action.media.src && typeof action.media.src === "string" && action.media.src.startsWith("data:");

    if (!mediaId && !hasLegacyMedia) {
      box.innerHTML = `<p class="mirror-empty-hint">${escapeHtml(action.name)}还没有上传练习素材</p>`;
      return;
    }

    let mediaSrc = null;
    let mediaType = null;

    if (hasLegacyMedia) {
      mediaSrc = action.media.src;
      mediaType = action.media.type;
    } else if (mediaId) {
      try {
        mediaSrc = await MediaLibrary.getMediaDataURL(mediaId);
        const m = await MediaLibrary.getMedia(mediaId);
        mediaType = m?.type || (mediaRef && mediaRef.type);
      } catch {
        mediaSrc = null;
      }
    }

    if (!mediaSrc) {
      box.innerHTML = '<p class="mirror-empty-hint">素材加载失败或已被清理</p>';
      return;
    }

    const isVideo = MediaLibrary.isVideoType(mediaType);
    box.classList.toggle("mirrored", mirrorEnabled && !compareMode);

    if (compareMode) {
      renderCompareMode(mediaSrc, isVideo);
    } else {
      renderSingleMode(mediaSrc, isVideo);
    }

    bindMirrorMediaEvents();
    if (isVideo && controls) controls.style.display = "flex";
  }

  function renderSingleMode(mediaSrc, isVideo) {
    const box = getMirrorMediaBox();
    const mediaHtml = isVideo
      ? `<video src="${mediaSrc}" controls preload="metadata"></video>`
      : `<img src="${mediaSrc}" alt="练习素材">`;
    box.innerHTML = mediaHtml;
  }

  function renderCompareMode(mediaSrc, isVideo) {
    const box = getMirrorMediaBox();
    const mediaTag = isVideo
      ? `<video src="${mediaSrc}" preload="metadata"></video>`
      : `<img src="${mediaSrc}" alt="练习素材">`;

    box.innerHTML = `
      <div class="mirror-compare-container">
        <div class="mirror-compare-item original">
          <span class="mirror-compare-label">原始视图</span>
          ${mediaTag}
        </div>
        <div class="mirror-compare-item mirrored">
          <span class="mirror-compare-label">镜像视图</span>
          ${mediaTag}
        </div>
      </div>
    `;

    if (isVideo) {
      const videos = box.querySelectorAll("video");
      const masterVideo = videos[0];
      const slaveVideo = videos[1];

      masterVideo.addEventListener("timeupdate", () => {
        if (Math.abs(masterVideo.currentTime - slaveVideo.currentTime) > 0.1) {
          slaveVideo.currentTime = masterVideo.currentTime;
        }
        currentVideoTime = masterVideo.currentTime;
        updateTimeDisplay();
        checkPauseMarkers();
      });

      masterVideo.addEventListener("play", () => {
        slaveVideo.play().catch(() => {});
        updatePlayPauseButton(false);
      });

      masterVideo.addEventListener("pause", () => {
        slaveVideo.pause();
        updatePlayPauseButton(true);
      });

      masterVideo.addEventListener("seeked", () => {
        slaveVideo.currentTime = masterVideo.currentTime;
      });

      masterVideo.controls = false;
      slaveVideo.controls = false;
    }
  }

  function bindMirrorMediaEvents() {
    const video = getMirrorVideo();
    if (video && !compareMode) {
      video.addEventListener("timeupdate", () => {
        currentVideoTime = video.currentTime;
        updateTimeDisplay();
        checkPauseMarkers();
      });
      video.addEventListener("play", () => updatePlayPauseButton(false));
      video.addEventListener("pause", () => updatePlayPauseButton(true));
    }
    renderMarkers();
  }

  function updateTimeDisplay() {
    const display = document.querySelector("#mirrorTimeDisplay");
    if (display) {
      display.textContent = formatDuration(currentVideoTime);
    }
  }

  function updatePlayPauseButton(paused) {
    const btn = document.querySelector("#mirrorPlayPauseBtn");
    if (btn) {
      btn.textContent = paused ? "▶ 播放" : "⏸ 暂停";
    }
  }

  function togglePlayPause() {
    const video = getMirrorVideo();
    if (!video && compareMode) {
      const videos = getMirrorMediaBox()?.querySelectorAll("video");
      if (videos && videos.length > 0) {
        if (videos[0].paused) {
          videos[0].play();
        } else {
          videos[0].pause();
        }
      }
    } else if (video) {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    }
  }

  function addPauseMarker() {
    const isVideo = isMirrorVideo();
    if (!isVideo) {
      showToast("只有视频素材可以标记暂停点", "warning");
      return;
    }
    if (currentVideoTime == null) {
      showToast("请先播放视频", "warning");
      return;
    }
    const exists = pauseMarkers.some((m) => Math.abs(m.time - currentVideoTime) < 0.5);
    if (exists) {
      showToast("该位置附近已有标记", "warning");
      return;
    }
    pauseMarkers.push({
      id: crypto.randomUUID(),
      time: currentVideoTime
    });
    pauseMarkers.sort((a, b) => a.time - b.time);
    renderMarkers();
    showToast(`已在 ${formatDuration(currentVideoTime)} 添加暂停点`, "success", 2000);
  }

  function clearPauseMarkers() {
    if (!pauseMarkers.length) {
      showToast("没有可清除的标记", "info");
      return;
    }
    if (!confirm("确定清除所有暂停标记？")) return;
    pauseMarkers = [];
    renderMarkers();
    showToast("已清除所有暂停标记", "success");
  }

  function renderMarkers() {
    const wrapper = getMirrorMediaWrapper();
    if (!wrapper) return;

    let container = wrapper.querySelector(".mirror-markers-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "mirror-markers-container";
      wrapper.appendChild(container);
    }

    const video = getMirrorVideo() || (compareMode && getMirrorMediaBox()?.querySelector("video"));
    if (!video || !video.duration || !isFinite(video.duration)) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = pauseMarkers.map((marker) => {
      const percent = (marker.time / video.duration) * 100;
      return `<div class="mirror-marker-dot" data-marker-id="${marker.id}" style="left: ${percent}%" title="${formatDuration(marker.time)}"></div>`;
    }).join("");

    container.querySelectorAll(".mirror-marker-dot").forEach((dot) => {
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = dot.dataset.markerId;
        const marker = pauseMarkers.find((m) => m.id === id);
        if (marker) {
          seekToTime(marker.time);
        }
      });
    });
  }

  function seekToTime(time) {
    const video = getMirrorVideo();
    if (video) {
      video.currentTime = time;
    } else if (compareMode) {
      const videos = getMirrorMediaBox()?.querySelectorAll("video");
      if (videos) {
        videos.forEach((v) => { v.currentTime = time; });
      }
    }
  }

  function checkPauseMarkers() {
    if (!pauseMarkers.length) return;
    const video = getMirrorVideo() || (compareMode && getMirrorMediaBox()?.querySelector("video"));
    if (!video || video.paused) return;

    for (const marker of pauseMarkers) {
      if (Math.abs(video.currentTime - marker.time) < 0.15 && !video.paused) {
        video.pause();
        showToast(`到达标记点 ${formatDuration(marker.time)}，已暂停`, "info", 2000);
        break;
      }
    }
  }

  function getSortedFrames(action) {
    if (!action || !Array.isArray(action.frames)) return [];
    return [...action.frames].sort((a, b) => {
      const parseTime = (t) => {
        if (!t) return null;
        const s = String(t).trim();
        const m1 = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
        if (m1) return Number(m1[1]) * 60 + Number(m1[2]) + (m1[3] ? Number(m1[3]) / 1000 : 0);
        const m2 = s.match(/^(\d{1,2})(\d{2})$/);
        if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
        const n = Number(s);
        return !isNaN(n) && isFinite(n) ? n : null;
      };
      const at = parseTime(a.time);
      const bt = parseTime(b.time);
      if (at != null && bt != null) return at - bt;
      if (at != null) return -1;
      if (bt != null) return 1;
      const aOrder = typeof a.order === "number" ? a.order : Infinity;
      const bOrder = typeof b.order === "number" ? b.order : Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return 0;
    });
  }

  function renderMirrorFrames() {
    const action = activeAction();
    const grid = document.querySelector("#mirrorFramesGrid");
    const countEl = document.querySelector("#mirrorFramesCount");

    if (!grid) return;

    if (!action) {
      grid.innerHTML = '<p class="muted mirror-frames-empty">选择一个动作查看关键帧对照</p>';
      if (countEl) countEl.textContent = "0 帧";
      return;
    }

    const frames = getSortedFrames(action);
    if (countEl) countEl.textContent = `${frames.length} 帧`;

    if (!frames.length) {
      grid.innerHTML = '<p class="muted mirror-frames-empty">暂无关键帧数据</p>';
      return;
    }

    grid.innerHTML = frames.map((frame) => {
      const hasLeftRight = hasDirectionContent(frame.weight) || hasDirectionContent(frame.wrist) ||
                           hasDirectionContent(frame.note) || hasDirectionContent(frame.tempo);
      const stage = frame.stage || "未命名";
      const time = frame.time || "未定时点";

      return `
        <article class="mirror-frame-card">
          <div class="frame-stage">${escapeHtml(stage)}</div>
          <div class="frame-time">⏱ ${escapeHtml(time)}</div>
          ${mirrorEnabled || hasLeftRight ? renderFrameContent(frame) : renderFrameSimpleContent(frame)}
        </article>
      `;
    }).join("");
  }

  function renderFrameSimpleContent(frame) {
    return `
      <div class="mirror-frame-item"><strong>重心：</strong>${escapeHtml(frame.weight || "未记录")}</div>
      <div class="mirror-frame-item"><strong>手腕：</strong>${escapeHtml(frame.wrist || "未记录")}</div>
      <div class="mirror-frame-item"><strong>节奏：</strong>${escapeHtml(frame.tempo || "未记录")}</div>
      ${frame.note ? `<div class="mirror-frame-note">${escapeHtml(frame.note)}</div>` : ""}
    `;
  }

  function renderFrameContent(frame) {
    const weightOrig = frame.weight || "未记录";
    const weightMirror = mirrorText(weightOrig);
    const wristOrig = frame.wrist || "未记录";
    const wristMirror = mirrorText(wristOrig);
    const tempoOrig = frame.tempo || "未记录";
    const tempoMirror = mirrorText(tempoOrig);
    const noteOrig = frame.note || "";
    const noteMirror = mirrorText(noteOrig);

    const weightChanged = weightOrig !== weightMirror;
    const wristChanged = wristOrig !== wristMirror;
    const tempoChanged = tempoOrig !== tempoMirror;
    const noteChanged = noteOrig !== noteMirror;

    const showMirror = mirrorEnabled || weightChanged || wristChanged || tempoChanged || noteChanged;

    if (!showMirror) {
      return renderFrameSimpleContent(frame);
    }

    return `
      <div class="mirror-frame-original">
        <div class="mirror-frame-label">原始描述</div>
        <div class="mirror-frame-item"><strong>重心：</strong>${escapeHtml(weightOrig)}</div>
        <div class="mirror-frame-item"><strong>手腕：</strong>${escapeHtml(wristOrig)}</div>
        <div class="mirror-frame-item"><strong>节奏：</strong>${escapeHtml(tempoOrig)}</div>
        ${noteOrig ? `<div class="mirror-frame-note">${escapeHtml(noteOrig)}</div>` : ""}
      </div>
      <div class="mirror-frame-mirrored">
        <div class="mirror-frame-label">💡 镜像对照</div>
        <div class="mirror-frame-item"><strong>重心：</strong>${escapeHtml(weightMirror)}</div>
        <div class="mirror-frame-item"><strong>手腕：</strong>${escapeHtml(wristMirror)}</div>
        <div class="mirror-frame-item"><strong>节奏：</strong>${escapeHtml(tempoMirror)}</div>
        ${noteMirror ? `<div class="mirror-frame-note">${escapeHtml(noteMirror)}</div>` : ""}
      </div>
    `;
  }

  function updateActionName() {
    const nameEl = document.querySelector("#mirrorActionName");
    const action = activeAction();
    if (nameEl) {
      nameEl.textContent = action ? `· ${action.name}` : "· 未选择动作";
    }
  }

  async function renderMirrorView() {
    updateActionName();
    await renderMirrorMedia();
    renderMirrorFrames();
  }

  function init() {
    const toggleBtn = document.querySelector("#mirrorToggleBtn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", toggleMirror);
    }

    const compareBtn = document.querySelector("#mirrorCompareBtn");
    if (compareBtn) {
      compareBtn.addEventListener("click", toggleCompareMode);
    }

    const playBtn = document.querySelector("#mirrorPlayPauseBtn");
    if (playBtn) {
      playBtn.addEventListener("click", togglePlayPause);
    }

    const markerBtn = document.querySelector("#mirrorPauseMarkerBtn");
    if (markerBtn) {
      markerBtn.addEventListener("click", addPauseMarker);
    }

    const clearMarkersBtn = document.querySelector("#mirrorClearMarkersBtn");
    if (clearMarkersBtn) {
      clearMarkersBtn.addEventListener("click", clearPauseMarkers);
    }

    const originalSwitchMainTab = switchMainTab;
    switchMainTab = function (mtab) {
      originalSwitchMainTab(mtab);
      if (mtab === "mirror") {
        renderMirrorView();
      }
    };
    window.switchMainTab = switchMainTab;
  }

  return {
    init,
    render: renderMirrorView,
    toggleMirror,
    toggleCompareMode,
    mirrorText
  };
})();

window.MirrorTraining = MirrorTraining;

const _originalRenderAll = renderAll;
renderAll = async function () {
  await _originalRenderAll();
  if (window.MirrorTraining) {
    const activeTab = document.querySelector('.m-tab.active');
    if (activeTab && activeTab.dataset.mtab === 'mirror') {
      await window.MirrorTraining.render();
    }
  }
};

(async function bootstrap() {
  const libOk = await MediaLibrary.init();
  if (!libOk) {
    console.warn("素材库不可用，部分功能受限");
  }

  const result = await MediaLibrary.migrateFromLocalStorage(state);
  const removedThumbnailRefs = removePersistedMediaThumbnails(state);
  if (result.migrated > 0 || removedThumbnailRefs > 0) {
    save();
  }
  if (result.migrated > 0) {
    await MediaLibrary.syncUsedByReferences(state);
    showToast(`已迁移 ${result.migrated} 个素材到离线素材库`, "success", 4000);
  }
  if (result.failed > 0) {
    showToast(`${result.failed} 个素材迁移失败，原始数据已保留，刷新页面将重试`, "warning", 6000);
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

  if (window.ReviewScoring) {
    window.ReviewScoring.init();
  }

  if (window.StoryboardTimeline) {
    window.StoryboardTimeline.init();
  }

  if (window.MirrorTraining) {
    window.MirrorTraining.init();
  }

  if (window.PracticeCalendar) {
    window.PracticeCalendar.init();
  }

  if (window.KnowledgeSearch) {
    window.KnowledgeSearch.init();
  }

  await renderAll();
})();
