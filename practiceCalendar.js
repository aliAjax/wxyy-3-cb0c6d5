const PracticeCalendar = (function () {
  const STORAGE_KEY = "wxyy-3-practice-calendar";

  let currentDate = new Date();
  let selectedDate = formatDateKey(new Date());
  let plans = [];
  let modalEventsBound = false;
  let isSubmitting = false;
  let isBatchSubmitting = false;

  function formatDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function getTodayKey() {
    return formatDateKey(new Date());
  }

  function isPastDate(dateKey) {
    return dateKey < getTodayKey();
  }

  function isToday(dateKey) {
    return dateKey === getTodayKey();
  }

  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      plans = data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn("日历数据加载失败:", e);
      plans = [];
    }
    if (!Array.isArray(plans)) plans = [];
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    } catch (e) {
      console.warn("日历数据保存失败:", e);
      showToast("日历数据保存失败", "error");
    }
    if (window.KnowledgeSearch && typeof window.KnowledgeSearch.refreshIndex === "function") {
      if (!save._throttleTimer) {
        save._throttleTimer = setTimeout(() => {
          save._throttleTimer = null;
          window.KnowledgeSearch.refreshIndex();
        }, 300);
      }
    }
  }

  function getAllPlans() {
    return [...plans];
  }

  function getPlansByDate(dateKey) {
    return plans.filter((p) => p.date === dateKey).map((p) => ({
      ...p,
      _invalid: !isReferenceValid(p)
    }));
  }

  function getPlansByRange(startKey, endKey) {
    return plans.filter((p) => p.date >= startKey && p.date <= endKey).map((p) => ({
      ...p,
      _invalid: !isReferenceValid(p)
    }));
  }

  function isReferenceValid(plan) {
    const appState = window.__appState;
    if (!appState) return true;
    if (plan.type === "action") {
      return appState.actions.some((a) => a.id === plan.refId);
    } else if (plan.type === "choreography") {
      return appState.choreographies.some((c) => c.id === plan.refId);
    }
    return true;
  }

  function getReferenceName(plan) {
    const appState = window.__appState;
    if (!appState) return plan.refName;
    if (plan.type === "action") {
      const action = appState.actions.find((a) => a.id === plan.refId);
      return action ? action.name : plan.refName;
    } else if (plan.type === "choreography") {
      const choreo = appState.choreographies.find((c) => c.id === plan.refId);
      return choreo ? choreo.name : plan.refName;
    }
    return plan.refName;
  }

  function createPlan(planData) {
    const plan = {
      id: planData.id || crypto.randomUUID(),
      date: planData.date,
      type: planData.type,
      refId: planData.refId,
      refName: planData.refName,
      goal: planData.goal || "",
      completed: typeof planData.completed === "boolean" ? planData.completed : false,
      completedAt: planData.completedAt || null,
      note: planData.note || "",
      createdAt: planData.createdAt || new Date().toISOString(),
      updatedAt: planData.updatedAt || new Date().toISOString()
    };
    plans.push(plan);
    save();
    return plan;
  }

  function updatePlan(planId, updates) {
    const idx = plans.findIndex((p) => p.id === planId);
    if (idx === -1) return null;
    plans[idx] = {
      ...plans[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    save();
    return plans[idx];
  }

  function deletePlan(planId) {
    const before = plans.length;
    plans = plans.filter((p) => p.id !== planId);
    if (plans.length !== before) {
      save();
      return true;
    }
    return false;
  }

  function toggleComplete(planId) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return null;
    plan.completed = !plan.completed;
    plan.completedAt = plan.completed ? new Date().toISOString() : null;
    plan.updatedAt = new Date().toISOString();
    save();
    return plan;
  }

  function batchCreatePlans(startDate, endDate, planTemplate, skipWeekends = false) {
    const start = parseDateKey(startDate);
    const end = parseDateKey(endDate);
    const created = [];

    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      if (!skipWeekends || (dayOfWeek !== 0 && dayOfWeek !== 6)) {
        const dateKey = formatDateKey(current);
        const plan = createPlan({
          ...planTemplate,
          date: dateKey
        });
        created.push(plan);
      }
      current.setDate(current.getDate() + 1);
    }

    return created;
  }

  function getWeekStats(dateKey) {
    const date = parseDateKey(dateKey);
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekStart = formatDateKey(monday);
    const weekEnd = formatDateKey(sunday);
    const weekPlans = getPlansByRange(weekStart, weekEnd);

    const total = weekPlans.length;
    const completed = weekPlans.filter((p) => p.completed).length;
    const overdue = weekPlans.filter((p) => !p.completed && isPastDate(p.date) && !isToday(p.date)).length;
    const today = weekPlans.filter((p) => isToday(p.date)).length;
    const invalid = weekPlans.filter((p) => p._invalid).length;

    return {
      weekStart,
      weekEnd,
      total,
      completed,
      overdue,
      today,
      invalid,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      plans: weekPlans
    };
  }

  function getMonthData(year, month) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const cells = [];
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      cells.push({
        date: formatDateKey(d),
        day: prevMonthLastDay - i,
        currentMonth: false,
        isToday: isToday(formatDateKey(d)),
        isPast: isPastDate(formatDateKey(d)),
        plans: []
      });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      const dateKey = formatDateKey(d);
      cells.push({
        date: dateKey,
        day: i,
        currentMonth: true,
        isToday: isToday(dateKey),
        isPast: isPastDate(dateKey),
        plans: getPlansByDate(dateKey)
      });
    }

    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      cells.push({
        date: formatDateKey(d),
        day: i,
        currentMonth: false,
        isToday: isToday(formatDateKey(d)),
        isPast: isPastDate(formatDateKey(d)),
        plans: []
      });
    }

    return {
      year,
      month,
      monthName: `${year}年${month + 1}月`,
      cells,
      firstDay: formatDateKey(firstDay),
      lastDay: formatDateKey(lastDay)
    };
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

  function showToast(message, type = "info", duration = 3000) {
    if (typeof window.showToast === "function") {
      window.showToast(message, type, duration);
      return;
    }
  }

  function getReferenceOptions() {
    const appState = window.__appState;
    if (!appState) return { actions: [], choreographies: [] };
    return {
      actions: appState.actions.map((a) => ({ id: a.id, name: a.name })),
      choreographies: appState.choreographies.map((c) => ({ id: c.id, name: c.name }))
    };
  }

  function renderCalendar() {
    const calendarEl = document.getElementById("practiceCalendar");
    if (!calendarEl) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthData = getMonthData(year, month);
    const weekStats = getWeekStats(selectedDate);
    const selectedPlans = getPlansByDate(selectedDate);

    calendarEl.innerHTML = `
      <div class="cal-container">
        <div class="cal-header">
          <div class="cal-nav">
            <button type="button" class="cal-nav-btn" id="calPrevMonth" title="上个月">‹</button>
            <h3 class="cal-title">${monthData.monthName}</h3>
            <button type="button" class="cal-nav-btn" id="calNextMonth" title="下个月">›</button>
            <button type="button" class="cal-today-btn" id="calTodayBtn">今天</button>
          </div>
          <div class="cal-actions">
            <button type="button" class="btn-small btn-accent" id="calAddPlanBtn">+ 添加计划</button>
            <button type="button" class="btn-small btn-secondary" id="calBatchBtn">批量生成</button>
          </div>
        </div>

        <div class="cal-week-stats">
          <div class="cal-stat-item">
            <span class="cal-stat-label">本周总计</span>
            <span class="cal-stat-value">${weekStats.total}</span>
          </div>
          <div class="cal-stat-item cal-stat-completed">
            <span class="cal-stat-label">已完成</span>
            <span class="cal-stat-value">${weekStats.completed}</span>
          </div>
          <div class="cal-stat-item cal-stat-overdue">
            <span class="cal-stat-label">逾期</span>
            <span class="cal-stat-value">${weekStats.overdue}</span>
          </div>
          <div class="cal-stat-item cal-stat-rate">
            <span class="cal-stat-label">完成率</span>
            <span class="cal-stat-value">${weekStats.completionRate}%</span>
          </div>
          <div class="cal-stat-item cal-stat-invalid">
            <span class="cal-stat-label">失效</span>
            <span class="cal-stat-value">${weekStats.invalid}</span>
          </div>
        </div>

        <div class="cal-grid">
          <div class="cal-weekday">一</div>
          <div class="cal-weekday">二</div>
          <div class="cal-weekday">三</div>
          <div class="cal-weekday">四</div>
          <div class="cal-weekday">五</div>
          <div class="cal-weekday">六</div>
          <div class="cal-weekday cal-weekend">日</div>
          ${monthData.cells.map((cell) => renderDayCell(cell)).join("")}
        </div>

        <div class="cal-detail">
          <div class="cal-detail-header">
            <h4>${formatSelectedDateLabel(selectedDate)} 的练习计划</h4>
            <button type="button" class="btn-small btn-accent" id="calAddPlanQuickBtn">+ 添加</button>
          </div>
          <div class="cal-detail-list" id="calPlanList">
            ${selectedPlans.length ? selectedPlans.map((p) => renderPlanCard(p)).join("") : `
              <div class="cal-empty">
                <p>当天暂无练习计划</p>
                <button type="button" class="btn-small btn-secondary" id="calQuickAddEmptyBtn">+ 添加第一个计划</button>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    bindCalendarEvents();
  }

  function formatSelectedDateLabel(dateKey) {
    const d = parseDateKey(dateKey);
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const todayStr = isToday(dateKey) ? " (今天)" : "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}${todayStr}`;
  }

  function renderDayCell(cell) {
    const plans = cell.plans;
    const completedCount = plans.filter((p) => p.completed).length;
    const overdueCount = plans.filter((p) => !p.completed && cell.isPast && !cell.isToday).length;
    const invalidCount = plans.filter((p) => p._invalid).length;

    let statusClass = "";
    if (cell.isToday) statusClass += " cal-cell-today";
    if (!cell.currentMonth) statusClass += " cal-cell-other";
    if (cell.isPast && !cell.isToday) statusClass += " cal-cell-past";
    if (selectedDate === cell.date) statusClass += " cal-cell-selected";

    const badges = [];
    if (plans.length > 0) {
      if (completedCount === plans.length && plans.length > 0) {
        badges.push(`<span class="cal-badge cal-badge-all-done" title="全部完成">✓</span>`);
      } else {
        if (completedCount > 0) {
          badges.push(`<span class="cal-badge cal-badge-done" title="已完成 ${completedCount} 项">${completedCount}✓</span>`);
        }
        if (overdueCount > 0) {
          badges.push(`<span class="cal-badge cal-badge-overdue" title="逾期 ${overdueCount} 项">${overdueCount}!</span>`);
        }
        if (invalidCount > 0) {
          badges.push(`<span class="cal-badge cal-badge-invalid" title="失效 ${invalidCount} 项">${invalidCount}?</span>`);
        }
        const remaining = plans.length - completedCount;
        if (remaining > 0 && overdueCount === 0) {
          badges.push(`<span class="cal-badge cal-badge-total" title="共 ${plans.length} 项">${plans.length}</span>`);
        }
      }
    }

    return `
      <div class="cal-cell${statusClass}" data-date="${cell.date}">
        <div class="cal-cell-head">
          <span class="cal-cell-day">${cell.day}</span>
          <div class="cal-cell-badges">${badges.join("")}</div>
        </div>
        ${plans.length > 0 ? `
          <div class="cal-cell-plans">
            ${plans.slice(0, 2).map((p) => `
              <div class="cal-cell-plan ${p.completed ? "done" : ""} ${p._invalid ? "invalid" : ""}" title="${escapeHtml(getReferenceName(p))}">
                ${p.completed ? "✓ " : ""}${escapeHtml(getReferenceName(p))}
              </div>
            `).join("")}
            ${plans.length > 2 ? `<div class="cal-cell-more">+${plans.length - 2} 更多</div>` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderPlanCard(plan) {
    const typeLabel = plan.type === "action" ? "动作" : "编排";
    const typeClass = plan.type === "action" ? "type-action" : "type-choreo";
    const refName = getReferenceName(plan);
    const isOverdue = !plan.completed && isPastDate(plan.date) && !isToday(plan.date);

    let statusClass = "";
    let statusLabel = "";
    if (plan._invalid) {
      statusClass = "plan-invalid";
      statusLabel = "已失效";
    } else if (plan.completed) {
      statusClass = "plan-completed";
      statusLabel = "已完成";
    } else if (isOverdue) {
      statusClass = "plan-overdue";
      statusLabel = "已逾期";
    } else if (isToday(plan.date)) {
      statusClass = "plan-today";
      statusLabel = "今日计划";
    }

    return `
      <div class="plan-card ${statusClass}" data-plan-id="${plan.id}">
        <div class="plan-card-head">
          <label class="plan-checkbox">
            <input type="checkbox" class="plan-complete-check" ${plan.completed ? "checked" : ""} ${plan._invalid ? "disabled" : ""}>
            <span class="plan-checkmark"></span>
          </label>
          <div class="plan-info">
            <span class="plan-type ${typeClass}">${typeLabel}</span>
            <strong class="plan-name ${plan._invalid ? "strikethrough" : ""}">${escapeHtml(refName)}</strong>
          </div>
          <span class="plan-status">${statusLabel}</span>
        </div>
        ${plan.goal ? `<div class="plan-goal">🎯 ${escapeHtml(plan.goal)}</div>` : ""}
        ${plan.note ? `<div class="plan-note">📝 ${escapeHtml(plan.note)}</div>` : ""}
        <div class="plan-actions">
          <button type="button" class="btn-small btn-secondary" data-plan-edit="${plan.id}">编辑</button>
          <button type="button" class="btn-small btn-danger" data-plan-delete="${plan.id}">删除</button>
        </div>
        ${plan._invalid ? `<div class="plan-invalid-hint">⚠ 关联的${typeLabel}已不存在，计划已失效</div>` : ""}
      </div>
    `;
  }

  function bindCalendarEvents() {
    document.getElementById("calPrevMonth")?.addEventListener("click", () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      renderCalendar();
    });

    document.getElementById("calNextMonth")?.addEventListener("click", () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderCalendar();
    });

    document.getElementById("calTodayBtn")?.addEventListener("click", () => {
      currentDate = new Date();
      selectedDate = getTodayKey();
      renderCalendar();
    });

    document.getElementById("calAddPlanBtn")?.addEventListener("click", () => openPlanModal());
    document.getElementById("calAddPlanQuickBtn")?.addEventListener("click", () => openPlanModal());
    document.getElementById("calQuickAddEmptyBtn")?.addEventListener("click", () => openPlanModal());
    document.getElementById("calBatchBtn")?.addEventListener("click", () => openBatchModal());

    document.querySelectorAll(".cal-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        selectedDate = cell.dataset.date;
        renderCalendar();
      });
    });

    document.querySelectorAll(".plan-complete-check").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const card = e.target.closest(".plan-card");
        const planId = card?.dataset.planId;
        if (planId) {
          toggleComplete(planId);
          renderCalendar();
        }
      });
    });

    document.querySelectorAll("[data-plan-edit]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const planId = btn.dataset.planEdit;
        const plan = plans.find((p) => p.id === planId);
        if (plan) openPlanModal(plan);
      });
    });

    document.querySelectorAll("[data-plan-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const planId = btn.dataset.planDelete;
        if (confirm("确定删除该练习计划？")) {
          deletePlan(planId);
          renderCalendar();
          showToast("计划已删除", "success");
        }
      });
    });

    bindModalEvents();
  }

  function openPlanModal(plan = null) {
    const modal = document.getElementById("planModal");
    if (!modal) return;

    const isEdit = !!plan;

    document.getElementById("planModalTitle").textContent = isEdit ? "编辑练习计划" : "添加练习计划";
    document.getElementById("planId").value = plan?.id || "";
    document.getElementById("planDate").value = plan?.date || selectedDate;
    document.getElementById("planType").value = plan?.type || "action";
    document.getElementById("planGoal").value = plan?.goal || "";
    document.getElementById("planNote").value = plan?.note || "";

    const typeSelect = document.getElementById("planType");
    updateRefOptions(typeSelect.value, plan?.refId);

    document.getElementById("planDeleteBtn").hidden = !isEdit;

    modal.hidden = false;
  }

  function updateRefOptions(type, selectedId = null) {
    const refSelect = document.getElementById("planRefId");
    const { actions, choreographies } = getReferenceOptions();
    const items = type === "action" ? actions : choreographies;

    if (items.length === 0) {
      refSelect.innerHTML = `<option value="">暂无可用的${type === "action" ? "动作" : "编排"}</option>`;
      return;
    }

    refSelect.innerHTML = `<option value="">请选择${type === "action" ? "动作" : "编排"}</option>` +
      items.map((item) => `
        <option value="${item.id}" ${selectedId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>
      `).join("");
  }

  function openBatchModal() {
    const modal = document.getElementById("batchPlanModal");
    if (!modal) return;

    document.getElementById("batchStartDate").value = selectedDate;
    const endDate = new Date(parseDateKey(selectedDate));
    endDate.setDate(endDate.getDate() + 6);
    document.getElementById("batchEndDate").value = formatDateKey(endDate);
    document.getElementById("batchType").value = "action";
    document.getElementById("batchGoal").value = "";
    document.getElementById("batchSkipWeekends").checked = false;

    updateBatchRefOptions("action");

    modal.hidden = false;
  }

  function updateBatchRefOptions(type) {
    const refSelect = document.getElementById("batchRefId");
    const { actions, choreographies } = getReferenceOptions();
    const items = type === "action" ? actions : choreographies;

    if (items.length === 0) {
      refSelect.innerHTML = `<option value="">暂无可用的${type === "action" ? "动作" : "编排"}</option>`;
      return;
    }

    refSelect.innerHTML = `<option value="">请选择${type === "action" ? "动作" : "编排"}</option>` +
      items.map((item) => `
        <option value="${item.id}">${escapeHtml(item.name)}</option>
      `).join("");
  }

  function bindModalEvents() {
    if (modalEventsBound) return;
    modalEventsBound = true;

    const planModal = document.getElementById("planModal");
    const batchModal = document.getElementById("batchPlanModal");

    planModal?.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-close-plan-modal") || e.target === planModal) {
        planModal.hidden = true;
      }
    });

    batchModal?.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-close-batch-modal") || e.target === batchModal) {
        batchModal.hidden = true;
      }
    });

    const planTypeSelect = document.getElementById("planType");
    planTypeSelect?.addEventListener("change", () => {
      updateRefOptions(planTypeSelect.value);
    });

    const batchTypeSelect = document.getElementById("batchType");
    batchTypeSelect?.addEventListener("change", () => {
      updateBatchRefOptions(batchTypeSelect.value);
    });

    const planForm = document.getElementById("planForm");
    planForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (isSubmitting) return;
      isSubmitting = true;

      setTimeout(() => { isSubmitting = false; }, 500);

      const formData = new FormData(planForm);
      const planId = formData.get("planId");
      const date = formData.get("planDate");
      const type = formData.get("planType");
      const refId = formData.get("planRefId");
      const goal = formData.get("planGoal").trim();
      const note = formData.get("planNote").trim();

      if (!date || !refId) {
        showToast("请填写完整信息", "error");
        return;
      }

      const { actions, choreographies } = getReferenceOptions();
      const items = type === "action" ? actions : choreographies;
      const refItem = items.find((i) => i.id === refId);
      if (!refItem) {
        showToast("选择的关联项无效", "error");
        return;
      }

      const planData = {
        date,
        type,
        refId,
        refName: refItem.name,
        goal,
        note
      };

      if (planId) {
        updatePlan(planId, planData);
        showToast("计划已更新", "success");
      } else {
        createPlan(planData);
        showToast("计划已创建", "success");
      }

      planForm.reset();
      planModal.hidden = true;
      selectedDate = date;
      renderCalendar();
    });

    document.getElementById("planDeleteBtn")?.addEventListener("click", () => {
      const planId = document.getElementById("planId").value;
      if (planId && confirm("确定删除该练习计划？")) {
        deletePlan(planId);
        document.getElementById("planForm")?.reset();
        planModal.hidden = true;
        renderCalendar();
        showToast("计划已删除", "success");
      }
    });

    const batchForm = document.getElementById("batchPlanForm");
    batchForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (isBatchSubmitting) return;
      isBatchSubmitting = true;

      setTimeout(() => { isBatchSubmitting = false; }, 1000);

      const formData = new FormData(batchForm);
      const startDate = formData.get("batchStartDate");
      const endDate = formData.get("batchEndDate");
      const type = formData.get("batchType");
      const refId = formData.get("batchRefId");
      const goal = formData.get("batchGoal").trim();
      const skipWeekends = formData.get("batchSkipWeekends") === "on";

      if (!startDate || !endDate || !refId) {
        showToast("请填写完整信息", "error");
        return;
      }

      if (startDate > endDate) {
        showToast("结束日期不能早于开始日期", "error");
        return;
      }

      const { actions, choreographies } = getReferenceOptions();
      const items = type === "action" ? actions : choreographies;
      const refItem = items.find((i) => i.id === refId);
      if (!refItem) {
        showToast("选择的关联项无效", "error");
        return;
      }

      const template = {
        type,
        refId,
        refName: refItem.name,
        goal
      };

      const created = batchCreatePlans(startDate, endDate, template, skipWeekends);
      batchForm.reset();
      batchModal.hidden = true;
      renderCalendar();
      showToast(`已批量创建 ${created.length} 个练习计划`, "success", 4000);
    });
  }

  function renderAll() {
    renderCalendar();
  }

  function setData(newPlans) {
    plans = Array.isArray(newPlans) ? newPlans : [];
    save();
  }

  function init() {
    load();
  }

  return {
    init,
    renderAll,
    getAllPlans,
    getPlansByDate,
    getPlansByRange,
    createPlan,
    updatePlan,
    deletePlan,
    toggleComplete,
    batchCreatePlans,
    getWeekStats,
    setData,
    formatDateKey,
    getTodayKey
  };
})();

window.PracticeCalendar = PracticeCalendar;
