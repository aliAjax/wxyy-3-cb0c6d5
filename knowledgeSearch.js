const KnowledgeSearch = (function () {
  const escapeHtml = window.Utils.escapeHtml;
  const showToast = window.Utils.showToast;

  const TYPE_CONFIG = {
    action: { label: "动作", icon: "🎯", color: "#8d2847" },
    frame: { label: "关键帧", icon: "🎬", color: "#b78a34" },
    annotation: { label: "批注", icon: "📝", color: "#4a7c59" },
    session: { label: "课次复盘", icon: "📚", color: "#5b8def" },
    score: { label: "评分", icon: "⭐", color: "#a05a2c" },
    choreography: { label: "编排", icon: "🎭", color: "#7c4a8d" },
    choreoItem: { label: "编排动作项", icon: "🔗", color: "#7c4a8d" },
    plan: { label: "练习计划", icon: "📅", color: "#3a7d44" }
  };

  let index = [];
  let allTags = new Set();
  let allStages = new Set();
  let searchPanelVisible = false;
  let searchInputTimer = null;
  let lastQuery = "";
  let lastFilters = {};
  let indexVersion = 0;

  function init() {
    buildIndex();
    bindEvents();
  }

  function getState() {
    return window.__appState || {};
  }

  function parseTimeString(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const trimmed = timeStr.trim();
    const patterns = [
      /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/,
      /^(\d{1,2})(\d{2})$/,
      /^(\d+)$/
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

  function detectHandClues(text) {
    const clues = [];
    if (!text) return clues;
    if (/左|左手|偏左|左移/.test(text)) clues.push("left");
    if (/右|右手|偏右|右移/.test(text)) clues.push("right");
    return clues;
  }

  function buildIndex() {
    const state = getState();
    const newIndex = [];
    const tagsSet = new Set();
    const stagesSet = new Set();

    const actions = state.actions || [];
    const sessions = state.sessions || [];
    const scores = state.scores || [];
    const choreographies = state.choreographies || [];
    const plans = window.PracticeCalendar ? window.PracticeCalendar.getAllPlans() : [];

    actions.forEach((action) => {
      const actionTags = (action.tags || "")
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      actionTags.forEach((t) => tagsSet.add(t));

      const actionHandClues = detectHandClues(`${action.name} ${action.tags || ""}`);

      const actionScores = scores.filter((s) => s.actionId === action.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      let latestScore = null;
      let avgScore = null;
      let scoreTrend = null;
      let scoreCount = actionScores.length;
      let bestDimension = null;
      let worstDimension = null;
      let dimensionTrends = null;

      if (actionScores.length > 0 && window.ReviewScoring) {
        latestScore = actionScores[0];
        avgScore = window.ReviewScoring.calcAverage(actionScores);
        scoreTrend = window.ReviewScoring.calcTrend(actionScores);
        if (actionScores.length >= 2) {
          const trends = window.ReviewScoring.calcAllDimensionTrends(actionScores);
          const DIMS = window.ReviewScoring.DIMENSIONS;
          let maxDiff = -Infinity;
          let minDiff = Infinity;
          dimensionTrends = {};
          DIMS.forEach((d) => {
            const t = trends[d.key];
            dimensionTrends[d.key] = t;
            if (t.diff > maxDiff && t.dataPoints >= 2) {
              maxDiff = t.diff;
              bestDimension = { key: d.key, label: d.label, color: d.color, diff: t.diff, trend: t.trend };
            }
            if (t.diff < minDiff && t.dataPoints >= 2) {
              minDiff = t.diff;
              worstDimension = { key: d.key, label: d.label, color: d.color, diff: t.diff, trend: t.trend };
            }
          });
        }
      }

      newIndex.push({
        id: `action-${action.id}`,
        type: "action",
        actionId: action.id,
        actionName: action.name,
        title: action.name,
        text: `${action.name} ${action.tags || ""}`,
        tags: actionTags,
        stages: [],
        handClues: actionHandClues,
        timePoints: [],
        score: latestScore ? latestScore.total : null,
        maxScore: latestScore ? latestScore.maxTotal : null,
        createdAt: action.createdAt,
        updatedAt: action.updatedAt || action.createdAt,
        metadata: {
          actionId: action.id,
          scoreCount,
          avgScore,
          scoreTrend,
          bestDimension,
          worstDimension,
          dimensionTrends
        }
      });

      const frames = action.frames || [];
      frames.forEach((frame) => {
        if (frame.stage) stagesSet.add(frame.stage);

        const frameText = `${frame.stage || ""} ${frame.weight || ""} ${frame.wrist || ""} ${frame.tempo || ""} ${frame.note || ""}`;
        const handClues = detectHandClues(frameText);
        const timeSeconds = parseTimeString(frame.time);

        newIndex.push({
          id: `frame-${frame.id}`,
          type: "frame",
          actionId: action.id,
          actionName: action.name,
          title: `${frame.stage || "未命名"} · ${frame.time || "未定时点"}`,
          text: frameText,
          tags: actionTags,
          stages: frame.stage ? [frame.stage] : [],
          handClues,
          timePoints: timeSeconds != null ? [timeSeconds] : [],
          score: null,
          maxScore: null,
          frameId: frame.id,
          frameTime: frame.time,
          createdAt: frame.createdAt || action.createdAt,
          updatedAt: frame.updatedAt || frame.createdAt || action.createdAt,
          metadata: { actionId: action.id, frameId: frame.id, stage: frame.stage }
        });
      });

      const annotations = action.annotations || [];
      annotations.forEach((ann) => {
        const annText = `${ann.bodyPart || ""} ${ann.direction || ""} ${ann.note || ""}`;
        const handClues = detectHandClues(annText);

        newIndex.push({
          id: `annotation-${ann.id}`,
          type: "annotation",
          actionId: action.id,
          actionName: action.name,
          title: `${ann.bodyPart || "未指定"}${ann.direction ? " · " + ann.direction : ""}`,
          text: annText,
          tags: actionTags,
          stages: [],
          handClues,
          timePoints: ann.timestamp != null ? [ann.timestamp] : [],
          score: null,
          maxScore: null,
          annotationId: ann.id,
          createdAt: ann.createdAt,
          updatedAt: ann.createdAt,
          metadata: { actionId: action.id, annotationId: ann.id, timestamp: ann.timestamp }
        });
      });
    });

    sessions.forEach((session) => {
      const action = actions.find((a) => a.id === session.actionId);
      const actionName = action ? action.name : session.actionSnapshotName || "未知动作";
      const actionTags = action
        ? (action.tags || "").split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
        : [];

      const sessionText = `${actionName} ${session.reviewNote || ""} ${session.status || ""}`;
      const handClues = detectHandClues(sessionText);

      newIndex.push({
        id: `session-${session.id}`,
        type: "session",
        actionId: session.actionId,
        actionName,
        title: `${actionName} · ${session.status === "completed" ? "已完成" : session.status === "abandoned" ? "已放弃" : "进行中"}`,
        text: sessionText,
        tags: actionTags,
        stages: [],
        handClues,
        timePoints: [],
        score: null,
        maxScore: null,
        sessionId: session.id,
        createdAt: session.startTime,
        updatedAt: session.endTime || session.startTime,
        metadata: { sessionId: session.id, actionId: session.actionId }
      });
    });

    scores.forEach((score) => {
      const action = actions.find((a) => a.id === score.actionId);
      const actionName = action ? action.name : "未知动作";
      const actionTags = action
        ? (action.tags || "").split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
        : [];

      const dimText = Object.entries(score.dimensions || {})
        .map(([k, v]) => `${k}:${v}`)
        .join(" ");

      newIndex.push({
        id: `score-${score.id}`,
        type: "score",
        actionId: score.actionId,
        actionName,
        title: `评分 ${score.total} / ${score.maxTotal}`,
        text: `${score.note || ""} ${dimText}`,
        tags: actionTags,
        stages: [],
        handClues: [],
        timePoints: [],
        score: score.total,
        maxScore: score.maxTotal,
        scoreId: score.id,
        createdAt: score.createdAt,
        updatedAt: score.createdAt,
        metadata: { scoreId: score.id, actionId: score.actionId, total: score.total, maxTotal: score.maxTotal }
      });
    });

    choreographies.forEach((choreo) => {
      const choreoText = `${choreo.name} ${choreo.description || ""}`;

      newIndex.push({
        id: `choreography-${choreo.id}`,
        type: "choreography",
        actionId: null,
        actionName: null,
        choreographyId: choreo.id,
        title: choreo.name,
        text: choreoText,
        tags: [],
        stages: [],
        handClues: [],
        timePoints: [],
        score: null,
        maxScore: null,
        createdAt: choreo.createdAt,
        updatedAt: choreo.updatedAt || choreo.createdAt,
        metadata: { choreographyId: choreo.id }
      });

      (choreo.items || []).forEach((item) => {
        const action = actions.find((a) => a.id === item.actionId);
        const actionName = action ? action.name : item.actionSnapshotName || "未知动作";
        const actionTags = action
          ? (action.tags || "").split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
          : [];

        const itemText = `${actionName} ${item.transitionHint || ""} ${item.note || ""}`;
        const handClues = detectHandClues(itemText);
        const itemStages = action && action.frames
          ? action.frames.map((f) => f.stage).filter(Boolean)
          : [];
        itemStages.forEach((s) => stagesSet.add(s));

        newIndex.push({
          id: `choreoItem-${item.id}`,
          type: "choreoItem",
          actionId: item.actionId,
          actionName,
          choreographyId: choreo.id,
          choreographyName: choreo.name,
          choreoItemId: item.id,
          title: `${choreo.name} - ${actionName}`,
          text: itemText,
          tags: actionTags,
          stages: itemStages,
          handClues,
          timePoints: [],
          score: null,
          maxScore: null,
          createdAt: choreo.createdAt,
          updatedAt: choreo.updatedAt || choreo.createdAt,
          metadata: { choreographyId: choreo.id, choreoItemId: item.id, actionId: item.actionId }
        });
      });
    });

    plans.forEach((plan) => {
      const refName = plan.refName || "";
      const planText = `${refName} ${plan.goal || ""} ${plan.note || ""}`;
      const handClues = detectHandClues(planText);

      newIndex.push({
        id: `plan-${plan.id}`,
        type: "plan",
        actionId: plan.type === "action" ? plan.refId : null,
        actionName: plan.type === "action" ? refName : null,
        planId: plan.id,
        title: `${plan.date} · ${refName}`,
        text: planText,
        tags: [],
        stages: [],
        handClues,
        timePoints: [],
        score: null,
        maxScore: null,
        planDate: plan.date,
        planType: plan.type,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt || plan.createdAt,
        metadata: { planId: plan.id, date: plan.date, type: plan.type, refId: plan.refId }
      });
    });

    index = newIndex;
    allTags = tagsSet;
    allStages = stagesSet;
    indexVersion++;
  }

  function refreshIndex() {
    buildIndex();
    if (searchPanelVisible) {
      performSearch(lastQuery, lastFilters);
    }
  }

  function getFilterOptions() {
    return {
      tags: Array.from(allTags).sort(),
      stages: Array.from(allStages).sort(),
      types: Object.keys(TYPE_CONFIG).map((key) => ({
        key,
        label: TYPE_CONFIG[key].label,
        icon: TYPE_CONFIG[key].icon
      }))
    };
  }

  function highlightText(text, query) {
    if (!query || !text) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return escapedText.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().split(/[\s,，。、；;：:！!？?（）()【】\[\]""''`~@#$%^&*_+\-=|\\/<>]+/).filter(Boolean);
  }

  function calculateRelevance(doc, queryTokens) {
    if (!queryTokens.length) return 0;
    let score = 0;
    const titleTokens = tokenize(doc.title);
    const textTokens = tokenize(doc.text);
    const tagTokens = (doc.tags || []).map((t) => t.toLowerCase());

    queryTokens.forEach((token) => {
      if (titleTokens.some((t) => t === token)) score += 10;
      else if (titleTokens.some((t) => t.includes(token))) score += 5;

      if (textTokens.some((t) => t === token)) score += 3;
      else if (textTokens.some((t) => t.includes(token))) score += 1.5;

      if (tagTokens.some((t) => t === token)) score += 7;
      else if (tagTokens.some((t) => t.includes(token))) score += 4;

      if (doc.actionName && doc.actionName.toLowerCase().includes(token)) score += 6;
    });

    return score;
  }

  function search(query, filters = {}) {
    const queryTokens = tokenize(query);
    let results = [...index];

    if (queryTokens.length > 0) {
      results = results.filter((doc) => {
        const searchFields = `${doc.title} ${doc.text} ${doc.tags.join(" ")} ${doc.actionName || ""}`.toLowerCase();
        return queryTokens.every((token) => searchFields.includes(token));
      });

      results.forEach((doc) => {
        doc._relevance = calculateRelevance(doc, queryTokens);
      });
      results.sort((a, b) => b._relevance - a._relevance);
    } else {
      results.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    }

    if (filters.types && filters.types.length > 0) {
      results = results.filter((doc) => filters.types.includes(doc.type));
    }

    if (filters.tags && filters.tags.length > 0) {
      results = results.filter((doc) =>
        filters.tags.some((tag) => doc.tags.includes(tag))
      );
    }

    if (filters.stages && filters.stages.length > 0) {
      results = results.filter((doc) =>
        filters.stages.some((stage) => doc.stages.includes(stage))
      );
    }

    if (filters.handClue) {
      results = results.filter((doc) => {
        if (filters.handClue === "both") {
          return doc.handClues.includes("left") && doc.handClues.includes("right");
        }
        return doc.handClues.includes(filters.handClue);
      });
    }

    if (filters.minScore != null || filters.maxScore != null) {
      results = results.filter((doc) => {
        if (doc.score == null) return false;
        if (filters.minScore != null && doc.score < filters.minScore) return false;
        if (filters.maxScore != null && doc.score > filters.maxScore) return false;
        return true;
      });
    }

    if (filters.timeMin != null || filters.timeMax != null) {
      results = results.filter((doc) => {
        if (!doc.timePoints || doc.timePoints.length === 0) return false;
        const hasMatch = doc.timePoints.some((t) => {
          if (filters.timeMin != null && t < filters.timeMin) return false;
          if (filters.timeMax != null && t > filters.timeMax) return false;
          return true;
        });
        return hasMatch;
      });
    }

    if (filters.dateFrom || filters.dateTo) {
      results = results.filter((doc) => {
        const date = doc.planDate || doc.createdAt;
        if (!date) return false;
        const dateStr = date.substring(0, 10);
        if (filters.dateFrom && dateStr < filters.dateFrom) return false;
        if (filters.dateTo && dateStr > filters.dateTo) return false;
        return true;
      });
    }

    return results;
  }

  function groupResults(results) {
    const groups = {};
    Object.keys(TYPE_CONFIG).forEach((type) => {
      groups[type] = [];
    });

    results.forEach((doc) => {
      if (!groups[doc.type]) groups[doc.type] = [];
      groups[doc.type].push(doc);
    });

    return Object.keys(TYPE_CONFIG)
      .filter((type) => groups[type] && groups[type].length > 0)
      .map((type) => ({
        type,
        label: TYPE_CONFIG[type].label,
        icon: TYPE_CONFIG[type].icon,
        color: TYPE_CONFIG[type].color,
        items: groups[type],
        count: groups[type].length
      }))
      .sort((a, b) => b.count - a.count);
  }

  function getSuggestions(query, results, filters) {
    const suggestions = [];
    const state = getState();
    const actionsCount = (state.actions || []).length;
    const framesCount = index.filter((d) => d.type === "frame").length;

    if (!query && Object.keys(filters || {}).length === 0) {
      suggestions.push({ type: "tip", text: "输入关键词开始搜索，或使用下方筛选条件" });
      if (actionsCount === 0) {
        suggestions.push({ type: "warning", text: "还没有创建任何动作，建议先添加动作" });
      }
    }

    if (query && results.length === 0) {
      suggestions.push({ type: "empty", text: `没有找到包含 "${query}" 的结果` });

      if (allTags.size > 0) {
        const similarTags = Array.from(allTags).filter((t) =>
          t.toLowerCase().includes(query.toLowerCase()) ||
          query.toLowerCase().includes(t.toLowerCase())
        );
        if (similarTags.length > 0) {
          suggestions.push({
            type: "suggestion",
            text: `试试搜索标签: ${similarTags.slice(0, 3).join("、")}`,
            action: "tag",
            value: similarTags[0]
          });
        }
      }

      if (allStages.size > 0) {
        const similarStages = Array.from(allStages).filter((s) =>
          s.includes(query) || query.includes(s)
        );
        if (similarStages.length > 0) {
          suggestions.push({
            type: "suggestion",
            text: `相关舞台节点: ${similarStages.slice(0, 3).join("、")}`,
            action: "stage",
            value: similarStages[0]
          });
        }
      }

      const activeFilters = Object.entries(filters || {})
        .filter(([k, v]) => v && (Array.isArray(v) ? v.length > 0 : true))
        .map(([k]) => k);
      if (activeFilters.length > 0) {
        suggestions.push({
          type: "tip",
          text: "尝试减少筛选条件或清除筛选",
          action: "clearFilters"
        });
      }
    }

    return suggestions;
  }

  function navigateToResult(doc) {
    const state = getState();

    switch (doc.type) {
      case "action":
        if (doc.actionId) {
          state.activeId = doc.actionId;
          if (typeof window.__saveAppState === "function") {
            window.__saveAppState();
          }
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("detail");
          }
          if (typeof window.__renderAll === "function") {
            window.__renderAll();
          }
          if (typeof switchSidebarTab === "function") {
            switchSidebarTab("actions");
          }
          setTimeout(() => {
            highlightTarget(`.action-item[data-action="${doc.actionId}"]`);
          }, 200);
        }
        break;

      case "frame":
        if (doc.actionId && doc.frameId) {
          state.activeId = doc.actionId;
          if (typeof window.__saveAppState === "function") {
            window.__saveAppState();
          }
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("detail");
          }
          if (typeof window.__renderAll === "function") {
            window.__renderAll();
          }
          setTimeout(() => {
            if (typeof window.__switchMainTab === "function") {
              window.__switchMainTab("storyboard");
            }
            if (window.StoryboardTimeline) {
              window.StoryboardTimeline.selectFrame(doc.frameId);
              window.StoryboardTimeline.expandFrame(doc.frameId);
            }
            setTimeout(() => {
              const frameEl = document.querySelector(`.storyboard-frame-card[data-frame-id="${doc.frameId}"]`);
              if (frameEl) {
                scrollToElement(frameEl);
                frameEl.classList.add("ks-highlight-target");
                setTimeout(() => frameEl.classList.remove("ks-highlight-target"), 3600);
              }
            }, 150);
          }, 100);
        }
        break;

      case "annotation":
        if (doc.actionId && doc.annotationId) {
          state.activeId = doc.actionId;
          if (typeof window.__saveAppState === "function") {
            window.__saveAppState();
          }
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("detail");
          }
          if (typeof window.__renderAll === "function") {
            window.__renderAll();
          }

          setTimeout(() => {
            const action = state.actions ? state.actions.find((a) => a.id === doc.actionId) : null;
            const annotation = findAnnotationById(action, doc.annotationId);

            if (annotation && annotation.timestamp != null) {
              const video = document.querySelector("#mediaBox video");
              if (video && !isNaN(video.duration)) {
                try {
                  video.currentTime = Math.min(annotation.timestamp, video.duration);
                } catch (e) {
                  // ignore
                }
              }
            }

            if (annotation && action) {
              const nearestFrame = findNearestFrameByTime(action, annotation.timestamp);
              if (nearestFrame && window.StoryboardTimeline) {
                window.StoryboardTimeline.selectFrame(nearestFrame.id);
              }
            }

            if (typeof window.__openAnnotationModal === "function" && annotation) {
              window.__openAnnotationModal(annotation);
            }

            setTimeout(() => {
              const annEl = document.querySelector(`.annotation-point[data-annotation-id="${doc.annotationId}"]`);
              if (annEl) {
                annEl.classList.add("ks-highlight-target");
                setTimeout(() => annEl.classList.remove("ks-highlight-target"), 3600);
              }
            }, 100);
          }, 200);
        }
        break;

      case "session":
        if (doc.sessionId) {
          state.activeSessionId = doc.sessionId;
          if (typeof window.__saveAppState === "function") {
            window.__saveAppState();
          }
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("practice");
          }
          if (typeof switchSidebarTab === "function") {
            switchSidebarTab("sessions");
          }
          if (typeof window.__renderAll === "function") {
            window.__renderAll();
          }

          setTimeout(() => {
            const sessionEl = document.querySelector(`.session-card[data-session="${doc.sessionId}"]`);
            if (sessionEl) {
              scrollToElement(sessionEl);
              sessionEl.classList.add("ks-highlight-target");
              setTimeout(() => sessionEl.classList.remove("ks-highlight-target"), 3600);
            }
          }, 200);
        }
        break;

      case "score":
        if (doc.scoreId && doc.actionId) {
          state.activeId = doc.actionId;
          if (typeof window.__saveAppState === "function") {
            window.__saveAppState();
          }
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("review");
          }
          if (typeof window.__renderAll === "function") {
            window.__renderAll();
          }

          setTimeout(() => {
            if (window.ReviewScoring && typeof window.ReviewScoring.renderAll === "function") {
              window.ReviewScoring.renderAll();
            }
            setTimeout(() => {
              const scoreEl = document.querySelector(`.score-history-card[data-score="${doc.scoreId}"]`);
              if (scoreEl) {
                scrollToElement(scoreEl);
                scoreEl.classList.add("ks-highlight-target");
                setTimeout(() => scoreEl.classList.remove("ks-highlight-target"), 3600);
              }
            }, 150);
          }, 200);
        }
        break;

      case "choreography":
        if (doc.choreographyId && window.Choreography) {
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("choreography");
          }
          if (typeof switchSidebarTab === "function") {
            switchSidebarTab("choreography");
          }
          if (typeof window.Choreography.setActiveChoreographyId === "function") {
            window.Choreography.setActiveChoreographyId(doc.choreographyId);
          }

          setTimeout(() => {
            const choreoEl = document.querySelector(`.choreo-card[data-choreo="${doc.choreographyId}"]`);
            if (choreoEl) {
              scrollToElement(choreoEl);
              choreoEl.classList.add("ks-highlight-target");
              setTimeout(() => choreoEl.classList.remove("ks-highlight-target"), 3600);
            }
          }, 200);
        }
        break;

      case "choreoItem":
        if (doc.choreographyId && doc.choreoItemId && window.Choreography) {
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("choreography");
          }
          if (typeof switchSidebarTab === "function") {
            switchSidebarTab("choreography");
          }
          if (typeof window.Choreography.setActiveChoreographyId === "function") {
            window.Choreography.setActiveChoreographyId(doc.choreographyId);
          }

          setTimeout(() => {
            const itemEl = document.querySelector(`.seq-row[data-choreo-item="${doc.choreoItemId}"], .tl-track[data-choreo-item="${doc.choreoItemId}"], .choreo-item-row[data-item="${doc.choreoItemId}"]`);
            if (itemEl) {
              scrollToElement(itemEl);
              itemEl.classList.add("ks-highlight-target");
              setTimeout(() => itemEl.classList.remove("ks-highlight-target"), 3600);
            }
          }, 250);
        }
        break;

      case "plan":
        if (doc.planId && window.PracticeCalendar) {
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("calendar");
          }
          if (window.PracticeCalendar.renderAll) {
            window.PracticeCalendar.renderAll();
          }

          setTimeout(() => {
            const planEl = document.querySelector(`.plan-card[data-plan-id="${doc.planId}"]`);
            if (planEl) {
              scrollToElement(planEl);
              planEl.classList.add("ks-highlight-target");
              setTimeout(() => planEl.classList.remove("ks-highlight-target"), 3600);
            } else {
              const dayEl = document.querySelector(`.cal-cell[data-date="${doc.planDate}"]`);
              if (dayEl) {
                scrollToElement(dayEl);
                dayEl.classList.add("ks-highlight-target");
                setTimeout(() => dayEl.classList.remove("ks-highlight-target"), 3600);
              }
            }
          }, 200);
        }
        break;
    }

    hideSearchPanel();
    showToast(`已定位到: ${doc.title}`, "success");
  }

  function switchSidebarTab(tab) {
    const sidebarTabs = document.querySelector("#sidebarTabs");
    if (!sidebarTabs) return;
    sidebarTabs.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === `panel-${tab}`);
    });
  }

  function scrollToElement(el) {
    if (!el) return false;
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      return true;
    }
    return false;
  }

  function highlightTarget(selector, parent = document) {
    if (!selector) return null;
    const el = parent.querySelector(selector);
    if (el) {
      el.classList.add("ks-highlight-target");
      setTimeout(() => {
        el.classList.remove("ks-highlight-target");
      }, 3600);
      return el;
    }
    return null;
  }

  function findAnnotationById(action, annotationId) {
    if (!action || !Array.isArray(action.annotations)) return null;
    return action.annotations.find((a) => a.id === annotationId) || null;
  }

  function findNearestFrameByTime(action, timestamp) {
    if (!action || !Array.isArray(action.frames) || timestamp == null) return null;
    let nearest = null;
    let minDiff = Infinity;
    action.frames.forEach((frame) => {
      const t = parseTimeString(frame.time);
      if (t != null) {
        const diff = Math.abs(t - timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = frame;
        }
      }
    });
    return nearest;
  }

  function renderSearchPanel() {
    const panel = document.querySelector("#knowledgeSearchPanel");
    if (!panel) return;

    const options = getFilterOptions();
    const results = search(lastQuery, lastFilters);
    const groups = groupResults(results);
    const suggestions = getSuggestions(lastQuery, results, lastFilters);
    const totalCount = results.length;

    panel.innerHTML = `
      <div class="ks-panel-inner">
        <div class="ks-panel-header">
          <h3>🔍 知识库搜索</h3>
          <button type="button" class="ks-close-btn" id="ksCloseBtn" title="关闭">×</button>
        </div>

        <div class="ks-search-bar">
          <input type="text" id="ksSearchInput" placeholder="搜索动作、关键帧、批注、课次、评分、编排..." 
                 value="${escapeHtml(lastQuery)}" autocomplete="off">
          <button type="button" class="btn-small btn-accent" id="ksSearchBtn">搜索</button>
        </div>

        <div class="ks-stats">
          <span class="ks-result-count">找到 <strong>${totalCount}</strong> 条结果</span>
          <button type="button" class="ks-clear-filters" id="ksClearFilters">清除筛选</button>
        </div>

        <div class="ks-filters">
          <div class="ks-filter-section">
            <h4>数据类型</h4>
            <div class="ks-filter-tags">
              ${options.types.map((t) => `
                <label class="ks-filter-tag ${(lastFilters.types || []).includes(t.key) ? "active" : ""}">
                  <input type="checkbox" value="${t.key}" data-filter="type" ${(lastFilters.types || []).includes(t.key) ? "checked" : ""}>
                  <span>${t.icon} ${t.label}</span>
                </label>
              `).join("")}
            </div>
          </div>

          <div class="ks-filter-section">
            <h4>标签</h4>
            <div class="ks-filter-tags scrollable">
              ${options.tags.length ? options.tags.map((tag) => `
                <label class="ks-filter-tag ${(lastFilters.tags || []).includes(tag) ? "active" : ""}">
                  <input type="checkbox" value="${escapeHtml(tag)}" data-filter="tag" ${(lastFilters.tags || []).includes(tag) ? "checked" : ""}>
                  <span>#${escapeHtml(tag)}</span>
                </label>
              `).join("") : '<span class="ks-filter-empty">暂无标签</span>'}
            </div>
          </div>

          <div class="ks-filter-section">
            <h4>舞台节点</h4>
            <div class="ks-filter-tags scrollable">
              ${options.stages.length ? options.stages.map((stage) => `
                <label class="ks-filter-tag ${(lastFilters.stages || []).includes(stage) ? "active" : ""}">
                  <input type="checkbox" value="${escapeHtml(stage)}" data-filter="stage" ${(lastFilters.stages || []).includes(stage) ? "checked" : ""}>
                  <span>${escapeHtml(stage)}</span>
                </label>
              `).join("") : '<span class="ks-filter-empty">暂无节点</span>'}
            </div>
          </div>

          <div class="ks-filter-section">
            <h4>左右手线索</h4>
            <div class="ks-filter-tags">
              <label class="ks-filter-tag ${lastFilters.handClue === "left" ? "active" : ""}">
                <input type="radio" value="left" data-filter="hand" ${lastFilters.handClue === "left" ? "checked" : ""}>
                <span>👈 左手</span>
              </label>
              <label class="ks-filter-tag ${lastFilters.handClue === "right" ? "active" : ""}">
                <input type="radio" value="right" data-filter="hand" ${lastFilters.handClue === "right" ? "checked" : ""}>
                <span>👉 右手</span>
              </label>
              <label class="ks-filter-tag ${lastFilters.handClue === "both" ? "active" : ""}">
                <input type="radio" value="both" data-filter="hand" ${lastFilters.handClue === "both" ? "checked" : ""}>
                <span>🤲 双手</span>
              </label>
              <label class="ks-filter-tag ${!lastFilters.handClue ? "active" : ""}">
                <input type="radio" value="" data-filter="hand" ${!lastFilters.handClue ? "checked" : ""}>
                <span>全部</span>
              </label>
            </div>
          </div>

          <div class="ks-filter-row">
            <div class="ks-filter-section">
              <h4>评分区间</h4>
              <div class="ks-range-inputs">
                <input type="number" id="ksMinScore" placeholder="最低" min="0" 
                       value="${lastFilters.minScore != null ? lastFilters.minScore : ""}">
                <span>-</span>
                <input type="number" id="ksMaxScore" placeholder="最高" min="0"
                       value="${lastFilters.maxScore != null ? lastFilters.maxScore : ""}">
              </div>
            </div>
            <div class="ks-filter-section">
              <h4>时间点(秒)</h4>
              <div class="ks-range-inputs">
                <input type="number" id="ksTimeMin" placeholder="起始" min="0" step="0.1"
                       value="${lastFilters.timeMin != null ? lastFilters.timeMin : ""}">
                <span>-</span>
                <input type="number" id="ksTimeMax" placeholder="结束" min="0" step="0.1"
                       value="${lastFilters.timeMax != null ? lastFilters.timeMax : ""}">
              </div>
            </div>
          </div>

          <div class="ks-filter-section">
            <h4>日期范围(计划/创建)</h4>
            <div class="ks-range-inputs">
              <input type="date" id="ksDateFrom" value="${lastFilters.dateFrom || ""}">
              <span>-</span>
              <input type="date" id="ksDateTo" value="${lastFilters.dateTo || ""}">
            </div>
          </div>
        </div>

        <div class="ks-results">
          ${suggestions.length > 0 && results.length === 0 ? `
            <div class="ks-suggestions">
              ${suggestions.map((s) => `
                <div class="ks-suggestion ks-suggestion-${s.type}" ${s.action ? `data-action="${s.action}" data-value="${escapeHtml(s.value || "")}"` : ""}>
                  ${s.type === "empty" ? "📭 " : s.type === "suggestion" ? "💡 " : s.type === "warning" ? "⚠️ " : "ℹ️ "}
                  ${escapeHtml(s.text)}
                </div>
              `).join("")}
            </div>
          ` : ""}

          ${groups.length > 0 ? groups.map((group) => `
            <div class="ks-result-group" data-group-type="${group.type}">
              <div class="ks-group-header">
                <span class="ks-group-icon" style="color: ${group.color}">${group.icon}</span>
                <span class="ks-group-label">${group.label}</span>
                <span class="ks-group-count">${group.count}</span>
              </div>
              <div class="ks-group-items">
                ${group.items.slice(0, 50).map((doc) => renderSearchResultItem(doc)).join("")}
                ${group.items.length > 50 ? `<div class="ks-more-hint">还有 ${group.items.length - 50} 条结果...</div>` : ""}
              </div>
            </div>
          `).join("") : ""}
        </div>
      </div>
    `;

    bindPanelEvents();
  }

  function renderActionScoreInfo(doc) {
    const meta = doc.metadata || {};
    if (!meta.scoreCount || meta.scoreCount === 0) return "";
    const trendLabel = { up: "↑ 上升", down: "↓ 下降", flat: "→ 持平" };
    const parts = [];
    parts.push(`<span class="ks-item-score">⭐ ${doc.score}/${doc.maxScore}</span>`);
    parts.push(`<span class="ks-item-score-count">${meta.scoreCount}次</span>`);
    if (meta.avgScore != null) {
      parts.push(`<span class="ks-item-avg">均${meta.avgScore.toFixed(1)}</span>`);
    }
    if (meta.scoreTrend) {
      parts.push(`<span class="score-trend-direction ${meta.scoreTrend} ks-item-trend">${trendLabel[meta.scoreTrend]}</span>`);
    }
    const dimParts = [];
    if (meta.bestDimension && meta.bestDimension.trend !== "flat") {
      const d = meta.bestDimension;
      const sign = d.diff > 0 ? "+" : "";
      dimParts.push(`<span class="ks-dim-trend ks-dim-trend-up" style="color:${d.color}">${d.label} ${sign}${d.diff.toFixed(1)}</span>`);
    }
    if (meta.worstDimension && meta.worstDimension.trend !== "flat" && meta.worstDimension.key !== (meta.bestDimension || {}).key) {
      const d = meta.worstDimension;
      const sign = d.diff > 0 ? "+" : "";
      dimParts.push(`<span class="ks-dim-trend ks-dim-trend-down" style="color:${d.color}">${d.label} ${sign}${d.diff.toFixed(1)}</span>`);
    }
    return `
      <div class="ks-item-meta ks-item-meta-row">
        ${parts.join("")}
      </div>
      ${dimParts.length ? `<div class="ks-item-dim-trends">${dimParts.join("")}</div>` : ""}
    `;
  }

  function renderSearchResultItem(doc) {
    const scoreInfo = doc.type === "action" ? renderActionScoreInfo(doc) : "";
    const genericMeta = doc.type !== "action" ? `
      ${doc.actionName ? `<span class="ks-item-action">${escapeHtml(doc.actionName)}</span>` : ""}
      ${doc.tags.length ? `<span class="ks-item-tags">${doc.tags.slice(0, 3).map((t) => `#${escapeHtml(t)}`).join(" ")}</span>` : ""}
      ${doc.score != null ? `<span class="ks-item-score">⭐ ${doc.score}/${doc.maxScore}</span>` : ""}
    ` : `
      ${doc.tags.length ? `<span class="ks-item-tags">${doc.tags.slice(0, 3).map((t) => `#${escapeHtml(t)}`).join(" ")}</span>` : ""}
    `;
    return `
      <div class="ks-result-item" data-doc-id="${doc.id}" data-doc-type="${doc.type}">
        <div class="ks-item-main">
          <div class="ks-item-title">${highlightText(doc.title, lastQuery)}</div>
          <div class="ks-item-meta">
            ${genericMeta}
          </div>
          ${scoreInfo}
          ${doc.text ? `<div class="ks-item-snippet">${highlightText(doc.text.substring(0, 100), lastQuery)}${doc.text.length > 100 ? "..." : ""}</div>` : ""}
        </div>
        <div class="ks-item-side">
          <button type="button" class="ks-item-jump" title="跳转到详情">→</button>
        </div>
      </div>
    `;
  }

  function performSearch(query, filters) {
    lastQuery = query || "";
    lastFilters = filters || {};
    renderSearchPanel();
  }

  function showSearchPanel() {
    const overlay = document.querySelector("#knowledgeSearchOverlay");
    if (overlay) {
      overlay.classList.add("visible");
      searchPanelVisible = true;
      refreshIndex();
      setTimeout(() => {
        const input = document.querySelector("#ksSearchInput");
        if (input) input.focus();
      }, 100);
    }
  }

  function hideSearchPanel() {
    const overlay = document.querySelector("#knowledgeSearchOverlay");
    if (overlay) {
      overlay.classList.remove("visible");
      searchPanelVisible = false;
    }
  }

  function bindPanelEvents() {
    const searchInput = document.querySelector("#ksSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(() => {
          performSearch(searchInput.value, lastFilters);
        }, 200);
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          performSearch(searchInput.value, lastFilters);
        }
        if (e.key === "Escape") {
          hideSearchPanel();
        }
      });
    }

    const searchBtn = document.querySelector("#ksSearchBtn");
    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        const input = document.querySelector("#ksSearchInput");
        performSearch(input ? input.value : "", lastFilters);
      });
    }

    const closeBtn = document.querySelector("#ksCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", hideSearchPanel);
    }

    const clearFiltersBtn = document.querySelector("#ksClearFilters");
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener("click", () => {
        lastFilters = {};
        performSearch(lastQuery, lastFilters);
      });
    }

    document.querySelectorAll('[data-filter="type"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(document.querySelectorAll('[data-filter="type"]:checked')).map((el) => el.value);
        lastFilters.types = checked.length > 0 ? checked : [];
        performSearch(lastQuery, lastFilters);
      });
    });

    document.querySelectorAll('[data-filter="tag"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(document.querySelectorAll('[data-filter="tag"]:checked')).map((el) => el.value);
        lastFilters.tags = checked.length > 0 ? checked : [];
        performSearch(lastQuery, lastFilters);
      });
    });

    document.querySelectorAll('[data-filter="stage"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(document.querySelectorAll('[data-filter="stage"]:checked')).map((el) => el.value);
        lastFilters.stages = checked.length > 0 ? checked : [];
        performSearch(lastQuery, lastFilters);
      });
    });

    document.querySelectorAll('[data-filter="hand"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        lastFilters.handClue = radio.value || null;
        performSearch(lastQuery, lastFilters);
      });
    });

    const minScoreInput = document.querySelector("#ksMinScore");
    const maxScoreInput = document.querySelector("#ksMaxScore");
    if (minScoreInput) {
      minScoreInput.addEventListener("input", () => {
        const val = minScoreInput.value;
        lastFilters.minScore = val === "" ? null : parseFloat(val);
        clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(() => performSearch(lastQuery, lastFilters), 300);
      });
    }
    if (maxScoreInput) {
      maxScoreInput.addEventListener("input", () => {
        const val = maxScoreInput.value;
        lastFilters.maxScore = val === "" ? null : parseFloat(val);
        clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(() => performSearch(lastQuery, lastFilters), 300);
      });
    }

    const timeMinInput = document.querySelector("#ksTimeMin");
    const timeMaxInput = document.querySelector("#ksTimeMax");
    if (timeMinInput) {
      timeMinInput.addEventListener("input", () => {
        const val = timeMinInput.value;
        lastFilters.timeMin = val === "" ? null : parseFloat(val);
        clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(() => performSearch(lastQuery, lastFilters), 300);
      });
    }
    if (timeMaxInput) {
      timeMaxInput.addEventListener("input", () => {
        const val = timeMaxInput.value;
        lastFilters.timeMax = val === "" ? null : parseFloat(val);
        clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(() => performSearch(lastQuery, lastFilters), 300);
      });
    }

    const dateFromInput = document.querySelector("#ksDateFrom");
    const dateToInput = document.querySelector("#ksDateTo");
    if (dateFromInput) {
      dateFromInput.addEventListener("change", () => {
        lastFilters.dateFrom = dateFromInput.value || null;
        performSearch(lastQuery, lastFilters);
      });
    }
    if (dateToInput) {
      dateToInput.addEventListener("change", () => {
        lastFilters.dateTo = dateToInput.value || null;
        performSearch(lastQuery, lastFilters);
      });
    }

    document.querySelectorAll(".ks-result-item").forEach((item) => {
      item.addEventListener("click", () => {
        const docId = item.dataset.docId;
        const doc = index.find((d) => d.id === docId);
        if (doc) {
          navigateToResult(doc);
        }
      });
    });

    document.querySelectorAll(".ks-suggestion[data-action]").forEach((s) => {
      s.style.cursor = "pointer";
      s.addEventListener("click", () => {
        const action = s.dataset.action;
        const value = s.dataset.value;
        if (action === "tag") {
          lastFilters.tags = [value];
        } else if (action === "stage") {
          lastFilters.stages = [value];
        } else if (action === "clearFilters") {
          lastFilters = {};
        }
        performSearch(lastQuery, lastFilters);
      });
    });
  }

  function bindEvents() {
    const searchBtn = document.querySelector("#openSearchBtn");
    if (searchBtn) {
      searchBtn.addEventListener("click", showSearchPanel);
    }

    const overlay = document.querySelector("#knowledgeSearchOverlay");
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          hideSearchPanel();
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (searchPanelVisible) {
          hideSearchPanel();
        } else {
          showSearchPanel();
        }
      }
      if (e.key === "Escape" && searchPanelVisible) {
        hideSearchPanel();
      }
    });
  }

  return {
    init,
    refreshIndex,
    search,
    showSearchPanel,
    hideSearchPanel,
    getFilterOptions,
    navigateToResult
  };
})();

window.KnowledgeSearch = KnowledgeSearch;
