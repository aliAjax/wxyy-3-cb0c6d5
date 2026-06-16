const SegmentedPractice = (function () {
  const escapeHtml = window.Utils.escapeHtml;
  const showToast = window.Utils.showToast;
  const formatDateKey = window.Utils.formatDateKey;

  const STORAGE_KEY = "wxyy-3-segmented-practice";
  const SEGMENT_TYPE = "segmented";

  let state = {
    generatedPlans: [],
    activePlanId: null,
    isGenerating: false,
    expandedSegmentId: null,
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

  function getAllDimensions() {
    if (typeof ReviewScoring !== "undefined" && ReviewScoring.DIMENSIONS) {
      return ReviewScoring.DIMENSIONS.map((d) => ({ key: d.key, label: d.label }));
    }
    return [
      { key: "centerStability", label: "重心稳定" },
      { key: "sleeveContinuity", label: "袖路连贯" },
      { key: "wristDirection", label: "腕部方向" },
      { key: "rhythmAlignment", label: "节奏贴合" },
      { key: "poseCompletion", label: "亮相完成度" },
    ];
  }

  function getLowScoreDimensions(actionId) {
    if (typeof ReviewScoring === "undefined") return [];
    const scores = ReviewScoring.getScoresForAction(actionId);
    if (!scores.length) return [];

    const dimensions = getAllDimensions();
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

  function updateSegment(planId, segmentId, updates) {
    const plan = getPlanById(planId);
    if (!plan) return null;

    const segment = plan.segments.find((s) => s.id === segmentId);
    if (!segment) return null;

    Object.assign(segment, updates);

    if (updates.frameIds && segment.actionId) {
      const allFrames = getActionFrames(segment.actionId);
      segment.frames = allFrames.filter((f) => updates.frameIds.includes(f.id)).map((f) => ({ ...f }));
    }

    plan.updatedAt = new Date().toISOString();
    save();
    return segment;
  }

  function reorderSegment(planId, segmentId, direction) {
    const plan = getPlanById(planId);
    if (!plan) return null;

    const currentIndex = plan.segments.findIndex((s) => s.id === segmentId);
    if (currentIndex === -1) return null;

    let newIndex = currentIndex;
    if (direction === "up" && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else if (direction === "down" && currentIndex < plan.segments.length - 1) {
      newIndex = currentIndex + 1;
    }

    if (newIndex === currentIndex) return plan;

    const [segment] = plan.segments.splice(currentIndex, 1);
    plan.segments.splice(newIndex, 0, segment);

    plan.segments.forEach((s, idx) => {
      s.order = idx;
      s.segmentIndex = idx;
    });

    if (plan.scheduledDates && plan.scheduledDates.length) {
      const sessionsPerDay = plan.params?.sessionsPerDay || 1;
      plan.scheduledDates = generateScheduleDates(plan.segments.length, plan.scheduledDates[0], sessionsPerDay);
    }

    plan.totalSegments = plan.segments.length;
    plan.updatedAt = new Date().toISOString();
    save();
    return plan;
  }

  function moveSegmentToDate(planId, segmentId, newDateKey) {
    const plan = getPlanById(planId);
    if (!plan || !plan.scheduledDates) return false;

    const seg = plan.segments.find((s) => s.id === segmentId);
    if (!seg) return false;

    plan.scheduledDates[seg.segmentIndex] = newDateKey;
    plan.updatedAt = new Date().toISOString();
    save();
    return true;
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

    if (plan.scheduledDates && plan.scheduledDates.length) {
      const sessionsPerDay = plan.params?.sessionsPerDay || 1;
      plan.scheduledDates = generateScheduleDates(plan.segments.length, plan.scheduledDates[0], sessionsPerDay);
    }

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

      if (plan.scheduledDates && plan.scheduledDates.length) {
        const sessionsPerDay = plan.params?.sessionsPerDay || 1;
        plan.scheduledDates = generateScheduleDates(plan.segments.length, plan.scheduledDates[0], sessionsPerDay);
      }

      if (state.expandedSegmentId === segmentId) {
        state.expandedSegmentId = null;
      }

      plan.totalSegments = plan.segments.length;
      plan.updatedAt = new Date().toISOString();
      save();
      return true;
    }
    return false;
  }

  function toggleSegmentExpand(segmentId) {
    state.expandedSegmentId = state.expandedSegmentId === segmentId ? null : segmentId;
    renderGeneratorModal();
  }

  function detectCrossGenerationConflicts(planId, startDate, sessionsPerDay = 1) {
    const plan = getPlanById(planId);
    if (!plan || !window.PracticeCalendar) {
      return { exactDuplicates: [], actionDateDuplicates: [], sameDayConflicts: [], allCalendarPlans: [] };
    }

    const scheduledDates = plan.scheduledDates || generateScheduleDates(plan.segments.length, startDate, sessionsPerDay);
    const existingPlans = window.PracticeCalendar.getAllPlans
      ? window.PracticeCalendar.getAllPlans()
      : [];

    const exactDuplicates = [];
    const actionDateDuplicates = [];
    const sameDayConflicts = [];

    plan.segments.forEach((seg, idx) => {
      const dateKey = scheduledDates[idx] || scheduledDates[scheduledDates.length - 1];

      existingPlans.forEach((existing) => {
        if (existing.date !== dateKey) return;

        if (existing.type === SEGMENT_TYPE && existing.segmentId === seg.id) {
          exactDuplicates.push({
            segmentId: seg.id,
            segmentName: seg.segmentName,
            date: dateKey,
            existingPlanId: existing.id,
            type: "exact",
          });
        }

        if (existing.type === SEGMENT_TYPE && existing.segmentedPlanId !== plan.id && existing.refId === seg.actionId) {
          const alreadyRecorded = actionDateDuplicates.some(
            (d) => d.segmentId === seg.id && d.date === dateKey
          );
          if (!alreadyRecorded) {
            actionDateDuplicates.push({
              segmentId: seg.id,
              segmentName: seg.segmentName,
              date: dateKey,
              existingPlanId: existing.id,
              existingPlanName: existing.note || existing.refName,
              type: "action-date",
            });
          }
        }

        if (existing.type !== SEGMENT_TYPE && existing.refId === seg.actionId) {
          const alreadyRecorded = sameDayConflicts.some(
            (c) => c.segmentId === seg.id && c.date === dateKey
          );
          if (!alreadyRecorded) {
            sameDayConflicts.push({
              segmentId: seg.id,
              segmentName: seg.segmentName,
              date: dateKey,
              existingPlanId: existing.id,
              existingPlanName: existing.refName,
              existingType: existing.type,
              type: "conflict",
            });
          }
        }
      });
    });

    return { exactDuplicates, actionDateDuplicates, sameDayConflicts, allCalendarPlans: existingPlans };
  }

  function checkForDuplicates(planId, startDate, sessionsPerDay = 1) {
    const { exactDuplicates, sameDayConflicts } = detectCrossGenerationConflicts(planId, startDate, sessionsPerDay);
    return { duplicates: exactDuplicates, conflicts: sameDayConflicts };
  }

  function getConflictSummary(planId, startDate, sessionsPerDay = 1) {
    const conflicts = detectCrossGenerationConflicts(planId, startDate, sessionsPerDay);
    const plan = getPlanById(planId);
    if (!plan) return null;

    const total = plan.segments.length;
    const exactDupCount = conflicts.exactDuplicates.length;
    const actionDateDupCount = conflicts.actionDateDuplicates.length;
    const conflictCount = conflicts.sameDayConflicts.length;

    return {
      total,
      exactDuplicateCount: exactDupCount,
      actionDateDuplicateCount: actionDateDupCount,
      conflictCount,
      willCreate: Math.max(0, total - exactDupCount - actionDateDupCount),
      ...conflicts,
    };
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
      skipExactDuplicates = true,
      skipActionDateDuplicates = true,
      skipConflicts = false,
    } = options;

    const targetStartDate = startDate || plan.scheduledDates?.[0] || formatDateKey(new Date());
    const scheduledDates = generateScheduleDates(plan.segments.length, targetStartDate, sessionsPerDay);

    const createdPlans = [];
    const skipped = [];
    const conflicts = detectCrossGenerationConflicts(planId, targetStartDate, sessionsPerDay);

    plan.segments.forEach((seg, idx) => {
      const dateKey = scheduledDates[idx] || scheduledDates[scheduledDates.length - 1];

      const isExactDup = conflicts.exactDuplicates.some(
        (d) => d.segmentId === seg.id && d.date === dateKey
      );
      if (skipExactDuplicates && isExactDup) {
        skipped.push({ segmentId: seg.id, segmentName: seg.segmentName, date: dateKey, reason: "exact" });
        return;
      }

      const isActionDateDup = conflicts.actionDateDuplicates.some(
        (d) => d.segmentId === seg.id && d.date === dateKey
      );
      if (skipActionDateDuplicates && isActionDateDup) {
        skipped.push({ segmentId: seg.id, segmentName: seg.segmentName, date: dateKey, reason: "action-date" });
        return;
      }

      const hasConflict = conflicts.sameDayConflicts.some(
        (c) => c.segmentId === seg.id && c.date === dateKey
      );
      if (skipConflicts && hasConflict) {
        skipped.push({ segmentId: seg.id, segmentName: seg.segmentName, date: dateKey, reason: "conflict" });
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
      const reasons = {};
      skipped.forEach((s) => {
        reasons[s.reason] = (reasons[s.reason] || 0) + 1;
      });
      const reasonMsgs = [];
      if (reasons.exact) reasonMsgs.push(`${reasons.exact}个完全重复`);
      if (reasons["action-date"]) reasonMsgs.push(`${reasons["action-date"]}个同日同动作`);
      if (reasons.conflict) reasonMsgs.push(`${reasons.conflict}个与其他计划冲突`);
      showToast(`跳过 ${skipped.length} 个计划：${reasonMsgs.join("，")}`, "info");
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
    state.expandedSegmentId = null;

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
        const frames = getActionFrames(item.actionId);
        return `
          <label class="seg-item-check">
            <input type="checkbox" name="segItemIds" value="${item.id}" ${checked ? "checked" : ""}>
            <span class="seg-item-name">${escapeHtml(item.actionSnapshotName || "未知动作")}</span>
            <span class="seg-item-beats">${item.beats} 拍 · ${frames.length} 帧</span>
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
    const summary = getConflictSummary(plan.id, scheduledDates[0] || formatDateKey(new Date()), plan.params?.sessionsPerDay || 1);

    const segmentsHtml = sortedSegments.map((seg, idx) => {
      const dateKey = scheduledDates[idx] || "未安排";
      const frameCount = seg.frames?.length || seg.frameIds?.length || 0;
      const isExpanded = state.expandedSegmentId === seg.id;
      const hasExactDup = summary?.exactDuplicates.some((d) => d.segmentId === seg.id && d.date === dateKey);
      const hasActionDup = summary?.actionDateDuplicates.some((d) => d.segmentId === seg.id && d.date === dateKey);
      const hasConflict = summary?.sameDayConflicts.some((c) => c.segmentId === seg.id && c.date === dateKey);

      let statusBadge = "";
      if (hasExactDup) {
        statusBadge = '<span class="seg-status-badge status-duplicate">完全重复</span>';
      } else if (hasActionDup) {
        statusBadge = '<span class="seg-status-badge status-warning">同日同动作</span>';
      } else if (hasConflict) {
        statusBadge = '<span class="seg-status-badge status-info">有冲突</span>';
      }

      return `
        <div class="seg-preview-card ${isExpanded ? "expanded" : ""}" data-segment-id="${seg.id}">
          <div class="seg-card-head" data-seg-toggle="${seg.id}">
            <span class="seg-num">${idx + 1}</span>
            <div class="seg-card-title">
              <strong>${escapeHtml(seg.segmentName)}</strong>
              <span class="seg-card-meta">${seg.beats} 拍 · ${frameCount} 个关键帧${statusBadge ? " · " + statusBadge : ""}</span>
            </div>
            <div class="seg-card-actions">
              <button type="button" class="btn-small btn-secondary" data-seg-up="${seg.id}" ${idx === 0 ? "disabled" : ""} title="上移">↑</button>
              <button type="button" class="btn-small btn-secondary" data-seg-down="${seg.id}" ${idx === sortedSegments.length - 1 ? "disabled" : ""} title="下移">↓</button>
              <button type="button" class="btn-small btn-secondary" data-seg-toggle="${seg.id}">${isExpanded ? "收起" : "编辑"}</button>
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
          </div>
          ${isExpanded ? renderSegmentEditor(seg, dateKey) : ""}
        </div>
      `;
    }).join("");

    const conflictSummaryHtml = summary && (summary.exactDuplicates.length > 0 || summary.actionDateDuplicates.length > 0 || summary.sameDayConflicts.length > 0)
      ? `
        <div class="seg-conflict-summary">
          <h4>⚠ 冲突检测结果</h4>
          <div class="seg-conflict-list">
            ${summary.exactDuplicates.length > 0 ? `
              <div class="seg-conflict-item status-duplicate">
                <span class="seg-conflict-count">${summary.exactDuplicates.length}</span>
                <span class="seg-conflict-label">个完全重复计划（将跳过）</span>
              </div>
            ` : ""}
            ${summary.actionDateDuplicates.length > 0 ? `
              <div class="seg-conflict-item status-warning">
                <span class="seg-conflict-count">${summary.actionDateDuplicates.length}</span>
                <span class="seg-conflict-label">个同日同动作的其他分段</span>
              </div>
            ` : ""}
            ${summary.sameDayConflicts.length > 0 ? `
              <div class="seg-conflict-item status-info">
                <span class="seg-conflict-count">${summary.sameDayConflicts.length}</span>
                <span class="seg-conflict-label">个与普通计划冲突</span>
              </div>
            ` : ""}
          </div>
        </div>
      `
      : "";

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
          <div class="seg-toolbar-spacer"></div>
          <label class="seg-date-label">
            开始日期
            <input type="date" id="segPreviewStartDate" value="${scheduledDates[0] || formatDateKey(new Date())}">
          </label>
          <label class="seg-day-rate-label">
            每天
            <select id="segPreviewSessionsPerDay">
              ${[1,2,3,4].map((n) => `<option value="${n}" ${(plan.params?.sessionsPerDay || 1) === n ? "selected" : ""}>${n} 节</option>`).join("")}
            </select>
          </label>
        </div>

        ${conflictSummaryHtml}

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
          <div class="seg-summary-item seg-summary-success">
            <span class="seg-summary-label">将写入</span>
            <span class="seg-summary-value">${summary?.willCreate ?? sortedSegments.length} 条</span>
          </div>
        </div>

        <div class="seg-write-options">
          <label class="seg-check-label">
            <input type="checkbox" id="segSkipExactDup" checked>
            <span>跳过完全重复的计划</span>
          </label>
          <label class="seg-check-label">
            <input type="checkbox" id="segSkipActionDateDup" checked>
            <span>跳过同日同动作的其他分段</span>
          </label>
          <label class="seg-check-label">
            <input type="checkbox" id="segSkipConflicts">
            <span>跳过与普通计划冲突的</span>
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-seg-modal>取消</button>
          <button type="button" class="btn-accent" id="segWriteCalendarBtn">📅 写入练习日历</button>
        </div>
      </div>
    `;
  }

  function renderSegmentEditor(seg, dateKey) {
    const allFrames = seg.actionId ? getActionFrames(seg.actionId) : [];
    const allDims = getAllDimensions();
    const allActions = getAvailableActions();

    const framesHtml = allFrames.length
      ? allFrames.map((f) => {
          const checked = seg.frameIds.includes(f.id);
          return `
            <label class="seg-frame-check">
              <input type="checkbox" name="segFrameIds" value="${f.id}" ${checked ? "checked" : ""} data-seg-frame="${seg.id}">
              <span class="seg-frame-name">${escapeHtml(f.stage || "未命名")} · ${f.time || "无时间"}</span>
            </label>
          `;
        }).join("")
      : '<p class="muted">该动作没有关键帧</p>';

    const dimsHtml = allDims.map((d) => {
      const checked = seg.focusDimensions?.some((fd) => fd.key === d.key);
      return `
        <label class="seg-dim-check">
          <input type="checkbox" name="segFocusDims" value="${d.key}" ${checked ? "checked" : ""} data-seg-dim="${seg.id}">
          <span>${escapeHtml(d.label)}</span>
        </label>
      `;
    }).join("");

    const actionsHtml = allActions.map((a) => `
      <option value="${a.id}" ${seg.actionId === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>
    `).join("");

    return `
      <div class="seg-editor">
        <div class="seg-editor-row">
          <label class="seg-editor-label">分段名称</label>
          <input type="text" class="seg-editor-input" id="segName_${seg.id}" value="${escapeHtml(seg.segmentName)}">
        </div>

        <div class="seg-editor-row">
          <label class="seg-editor-label">关联动作</label>
          <select class="seg-editor-select" id="segAction_${seg.id}" data-seg-action="${seg.id}">
            <option value="">未关联</option>
            ${actionsHtml}
          </select>
        </div>

        <div class="seg-editor-row seg-editor-grid">
          <label class="seg-editor-label">拍数</label>
          <input type="number" class="seg-editor-input" id="segBeats_${seg.id}" min="1" max="64" value="${seg.beats || 8}">
          <label class="seg-editor-label">日期</label>
          <input type="date" class="seg-editor-input" id="segDate_${seg.id}" value="${dateKey}">
        </div>

        <div class="seg-editor-row">
          <label class="seg-editor-label">练习目标</label>
          <input type="text" class="seg-editor-input" id="segGoal_${seg.id}" value="${escapeHtml(seg.goal || "")}" placeholder="例如：掌握8拍节奏配合">
        </div>

        <div class="seg-editor-row">
          <label class="seg-editor-label">重点维度</label>
          <div class="seg-dim-list">
            ${dimsHtml}
          </div>
        </div>

        <div class="seg-editor-row">
          <label class="seg-editor-label">关键帧选择 (${allFrames.length} 个)</label>
          <div class="seg-frame-list">
            ${framesHtml}
          </div>
        </div>

        <div class="seg-editor-actions">
          <button type="button" class="btn-small btn-accent" data-seg-save="${seg.id}">保存修改</button>
          <button type="button" class="btn-small btn-secondary" data-seg-toggle="${seg.id}">取消</button>
        </div>
      </div>
    `;
  }

  function getAvailableActions() {
    const appState = window.__appState;
    if (!appState || !Array.isArray(appState.actions)) return [];
    return appState.actions.map((a) => ({ id: a.id, name: a.name }));
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
        state.expandedSegmentId = null;
        save();
        renderGeneratorModal();
      });
    }

    const writeBtn = document.getElementById("segWriteCalendarBtn");
    if (writeBtn) {
      writeBtn.addEventListener("click", handleWriteToCalendar);
    }

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

    document.querySelectorAll("[data-seg-toggle]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const segId = el.dataset.segToggle;
        toggleSegmentExpand(segId);
      });
    });

    document.querySelectorAll("[data-seg-up]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const segId = btn.dataset.segUp;
        const plan = getActivePlan();
        if (plan) {
          reorderSegment(plan.id, segId, "up");
          renderGeneratorModal();
        }
      });
    });

    document.querySelectorAll("[data-seg-down]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const segId = btn.dataset.segDown;
        const plan = getActivePlan();
        if (plan) {
          reorderSegment(plan.id, segId, "down");
          renderGeneratorModal();
        }
      });
    });

    document.querySelectorAll("[data-seg-remove]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const segId = btn.dataset.segRemove;
        if (confirm("确定删除这个分段吗？")) {
          const plan = getActivePlan();
          if (plan) {
            removeSegment(plan.id, segId);
            renderGeneratorModal();
          }
        }
      });
    });

    document.querySelectorAll("[data-seg-save]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const segId = btn.dataset.segSave;
        saveSegmentEdits(segId);
      });
    });

    document.querySelectorAll("[data-seg-action]").forEach((select) => {
      select.addEventListener("change", (e) => {
        const segId = e.target.dataset.segAction;
        const actionId = e.target.value;
        handleSegmentActionChange(segId, actionId);
      });
    });

    const startDateInput = document.getElementById("segPreviewStartDate");
    if (startDateInput) {
      startDateInput.addEventListener("change", (e) => {
        const plan = getActivePlan();
        if (plan) {
          const sessionsPerDay = parseInt(document.getElementById("segPreviewSessionsPerDay")?.value, 10) || 1;
          plan.scheduledDates = generateScheduleDates(plan.segments.length, e.target.value, sessionsPerDay);
          plan.updatedAt = new Date().toISOString();
          save();
          renderGeneratorModal();
        }
      });
    }

    const sessionsSelect = document.getElementById("segPreviewSessionsPerDay");
    if (sessionsSelect) {
      sessionsSelect.addEventListener("change", (e) => {
        const plan = getActivePlan();
        if (plan) {
          const sessionsPerDay = parseInt(e.target.value, 10) || 1;
          plan.params.sessionsPerDay = sessionsPerDay;
          const startDate = plan.scheduledDates?.[0] || formatDateKey(new Date());
          plan.scheduledDates = generateScheduleDates(plan.segments.length, startDate, sessionsPerDay);
          plan.updatedAt = new Date().toISOString();
          save();
          renderGeneratorModal();
        }
      });
    }
  }

  function handleSegmentActionChange(segmentId, actionId) {
    const plan = getActivePlan();
    if (!plan) return;

    const seg = plan.segments.find((s) => s.id === segmentId);
    if (!seg) return;

    if (!actionId) {
      seg.actionId = null;
      seg.actionSnapshotName = "未关联";
      seg.frameIds = [];
      seg.frames = [];
    } else {
      const action = window.__appState?.actions?.find((a) => a.id === actionId);
      if (action) {
        seg.actionId = action.id;
        seg.actionSnapshotName = action.name;
        const frames = getActionFrames(action.id);
        seg.frameIds = frames.map((f) => f.id);
        seg.frames = frames.map((f) => ({ ...f }));
      }
    }

    plan.updatedAt = new Date().toISOString();
    save();
    renderGeneratorModal();
  }

  function saveSegmentEdits(segmentId) {
    const plan = getActivePlan();
    if (!plan) return;

    const seg = plan.segments.find((s) => s.id === segmentId);
    if (!seg) return;

    const nameInput = document.getElementById(`segName_${segmentId}`);
    const beatsInput = document.getElementById(`segBeats_${segmentId}`);
    const dateInput = document.getElementById(`segDate_${segmentId}`);
    const goalInput = document.getElementById(`segGoal_${segmentId}`);
    const frameChecks = document.querySelectorAll(`[data-seg-frame="${segmentId}"]:checked`);
    const dimChecks = document.querySelectorAll(`[data-seg-dim="${segmentId}"]:checked`);

    const updates = {};

    if (nameInput) updates.segmentName = nameInput.value.trim();
    if (beatsInput) {
      const beats = parseInt(beatsInput.value, 10);
      if (!isNaN(beats) && beats > 0) {
        updates.beats = Math.min(64, Math.max(1, beats));
      }
    }
    if (goalInput) updates.goal = goalInput.value.trim();

    if (frameChecks.length) {
      updates.frameIds = Array.from(frameChecks).map((cb) => cb.value);
    }

    if (dimChecks.length) {
      const allDims = getAllDimensions();
      updates.focusDimensions = Array.from(dimChecks).map((cb) => {
        const dim = allDims.find((d) => d.key === cb.value);
        return dim ? { key: dim.key, label: dim.label } : null;
      }).filter(Boolean);
    }

    updateSegment(plan.id, segmentId, updates);

    if (dateInput && plan.scheduledDates) {
      plan.scheduledDates[seg.segmentIndex] = dateInput.value;
      plan.updatedAt = new Date().toISOString();
      save();
    }

    showToast("分段已更新", "success");
    renderGeneratorModal();
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

    const startDateInput = document.getElementById("segPreviewStartDate");
    const sessionsPerDaySelect = document.getElementById("segPreviewSessionsPerDay");
    const skipExactDup = document.getElementById("segSkipExactDup");
    const skipActionDateDup = document.getElementById("segSkipActionDateDup");
    const skipConflicts = document.getElementById("segSkipConflicts");

    const startDate = startDateInput?.value || plan.scheduledDates?.[0] || formatDateKey(new Date());
    const sessionsPerDay = parseInt(sessionsPerDaySelect?.value, 10) || plan.params?.sessionsPerDay || 1;

    const summary = getConflictSummary(plan.id, startDate, sessionsPerDay);

    let message = `确认将分段练习方案写入日历？\n\n`;
    message += `• 总分段数: ${summary.total}\n`;
    message += `• 开始日期: ${startDate}\n`;
    message += `• 每天课次: ${sessionsPerDay} 节\n`;
    const expectedCreate = Math.max(
      0,
      summary.total
        - (skipExactDup?.checked ?? true ? summary.exactDuplicates.length : 0)
        - (skipActionDateDup?.checked ?? true ? summary.actionDateDuplicates.length : 0)
        - (skipConflicts?.checked ?? false ? summary.sameDayConflicts.length : 0)
    );

    message += `• 预计写入: ${expectedCreate} 条\n`;

    if (summary.exactDuplicates.length > 0) {
      message += `\n⚠ ${summary.exactDuplicates.length} 个完全重复的计划${skipExactDup?.checked ?? true ? "将被跳过" : "不会跳过"}`;
    }
    if (summary.actionDateDuplicates.length > 0) {
      message += `\n⚠ ${summary.actionDateDuplicates.length} 个同日同动作的其他分段${skipActionDateDup?.checked ?? true ? "将被跳过" : "不会跳过"}`;
    }
    if (summary.sameDayConflicts.length > 0) {
      message += `\n⚠ ${summary.sameDayConflicts.length} 个与普通计划冲突${skipConflicts?.checked ?? false ? "将被跳过" : "不会跳过"}`;
    }

    message += `\n\n是否继续？`;

    if (!confirm(message)) return;

    const created = writeToCalendar(plan.id, {
      startDate,
      sessionsPerDay,
      skipExactDuplicates: skipExactDup?.checked ?? true,
      skipActionDateDuplicates: skipActionDateDup?.checked ?? true,
      skipConflicts: skipConflicts?.checked ?? false,
    });

    if (created.length > 0) {
      closeGeneratorModal();
      if (typeof window.PracticeCalendar?.renderAll === "function") {
        window.PracticeCalendar.renderAll();
      }
    }
  }

  function openSegmentEditor(segmentId) {
    toggleSegmentExpand(segmentId);
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
    detectCrossGenerationConflicts,
    getConflictSummary,
    checkForDuplicates,
    SEGMENT_TYPE,
  };
})();

window.SegmentedPractice = SegmentedPractice;
