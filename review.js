const ReviewScoring = (function () {
  const DIMENSIONS = [
    { key: "centerStability", label: "重心稳定", sliderClass: "slider-centerStability", fillClass: "dim-centerStability", color: "#8d2847" },
    { key: "sleeveContinuity", label: "袖路连贯", sliderClass: "slider-sleeveContinuity", fillClass: "dim-sleeveContinuity", color: "#b78a34" },
    { key: "wristDirection", label: "腕部方向", sliderClass: "slider-wristDirection", fillClass: "dim-wristDirection", color: "#4a7c59" },
    { key: "rhythmAlignment", label: "节奏贴合", sliderClass: "slider-rhythmAlignment", fillClass: "dim-rhythmAlignment", color: "#5b8def" },
    { key: "poseCompletion", label: "亮相完成度", sliderClass: "slider-poseCompletion", fillClass: "dim-poseCompletion", color: "#a05a2c" }
  ];

  function init() {
    migrateState();
    bindEvents();
    renderAll();
  }

  function migrateState() {
    const appState = window.__appState;
    if (!appState) return;
    if (!Array.isArray(appState.scores)) {
      appState.scores = [];
    }
    window.__saveAppState();
  }

  function getScores() {
    return window.__appState?.scores || [];
  }

  function getScoresForAction(actionId) {
    return getScores()
      .filter((s) => s.actionId === actionId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function addScore(actionId, dimensions, note) {
    const appState = window.__appState;
    if (!appState) return null;
    if (!Array.isArray(appState.scores)) {
      appState.scores = [];
    }

    const total = DIMENSIONS.reduce((sum, d) => sum + (dimensions[d.key] || 0), 0);
    const score = {
      id: crypto.randomUUID(),
      actionId: actionId,
      dimensions: { ...dimensions },
      total: total,
      maxTotal: DIMENSIONS.length * 5,
      note: note.trim(),
      createdAt: new Date().toISOString()
    };

    appState.scores.unshift(score);
    window.__saveAppState();
    renderAll();
    return score;
  }

  function deleteScore(scoreId) {
    const appState = window.__appState;
    if (!appState || !Array.isArray(appState.scores)) return;
    appState.scores = appState.scores.filter((s) => s.id !== scoreId);
    window.__saveAppState();
    renderAll();
  }

  function calcAverage(scores) {
    if (!scores.length) return 0;
    const sum = scores.reduce((acc, s) => acc + s.total, 0);
    return sum / scores.length;
  }

  function calcDimensionAverage(scores, dimensionKey) {
    const valid = scores.filter((s) => s.dimensions && s.dimensions[dimensionKey] != null);
    if (!valid.length) return null;
    const sum = valid.reduce((acc, s) => acc + (s.dimensions[dimensionKey] || 0), 0);
    return sum / valid.length;
  }

  function calcTrend(scores) {
    if (scores.length < 2) return "flat";
    const recent = scores.slice(0, 3);
    const older = scores.slice(3, 6);
    if (!older.length) {
      return scores[0].total >= scores[1].total ? "up" : "down";
    }
    const recentAvg = calcAverage(recent);
    const olderAvg = calcAverage(older);
    if (recentAvg > olderAvg + 0.5) return "up";
    if (recentAvg < olderAvg - 0.5) return "down";
    return "flat";
  }

  function calcDimensionTrend(scores, dimensionKey) {
    const validScores = scores.filter((s) => s.dimensions && s.dimensions[dimensionKey] != null);
    if (validScores.length < 2) return { trend: "flat", diff: 0, recentAvg: null, olderAvg: null, dataPoints: validScores.length };
    const recent = validScores.slice(0, 3);
    const older = validScores.slice(3, 6);
    const recentAvg = calcDimensionAverage(recent, dimensionKey);
    let trend = "flat";
    let diff = 0;
    let olderAvg = null;
    if (!older.length) {
      const first = validScores[0].dimensions[dimensionKey] || 0;
      const second = validScores[1].dimensions[dimensionKey] || 0;
      diff = first - second;
      olderAvg = second;
    } else {
      olderAvg = calcDimensionAverage(older, dimensionKey);
      diff = (recentAvg || 0) - (olderAvg || 0);
    }
    if (diff > 0.3) trend = "up";
    else if (diff < -0.3) trend = "down";
    return { trend, diff, recentAvg, olderAvg, dataPoints: validScores.length };
  }

  function calcAllDimensionTrends(scores) {
    const result = {};
    DIMENSIONS.forEach((d) => {
      result[d.key] = calcDimensionTrend(scores, d.key);
    });
    result.total = calcTrend(scores);
    return result;
  }

  function buildTrendSeries(scores, maxPoints = 10) {
    const ordered = [...scores].reverse().slice(-maxPoints);
    const series = {
      dates: ordered.map((s) => s.createdAt),
      labels: ordered.map((s) => formatDateShort(s.createdAt)),
      total: ordered.map((s) => s.total),
      maxTotal: ordered.length ? ordered[ordered.length - 1].maxTotal : DIMENSIONS.length * 5,
      dimensions: {}
    };
    DIMENSIONS.forEach((d) => {
      series.dimensions[d.key] = ordered.map((s) =>
        s.dimensions && s.dimensions[d.key] != null ? s.dimensions[d.key] : null
      );
    });
    return series;
  }

  function formatDateShort(iso) {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

  function formatDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function renderScoreSummary() {
    const container = document.querySelector("#scoreSummary");
    if (!container) return;

    const activeId = window.__appState?.activeId;
    if (!activeId) {
      container.innerHTML = "";
      return;
    }

    const scores = getScoresForAction(activeId);
    if (!scores.length) {
      container.innerHTML = `<div class="score-summary-empty">暂无复盘评分，前往「复盘评分」标签页录入</div>`;
      return;
    }

    const latest = scores[0];
    const avg = calcAverage(scores);
    const trend = calcTrend(scores);

    const trendLabel = { up: "↑ 上升", down: "↓ 下降", flat: "→ 持平" };
    const trendCls = trend;

    const dimBarsHtml = DIMENSIONS.map((d) => {
      const hasVal = latest.dimensions && latest.dimensions[d.key] != null;
      const val = hasVal ? latest.dimensions[d.key] : 0;
      const pct = (val / 5) * 100;
      return `
        <div class="score-dim-row ${!hasVal ? "score-dim-row-missing" : ""}">
          <span class="score-dim-label">${d.label}</span>
          <div class="score-dim-bar-track">
            <div class="score-dim-bar-fill ${d.fillClass}" style="width:${pct}%"></div>
          </div>
          <span class="score-dim-value">${hasVal ? val : '<span class="muted">—</span>'}</span>
        </div>
      `;
    }).join("");

    const dimTrendHtml = renderDimensionTrendComparison(scores, "compact");

    container.innerHTML = `
      <div class="score-summary-card">
        <div class="score-summary-latest">
          <div class="score-summary-dims">
            ${dimBarsHtml}
          </div>
          <div class="score-summary-total">
            <span class="score-total-number">${latest.total}</span>
            <span class="score-total-label">/ ${latest.maxTotal}</span>
          </div>
        </div>
        ${latest.note ? `<div class="score-summary-note">${escapeHtml(latest.note)}</div>` : ""}
        <div class="score-summary-date">${formatDate(latest.createdAt)} · 共 ${scores.length} 次评分 · 平均 <strong>${avg.toFixed(1)}</strong> <span class="score-trend-direction ${trendCls} score-trend-inline">${trendLabel[trend]}</span></div>
        ${dimTrendHtml}
      </div>
    `;
  }

  function renderScoreForm() {
    const panel = document.querySelector("#reviewPanel");
    if (!panel) return;

    const activeId = window.__appState?.activeId;
    if (!activeId) {
      panel.innerHTML = `<div class="review-panel-empty"><p>选择一个动作后可进行复盘评分</p></div>`;
      return;
    }

    const action = window.__appState?.actions?.find((a) => a.id === activeId);
    if (!action) {
      panel.innerHTML = `<div class="review-panel-empty"><p>选择一个动作后可进行复盘评分</p></div>`;
      return;
    }

    const slidersHtml = DIMENSIONS.map((d) => `
      <div class="score-input-row">
        <span class="score-input-label">${d.label}</span>
        <input type="range" class="score-input-slider ${d.sliderClass}" data-dim="${d.key}" min="1" max="5" step="1" value="3">
        <span class="score-input-value" data-dim-display="${d.key}">3</span>
      </div>
    `).join("");

    const scores = getScoresForAction(activeId);
    const dimTrendFullHtml = renderDimensionTrendComparison(scores, "full");

    panel.innerHTML = `
      <div class="review-score-form-section">
        <div class="review-form-header">
          <h3>${escapeHtml(action.name)} — 录入评分</h3>
          <button type="button" id="addToCalendarFromReviewPageBtn" class="btn-small btn-accent">📅 加入日历计划</button>
        </div>
        <div class="score-input-grid">
          ${slidersHtml}
        </div>
        <div class="score-input-note">
          <label>评分备注
            <textarea id="scoreNoteInput" rows="2" placeholder="记录本次练习评分的要点..."></textarea>
          </label>
        </div>
        <div class="score-input-total">
          <span class="score-input-total-label">总分</span>
          <span class="score-input-total-number" id="scoreTotalDisplay">${DIMENSIONS.length * 3}</span>
        </div>
        <div class="score-submit-row">
          <button type="button" id="resetScoreBtn" class="btn-secondary">重置</button>
          <button type="button" id="submitScoreBtn" class="btn-accent">保存评分</button>
        </div>
      </div>

      <div class="score-history-section">
        <h3>历史评分记录（${scores.length}）</h3>
        ${dimTrendFullHtml}
        ${scores.length ? renderScoreHistoryList(scores) : `<div class="score-history-empty">暂无历史评分记录</div>`}
      </div>
    `;

    bindScoreFormEvents();
  }

  function renderScoreHistoryList(scores) {
    return `
      <div class="score-history-list">
        ${scores.map((s) => {
          const dimRowsHtml = DIMENSIONS.map((d) => {
            const hasVal = s.dimensions && s.dimensions[d.key] != null;
            const val = hasVal ? s.dimensions[d.key] : 0;
            const pct = (val / 5) * 100;
            return `
              <div class="score-dim-row ${!hasVal ? "score-dim-row-missing" : ""}">
                <span class="score-dim-label">${d.label}</span>
                <div class="score-dim-bar-track">
                  <div class="score-dim-bar-fill ${d.fillClass}" style="width:${pct}%"></div>
                </div>
                <span class="score-dim-value">${hasVal ? val : '<span class="muted">—</span>'}</span>
              </div>
            `;
          }).join("");

          return `
            <div class="score-history-card" data-score="${s.id}">
              <div class="score-history-head">
                <span class="score-history-date">${formatDate(s.createdAt)}</span>
                <span class="score-history-total">${s.total} / ${s.maxTotal}</span>
              </div>
              <div class="score-history-dims">
                ${dimRowsHtml}
              </div>
              ${s.note ? `<div class="score-history-note">${escapeHtml(s.note)}</div>` : ""}
              <div class="score-history-actions">
                <button type="button" class="btn-small btn-danger" data-delete-score="${s.id}">删除</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function bindScoreFormEvents() {
    const sliders = document.querySelectorAll(".score-input-slider");
    sliders.forEach((slider) => {
      slider.addEventListener("input", () => {
        const key = slider.dataset.dim;
        const display = document.querySelector(`[data-dim-display="${key}"]`);
        if (display) display.textContent = slider.value;
        updateTotalDisplay();
      });
    });

    const addCalendarBtn = document.querySelector("#addToCalendarFromReviewPageBtn");
    if (addCalendarBtn) {
      addCalendarBtn.addEventListener("click", () => {
        const activeId = window.__appState?.activeId;
        const action = window.__appState?.actions?.find((a) => a.id === activeId);
        if (!action) {
          if (typeof window.showToast === "function") {
            window.showToast("请先选择一个动作", "warning");
          }
          return;
        }
        if (window.PracticeCalendar) {
          window.PracticeCalendar.openPlanModalForAction(action.id, action.name);
        }
      });
    }

    const submitBtn = document.querySelector("#submitScoreBtn");
    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        const activeId = window.__appState?.activeId;
        if (!activeId) return;

        const dimensions = {};
        DIMENSIONS.forEach((d) => {
          const slider = document.querySelector(`.score-input-slider[data-dim="${d.key}"]`);
          dimensions[d.key] = slider ? parseInt(slider.value, 10) : 3;
        });

        const noteInput = document.querySelector("#scoreNoteInput");
        const note = noteInput ? noteInput.value : "";

        addScore(activeId, dimensions, note);
        renderScoreSummary();
      });
    }

    const resetBtn = document.querySelector("#resetScoreBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const sliders = document.querySelectorAll(".score-input-slider");
        sliders.forEach((slider) => {
          slider.value = 3;
          const key = slider.dataset.dim;
          const display = document.querySelector(`[data-dim-display="${key}"]`);
          if (display) display.textContent = "3";
        });
        const noteInput = document.querySelector("#scoreNoteInput");
        if (noteInput) noteInput.value = "";
        updateTotalDisplay();
      });
    }

    const historyList = document.querySelector(".score-history-list");
    if (historyList) {
      historyList.addEventListener("click", (e) => {
        const deleteId = e.target.closest("[data-delete-score]")?.dataset.deleteScore;
        if (deleteId) {
          if (!confirm("确定删除该评分记录？")) return;
          deleteScore(deleteId);
          renderScoreSummary();
        }
      });
    }
  }

  function updateTotalDisplay() {
    let total = 0;
    DIMENSIONS.forEach((d) => {
      const slider = document.querySelector(`.score-input-slider[data-dim="${d.key}"]`);
      if (slider) total += parseInt(slider.value, 10);
    });
    const display = document.querySelector("#scoreTotalDisplay");
    if (display) display.textContent = total;
  }

  function bindEvents() {}

  function renderDimensionTrendComparison(scores, variant = "compact") {
    if (!scores || scores.length < 2) return "";
    const series = buildTrendSeries(scores, 10);
    const allTrends = calcAllDimensionTrends(scores);
    const trendLabelMap = { up: "↑ 上升", down: "↓ 下降", flat: "→ 持平" };
    const maxVal = 5;

    let dimRowsHtml = "";
    DIMENSIONS.forEach((d) => {
      const vals = series.dimensions[d.key];
      const sparkHtml = vals.map((v, i) => {
        if (v == null) {
          return `<div class="dim-trend-col dim-trend-col-missing" title="该次评分缺少此维度"></div>`;
        }
        const h = Math.max(3, (v / maxVal) * 48);
        const isLatest = i === vals.length - 1;
        return `<div class="dim-trend-col" style="height:${h}px;background:${d.color};opacity:${isLatest ? 1 : 0.55}" title="${series.labels[i]}: ${v}分"></div>`;
      }).join("");

      const dimTrend = allTrends[d.key] || { trend: "flat", diff: 0, dataPoints: vals.filter(v => v != null).length };
      const hasEnoughData = dimTrend.dataPoints >= 2;
      const trendCls = hasEnoughData ? dimTrend.trend : "flat";
      const trendText = hasEnoughData ? trendLabelMap[dimTrend.trend] : "数据不足";
      const diffText = hasEnoughData && dimTrend.diff !== 0 ? `${dimTrend.diff > 0 ? "+" : ""}${dimTrend.diff.toFixed(1)}` : "";

      const latestVal = vals.filter(v => v != null).slice(-1)[0];
      const avgVal = calcDimensionAverage(scores, d.key);

      dimRowsHtml += `
        <div class="dim-trend-row">
          <div class="dim-trend-label" style="color:${d.color}">${d.label}</div>
          <div class="dim-trend-spark">${sparkHtml}</div>
          <div class="dim-trend-value">
            <span class="dim-trend-latest">${latestVal != null ? latestVal : "-"}</span>
            <span class="dim-trend-avg muted">${avgVal != null ? "均" + avgVal.toFixed(1) : ""}</span>
          </div>
          <div class="score-trend-direction ${trendCls} dim-trend-dir">
            ${trendText}${diffText ? ` <span class="dim-trend-diff">(${diffText})</span>` : ""}
          </div>
        </div>
      `;
    });

    if (variant === "compact") {
      return `
        <div class="dim-trend-compact dim-trend-section">
          <h4>维度趋势对比（最近 ${series.labels.length} 次）</h4>
          <div class="dim-trend-rows">${dimRowsHtml}</div>
        </div>
      `;
    }

    const totalColsHtml = series.total.map((t, i) => {
      const h = Math.max(4, (t / series.maxTotal) * 56);
      const isLatest = i === series.total.length - 1;
      const c = isLatest ? "var(--gold)" : "var(--accent)";
      return `<div class="dim-trend-col" style="height:${h}px;background:${c};opacity:${isLatest ? 1 : 0.6}" title="${series.labels[i]}: 总分 ${t}/${series.maxTotal}"></div>`;
    }).join("");

    const totalTrend = allTrends.total;
    const totalAvg = calcAverage(scores);
    const latestTotal = scores[0] ? scores[0].total : 0;

    return `
      <div class="dim-trend-section dim-trend-full">
        <div class="dim-trend-header">
          <h4>维度趋势对比（最近 ${series.labels.length} 次评分）</h4>
          <div class="dim-trend-labels-row">
            ${series.labels.map((l, i) => `<span class="dim-trend-xlabel">${l}</span>`).join("")}
          </div>
        </div>
        <div class="dim-trend-total-row">
          <div class="dim-trend-label"><strong>总分</strong></div>
          <div class="dim-trend-spark">${totalColsHtml}</div>
          <div class="dim-trend-value">
            <span class="dim-trend-latest">${latestTotal}</span>
            <span class="dim-trend-avg muted">均${totalAvg.toFixed(1)}</span>
          </div>
          <div class="score-trend-direction ${totalTrend} dim-trend-dir">${trendLabelMap[totalTrend]}</div>
        </div>
        <div class="dim-trend-rows">${dimRowsHtml}</div>
      </div>
    `;
  }

  function renderAll() {
    renderScoreForm();
    renderScoreSummary();
  }

  return {
    init,
    addScore,
    deleteScore,
    getScoresForAction,
    calcAverage,
    calcTrend,
    calcDimensionAverage,
    calcDimensionTrend,
    calcAllDimensionTrends,
    buildTrendSeries,
    renderAll,
    renderScoreSummary,
    renderScoreForm,
    renderDimensionTrendComparison,
    DIMENSIONS
  };
})();

window.ReviewScoring = ReviewScoring;
