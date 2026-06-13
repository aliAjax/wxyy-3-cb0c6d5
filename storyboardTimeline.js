const StoryboardTimeline = (function () {
  const state = {
    selectedFrameId: null,
    editingTimeFrameId: null,
    expandedFrameId: null,
    zoomLevel: 1,
    dragState: null,
    undoStack: [],
    redoStack: [],
    snackbarTimer: null,
    keyboardPanelVisible: false,
    framesCollapsed: false,
  };

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.25;
  const PIXELS_PER_SECOND = 50;
  const FRAME_CARD_WIDTH = 120;
  const MAX_HISTORY_SIZE = 50;

  function init() {
    bindEvents();
    renderAll();
  }

  function getActiveAction() {
    return window.__appState?.actions?.find((a) => a.id === window.__appState.activeId) || null;
  }

  function getFrames() {
    const action = getActiveAction();
    if (!action) return [];
    if (!Array.isArray(action.frames)) action.frames = [];
    return action.frames;
  }

  function getAnnotations() {
    const action = getActiveAction();
    if (!action) return [];
    if (!Array.isArray(action.annotations)) action.annotations = [];
    return action.annotations;
  }

  function parseTimeString(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const trimmed = timeStr.trim();
    const patterns = [
      /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/,
      /^(\d{1,2})(\d{2})$/,
      /^(\d+)$/,
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        let minutes, seconds, ms = 0;
        if (pattern === patterns[0]) {
          minutes = parseInt(match[1], 10);
          seconds = parseInt(match[2], 10);
          ms = match[3] ? parseInt(match[3].padEnd(3, "0"), 10) : 0;
        } else if (pattern === patterns[1]) {
          minutes = parseInt(match[1], 10);
          seconds = parseInt(match[2], 10);
        } else {
          minutes = 0;
          seconds = parseInt(match[1], 10);
        }
        if (seconds >= 60) return null;
        return minutes * 60 + seconds + ms / 1000;
      }
    }
    return null;
  }

  function formatTime(seconds) {
    if (seconds == null || isNaN(seconds)) return "--:--";
    const s = Math.floor(seconds || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function validateTimeString(timeStr) {
    return parseTimeString(timeStr) !== null;
  }

  function getFrameTimeSeconds(frame) {
    if (!frame) return null;
    const parsed = parseTimeString(frame.time);
    return parsed != null ? parsed : null;
  }

  function saveSnapshot(label = "edit") {
    const action = getActiveAction();
    if (!action) return;

    const snapshot = {
      label,
      timestamp: Date.now(),
      frames: JSON.parse(JSON.stringify(action.frames || [])),
    };

    state.undoStack.push(snapshot);
    if (state.undoStack.length > MAX_HISTORY_SIZE) {
      state.undoStack.shift();
    }
    state.redoStack = [];
  }

  function canUndo() {
    return state.undoStack.length > 0;
  }

  function canRedo() {
    return state.redoStack.length > 0;
  }

  function undo() {
    if (!canUndo()) return false;
    const action = getActiveAction();
    if (!action) return false;

    const currentSnapshot = {
      label: "current",
      timestamp: Date.now(),
      frames: JSON.parse(JSON.stringify(action.frames || [])),
    };

    const prevSnapshot = state.undoStack.pop();
    state.redoStack.push(currentSnapshot);

    action.frames = prevSnapshot.frames;
    commitChanges();
    showSnackbar("已撤销", "undo");
    return true;
  }

  function redo() {
    if (!canRedo()) return false;
    const action = getActiveAction();
    if (!action) return false;

    const currentSnapshot = {
      label: "current",
      timestamp: Date.now(),
      frames: JSON.parse(JSON.stringify(action.frames || [])),
    };

    const nextSnapshot = state.redoStack.pop();
    state.undoStack.push(currentSnapshot);

    action.frames = nextSnapshot.frames;
    commitChanges();
    showSnackbar("已重做", "undo");
    return true;
  }

  function showSnackbar(message, type = "info", duration = 2000) {
    let snackbar = document.querySelector(".storyboard-snackbar");
    if (!snackbar) {
      snackbar = document.createElement("div");
      snackbar.className = "storyboard-snackbar";
      document.body.appendChild(snackbar);
    }

    snackbar.textContent = message;
    snackbar.className = `storyboard-snackbar snackbar-${type}`;

    requestAnimationFrame(() => {
      snackbar.classList.add("visible");
    });

    if (state.snackbarTimer) {
      clearTimeout(state.snackbarTimer);
    }

    state.snackbarTimer = setTimeout(() => {
      snackbar.classList.remove("visible");
    }, duration);
  }

  function saveToParent() {
    if (typeof window.__saveAppState === "function") {
      window.__saveAppState();
    }
  }

  function getFrameById(frameId) {
    return getFrames().find((f) => f.id === frameId) || null;
  }

  function getNearestFrameByTime(seconds) {
    if (seconds == null) return null;
    let nearest = null;
    let nearestDelta = Infinity;
    getFrames().forEach((frame) => {
      const time = getFrameTimeSeconds(frame);
      if (time == null) return;
      const delta = Math.abs(time - seconds);
      if (delta < nearestDelta) {
        nearest = frame;
        nearestDelta = delta;
      }
    });
    return nearestDelta < 1.5 ? nearest : null;
  }

  function normalizeAnnotationLinks() {
    getAnnotations().forEach((ann) => {
      if (ann.frameId && getFrameById(ann.frameId)) return;
      const nearest = getNearestFrameByTime(ann.timestamp);
      if (nearest) ann.frameId = nearest.id;
    });
  }

  function syncFrameAnnotations(frameId, oldTime, newTime) {
    if (!frameId || newTime == null) return;
    getAnnotations().forEach((ann) => {
      const isLinked = ann.frameId === frameId;
      const isLegacyMatch = !ann.frameId && oldTime != null && ann.timestamp != null && Math.abs(ann.timestamp - oldTime) < 1.5;
      if (isLinked || isLegacyMatch) {
        ann.frameId = frameId;
        ann.timestamp = newTime;
      }
    });
  }

  function syncFramesOrder() {
    const action = getActiveAction();
    if (!action || !Array.isArray(action.frames)) return;
    normalizeAnnotationLinks();
    const sorted = getSortedFrames();
    sorted.forEach((f, idx) => {
      f.order = idx;
    });
    action.frames = sorted;
  }

  function commitChanges(syncDetail = true) {
    syncFramesOrder();
    saveToParent();
    renderAll();
    if (syncDetail) {
      syncParentDetail();
    }
  }

  function getSortedFrames() {
    const frames = getFrames();
    return [...frames].sort((a, b) => {
      const timeA = getFrameTimeSeconds(a);
      const timeB = getFrameTimeSeconds(b);
      if (timeA != null && timeB != null) return timeA - timeB;
      if (timeA != null) return -1;
      if (timeB != null) return 1;
      if (typeof a.order === "number" && typeof b.order === "number") {
        if (a.order !== b.order) return a.order - b.order;
      } else if (typeof a.order === "number") {
        return -1;
      } else if (typeof b.order === "number") {
        return 1;
      }
      return 0;
    });
  }

  function getMaxTime() {
    const frames = getFrames();
    let maxTime = 10;
    frames.forEach((f) => {
      const t = getFrameTimeSeconds(f);
      if (t != null && t > maxTime) maxTime = t;
    });
    return Math.ceil(maxTime / 5) * 5 + 5;
  }

  function getTimelineWidth() {
    const maxTime = getMaxTime();
    return maxTime * PIXELS_PER_SECOND * state.zoomLevel + 100;
  }

  function getFramePosition(frame) {
    const time = getFrameTimeSeconds(frame);
    if (time == null) return 20;
    return time * PIXELS_PER_SECOND * state.zoomLevel + 20;
  }

  function positionToTime(pixelX) {
    return Math.max(0, (pixelX - 20) / (PIXELS_PER_SECOND * state.zoomLevel));
  }

  function addFrame(stage = "起势", time = "", weight = "", wrist = "", tempo = "", note = "") {
    const action = getActiveAction();
    if (!action) return null;

    saveSnapshot("add-frame");

    const frame = {
      id: crypto.randomUUID(),
      stage,
      time,
      weight,
      wrist,
      tempo,
      note,
      createdAt: new Date().toISOString(),
    };

    if (!Array.isArray(action.frames)) action.frames = [];
    action.frames.push(frame);
    state.selectedFrameId = frame.id;
    state.expandedFrameId = frame.id;

    commitChanges();
    showSnackbar("已添加关键帧", "success");
    return frame;
  }

  function duplicateFrame(frameId) {
    const action = getActiveAction();
    if (!action) return null;

    const sourceFrame = action.frames?.find((f) => f.id === frameId);
    if (!sourceFrame) return null;

    saveSnapshot("duplicate-frame");

    const newFrame = {
      ...JSON.parse(JSON.stringify(sourceFrame)),
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    const currentTime = getFrameTimeSeconds(sourceFrame);
    if (currentTime != null) {
      newFrame.time = formatTime(currentTime + 1);
    }
    delete newFrame.order;

    action.frames.push(newFrame);
    state.selectedFrameId = newFrame.id;

    commitChanges();
    showSnackbar("已复制关键帧", "success");
    return newFrame;
  }

  function deleteFrame(frameId) {
    const action = getActiveAction();
    if (!action || !action.frames) return false;

    const frameIndex = action.frames.findIndex((f) => f.id === frameId);
    if (frameIndex === -1) return false;

    saveSnapshot("delete-frame");

    action.frames = action.frames.filter((f) => f.id !== frameId);
    getAnnotations().forEach((ann) => {
      if (ann.frameId === frameId) delete ann.frameId;
    });

    if (state.selectedFrameId === frameId) state.selectedFrameId = null;
    if (state.expandedFrameId === frameId) state.expandedFrameId = null;
    if (state.editingTimeFrameId === frameId) state.editingTimeFrameId = null;

    commitChanges();
    showSnackbar("已删除关键帧", "info");
    return true;
  }

  function updateFrame(frameId, updates) {
    const action = getActiveAction();
    if (!action || !action.frames) return null;

    const frame = action.frames.find((f) => f.id === frameId);
    if (!frame) return null;

    saveSnapshot("update-frame");
    const oldTime = getFrameTimeSeconds(frame);
    Object.assign(frame, updates, { updatedAt: new Date().toISOString() });
    if (Object.prototype.hasOwnProperty.call(updates, "time")) {
      syncFrameAnnotations(frameId, oldTime, getFrameTimeSeconds(frame));
    }

    commitChanges();
    return frame;
  }

  function updateFrameTime(frameId, newTimeStr) {
    const action = getActiveAction();
    if (!action || !action.frames) return false;

    const frame = action.frames.find((f) => f.id === frameId);
    if (!frame) return false;

    if (!validateTimeString(newTimeStr)) {
      return false;
    }

    saveSnapshot("update-time");
    const oldTime = getFrameTimeSeconds(frame);
    frame.time = newTimeStr.trim();
    frame.updatedAt = new Date().toISOString();
    syncFrameAnnotations(frameId, oldTime, getFrameTimeSeconds(frame));

    commitChanges();
    return true;
  }

  function reorderFrame(frameId, targetIndex) {
    const action = getActiveAction();
    if (!action || !action.frames) return false;

    const sortedFrames = getSortedFrames();
    const currentIndex = sortedFrames.findIndex((f) => f.id === frameId);
    if (currentIndex === -1) return false;

    targetIndex = Math.max(0, Math.min(targetIndex, sortedFrames.length - 1));
    if (currentIndex === targetIndex) return false;

    saveSnapshot("reorder-frame");

    const [frame] = sortedFrames.splice(currentIndex, 1);
    sortedFrames.splice(targetIndex, 0, frame);

    const prevFrame = sortedFrames[targetIndex - 1];
    const nextFrame = sortedFrames[targetIndex + 1];
    const prevTime = prevFrame ? getFrameTimeSeconds(prevFrame) : null;
    const nextTime = nextFrame ? getFrameTimeSeconds(nextFrame) : null;

    let newTime;
    if (prevTime != null && nextTime != null) {
      newTime = (prevTime + nextTime) / 2;
    } else if (prevTime != null) {
      newTime = prevTime + 1;
    } else if (nextTime != null) {
      newTime = Math.max(0, nextTime - 1);
    } else {
      newTime = 0;
    }

    frame.time = formatTime(newTime);
    frame.updatedAt = new Date().toISOString();

    sortedFrames.forEach((f, idx) => {
      f.order = idx;
    });

    action.frames = [...sortedFrames];

    commitChanges();
    return true;
  }

  function moveFrameToTime(frameId, newTimeSeconds) {
    const action = getActiveAction();
    if (!action || !action.frames) return false;

    const frame = action.frames.find((f) => f.id === frameId);
    if (!frame) return false;

    const oldTime = getFrameTimeSeconds(frame);
    const clampedTime = Math.max(0, newTimeSeconds);

    if (oldTime != null && Math.abs(oldTime - clampedTime) < 0.1) {
      return false;
    }

    saveSnapshot("move-frame");
    frame.time = formatTime(clampedTime);
    frame.updatedAt = new Date().toISOString();
    syncFrameAnnotations(frameId, oldTime, getFrameTimeSeconds(frame));

    commitChanges();
    return true;
  }

  function getMirrorFrames() {
    const frames = getSortedFrames();
    const leftFrames = frames.filter((frame) =>
      /左|偏左|左手/.test(`${frame.weight}${frame.wrist}${frame.note}`)
    );
    const rightFrames = frames.filter((frame) =>
      /右|偏右|右手/.test(`${frame.weight}${frame.wrist}${frame.note}`)
    );

    return {
      left: leftFrames.length ? leftFrames : frames,
      right: rightFrames.length ? rightFrames : frames,
    };
  }

  function getAnnotationsForFrame(frameId) {
    const frame = getFrames().find((f) => f.id === frameId);
    if (!frame) return [];
    const frameTime = getFrameTimeSeconds(frame);

    const annotations = getAnnotations();
    return annotations.filter((ann) => {
      if (ann.frameId) return ann.frameId === frameId;
      if (frameTime == null) return false;
      if (ann.timestamp == null) return false;
      return Math.abs(ann.timestamp - frameTime) < 1.5;
    });
  }

  function selectFrame(frameId) {
    state.selectedFrameId = frameId;
    renderAll();
  }

  function expandFrame(frameId) {
    state.expandedFrameId = state.expandedFrameId === frameId ? null : frameId;
    renderAll();
  }

  function startEditingTime(frameId) {
    state.editingTimeFrameId = frameId;
    renderAll();
    setTimeout(() => {
      const input = document.querySelector(`.storyboard-frame-time-input[data-frame-time="${frameId}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  function stopEditingTime() {
    state.editingTimeFrameId = null;
    renderAll();
  }

  function setZoom(level) {
    state.zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    renderAll();
  }

  function zoomIn() {
    setZoom(state.zoomLevel + ZOOM_STEP);
  }

  function zoomOut() {
    setZoom(state.zoomLevel - ZOOM_STEP);
  }

  function zoomReset() {
    setZoom(1);
  }

  function toggleFramesCollapsed() {
    state.framesCollapsed = !state.framesCollapsed;
    renderAll();
  }

  function toggleKeyboardPanel() {
    state.keyboardPanelVisible = !state.keyboardPanelVisible;
    renderAll();
  }

  function renderRuler() {
    const rulerEl = document.querySelector(".storyboard-ruler");
    if (!rulerEl) return;

    const action = getActiveAction();
    const maxTime = action ? getMaxTime() : 30;
    const totalWidth = maxTime * PIXELS_PER_SECOND * state.zoomLevel + 60;
    rulerEl.style.width = `${totalWidth}px`;

    let marksHtml = "";
    const majorInterval = 5;
    const minorInterval = 1;

    for (let t = 0; t <= maxTime; t += minorInterval) {
      const isMajor = t % majorInterval === 0;
      const left = t * PIXELS_PER_SECOND * state.zoomLevel + 20;
      const label = formatTime(t);
      marksHtml += `
        <div class="storyboard-ruler-mark ${isMajor ? "major" : ""}" style="left: ${left}px;">
          ${isMajor ? label : ""}
        </div>
      `;
    }

    rulerEl.innerHTML = marksHtml;
  }

  function renderFrames() {
    const container = document.querySelector(".storyboard-frames-container");
    if (!container) return;

    const action = getActiveAction();
    const frames = action ? getSortedFrames() : [];
    const maxTime = action ? getMaxTime() : 30;
    const totalWidth = maxTime * PIXELS_PER_SECOND * state.zoomLevel + 100;
    container.style.width = `${totalWidth}px`;

    if (!action || !frames.length) {
      container.innerHTML = "";
      return;
    }

    let framesHtml = "";
    frames.forEach((frame, index) => {
      const left = getFramePosition(frame);
      const isSelected = state.selectedFrameId === frame.id;
      const isExpanded = state.expandedFrameId === frame.id;
      const isEditingTime = state.editingTimeFrameId === frame.id;
      const isCollapsed = state.framesCollapsed;
      const annotationRefs = getAnnotationsForFrame(frame.id);

      let timeContent = "";
      if (isEditingTime) {
        timeContent = `
          <input type="text" 
                 class="storyboard-frame-time-input" 
                 data-frame-time="${frame.id}"
                 value="${escapeHtml(frame.time || "")}"
                 placeholder="00:00">
        `;
      } else {
        timeContent = `
          <div class="storyboard-frame-time" data-frame-time="${frame.id}">
            ${escapeHtml(frame.time || "未定时")}
          </div>
        `;
      }

      framesHtml += `
        <div class="storyboard-frame-card ${isSelected ? "selected" : ""} ${isCollapsed ? "collapsed" : ""}"
             data-frame-id="${frame.id}"
             style="left: ${left - FRAME_CARD_WIDTH / 2}px;">
          <div class="storyboard-frame-head">
            <div class="storyboard-frame-order">${index + 1}</div>
            <div style="flex: 1; min-width: 0;">
              ${timeContent}
              <div class="storyboard-frame-stage">${escapeHtml(frame.stage || "未命名")}</div>
            </div>
            <button class="storyboard-frame-expand-btn" data-expand-frame="${frame.id}" type="button">
              ${isExpanded ? "▲" : "▼"}
            </button>
          </div>
          <div class="storyboard-frame-body">
            <div class="frame-field">
              <span class="frame-field-label">重心:</span>
              <span class="frame-field-value">${escapeHtml(frame.weight || "未记录")}</span>
            </div>
            <div class="frame-field">
              <span class="frame-field-label">手腕:</span>
              <span class="frame-field-value">${escapeHtml(frame.wrist || "未记录")}</span>
            </div>
            <div class="frame-field">
              <span class="frame-field-label">节奏:</span>
              <span class="frame-field-value">${escapeHtml(frame.tempo || "未记录")}</span>
            </div>
            ${annotationRefs.length > 0 ? `
              <div class="storyboard-annotation-refs">
                <h4>关联批注 (${annotationRefs.length})</h4>
                ${annotationRefs.slice(0, 3).map((ann, idx) => `
                  <div class="storyboard-annotation-ref-item">
                    <span class="ref-dot">${idx + 1}</span>
                    <span class="ref-body-part">${escapeHtml(ann.bodyPart || "")}</span>
                    ${ann.direction ? `<span class="ref-direction">${escapeHtml(ann.direction)}</span>` : ""}
                  </div>
                `).join("")}
              </div>
            ` : ""}
          </div>
          <div class="storyboard-frame-actions">
            <button class="storyboard-frame-action-btn copy" data-duplicate-frame="${frame.id}" type="button" title="复制">
              ⎘
            </button>
            <button class="storyboard-frame-action-btn" data-edit-frame="${frame.id}" type="button" title="编辑">
              ✎
            </button>
            <button class="storyboard-frame-action-btn danger" data-delete-frame="${frame.id}" type="button" title="删除">
              ×
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = framesHtml;
    bindFrameEvents();
  }

  function renderDetailPanel() {
    const panel = document.querySelector(".storyboard-detail-panel");
    if (!panel) return;

    const frameId = state.expandedFrameId;
    if (!frameId) {
      panel.classList.add("collapsed");
      return;
    }

    const frame = getFrames().find((f) => f.id === frameId);
    if (!frame) {
      panel.classList.add("collapsed");
      return;
    }

    panel.classList.remove("collapsed");

    const head = panel.querySelector(".storyboard-detail-head h3");
    if (head) head.textContent = `编辑关键帧 · ${frame.stage || "未命名"}`;

    const body = panel.querySelector(".storyboard-detail-body");
    if (!body) return;

    const mirror = getMirrorFrames();
    const annotationRefs = getAnnotationsForFrame(frameId);

    body.innerHTML = `
      <form class="storyboard-detail-form" data-detail-form="${frame.id}">
        <div class="storyboard-detail-grid">
          <label>节点
            <select name="stage" data-detail-field="stage">
              <option ${frame.stage === "起势" ? "selected" : ""}>起势</option>
              <option ${frame.stage === "抛袖" ? "selected" : ""}>抛袖</option>
              <option ${frame.stage === "收袖" ? "selected" : ""}>收袖</option>
              <option ${frame.stage === "转身" ? "selected" : ""}>转身</option>
              <option ${frame.stage === "亮相" ? "selected" : ""}>亮相</option>
            </select>
          </label>
          <label>时间点
            <input type="text" name="time" value="${escapeHtml(frame.time || "")}" 
                   data-detail-field="time" placeholder="00:08">
          </label>
          <label>身体重心
            <input type="text" name="weight" value="${escapeHtml(frame.weight || "")}" 
                   data-detail-field="weight" placeholder="偏左、下沉、上提">
          </label>
          <label>手腕方向
            <input type="text" name="wrist" value="${escapeHtml(frame.wrist || "")}" 
                   data-detail-field="wrist" placeholder="内旋、外翻、平送">
          </label>
          <label class="full-width">节奏备注
            <input type="text" name="tempo" value="${escapeHtml(frame.tempo || "")}" 
                   data-detail-field="tempo" placeholder="慢起快收，落点在板后">
          </label>
          <label class="full-width">复盘批注
            <textarea name="note" rows="2" data-detail-field="note"
                      placeholder="记录这个关键帧的要点...">${escapeHtml(frame.note || "")}</textarea>
          </label>
        </div>

        ${annotationRefs.length > 0 ? `
          <div class="storyboard-annotation-refs">
            <h4>关联的媒体批注 (${annotationRefs.length})</h4>
            ${annotationRefs.map((ann, idx) => `
              <div class="storyboard-annotation-ref-item">
                <span class="ref-dot">${idx + 1}</span>
                <span class="ref-body-part">${escapeHtml(ann.bodyPart || "未指定")}</span>
                ${ann.direction ? `<span class="ref-direction">${escapeHtml(ann.direction)}</span>` : ""}
                ${ann.note ? `<span class="ref-note">${escapeHtml(ann.note)}</span>` : ""}
              </div>
            `).join("")}
          </div>
        ` : ""}

        <div class="storyboard-mirror-section">
          <div class="storyboard-mirror-card">
            <h4>左手线索</h4>
            ${mirror.left.slice(0, 4).map((f) => `
              <p>${escapeHtml(f.stage)}: ${escapeHtml(f.wrist || f.note || "待补充")}</p>
            `).join("") || "<p>暂无</p>"}
          </div>
          <div class="storyboard-mirror-card">
            <h4>右手线索</h4>
            ${mirror.right.slice(0, 4).map((f) => `
              <p>${escapeHtml(f.stage)}: ${escapeHtml(f.wrist || f.note || "待补充")}</p>
            `).join("") || "<p>暂无</p>"}
          </div>
        </div>

        <div class="storyboard-detail-actions">
          <button type="button" class="btn-secondary" data-detail-close>关闭</button>
          <button type="button" class="btn-danger" data-detail-delete="${frame.id}">删除</button>
          <button type="button" class="btn-accent" data-detail-save="${frame.id}">保存修改</button>
        </div>
      </form>
    `;

    bindDetailPanelEvents();
  }

  function renderToolbar() {
    const titleEl = document.querySelector(".storyboard-toolbar-title .action-name");
    if (titleEl) {
      const action = getActiveAction();
      titleEl.textContent = action ? action.name : "未选择动作";
    }

    const undoBtn = document.querySelector('[data-toolbar-action="undo"]');
    const redoBtn = document.querySelector('[data-toolbar-action="redo"]');
    if (undoBtn) undoBtn.disabled = !canUndo();
    if (redoBtn) redoBtn.disabled = !canRedo();

    const zoomLevel = document.querySelector(".storyboard-zoom-level");
    if (zoomLevel) {
      zoomLevel.textContent = `${Math.round(state.zoomLevel * 100)}%`;
    }

    const collapseBtn = document.querySelector('[data-toolbar-action="collapse"]');
    if (collapseBtn) {
      collapseBtn.textContent = state.framesCollapsed ? "展开卡片" : "收起卡片";
    }
  }

  function renderEmptyState() {
    const workbench = document.querySelector(".storyboard-workbench");
    if (!workbench) return;

    const action = getActiveAction();
    const frames = getFrames();

    let emptyEl = document.querySelector(".storyboard-empty, .storyboard-no-action");
    if (emptyEl) emptyEl.remove();

    const timelineContainer = document.querySelector(".storyboard-timeline-container");
    if (!timelineContainer) return;

    if (!action) {
      const noActionEl = document.createElement("div");
      noActionEl.className = "storyboard-no-action";
      noActionEl.innerHTML = `
        <div class="storyboard-no-action-icon">🎬</div>
        <h3>请选择一个动作</h3>
        <p>从左侧动作库选择或新建一个水袖动作</p>
        <p>然后在分镜时间轴中编排关键帧</p>
      `;
      timelineContainer.appendChild(noActionEl);
      return;
    }

    if (!frames.length) {
      const emptyStateEl = document.createElement("div");
      emptyStateEl.className = "storyboard-empty";
      emptyStateEl.innerHTML = `
        <div class="storyboard-empty-icon">⏱</div>
        <h3>还没有关键帧</h3>
        <p>点击「添加关键帧」开始编排动作时间线</p>
        <p>每个关键帧代表一个动作节点，可拖拽排序和调整时间</p>
        <div class="storyboard-empty-hint">
          快捷键提示：<kbd>N</kbd> 新建 · <kbd>Del</kbd> 删除 · 
          <kbd>D</kbd> 复制 · <kbd>Ctrl+Z</kbd> 撤销
        </div>
      `;
      timelineContainer.appendChild(emptyStateEl);
    }
  }

  function renderKeyboardPanel() {
    const panel = document.querySelector(".storyboard-kbd-panel");
    if (panel) {
      panel.classList.toggle("visible", state.keyboardPanelVisible);
    }
  }

  function renderAll() {
    renderToolbar();
    renderRuler();
    renderFrames();
    renderDetailPanel();
    renderEmptyState();
    renderKeyboardPanel();
  }

  function bindFrameEvents() {
    const container = document.querySelector(".storyboard-frames-container");
    if (!container) return;

    container.querySelectorAll(".storyboard-frame-card").forEach((card) => {
      const frameId = card.dataset.frameId;

      card.addEventListener("mousedown", (e) => {
        if (e.target.closest("button, input, select, textarea")) return;
        startDrag(e, frameId);
      });

      card.addEventListener("click", (e) => {
        if (state.dragState?.wasDragging) return;
        if (e.target.closest("button, input, select, textarea")) return;
        selectFrame(frameId);
      });

      card.addEventListener("dblclick", (e) => {
        if (e.target.closest(".storyboard-frame-time")) {
          startEditingTime(frameId);
        } else {
          expandFrame(frameId);
        }
      });

      const timeEl = card.querySelector('[data-frame-time]');
      if (timeEl && timeEl.classList.contains("storyboard-frame-time")) {
        timeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          startEditingTime(frameId);
        });
      }

      const timeInput = card.querySelector(".storyboard-frame-time-input");
      if (timeInput) {
        timeInput.addEventListener("click", (e) => e.stopPropagation());
        timeInput.addEventListener("mousedown", (e) => e.stopPropagation());
        timeInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const newTime = timeInput.value.trim();
            if (validateTimeString(newTime)) {
              updateFrameTime(frameId, newTime);
              stopEditingTime();
            } else {
              timeInput.classList.add("error");
              showSnackbar("时间格式不正确，请使用 mm:ss 格式", "error");
            }
          } else if (e.key === "Escape") {
            stopEditingTime();
          }
        });
        timeInput.addEventListener("blur", () => {
          const newTime = timeInput.value.trim();
          if (validateTimeString(newTime)) {
            updateFrameTime(frameId, newTime);
          }
          stopEditingTime();
        });
        timeInput.addEventListener("input", () => {
          timeInput.classList.remove("error");
        });
      }
    });

    container.querySelectorAll('[data-expand-frame]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.expandFrame;
        expandFrame(id);
      });
    });

    container.querySelectorAll('[data-duplicate-frame]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.duplicateFrame;
        duplicateFrame(id);
      });
    });

    container.querySelectorAll('[data-edit-frame]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.editFrame;
        state.expandedFrameId = id;
        renderAll();
      });
    });

    container.querySelectorAll('[data-delete-frame]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteFrame;
        if (confirm("确定删除该关键帧？")) {
          deleteFrame(id);
        }
      });
    });
  }

  function bindDetailPanelEvents() {
    const panel = document.querySelector(".storyboard-detail-panel");
    if (!panel) return;

    const closeBtn = panel.querySelector('[data-detail-close]');
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        state.expandedFrameId = null;
        renderAll();
      });
    }

    const deleteBtn = panel.querySelector('[data-detail-delete]');
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        const id = deleteBtn.dataset.detailDelete;
        if (confirm("确定删除该关键帧？")) {
          deleteFrame(id);
        }
      });
    }

    const saveBtn = panel.querySelector('[data-detail-save]');
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const id = saveBtn.dataset.detailSave;
        const form = panel.querySelector('.storyboard-detail-form');
        if (!form) return;

        const updates = {};
        form.querySelectorAll("[data-detail-field]").forEach((field) => {
          const key = field.dataset.detailField;
          updates[key] = field.value;
        });

        if (updates.time && !validateTimeString(updates.time)) {
          showSnackbar("时间格式不正确，请使用 mm:ss 格式", "error");
          return;
        }

        updateFrame(id, updates);
        state.expandedFrameId = null;
        renderAll();
        showSnackbar("关键帧已更新", "success");
      });
    }
  }

  function startDrag(e, frameId) {
    e.preventDefault();
    const card = document.querySelector(`[data-frame-id="${frameId}"]`);
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const container = document.querySelector(".storyboard-timeline-container");
    const containerRect = container.getBoundingClientRect();

    state.dragState = {
      frameId,
      startX: e.clientX,
      startLeft: parseFloat(card.style.left),
      wasDragging: false,
      containerScrollLeft: container.scrollLeft,
    };

    card.classList.add("dragging");

    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
  }

  function onDrag(e) {
    if (!state.dragState) return;
    e.preventDefault();

    const { frameId, startX, startLeft, containerScrollLeft } = state.dragState;
    const container = document.querySelector(".storyboard-timeline-container");
    const card = document.querySelector(`[data-frame-id="${frameId}"]`);
    if (!card) return;

    const deltaX = e.clientX - startX;
    const newLeft = startLeft + deltaX;

    if (Math.abs(deltaX) > 3) {
      state.dragState.wasDragging = true;
    }

    card.style.left = `${newLeft}px`;

    const sortedFrames = getSortedFrames();
    const centerX = newLeft + FRAME_CARD_WIDTH / 2;
    let targetIndex = 0;

    for (let i = 0; i < sortedFrames.length; i++) {
      const f = sortedFrames[i];
      const fPos = getFramePosition(f);
      if (fPos < centerX) {
        targetIndex = i + 1;
      }
    }

    const currentIndex = sortedFrames.findIndex((f) => f.id === frameId);
    if (targetIndex > currentIndex) targetIndex--;

    updateDropIndicator(targetIndex, sortedFrames);

    if (e.clientX < container.getBoundingClientRect().left + 50) {
      container.scrollLeft -= 10;
    } else if (e.clientX > container.getBoundingClientRect().right - 50) {
      container.scrollLeft += 10;
    }
  }

  function updateDropIndicator(targetIndex, sortedFrames) {
    let indicator = document.querySelector(".storyboard-drop-indicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.className = "storyboard-drop-indicator";
      document.querySelector(".storyboard-frames-container")?.appendChild(indicator);
    }

    if (targetIndex >= sortedFrames.length) {
      const lastFrame = sortedFrames[sortedFrames.length - 1];
      if (lastFrame) {
        const pos = getFramePosition(lastFrame) + FRAME_CARD_WIDTH / 2 + 20;
        indicator.style.left = `${pos}px`;
      }
    } else if (targetIndex < 0) {
      indicator.style.left = `${0}px`;
    } else {
      const frame = sortedFrames[targetIndex];
      if (frame) {
        const pos = getFramePosition(frame) - FRAME_CARD_WIDTH / 2 - 10;
        indicator.style.left = `${pos}px`;
      }
    }
  }

  function removeDropIndicator() {
    const indicator = document.querySelector(".storyboard-drop-indicator");
    if (indicator) indicator.remove();
  }

  function stopDrag() {
    if (!state.dragState) return;

    const { frameId, wasDragging } = state.dragState;
    const card = document.querySelector(`[data-frame-id="${frameId}"]`);

    if (card) card.classList.remove("dragging");
    removeDropIndicator();

    if (wasDragging) {
      const sortedFrames = getSortedFrames();
      const currentIndex = sortedFrames.findIndex((f) => f.id === frameId);
      let targetIndex = 0;

      if (card) {
        const centerX = parseFloat(card.style.left) + FRAME_CARD_WIDTH / 2;
        for (let i = 0; i < sortedFrames.length; i++) {
          const f = sortedFrames[i];
          const fPos = getFramePosition(f);
          if (fPos < centerX) {
            targetIndex = i + 1;
          }
        }
        if (targetIndex > currentIndex) targetIndex--;

        const newTime = positionToTime(centerX);
        moveFrameToTime(frameId, newTime);
      }
    }

    state.dragState = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", stopDrag);
  }

  function syncParentDetail() {
    syncFramesOrder();
    if (typeof window.__renderActionDetail === "function") {
      window.__renderActionDetail();
    }
    if (typeof window.renderFramesList === "function") {
      window.renderFramesList();
    }
    if (typeof window.__renderActionAnnotations === "function") {
      window.__renderActionAnnotations();
    }
  }

  function handleKeydown(e) {
    const workbench = document.querySelector(".storyboard-workbench");
    if (!workbench) return;

    const mainTabActive = document.querySelector('[data-mtab="storyboard"]')?.classList.contains("active");
    if (!mainTabActive) return;

    const target = e.target;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
      if (e.key === "Escape") {
        stopEditingTime();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "y") {
      e.preventDefault();
      redo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      if (state.selectedFrameId) {
        duplicateFrame(state.selectedFrameId);
      }
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selectedFrameId) {
        e.preventDefault();
        if (confirm("确定删除该关键帧？")) {
          deleteFrame(state.selectedFrameId);
        }
      }
      return;
    }

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      addFrame();
      return;
    }

    if (e.key === "Escape") {
      state.selectedFrameId = null;
      state.expandedFrameId = null;
      state.editingTimeFrameId = null;
      renderAll();
      return;
    }

    if (e.key === "Enter") {
      if (state.selectedFrameId) {
        e.preventDefault();
        state.expandedFrameId = state.expandedFrameId === state.selectedFrameId 
          ? null 
          : state.selectedFrameId;
        renderAll();
      }
      return;
    }

    if (e.key === "ArrowLeft" && state.selectedFrameId) {
      e.preventDefault();
      moveSelectedFrameBy(-1, e.shiftKey ? 5 : 1);
      return;
    }

    if (e.key === "ArrowRight" && state.selectedFrameId) {
      e.preventDefault();
      moveSelectedFrameBy(1, e.shiftKey ? 5 : 1);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "=") {
      e.preventDefault();
      zoomIn();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      zoomOut();
      return;
    }

    if (e.key === "?" || e.key === "/") {
      e.preventDefault();
      toggleKeyboardPanel();
      return;
    }
  }

  function moveSelectedFrameBy(seconds, multiplier = 1) {
    if (!state.selectedFrameId) return;
    const frame = getFrames().find((f) => f.id === state.selectedFrameId);
    if (!frame) return;

    const currentTime = getFrameTimeSeconds(frame) || 0;
    const newTime = Math.max(0, currentTime + seconds * multiplier);
    moveFrameToTime(state.selectedFrameId, newTime);
  }

  function bindEvents() {
    document.addEventListener("keydown", handleKeydown);

    const toolbar = document.querySelector(".storyboard-toolbar");
    if (toolbar) {
      toolbar.addEventListener("click", (e) => {
        const action = e.target.closest("[data-toolbar-action]")?.dataset.toolbarAction;
        if (!action) return;

        switch (action) {
          case "add":
            addFrame();
            break;
          case "undo":
            undo();
            break;
          case "redo":
            redo();
            break;
          case "collapse":
            toggleFramesCollapsed();
            break;
          case "zoom-in":
            zoomIn();
            break;
          case "zoom-out":
            zoomOut();
            break;
          case "zoom-reset":
            zoomReset();
            break;
        }
      });
    }

    const kbdToggle = document.querySelector(".storyboard-kbd-toggle");
    if (kbdToggle) {
      kbdToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleKeyboardPanel();
      });
    }

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".storyboard-keyboard-hint")) {
        if (state.keyboardPanelVisible) {
          state.keyboardPanelVisible = false;
          renderKeyboardPanel();
        }
      }
    });

    const timelineContainer = document.querySelector(".storyboard-timeline-container");
    if (timelineContainer) {
      timelineContainer.addEventListener("wheel", (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.deltaY < 0) {
            zoomIn();
          } else {
            zoomOut();
          }
        }
      });

      timelineContainer.addEventListener("click", (e) => {
        if (e.target === timelineContainer || e.target.classList.contains("storyboard-frames-container")) {
          state.selectedFrameId = null;
          renderAll();
        }
      });
    }
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

  return {
    init,
    renderAll,
    addFrame,
    duplicateFrame,
    deleteFrame,
    updateFrame,
    updateFrameTime,
    reorderFrame,
    selectFrame,
    expandFrame,
    undo,
    redo,
    canUndo,
    canRedo,
    validateTimeString,
    parseTimeString,
    formatTime,
    zoomIn,
    zoomOut,
    zoomReset,
    getSortedFrames,
    getMirrorFrames,
    getAnnotationsForFrame,
  };
})();

window.StoryboardTimeline = StoryboardTimeline;
