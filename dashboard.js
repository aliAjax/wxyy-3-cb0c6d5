const PracticeLoopDashboard = (function () {
  const escapeHtml = window.Utils.escapeHtml;
  const formatDateShort = window.Utils.formatDateShortSlash;
  const formatDateKey = window.Utils.formatDateKey;
  const getTodayKey = window.Utils.getTodayKey;
  const showToast = window.Utils.showToast;

  function getDaysAgoKey(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return formatDateKey(d);
  }

  function getDaysLaterKey(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return formatDateKey(d);
  }

  function safeGet(obj, path, fallback) {
    if (obj == null) return fallback;
    return path.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : fallback), obj);
  }

  function getSafeActionName(action, fallback) {
    if (!action) return fallback || "未知动作";
    const name = safeGet(action, "name", "");
    const snapshotName = safeGet(action, "snapshotName", "");
    return name || snapshotName || fallback || "未知动作";
  }

  function getSafeSessionStatus(session) {
    if (!session) return "unknown";
    const status = safeGet(session, "status", "");
    if (["in_progress", "completed", "abandoned"].includes(status)) return status;
    if (session.endTime) return "completed";
    if (session.startTime && !session.endTime) return "in_progress";
    return "unknown";
  }

  function computeLast7Days() {
    const appState = window.__appState;
    const calendar = window.PracticeCalendar;
    if (!appState) return { days: [], completedDays: 0, totalPlans: 0, completedPlans: 0, totalSessions: 0, completedSessions: 0 };

    const days = [];
    let totalPlans = 0;
    let completedPlans = 0;
    let completedDays = 0;
    let totalSessions = 0;
    let completedSessions = 0;

    for (let i = 6; i >= 0; i--) {
      const dateKey = getDaysAgoKey(i);
      const dayLabel = formatDateShort(getDaysAgoKey(i));
      let dayPlans = [];
      if (calendar) {
        try {
          dayPlans = calendar.getPlansByDate(dateKey) || [];
        } catch (e) {
          console.warn("日历数据读取失败:", e);
          dayPlans = [];
        }
      }
      const sessions = (appState.sessions || []).filter((s) => {
        const startTime = safeGet(s, "startTime", "");
        return startTime && String(startTime).slice(0, 10) === dateKey;
      });
      const completedSessionCount = sessions.filter((s) => getSafeSessionStatus(s) === "completed").length;
      const planTotal = dayPlans.length;
      const planCompleted = dayPlans.filter((p) => !!p.completed).length;
      totalPlans += planTotal;
      completedPlans += planCompleted;
      totalSessions += sessions.length;
      completedSessions += completedSessionCount;
      const hasActivity = completedSessionCount > 0 || planCompleted > 0;
      if (hasActivity) completedDays++;
      days.push({
        dateKey,
        label: i === 0 ? "今天" : dayLabel,
        isToday: i === 0,
        sessionCount: sessions.length,
        completedSessionCount,
        planTotal,
        planCompleted,
        hasActivity
      });
    }

    return { days, completedDays, totalPlans, completedPlans, totalSessions, completedSessions };
  }

  function computeLowScoreActions() {
    const appState = window.__appState;
    if (!appState) return [];
    const scores = appState.scores || [];
    const actions = appState.actions || [];
    const THRESHOLD = 12;
    const MAX_ITEMS = 5;

    const actionScores = {};
    scores.forEach((s) => {
      const aid = s.actionId;
      if (!aid) return;
      if (!actionScores[aid]) actionScores[aid] = [];
      const total = safeGet(s, "total", 0);
      const maxTotal = safeGet(s, "maxTotal", 25);
      const dimensions = safeGet(s, "dimensions", null);
      let scoreValue = Number(total) || 0;
      if (scoreValue <= 0 && dimensions && typeof dimensions === "object") {
        scoreValue = Object.values(dimensions).reduce((sum, v) => sum + (Number(v) || 0), 0);
      }
      const maxValue = Number(maxTotal) > 0 ? Number(maxTotal) : 25;
      if (maxValue > 0 && scoreValue > 0) {
        actionScores[aid].push(scoreValue);
      }
    });

    const results = [];
    Object.entries(actionScores).forEach(([aid, vals]) => {
      if (!vals || !vals.length) return;
      const action = actions.find((a) => a.id === aid);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const actionSnapshotName = vals._snapshotName || null;
      if (avg <= THRESHOLD) {
        results.push({
          id: aid,
          name: action ? getSafeActionName(action) : (actionSnapshotName || "已删除动作"),
          exists: !!action,
          avgScore: avg,
          scoreCount: vals.length,
          maxScore: Math.max(...vals),
          minScore: Math.min(...vals)
        });
      }
    });

    results.sort((a, b) => a.avgScore - b.avgScore);
    return results.slice(0, MAX_ITEMS);
  }

  function computeExpiringPlans() {
    const calendar = window.PracticeCalendar;
    if (!calendar) return [];
    const today = getTodayKey();
    const limitDate = getDaysLaterKey(3);
    let allPlans = [];
    try {
      allPlans = calendar.getAllPlans() || [];
    } catch (e) {
      console.warn("日历数据读取失败:", e);
      return [];
    }
    const upcoming = allPlans.filter((p) => {
      if (!p || !p.date) return false;
      if (p.completed) return false;
      if (p.date < today) return false;
      return p.date <= limitDate;
    });
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    return upcoming.slice(0, 5).map((p) => {
      const appState = window.__appState;
      let refName = p.refName || "未知";
      let refExists = true;
      if (appState) {
        if (p.type === "action") {
          const action = (appState.actions || []).find((a) => a.id === p.refId);
          refName = action ? getSafeActionName(action) : (p.refName || "已删除动作");
          refExists = !!action;
        } else if (p.type === "choreography") {
          const choreo = (appState.choreographies || []).find((c) => c.id === p.refId);
          refName = choreo ? (safeGet(choreo, "name", "") || p.refName || "已删除编排") : (p.refName || "已删除编排");
          refExists = !!choreo;
        }
      }
      return { ...p, refName, refExists };
    });
  }

  function computeMostUsedChoreoActions() {
    const appState = window.__appState;
    if (!appState) return [];
    const choreographies = appState.choreographies || [];
    const actionCount = {};

    choreographies.forEach((choreo) => {
      const items = safeGet(choreo, "items", []);
      if (!Array.isArray(items)) return;
      const choreoName = safeGet(choreo, "name", "未命名编排");
      items.forEach((item) => {
        const aid = safeGet(item, "actionId", null);
        if (!aid) return;
        const snapshotName = safeGet(item, "actionSnapshotName", null);
        if (!actionCount[aid]) {
          actionCount[aid] = { count: 0, choreoNames: [], snapshotName: snapshotName || "未知" };
        }
        actionCount[aid].count++;
        if (!actionCount[aid].choreoNames.includes(choreoName)) {
          actionCount[aid].choreoNames.push(choreoName);
        }
        if (snapshotName && !actionCount[aid].snapshotName) {
          actionCount[aid].snapshotName = snapshotName;
        }
      });
    });

    const results = [];
    const actions = appState.actions || [];
    Object.entries(actionCount).forEach(([aid, data]) => {
      const action = actions.find((a) => a.id === aid);
      results.push({
        id: aid,
        name: action ? getSafeActionName(action) : data.snapshotName,
        exists: !!action,
        count: data.count,
        choreoNames: data.choreoNames
      });
    });

    results.sort((a, b) => b.count - a.count);
    return results.slice(0, 5);
  }

  function computeMediaRisk() {
    const appState = window.__appState;
    if (!appState) return [];
    const actions = appState.actions || [];
    const atRisk = [];

    actions.forEach((action) => {
      const actionName = getSafeActionName(action);
      const mediaId = action.mediaId || (action.mediaRef && action.mediaRef.id) || null;
      const hasMediaRef = !!(action.mediaRef && action.mediaRef.id);
      const hasLegacyMedia = !!(action.media && action.media.src);
      const hasNoMedia = !mediaId && !hasLegacyMedia;

      if (hasNoMedia) {
        atRisk.push({ id: action.id, name: actionName, riskType: "none", label: "无素材" });
      } else if (hasLegacyMedia && !hasMediaRef) {
        atRisk.push({ id: action.id, name: actionName, riskType: "legacy", label: "旧格式素材" });
      }
    });

    atRisk.sort((a, b) => {
      const order = { legacy: 0, none: 1 };
      return (order[a.riskType] || 2) - (order[b.riskType] || 2);
    });
    return atRisk.slice(0, 8);
  }

  function getRecentSessions(limit = 5) {
    const appState = window.__appState;
    if (!appState) return [];
    const sessions = appState.sessions || [];
    const actions = appState.actions || [];
    const sorted = [...sessions].sort((a, b) => {
      const aTime = safeGet(a, "startTime", "");
      const bTime = safeGet(b, "startTime", "");
      return new Date(bTime) - new Date(aTime);
    });
    return sorted.slice(0, limit).map((s) => {
      const action = actions.find((a) => a.id === s.actionId);
      return {
        id: s.id,
        actionId: s.actionId,
        actionName: action ? getSafeActionName(action) : (s.actionSnapshotName || "未知动作"),
        actionExists: !!action,
        status: getSafeSessionStatus(s),
        startTime: s.startTime,
        duration: safeGet(s, "duration", 0)
      };
    });
  }

  function renderWeekChart(days) {
    const maxSession = Math.max(1, ...days.map((d) => d.completedSessionCount + d.planCompleted));
    return days.map((d) => {
      const activityCount = d.completedSessionCount + d.planCompleted;
      const heightPct = maxSession > 0 ? Math.max(4, (activityCount / maxSession) * 100) : 4;
      const barCls = d.isToday ? "db-bar-today" : d.hasActivity ? "db-bar-active" : "db-bar-empty";
      return `
        <div class="db-week-col">
          <div class="db-week-bar-wrap">
            <div class="db-week-bar ${barCls}" style="height:${heightPct}%" title="完成课次: ${d.completedSessionCount}, 完成计划: ${d.planCompleted}">
              ${activityCount > 0 ? `<span class="db-week-bar-num">${activityCount}</span>` : ""}
            </div>
          </div>
          <span class="db-week-label ${d.isToday ? "today" : ""}">${d.label}</span>
        </div>
      `;
    }).join("");
  }

  function formatDuration(min) {
    if (!min) return "0分钟";
    const m = Math.floor(min);
    if (m < 60) return `${m}分钟`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r > 0 ? `${h}小时${r}分` : `${h}小时`;
  }

  function renderDashboard() {
    const container = document.getElementById("dashboardPanel");
    if (!container) return;

    const week7 = computeLast7Days();
    const lowScore = computeLowScoreActions();
    const expiring = computeExpiringPlans();
    const mostUsed = computeMostUsedChoreoActions();
    const mediaRisk = computeMediaRisk();
    const recentSessions = getRecentSessions(5);

    const completionRate = week7.totalPlans > 0 ? Math.round((week7.completedPlans / week7.totalPlans) * 100) : 0;
    const sessionCompletionRate = week7.totalSessions > 0 ? Math.round((week7.completedSessions / week7.totalSessions) * 100) : 0;

    container.innerHTML = `
      <div class="db-container">
        <div class="db-header">
          <h2>练习闭环仪表盘</h2>
          <p class="db-header-sub">汇总动作库、课次记录、复盘评分、练习日历和编排数据</p>
        </div>

        <div class="db-summary-row">
          <div class="db-summary-card" data-db-jump="actions">
            <div class="db-summary-icon">🎯</div>
            <div class="db-summary-body">
              <span class="db-summary-num">${(window.__appState?.actions || []).length}</span>
              <span class="db-summary-label">动作总数</span>
            </div>
          </div>
          <div class="db-summary-card" data-db-jump="sessions">
            <div class="db-summary-icon">🏋️</div>
            <div class="db-summary-body">
              <span class="db-summary-num">${(window.__appState?.sessions || []).length}</span>
              <span class="db-summary-label">课次记录</span>
            </div>
          </div>
          <div class="db-summary-card" data-db-jump="calendar">
            <div class="db-summary-icon">📅</div>
            <div class="db-summary-body">
              <span class="db-summary-num">${week7.totalPlans}</span>
              <span class="db-summary-label">近7天计划</span>
            </div>
          </div>
          <div class="db-summary-card" data-db-jump="review">
            <div class="db-summary-icon">⭐</div>
            <div class="db-summary-body">
              <span class="db-summary-num">${(window.__appState?.scores || []).length}</span>
              <span class="db-summary-label">评分记录</span>
            </div>
          </div>
          <div class="db-summary-card" data-db-jump="choreography">
            <div class="db-summary-icon">🎭</div>
            <div class="db-summary-body">
              <span class="db-summary-num">${(window.__appState?.choreographies || []).length}</span>
              <span class="db-summary-label">编排数量</span>
            </div>
          </div>
        </div>

        <div class="db-grid-2col">
          <section class="db-card">
            <div class="db-card-head">
              <h3>近7天练习完成情况</h3>
              <span class="db-card-badge">${week7.completedDays}/7 天有练习</span>
            </div>
            <div class="db-card-body">
              <div class="db-week-chart">
                ${renderWeekChart(week7.days)}
              </div>
              <div class="db-week-legend">
                <span>计划完成率 <strong>${completionRate}%</strong></span>
                <span>课次完成率 <strong>${sessionCompletionRate}%</strong></span>
              </div>
              <div class="db-week-legend">
                <span>已完成计划 <strong>${week7.completedPlans}</strong>/${week7.totalPlans}</span>
                <span>已完成课次 <strong>${week7.completedSessions}</strong>/${week7.totalSessions}</span>
              </div>
            </div>
          </section>

          <section class="db-card">
            <div class="db-card-head">
              <h3>最近课次记录</h3>
              <span class="db-card-badge" data-db-jump="sessions" style="cursor:pointer">查看全部 →</span>
            </div>
            <div class="db-card-body">
              ${recentSessions.length > 0 ? `
                <ul class="db-list">
                  ${recentSessions.map((s) => `
                    <li class="db-list-item ${!s.actionExists ? "db-list-invalid" : ""}" data-db-session="${s.id}" data-db-action="${s.actionId}">
                      <div class="db-list-main">
                        <span class="db-list-name ${!s.actionExists ? "strikethrough" : ""}">${escapeHtml(s.actionName)}</span>
                        <span class="db-list-meta">${s.startTime ? formatDateShort(s.startTime) : ""} · ${formatDuration(s.duration)}</span>
                        ${!s.actionExists ? `<span class="db-list-meta warn">⚠ 动作已删除</span>` : ""}
                      </div>
                      <span class="db-status-tag db-status-${s.status}">${
                        s.status === "completed" ? "已完成" :
                        s.status === "in_progress" ? "进行中" :
                        s.status === "abandoned" ? "已放弃" : "未知"
                      }</span>
                    </li>
                  `).join("")}
                </ul>
              ` : `<p class="db-empty">还没有课次记录</p>`}
            </div>
          </section>
        </div>

        <div class="db-grid-2col">
          <section class="db-card">
            <div class="db-card-head">
              <h3>低分动作预警</h3>
              <span class="db-card-badge ${lowScore.length > 0 ? "badge-warn" : ""}">${lowScore.length} 个</span>
            </div>
            <div class="db-card-body">
              ${lowScore.length > 0 ? `
                <ul class="db-list">
                  ${lowScore.map((a) => `
                    <li class="db-list-item ${!a.exists ? "db-list-invalid" : ""}" data-db-action="${a.id}">
                      <div class="db-list-main">
                        <span class="db-list-name ${!a.exists ? "strikethrough" : ""}">${escapeHtml(a.name)}</span>
                        <span class="db-list-meta">均分 ${a.avgScore.toFixed(1)} · 最高${a.maxScore.toFixed(1)}/最低${a.minScore.toFixed(1)} · ${a.scoreCount}次评分</span>
                        ${!a.exists ? `<span class="db-list-meta warn">⚠ 动作已删除（历史评分）</span>` : ""}
                      </div>
                      <span class="db-list-score low">${a.avgScore.toFixed(1)}</span>
                    </li>
                  `).join("")}
                </ul>
              ` : `<p class="db-empty">暂无低分动作，继续保持！</p>`}
            </div>
          </section>

          <section class="db-card">
            <div class="db-card-head">
              <h3>即将到期计划</h3>
              <span class="db-card-badge ${expiring.length > 0 ? "badge-warn" : ""}">${expiring.length} 项</span>
            </div>
            <div class="db-card-body">
              ${expiring.length > 0 ? `
                <ul class="db-list">
                  ${expiring.map((p) => `
                    <li class="db-list-item ${!p.refExists ? "db-list-invalid" : ""}" data-db-plan="${p.id}" data-db-plan-date="${p.date}" data-db-plan-type="${p.type}" data-db-plan-ref="${p.refId}">
                      <div class="db-list-main">
                        <span class="db-list-type-tag">${p.type === "action" ? "动作" : "编排"}</span>
                        <span class="db-list-name ${!p.refExists ? "strikethrough" : ""}">${escapeHtml(p.refName)}</span>
                        <span class="db-list-meta">${p.goal ? "🎯 " + escapeHtml(p.goal.length > 25 ? p.goal.slice(0, 25) + "…" : p.goal) : "未设置目标"}</span>
                        ${!p.refExists ? `<span class="db-list-meta warn">⚠ 关联已不存在</span>` : ""}
                      </div>
                      <span class="db-list-date">${formatDateShort(p.date)}</span>
                    </li>
                  `).join("")}
                </ul>
              ` : `<p class="db-empty">近3天无待完成计划</p>`}
            </div>
          </section>
        </div>

        <div class="db-grid-2col">
          <section class="db-card">
            <div class="db-card-head">
              <h3>编排最常用动作</h3>
            </div>
            <div class="db-card-body">
              ${mostUsed.length > 0 ? `
                <ul class="db-list">
                  ${mostUsed.map((a, i) => `
                    <li class="db-list-item" data-db-action="${a.id}" data-db-choreo-action="${a.id}">
                      <div class="db-list-main">
                        <span class="db-rank-badge rank-${i + 1}">${i + 1}</span>
                        <span class="db-list-name ${!a.exists ? "strikethrough" : ""}">${escapeHtml(a.name)}</span>
                        <span class="db-list-meta">出现在 ${a.choreoNames.slice(0, 2).map((n) => escapeHtml(n)).join("、")}${a.choreoNames.length > 2 ? ` 等${a.choreoNames.length}个编排` : ""}</span>
                        ${!a.exists ? `<span class="db-list-meta warn">⚠ 动作已删除（编排快照保留）</span>` : ""}
                      </div>
                      <span class="db-list-count">${a.count} 次</span>
                    </li>
                  `).join("")}
                </ul>
              ` : `<p class="db-empty">暂无编排数据</p>`}
            </div>
          </section>

          <section class="db-card">
            <div class="db-card-head">
              <h3>素材缺失风险</h3>
              <span class="db-card-badge ${mediaRisk.length > 0 ? "badge-warn" : ""}">${mediaRisk.length} 个</span>
            </div>
            <div class="db-card-body">
              ${mediaRisk.length > 0 ? `
                <div class="db-risk-grid">
                  ${mediaRisk.map((a) => `
                    <div class="db-risk-item ${a.riskType === "none" ? "risk-high" : "risk-medium"}" data-db-action="${a.id}">
                      <span class="db-risk-badge">${a.riskType === "none" ? "缺失" : "旧格式"}</span>
                      <span class="db-risk-name">${escapeHtml(a.name)}</span>
                    </div>
                  `).join("")}
                </div>
                <div class="db-risk-legend">
                  <span class="risk-high-legend">🔴 缺失素材：需要上传参考视频/图片</span>
                  <span class="risk-medium-legend">🟡 旧格式：建议迁移到素材库统一管理</span>
                </div>
              ` : `<p class="db-empty">所有动作素材状态正常 ✅</p>`}
            </div>
          </section>
        </div>
      </div>
    `;

    bindDashboardEvents();
  }

  function bindDashboardEvents() {
    const container = document.getElementById("dashboardPanel");
    if (!container) return;

    container.addEventListener("click", (e) => {
      const jumpTarget = e.target.closest("[data-db-jump]");
      if (jumpTarget) {
        const target = jumpTarget.dataset.dbJump;
        jumpToSection(target);
        return;
      }

      const sessionEl = e.target.closest("[data-db-session]");
      if (sessionEl) {
        const sessionId = sessionEl.dataset.dbSession;
        jumpToSession(sessionId);
        return;
      }

      const actionEl = e.target.closest("[data-db-action]");
      if (actionEl) {
        const actionId = actionEl.dataset.dbAction;
        jumpToAction(actionId);
        return;
      }

      const planEl = e.target.closest("[data-db-plan]");
      if (planEl) {
        const planDate = planEl.dataset.dbPlanDate;
        const planType = planEl.dataset.dbPlanType;
        const planRefId = planEl.dataset.dbPlanRef;
        jumpToPlan(planDate, planType, planRefId);
        return;
      }
    });
  }

  function jumpToSection(target) {
    const tabMap = {
      actions: "detail",
      sessions: "detail",
      calendar: "calendar",
      review: "review",
      choreography: "choreography"
    };
    const sidebarMap = {
      actions: "actions",
      sessions: "sessions",
      calendar: "actions",
      review: "actions",
      choreography: "choreography"
    };
    const toastMsg = {
      actions: null,
      sessions: "已打开课次记录列表，点击课次卡片的「查看」进入练习",
      calendar: null,
      review: null,
      choreography: null
    };
    if (typeof window.__switchMainTab === "function") {
      window.__switchMainTab(tabMap[target] || "detail");
    }
    const sidebarTab = sidebarMap[target];
    if (sidebarTab) {
      if (typeof window.__switchSidebarTab === "function") {
        window.__switchSidebarTab(sidebarTab);
      }
    }
    const msg = toastMsg[target];
    if (msg && typeof window.showToast === "function") {
      window.showToast(msg, "info");
    }
  }

  function jumpToAction(actionId) {
    const appState = window.__appState;
    if (!appState || !actionId) return;
    const action = (appState.actions || []).find((a) => a.id === actionId);
    if (action) {
      appState.activeId = actionId;
      if (typeof window.__saveAppState === "function") window.__saveAppState();
      if (typeof window.__switchMainTab === "function") window.__switchMainTab("detail");
      if (typeof window.__switchSidebarTab === "function") window.__switchSidebarTab("actions");
      if (typeof window.__renderAll === "function") window.__renderAll();
    } else {
      const choreos = (appState.choreographies || []);
      let referencedChoreo = null;
      for (const c of choreos) {
        const items = safeGet(c, "items", []);
        if (items.some((item) => item.actionId === actionId)) {
          referencedChoreo = c;
          break;
        }
      }
      if (referencedChoreo) {
        if (typeof window.showToast === "function") {
          window.showToast(`该动作已删除，跳转到引用它的编排「${safeGet(referencedChoreo, "name", "")}」`, "warning");
        }
        jumpToChoreography(referencedChoreo.id);
      } else {
        if (typeof window.showToast === "function") {
          window.showToast("该动作已被删除，且无编排引用记录", "warning");
        }
      }
    }
  }

  function jumpToSession(sessionId) {
    const appState = window.__appState;
    if (!appState || !sessionId) return;
    const session = (appState.sessions || []).find((s) => s.id === sessionId);
    if (session) {
      appState.activeSessionId = sessionId;
      if (session.actionId) {
        appState.activeId = session.actionId;
      }
      if (typeof window.__saveAppState === "function") window.__saveAppState();
      if (typeof window.__switchMainTab === "function") window.__switchMainTab("practice");
      if (typeof window.__switchSidebarTab === "function") window.__switchSidebarTab("sessions");
      if (typeof window.__renderAll === "function") window.__renderAll();
    } else {
      if (typeof window.showToast === "function") {
        window.showToast("该课次记录已被删除", "warning");
      }
    }
  }

  function jumpToPlan(planDate, planType, planRefId) {
    if (typeof window.__switchMainTab === "function") {
      window.__switchMainTab("calendar");
    }
    if (typeof window.__switchSidebarTab === "function") {
      window.__switchSidebarTab("actions");
    }
    if (window.PracticeCalendar && planDate) {
      try {
        window.PracticeCalendar.navigateToDate(planDate);
      } catch (e) {
        console.warn("导航到日历日期失败:", e);
      }
    }
    if (typeof window.showToast === "function" && planDate) {
      const d = new Date(planDate);
      const dateStr = `${d.getMonth() + 1}月${d.getDate()}日`;
      window.showToast(`已定位到 ${dateStr} 的日历计划`, "info");
    }
  }

  function jumpToChoreography(choreoId) {
    const appState = window.__appState;
    if (!appState || !choreoId) return;
    const choreo = (appState.choreographies || []).find((c) => c.id === choreoId);
    if (choreo) {
      appState.activeChoreographyId = choreoId;
      if (typeof window.__saveAppState === "function") window.__saveAppState();
      if (typeof window.__switchMainTab === "function") window.__switchMainTab("choreography");
      if (typeof window.__switchSidebarTab === "function") window.__switchSidebarTab("choreography");
      if (window.Choreography && typeof window.Choreography.setActiveChoreographyId === "function") {
        window.Choreography.setActiveChoreographyId(choreoId);
      }
      if (typeof window.__renderAll === "function") window.__renderAll();
    } else {
      if (typeof window.showToast === "function") {
        window.showToast("该编排已被删除", "warning");
      }
    }
  }

  function init() {
    renderDashboard();
  }

  function renderAll() {
    renderDashboard();
  }

  return {
    init,
    renderAll,
    renderDashboard
  };
})();

window.PracticeLoopDashboard = PracticeLoopDashboard;
