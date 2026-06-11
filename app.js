const storageKey = "wxyy-3-kunqu-sleeve-board";
const state = JSON.parse(localStorage.getItem(storageKey) || '{"actions":[],"activeId":null,"sessions":[],"activeSessionId":null}');

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

let pendingMedia = null;
let timerInterval = null;
let metronomeAudio = null;
let metronomeInterval = null;
let metronomePlaying = false;

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function activeAction() {
  return state.actions.find((action) => action.id === state.activeId) || null;
}

function activeSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId) || null;
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
  actionList.innerHTML = actions.length ? actions.map((action) => `
    <button class="action-item ${action.id === state.activeId ? "active" : ""}" type="button" data-action="${action.id}">
      <strong>${action.name}</strong>
      <span>${action.tags || "无标签"} · ${action.frames.length}个关键帧</span>
    </button>
  `).join("") : "<p>还没有动作条目。</p>";
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
    mediaBox.innerHTML = "<p>选择或新建一个水袖动作</p>";
    timeline.innerHTML = "<p>暂无关键帧。</p>";
    mirrorPane.innerHTML = "<p>暂无对照内容。</p>";
    frameForm.style.display = "none";
    renderActionHistory();
    return;
  }

  frameForm.style.display = "block";
  if (action.media?.src) {
    const isVideo = action.media.type.startsWith("video/");
    mediaBox.innerHTML = isVideo
      ? `<video src="${action.media.src}" controls></video>`
      : `<img src="${action.media.src}" alt="${action.name}练习素材">`;
  } else {
    mediaBox.innerHTML = `<p>${action.name}还没有上传练习素材</p>`;
  }

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
  const id = event.target.closest("[data-action]")?.dataset.action;
  if (!id) return;
  state.activeId = id;
  save();
  renderAll();
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

window.addEventListener("beforeunload", () => {
  stopTimer();
  stopMetronome();
});

renderAll();
