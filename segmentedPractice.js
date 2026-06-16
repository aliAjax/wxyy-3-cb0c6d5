const SegmentedPractice = (function () {
  const STORAGE_KEY = "wxyy-3-segmented-practice";
  const SEGMENT_TYPE = "segmented";

  let state = {
    generatedPlans: [],
    activePlanId: null,
    isGenerating: false,
  };

  let modalEventsBound = false;

  function init() {
    load();
    bindEvents();
  }

  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        state.generatedPlans = parsed.generatedPlans || [];
        state.activePlanId = parsed.activePlanId || null;
      }
    } catch (e) {
      console.warn("分段练习数据加载失败:", e);
    }
    if (!Array.isArray(state.generatedPlans)) state.generatedPlans = [];
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        generatedPlans: state.generatedPlans,
        activePlanId: state.activePlanId,
      }));
    } catch (e) {
      console.warn("分段练习数据保存失败:", e);
    }
  }

  function getActivePlan() {
    return state.generatedPlans.find((p) => p.id === state.activePlanId) || null;
  }

  function getPlanById(planId) {
    return state.generatedPlans.find((p) => p.id === planId) || null;
  }

  function getAllPlans() {
    return [...state.generatedPlans];
  }

  function setActivePlan(planId) {
    state.activePlanId = planId;
    save();
  }

  function deletePlan(planId) {
    state.generatedPlans = state.generatedPlans.filter((p) => p.id !== planId);
    if (state.activePlanId === planId) {
      state.activePlanId = null;
    }
    save();
    renderGeneratorModal();
  }

  function getActionFrames(actionId) {
    const appState = window.__appState;
    if (!appState) return [];
    const action = appState.actions?.find((a) => a.id === actionId);
    if (!action || !Array.isArray(action.frames)) return [];
    return [...action.frames].sort((a, b) => {
      const timeA = StoryboardTimeline.parseTimeString(a.time);
      const timeB = StoryboardTimeline.parseTimeString(b.time);
      if (timeA == null && timeB == null) return 0;
      if (timeA == null) return 1;
      if (timeB == null) return -1;
      return timeA - timeB;
    });
  }

  function getLowScoreDimensions(actionId) {
    if (typeof ReviewScoring === "undefined") return [];
    const scores = ReviewScoring.getScoresForAction(actionId);
    if (!scores.length) return [];

    const dimensions = ReviewScoring.DIMENSIONS || [];
    const dimensionAvgs = dimensions.map((dim) => {
      const avg = ReviewScoring.calcDimensionAverage(scores, dim.key);
      return { key: dim.key, label: dim.label, avg: avg ?? 5 };
    });

    const sorted = dimensionAvgs
      .filter((d) => d.avg < 3.5)
      .sort((a, b) => a.avg - b.avg);

    return sorted;
  }

  function splitFramesIntoSegments(frames, beats, targetSegments = 3) {
    if (!frames.length) return [];
    if (frames.length <= targetSegments || targetSegments <= 1) {
      return [{ frameIds: frames.map((f) => f.id), startBeat: 0, beats: beats }];
    }

    const segments = [];
    const framesPerSegment = Math.ceil(frames.length / targetSegments);
    const beatsPerSegment = beats / targetSegments;

    for (let i = 0; i < targetSegments; i++) {
      const startIdx = i * framesPerSegment;
      const endIdx = Math.min(startIdx + framesPerSegment, frames.length);
      const segmentFrames = frames.slice(startIdx, endIdx);
      if (!segmentFrames.length) break;

      segments.push({
        frameIds: segmentFrames.map((f) => f.id),
        startBeat: Math.round(i * beatsPerSegment),
        beats: Math.round(beatsPerSegment),
      });
    }

    return segments;
  }

  function generateSegmentName(actionName, segmentIndex, totalSegments, focusDimensions) {
    const ordinalNames = ["第一段", "第二段", "第三段", "第四段", "第五段", "第六段"];
    const segmentLabel = ordinalNames[segmentIndex] || `第${segmentIndex + 1}段`;

    let focusLabel = "";
    if (focusDimensions && focusDimensions.length) {
      focusLabel = ` · 重点:${focusDimensions.slice(0, 2).map((d) => d.label).join("、")}`;
    }

    return `${actionName} - ${segmentLabel}${focusLabel}`;
  }

  function generatePracticeGoal(actionName, segmentIndex, totalSegments, focusDimensions, beats) {
    const goals = [];

    goals.push(`掌握${beats}拍的节奏配合`);

    if (focusDimensions && focusDimensions.length) {
      focusDimensions.slice(0, 2).forEach((dim) => {
        goals.push(`加强「${dim.label}」`);
      });
    }

    return goals.join("；");
  }

  function generatePlan(params) {
    const {
      choreographyId,
      selectedItemIds = [],
      targetSegmentsPerAction = 2,
      focusOnLowScore = true,
      startDate = null,
      sessionsPerDay = 1,
    } = params;

    const choreos = window.Choreography?.getState?.()?.choreographies || window.__appState?.choreographies || [];
    const choreo = choreos.find((c) => c.id === choreographyId);
    if (!choreo) {
      showToast("未找到对应的编排", "error");
      return null;
    }

    const items = selectedItemIds.length
      ? choreo.items.filter((item) => selectedItemIds.includes(item.id))
      : [...choreo.items];

    if (!items.length) {
      showToast("没有选中的动作项", "error");
      return null;
    }

    const sortedItems = [...items].sort((a, b) => a.order - b.order);

    const segments = [];
    let globalSegmentIndex = 0;

    sortedItems.forEach((item, itemIdx) => {
      const actionName = item.actionSnapshotName || "未知动作";
      const frames = getActionFrames(item.actionId);
      const lowScoreDims = focusOnLowScore ? getLowScoreDimensions(item.actionId) : [];

      const targetSegs = Math.max(1, Math.min(targetSegmentsPerAction, Math.max(1, Math.floor(frames.length / 2)) || 1));
      const frameSegments = splitFramesIntoSegments(frames, item.beats, targetSegs);

      frameSegments.forEach((fs, segIdx) => {
        const segmentFrames = frames.filter((f) => fs.frameIds.includes(f.id));
        const focusDims = lowScoreDims.slice(segIdx, segIdx + 2);

        const segment = {
          id: crypto.randomUUID(),
          choreoItemId: item.id,
          actionId: item.actionId,
          actionSnapshotName: actionName,
          segmentIndex: globalSegmentIndex,
          itemSegmentIndex: segIdx,
          segmentName: generateSegmentName(actionName, segIdx, frameSegments.length, focusDims),
          frameIds: fs.frameIds,
          frames: segmentFrames.map((f) => ({ ...f })),
          beats: fs.beats,
          startBeat: item.startBeat != null ? item.startBeat + fs.startBeat : fs.startBeat,
          focusDimensions: focusDims,
          goal: generatePracticeGoal(actionName, segIdx, frameSegments.length, focusDims, fs.beats),
          note: item.transitionHint || item.note || "",
          order: globalSegmentIndex,
        };

        segments.push(segment);
        globalSegmentIndex++;
      });
    });

    const plan = {
      id: crypto.randomUUID(),
      choreographyId: choreo.id,
      choreographyName: choreo.name,
      segments: segments,
      totalSegments: segments.length,
      selectedItemIds: sortedItems.map((i) => i.id),
      params: {
        targetSegmentsPerAction,
        focusOnLowScore,
        sessionsPerDay,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (startDate) {
      plan.scheduledDates = generateScheduleDates(segments.length, startDate, sessionsPerDay);
    }

    state.generatedPlans.unshift(plan);
    state.activePlanId = plan.id;
    save();

    return plan;
  }

  function generateScheduleDates(totalSegments, startDateKey, sessionsPerDay = 1) {
    const dates = [];
    const startDate = new Date(startDateKey);
    let currentDate = new Date(startDate);
    let sessionCount = 0;

    for (let i = 0; i < totalSegments; i++) {
      dates.push(formatDateKey(currentDate));
      sessionCount++;
      if (sessionCount >= sessionsPerDay) {
        sessionCount = 0;
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    return dates;
  }

  function formatDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function updateSegment(planId, segmentId, updates) {
    const plan = getPlanById(planId);
    if (!plan) return null;

    const segment = plan.segments.find((s) => s.id === segmentId);
    if (!segment) return null;

    Object.assign(segment, updates);
    plan.updatedAt = new Date().toISOString();
    save();
    return segment;
  }

  function reorderSegment(planId, segmentId, newIndex) {
    const plan = getPlanById(planId);
    if (!plan) return null;

    const currentIndex = plan.segments.findIndex((s) => s.id === segmentId);
    if (currentIndex === -1) return null;

    const [segment] = plan.segments.splice(currentIndex, 1);
    plan.segments.splice(newIndex, 0, segment);

    plan.segments.forEach((s, idx) => {
      s.order = idx;
      s.segmentIndex = idx;
    });

    plan.updatedAt = new Date().toISOString();
    save();
    return plan;
  }

  function addSegment(planId, afterSegmentId = null) {
    const plan = getPlanById(planId);
    if (!plan) return null;

    const newSegment = {
      id: crypto.randomUUID(),
      choreoItemId: null,
      actionId: null,
      actionSnapshotName: "新增分段",
      segmentIndex: plan.segments.length,
      itemSegmentIndex: 0,
      segmentName: "新增分段",
      frameIds: [],
      frames: [],
      beats: 8,
      startBeat: 0,
      focusDimensions: [],
      goal: "",
      note: "",
      order: plan.segments.length,
    };

    if (afterSegmentId) {
      const idx = plan.segments.findIndex((s) => s.id === afterSegmentId);
      if (idx !== -1) {
        plan.segments.splice(idx + 1, 0, newSegment);
      } else {
        plan.segments.push(newSegment);
      }
    } else {
      plan.segments.push(newSegment);
    }

    plan.segments.forEach((s, idx) => {
      s.order = idx;
      s.segmentIndex = idx;
    });

    plan.totalSegments = plan.segments.length;
    plan.updatedAt = new Date().toISOString();
    save();
    return newSegment;
  }

  function removeSegment(planId, segmentId) {
    const plan = getPlanById(planId);
    if (!plan) return false;

    const beforeLen = plan.segments.length;
    plan.segments = plan.segments.filter((s) => s.id !== segmentId);

    if (plan.segments.length !== beforeLen) {
      plan.segments.forEach((s, idx) => {
        s.order = idx;
        s.segmentIndex = idx;
      });
      plan.totalSegments = plan.segments.length;
      plan.updatedAt = new Date().toISOString();
      save();
      return true;
    }
    return false;
  }

  function getExistingPlansForChoreo(choreoId) {
    if (!window.PracticeCalendar || typeof window.PracticeCalendar.getPlansByRef !== "function") {
      return [];
    }
    return window.PracticeCalendar.getPlansByRef(choreoId, "choreography") || [];
  }

  function checkForDuplicates(planId, startDate, sessionsPerDay = 1) {
    const plan = getPlanById(planId);
    if (!plan || !window.PracticeCalendar) return { duplicates: [], conflicts: [] };

    const duplicates = [];
    const conflicts = [];
    const scheduledDates = plan.scheduledDates || generateScheduleDates(plan.segments.length, startDate, sessionsPerDay);

    const existingPlans = window.PracticeCalendar.getAllPlans
      ? window.PracticeCalendar.getAllPlans()
      : [];

    plannedSegments: for (let i = 0; i < plan.segments.length; i++) {
      const seg = plan.segments[i];
      const dateKey = scheduledDates[i] || scheduledDates[scheduledDates.length - 1];

      for (const existing of existingPlans) {
        if (existing.date !== dateKey) continue;
        if (existing.type === SEGMENT_TYPE && existing.segmentId === seg.id) {
          duplicates.push({ segmentId: seg.id, date: dateKey, existingPlanId: existing.id });
          continue plannedSegments;
        }
        if (existing.refId === seg.actionId) {
          conflicts.push({ segmentId: seg.id, date: dateKey, existingPlanId: existing.id, existingType: existing.type });
        }
      }
    }

    return { duplicates, conflicts };
  }

  function writeToCalendar(planId, options = {}) {
    const plan = getPlanById(planId);
    if (!plan || !window.PracticeCalendar) {
      showToast("无法写入日历", "error");
      return [];
    }

    const {
      startDate = null,
      sessionsPerDay = 1,
      skipDuplicates = true,
      skipConflicts = false,
    } = options;

    const targetStartDate = startDate || plan.scheduledDates?.[0] || formatDateKey(new Date());
    const scheduledDates = generateScheduleDates(plan.segments.length, targetStartDate, sessionsPerDay);

    const createdPlans = [];
    const skipped = [];

    const existingPlans = window.PracticeCalendar.getAllPlans
      ? window.PracticeCalendar.getAllPlans()
      : [];

    plan.segments.forEach((seg, idx) => {
      const dateKey = scheduledDates[idx] || scheduledDates[scheduledDates.length - 1];

      const isDuplicate = existingPlans.some((p) =>
        p.type === SEGMENT_TYPE && p.segmentId === seg.id && p.date === dateKey
      );

      if (skipDuplicates && isDuplicate) {
        skipped.push({ segmentId: seg.id, reason: "duplicate" });
        return;
      }

      const hasConflict = existingPlans.some((p) =>
        p.date === dateKey && p.refId === seg.actionId && p.type !== SEGMENT_TYPE
      );

      if (skipConflicts && hasConflict) {
        skipped.push({ segmentId: seg.id, reason: "conflict" });
        return;
      }

      const calendarPlan = window.PracticeCalendar.createPlan({
        date: dateKey,
        type: SEGMENT_TYPE,
        refId: seg.actionId,
        refName: seg.actionSnapshotName,
        goal: seg.goal,
        note: seg.segmentName,
        segmentId: seg.id,
        segmentedPlanId: plan.id,
        segmentIndex: seg.segmentIndex,
        frameIds: seg.frameIds,
        focusDimensions: seg.focusDimensions,
        completed: false,
      });

      if (calendarPlan) {
        createdPlans.push(calendarPlan);
      }
    });

    if (createdPlans.length > 0) {
      showToast(`已成功写入 ${createdPlans.length} 个分段练习计划到日历`, "success");
    }
    if (skipped.length > 0) {
      showToast(`跳过 ${skipped.length} 个重复/冲突的计划`, "info");
    }

    return createdPlans;
  }

  function openGeneratorModal(choreographyId = null, selectedItemIds = []) {
    const modal = document.getElementById("segmentedPracticeModal");
    if (!modal) {
      console.warn("分段练习模态框不存在");
      return;
    }

    state._pendingChoreoId = choreographyId;
    state._pendingItemIds = [...selectedItemIds];

    modal.hidden = false;
    renderGeneratorModal();
  }

  function closeGeneratorModal() {
    const modal = document.getElementById("segmentedPracticeModal");
    if (modal) modal.hidden = true;
  }

  function renderGeneratorModal() {
    const modal = document.getElementById("segmentedPracticeModal");
    if (!modal || modal.hidden) return;

    const activePlan = getActivePlan();
    const contentEl = document.getElementById("segmentedGeneratorContent");
    if (!contentEl) return;

    if (!activePlan) {
      contentEl.innerHTML = renderGeneratorForm();
    } else {
      contentEl.innerHTML = renderPlanPreview(activePlan);
    }

    bindGeneratorEvents();
  }

  function renderGeneratorForm() {
    const choreos = window.Choreography?.getState?.()?.choreographies || window.__appState?.choreographies || [];
    const pendingChoreoId = state._pendingChoreoId;
    const pendingItemIds = state._pendingItemIds || [];

    const choreo = choreos.find((c) => c.id === pendingChoreoId);

    let itemsHtml = "";
    if (choreo) {
      const sortedItems = [...choreo.items].sort((a, b) => a.order - b.order);
      itemsHtml = sortedItems.map((item) => {
        const checked = pendingItemIds.length === 0 || pendingItemIds.includes(item.id);
        return `
          <label class="seg-item-check">
            <input type="checkbox" name="segItemIds" value="${item.id}" ${checked ? "checked" : ""}>
            <span class="seg-item-name">${escapeHtml(item.actionSnapshotName || "未知动作")}</span>
            <span class="seg-item-beats">${item.beats} 拍</span>
          </label>
        `;
      }).join("");
    } else {
      itemsHtml = `<p class="muted">请先选择一个编排</p>`;
    }

    return `
      <div class="seg-form">
        <h3>生成分段练习方案</h3>
        <p class="muted">基于编排动作、关键帧和复盘低分维度，智能生成一组循序渐进的分段练习课次。</p>

        <div class="seg-form-section">
          <label>
            编排
            <select id="segChoreoSelect">
              <option value="">请选择编排</option>
              ${choreos.map((c) => `
                <option value="${c.id}" ${c.id === pendingChoreoId ? "selected" : ""}>${escapeHtml(c.name)}</option>
              `).join("")}
            </select>
          </label>
        </div>

        <div class="seg-form-section">
          <h4>选择动作项</h4>
          <div class="seg-item-list">
            ${itemsHtml || '<p class="muted">该编排暂无动作项</p>'}
          </div>
        </div>

        <div class="seg-form-section">
          <div class="seg-form-row">
            <label>
              每动作分段数
              <input type="number" id="segTargetCount" min="1" max="6" value="2">
            </label>
            <label>
              每天课次数
              <input type="number" id="segSessionsPerDay" min="1" max="4" value="1">
            </label>
          </div>
        </div>

        <div class="seg-form-section">
          <label class="seg-check-label">
            <input type="checkbox" id="segFocusLowScore" checked>
            <span>重点关注复盘低分维度</span>
          </label>
        </div>

        <div class="seg-form-section">
          <label>
            开始日期
            <input type="date" id="segStartDate" value="${formatDateKey(new Date())}">
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-seg-modal>取消</button>
          <button type="button" class="btn-accent" id="segGenerateBtn">生成分段方案</button>
        </div>
      </div>
    `;
  }

  function renderPlanPreview(plan) {
    const sortedSegments = [...plan.segments].sort((a, b) => a.order - b.order);
    const scheduledDates = plan.scheduledDates || [];

    const segmentsHtml = sortedSegments.map((seg, idx) => {
      const dateKey = scheduledDates[idx] || "未安排";
      const frameCount = seg.frames?.length || seg.frameIds?.length || 0;
      const focusLabels = seg.focusDimensions?.map((d) => d.label).join("、") || "无";

      return `
        <div class="seg-preview-card" data-segment-id="${seg.id}">
          <div class="seg-card-head">
            <span class="seg-num">${idx + 1}</span>
            <div class="seg-card-title">
              <strong>${escapeHtml(seg.segmentName)}</strong>
              <span class="seg-card-meta">${seg.beats} 拍 · ${frameCount} 个关键帧</span>
            </div>
            <div class="seg-card-actions">
              <button type="button" class="btn-small btn-secondary" data-seg-edit="${seg.id}">编辑</button>
              <button type="button" class="btn-small btn-danger" data-seg-remove="${seg.id}">删除</button>
            </div>
          </div>
          <div class="seg-card-body">
            <div class="seg-card-info">
              <span class="seg-info-label">📅 日期:</span>
              <span class="seg-info-value">${dateKey}</span>
            </div>
            <div class="seg-card-info">
              <span class="seg-info-label">🎯 目标:</span>
              <span class="seg-info-value">${escapeHtml(seg.goal || "未设置")}</span>
            </div>
            <div class="seg-card-info">
              <span class="seg-info-label">⭐ 重点维度:</span>
              <span class="seg-info-value">${focusLabels}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="seg-preview">
        <div class="seg-preview-head">
          <div>
            <h3>${escapeHtml(plan.choreographyName)} - 分段练习方案</h3>
            <p class="muted">共 ${sortedSegments.length} 个分段 · 生成于 ${new Date(plan.createdAt).toLocaleDateString()}</p>
          </div>
          <button type="button" class="btn-small btn-secondary" id="segBackToFormBtn">重新生成</button>
        </div>

        <div class="seg-preview-toolbar">
          <button type="button" class="btn-small" id="segAddSegmentBtn">+ 添加分段</button>
          <span class="muted">拖拽或使用按钮调整顺序</span>
        </div>

        <div class="seg-preview-list">
          ${segmentsHtml || '<p class="muted">暂无分段</p>'}
        </div>

        <div class="seg-preview-summary">
          <div class="seg-summary-item">
            <span class="seg-summary-label">总分段数</span>
            <span class="seg-summary-value">${sortedSegments.length}</span>
          </div>
          <div class="seg-summary-item">
            <span class="seg-summary-label">预计天数</span>
            <span class="seg-summary-value">${Math.ceil(sortedSegments.length / (plan.params?.sessionsPerDay || 1))} 天</span>
          </div>
          <div class="seg-summary-item">
            <span class="seg-summary-label">总拍数</span>
            <span class="seg-summary-value">${sortedSegments.reduce((sum, s) => sum + s.beats, 0)} 拍</span>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-seg-modal>取消</button>
          <button type="button" class="btn-accent" id="segWriteCalendarBtn">📅 写入练习日历</button>
        </div>
      </div>
    `;
  }

  function bindEvents() {
    if (modalEventsBound) return;
    modalEventsBound = true;

    const modal = document.getElementById("segmentedPracticeModal");
    if (!modal) return;

    modal.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-close-seg-modal") || e.target === modal) {
        closeGeneratorModal();
      }
    });
  }

  function bindGeneratorEvents() {
    const generateBtn = document.getElementById("segGenerateBtn");
    if (generateBtn) {
      generateBtn.addEventListener("click", handleGenerate);
    }

    const backBtn = document.getElementById("segBackToFormBtn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        state.activePlanId = null;
        save();
        renderGeneratorModal();
      });
    }

    const writeBtn = document.getElementById("segWriteCalendarBtn");
    if (writeBtn) {
      writeBtn.addEventListener("click", handleWriteToCalendar);
    }

    const editBtns = document.querySelectorAll("[data-seg-edit]");
    editBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const segId = e.target.dataset.segEdit;
        openSegmentEditor(segId);
      });
    });

    const removeBtns = document.querySelectorAll("[data-seg-remove]");
    removeBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const segId = e.target.dataset.segRemove;
        if (confirm("确定删除这个分段吗？")) {
          const plan = getActivePlan();
          if (plan) {
            removeSegment(plan.id, segId);
            renderGeneratorModal();
          }
        }
      });
    });

    const addSegBtn = document.getElementById("segAddSegmentBtn");
    if (addSegBtn) {
      addSegBtn.addEventListener("click", () => {
        const plan = getActivePlan();
        if (plan) {
          addSegment(plan.id);
          renderGeneratorModal();
        }
      });
    }

    const choreoSelect = document.getElementById("segChoreoSelect");
    if (choreoSelect) {
      choreoSelect.addEventListener("change", (e) => {
        state._pendingChoreoId = e.target.value;
        state._pendingItemIds = [];
        renderGeneratorModal();
      });
    }
  }

  function handleGenerate() {
    const choreoSelect = document.getElementById("segChoreoSelect");
    const targetCountInput = document.getElementById("segTargetCount");
    const sessionsPerDayInput = document.getElementById("segSessionsPerDay");
    const focusLowScoreInput = document.getElementById("segFocusLowScore");
    const startDateInput = document.getElementById("segStartDate");
    const itemCheckboxes = document.querySelectorAll('input[name="segItemIds"]:checked');

    const choreographyId = choreoSelect?.value;
    if (!choreographyId) {
      showToast("请选择一个编排", "error");
      return;
    }

    const selectedItemIds = Array.from(itemCheckboxes).map((cb) => cb.value);
    if (!selectedItemIds.length) {
      showToast("请至少选择一个动作项", "error");
      return;
    }

    const targetSegments = parseInt(targetCountInput?.value, 10) || 2;
    const sessionsPerDay = parseInt(sessionsPerDayInput?.value, 10) || 1;
    const focusOnLowScore = focusLowScoreInput?.checked ?? true;
    const startDate = startDateInput?.value || formatDateKey(new Date());

    const plan = generatePlan({
      choreographyId,
      selectedItemIds,
      targetSegmentsPerAction: targetSegments,
      focusOnLowScore,
      sessionsPerDay,
      startDate,
    });

    if (plan) {
      renderGeneratorModal();
    }
  }

  function handleWriteToCalendar() {
    const plan = getActivePlan();
    if (!plan) return;

    const startDateInput = document.getElementById("segStartDate");
    const startDate = startDateInput?.value || plan.scheduledDates?.[0] || formatDateKey(new Date());
    const sessionsPerDay = plan.params?.sessionsPerDay || 1;

    const { duplicates, conflicts } = checkForDuplicates(plan.id, startDate, sessionsPerDay);

    let message = `确认将 ${plan.segments.length} 个分段练习计划写入日历？\n\n`;
    message += `开始日期: ${startDate}\n`;
    message += `每天课次: ${sessionsPerDay} 节\n`;
    if (duplicates.length) message += `\n⚠ 发现 ${duplicates.length} 个重复计划（将跳过）`;
    if (conflicts.length) message += `\n⚠ 发现 ${conflicts.length} 个同日同动作的其他计划`;

    if (!confirm(message)) return;

    const created = writeToCalendar(plan.id, {
      startDate,
      sessionsPerDay,
      skipDuplicates: true,
      skipConflicts: false,
    });

    if (created.length > 0) {
      closeGeneratorModal();
      if (typeof window.PracticeCalendar?.renderAll === "function") {
        window.PracticeCalendar.renderAll();
      }
    }
  }

  function openSegmentEditor(segmentId) {
    const plan = getActivePlan();
    if (!plan) return;

    const segment = plan.segments.find((s) => s.id === segmentId);
    if (!segment) return;

    const newName = prompt("编辑分段名称:", segment.segmentName);
    if (newName != null && newName.trim()) {
      updateSegment(plan.id, segmentId, { segmentName: newName.trim() });
      renderGeneratorModal();
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

  function showToast(msg, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(msg, type);
    } else {
      console.log(`[${type}] ${msg}`);
    }
  }

  function startSegmentedSession(segmentId) {
    const plan = findPlanBySegmentId(segmentId);
    if (!plan) return null;

    const segment = plan.segments.find((s) => s.id === segmentId);
    if (!segment) return null;

    const appState = window.__appState;
    if (!appState) return null;

    const session = {
      id: crypto.randomUUID(),
      actionId: segment.actionId,
      actionSnapshotName: segment.actionSnapshotName,
      selectedFrameIds: segment.frameIds,
      selectedFrames: segment.frames.map((f) => ({ ...f })),
      startTime: new Date().toISOString(),
      duration: 0,
      tempoBPM: 80,
      status: "in_progress",
      reviewNote: "",
      isSegmented: true,
      segmentId: segment.id,
      segmentedPlanId: plan.id,
      segmentIndex: segment.segmentIndex,
      totalSegments: plan.totalSegments,
      segmentName: segment.segmentName,
      focusDimensions: segment.focusDimensions,
    };

    if (!Array.isArray(appState.sessions)) appState.sessions = [];
    appState.sessions.unshift(session);
    appState.activeSessionId = session.id;

    if (typeof window.__saveAppState === "function") {
      window.__saveAppState();
    }

    return session;
  }

  function findPlanBySegmentId(segmentId) {
    return state.generatedPlans.find((p) =>
      p.segments.some((s) => s.id === segmentId)
    ) || null;
  }

  function getNextSegment(segmentId) {
    const plan = findPlanBySegmentId(segmentId);
    if (!plan) return null;

    const currentIdx = plan.segments.findIndex((s) => s.id === segmentId);
    if (currentIdx === -1 || currentIdx >= plan.segments.length - 1) return null;

    return plan.segments[currentIdx + 1];
  }

  function getPrevSegment(segmentId) {
    const plan = findPlanBySegmentId(segmentId);
    if (!plan) return null;

    const currentIdx = plan.segments.findIndex((s) => s.id === segmentId);
    if (currentIdx <= 0) return null;

    return plan.segments[currentIdx - 1];
  }

  return {
    init,
    generatePlan,
    writeToCalendar,
    openGeneratorModal,
    closeGeneratorModal,
    getActivePlan,
    getPlanById,
    getAllPlans,
    setActivePlan,
    deletePlan,
    updateSegment,
    reorderSegment,
    addSegment,
    removeSegment,
    startSegmentedSession,
    getNextSegment,
    getPrevSegment,
    findPlanBySegmentId,
    SEGMENT_TYPE,
  };
})();
