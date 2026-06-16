const ImportExport = (function () {
  const escapeHtml = window.Utils.escapeHtml;
  const formatDate = window.Utils.formatDate;
  const formatSize = window.Utils.formatSize;
  const showToast = window.Utils.showToast;

  const BACKUP_VERSION = 4;
  const MIN_SUPPORTED_VERSION = 1;

  const ImportStatus = {
    ADD: "add",
    OVERWRITE: "overwrite",
    SKIP: "skip",
    CONFLICT: "conflict",
    ERROR: "error"
  };

  const ResolveMode = {
    ADD_COPY: "add_copy",
    OVERWRITE: "overwrite",
    SKIP: "skip"
  };

  let currentPreview = null;
  let currentSection = "actions";
  let parsedBackupData = null;
  let lastImportResult = null;
  let expandedConflictIds = new Set();

  const SectionType = {
    ACTIONS: "actions",
    CHOREOGRAPHIES: "choreographies",
    SCORES: "scores",
    PLANS: "plans",
    MEDIA: "media"
  };

  function getAppState() {
    return window.__appState;
  }

  function saveAppState() {
    if (typeof window.__saveAppState === "function") {
      window.__saveAppState();
    }
  }

  function collectMediaIdsFromState(actions) {
    const ids = new Set();
    if (!Array.isArray(actions)) return ids;
    actions.forEach((action) => {
      if (action.mediaId) ids.add(action.mediaId);
      if (action.mediaRef && action.mediaRef.id) ids.add(action.mediaRef.id);
      if (action.media && action.media.id) ids.add(action.media.id);
    });
    return ids;
  }

  async function exportBackup() {
    const appState = getAppState();
    if (!appState) return null;

    const actions = JSON.parse(JSON.stringify(appState.actions || []));
    const choreographies = JSON.parse(JSON.stringify(appState.choreographies || []));
    const scores = JSON.parse(JSON.stringify(appState.scores || []));
    const plans = window.PracticeCalendar ? JSON.parse(JSON.stringify(window.PracticeCalendar.getAllPlans())) : [];

    actions.forEach((action) => {
      if (!Array.isArray(action.frames)) action.frames = [];
      if (!Array.isArray(action.annotations)) action.annotations = [];
      if (!Array.isArray(action.versions)) action.versions = [];
    });

    const mediaIds = collectMediaIdsFromState(actions);

    const mediaData = {};
    const mediaMeta = [];

    for (const mid of mediaIds) {
      try {
        const m = await MediaLibrary.getMedia(mid);
        if (m) {
          mediaMeta.push({
            id: m.id,
            type: m.type,
            name: m.name,
            size: m.size,
            createdAt: m.createdAt
          });
          if (m.data) {
            const dataUrl = await MediaLibrary.getMediaDataURL(mid);
            if (dataUrl) {
              mediaData[mid] = dataUrl;
            }
          }
        }
      } catch (e) {
        console.warn(`素材 ${mid} 导出失败:`, e);
      }
    }

    const backup = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      app: "wxyy-3-kunqu-sleeve-board",
      data: {
        actions: actions,
        choreographies: choreographies,
        scores: scores,
        plans: plans
      },
      media: {
        meta: mediaMeta,
        data: mediaData
      }
    };

    return backup;
  }

  async function handleExport() {
    try {
      const backup = await exportBackup();
      if (!backup) {
        showToast("导出失败：无法获取应用状态", "error");
        return;
      }

      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `kunqu-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`导出成功：${backup.data.actions.length} 个动作，${backup.data.choreographies.length} 个编排，${backup.data.scores.length} 条评分，${backup.data.plans.length} 个练习计划`, "success", 5000);
    } catch (err) {
      console.error("导出失败:", err);
      showToast("导出失败：" + (err.message || err), "error");
    }
  }

  function validateAction(action) {
    const issues = [];
    if (!action || typeof action !== "object") {
      issues.push("动作不是有效对象");
      return { valid: false, issues, sanitized: null };
    }
    if (!action.id || typeof action.id !== "string") {
      action.id = crypto.randomUUID();
      issues.push("动作缺少ID，已自动生成");
    }
    if (!action.name || typeof action.name !== "string" || !action.name.trim()) {
      action.name = "未命名动作";
      issues.push("动作缺少名称，已设为默认值");
    } else {
      action.name = String(action.name).trim();
    }
    if (typeof action.tags !== "string") {
      action.tags = action.tags ? String(action.tags) : "";
    }
    if (!Array.isArray(action.frames)) {
      action.frames = [];
      issues.push("动作关键帧格式无效，已重置为空数组");
    } else {
      action.frames = action.frames.filter((f) => f && typeof f === "object").map((f) => ({
        id: f.id || crypto.randomUUID(),
        stage: f.stage || "未命名节点",
        time: f.time || "",
        weight: f.weight || "",
        wrist: f.wrist || "",
        tempo: f.tempo || "",
        note: f.note || ""
      }));
    }
    if (!Array.isArray(action.annotations)) {
      action.annotations = [];
    } else {
      action.annotations = action.annotations.filter((a) => a && typeof a === "object").map((a) => {
        const ann = {
          id: a.id || crypto.randomUUID(),
          x: typeof a.x === "number" ? Math.max(0, Math.min(100, a.x)) : 50,
          y: typeof a.y === "number" ? Math.max(0, Math.min(100, a.y)) : 50,
          bodyPart: a.bodyPart || "其他",
          direction: a.direction || "",
          note: a.note || "",
          timestamp: typeof a.timestamp === "number" ? a.timestamp : null,
          createdAt: a.createdAt || new Date().toISOString()
        };
        if (a.frameId && typeof a.frameId === "string") {
          ann.frameId = a.frameId;
        }
        return ann;
      });
    }
    if (!action.createdAt || isNaN(new Date(action.createdAt).getTime())) {
      action.createdAt = new Date().toISOString();
    }
    if (!Array.isArray(action.versions)) {
      action.versions = [];
    } else {
      action.versions = action.versions.filter((v) => v && typeof v === "object").map((v, i) => ({
        id: v.id || crypto.randomUUID(),
        versionNumber: v.versionNumber || i + 1,
        createdAt: v.createdAt || new Date().toISOString(),
        changeTypes: Array.isArray(v.changeTypes) ? v.changeTypes : [],
        changeDescription: v.changeDescription || "历史版本",
        name: typeof v.name === "string" ? v.name : "",
        tags: typeof v.tags === "string" ? v.tags : "",
        frames: Array.isArray(v.frames) ? v.frames.map((f) => ({ ...f })) : [],
        annotations: Array.isArray(v.annotations) ? v.annotations.map((a) => ({ ...a })) : [],
        mediaId: v.mediaId || null,
        mediaRef: v.mediaRef ? { ...v.mediaRef } : null,
        restoredFrom: v.restoredFrom || null,
      }));
      action.versions.forEach((v, i) => {
        v.versionNumber = i + 1;
      });
    }
    return { valid: true, issues, sanitized: action };
  }

  function validateChoreography(choreo) {
    const issues = [];
    if (!choreo || typeof choreo !== "object") {
      issues.push("编排不是有效对象");
      return { valid: false, issues, sanitized: null };
    }
    if (!choreo.id || typeof choreo.id !== "string") {
      choreo.id = crypto.randomUUID();
      issues.push("编排缺少ID，已自动生成");
    }
    if (!choreo.name || typeof choreo.name !== "string" || !choreo.name.trim()) {
      choreo.name = "未命名编排";
      issues.push("编排缺少名称，已设为默认值");
    } else {
      choreo.name = String(choreo.name).trim();
    }
    if (typeof choreo.description !== "string") {
      choreo.description = "";
    }
    if (!Array.isArray(choreo.items)) {
      choreo.items = [];
      issues.push("编排动作序列格式无效，已重置为空");
    } else {
      choreo.items = choreo.items.filter((it) => it && typeof it === "object").map((it) => ({
        id: it.id || crypto.randomUUID(),
        actionId: it.actionId || "",
        actionSnapshotName: it.actionSnapshotName || "(已删除动作)",
        beats: typeof it.beats === "number" ? it.beats : 8,
        transition: it.transition || "",
        note: it.note || ""
      }));
    }
    if (!choreo.createdAt) choreo.createdAt = new Date().toISOString();
    if (!choreo.updatedAt) choreo.updatedAt = new Date().toISOString();
    return { valid: true, issues, sanitized: choreo };
  }

  function validateScore(score) {
    const issues = [];
    if (!score || typeof score !== "object") {
      issues.push("评分不是有效对象");
      return { valid: false, issues, sanitized: null };
    }
    if (!score.id || typeof score.id !== "string") {
      score.id = crypto.randomUUID();
      issues.push("评分缺少ID，已自动生成");
    }
    if (!score.actionId || typeof score.actionId !== "string") {
      issues.push("评分缺少关联动作ID");
      return { valid: false, issues, sanitized: null };
    }
    if (typeof score.total !== "number") score.total = 0;
    if (typeof score.maxTotal !== "number") score.maxTotal = 100;
    if (!Array.isArray(score.items)) score.items = [];
    if (!score.createdAt) score.createdAt = new Date().toISOString();
    if (typeof score.sessionId !== "string") score.sessionId = null;
    if (typeof score.overallNote !== "string") score.overallNote = "";
    return { valid: true, issues, sanitized: score };
  }

  function validatePlan(plan) {
    const issues = [];
    if (!plan || typeof plan !== "object") {
      issues.push("练习计划不是有效对象");
      return { valid: false, issues, sanitized: null };
    }
    if (!plan.id || typeof plan.id !== "string") {
      plan.id = crypto.randomUUID();
      issues.push("练习计划缺少ID，已自动生成");
    }
    if (!plan.date || typeof plan.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) {
      const today = new Date();
      plan.date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      issues.push("练习计划日期无效，已设为今天");
    }
    if (!plan.type || (plan.type !== "action" && plan.type !== "choreography")) {
      plan.type = "action";
      issues.push("练习计划类型无效，已设为动作");
    }
    if (!plan.refId || typeof plan.refId !== "string") {
      plan.refId = "";
      issues.push("练习计划缺少关联ID");
    }
    if (!plan.refName || typeof plan.refName !== "string") {
      plan.refName = "(未知内容)";
    }
    if (typeof plan.goal !== "string") plan.goal = "";
    if (typeof plan.completed !== "boolean") plan.completed = false;
    if (typeof plan.completedAt !== "string" && plan.completedAt !== null) plan.completedAt = null;
    if (typeof plan.note !== "string") plan.note = "";
    if (!plan.createdAt) plan.createdAt = new Date().toISOString();
    if (!plan.updatedAt) plan.updatedAt = new Date().toISOString();
    return { valid: true, issues, sanitized: plan };
  }

  function validateBackupStructure(backup) {
    const errors = [];
    const warnings = [];

    if (!backup || typeof backup !== "object") {
      errors.push("备份文件格式无效");
      return { valid: false, errors, warnings };
    }

    if (!backup.app || backup.app !== "wxyy-3-kunqu-sleeve-board") {
      warnings.push("备份文件来源可能不是本应用，数据结构可能不兼容");
    }

    if (!backup.version) {
      warnings.push("备份文件未指定版本号，可能为旧版本格式");
    } else if (backup.version < MIN_SUPPORTED_VERSION) {
      errors.push(`备份版本过低 (v${backup.version})，最低支持 v${MIN_SUPPORTED_VERSION}`);
    } else if (backup.version > BACKUP_VERSION) {
      warnings.push(`备份版本 (v${backup.version}) 高于当前版本 (v${BACKUP_VERSION})，部分数据可能无法完全导入`);
    }

    if (!backup.data || typeof backup.data !== "object") {
      errors.push("备份文件缺少 data 字段");
      return { valid: false, errors, warnings };
    }

    if (!Array.isArray(backup.data.actions)) {
      errors.push("备份文件中动作数据格式无效");
    } else {
      const dataIssues = [];
      backup.data.actions = backup.data.actions.map((a) => {
        const { sanitized, issues } = validateAction(a);
        dataIssues.push(...issues.map((i) => `动作「${a?.name || "未命名"}」: ${i}`));
        return sanitized;
      }).filter(Boolean);
      if (dataIssues.length) {
        warnings.push(`动作数据已自动修复 ${dataIssues.length} 处问题`);
        warnings.push(...dataIssues.slice(0, 5));
        if (dataIssues.length > 5) warnings.push(`...以及另外 ${dataIssues.length - 5} 处`);
      }
    }

    if (!Array.isArray(backup.data.choreographies)) {
      warnings.push("备份文件中编排数据格式无效，将跳过编排导入");
      backup.data.choreographies = [];
    } else {
      const dataIssues = [];
      backup.data.choreographies = backup.data.choreographies.map((c) => {
        const { sanitized, issues } = validateChoreography(c);
        dataIssues.push(...issues.map((i) => `编排「${c?.name || "未命名"}」: ${i}`));
        return sanitized;
      }).filter(Boolean);
      if (dataIssues.length) {
        warnings.push(`编排数据已自动修复 ${dataIssues.length} 处问题`);
      }
    }

    if (!Array.isArray(backup.data.scores)) {
      warnings.push("备份文件中评分数据格式无效，将跳过评分导入");
      backup.data.scores = [];
    } else {
      const dataIssues = [];
      backup.data.scores = backup.data.scores.map((s) => {
        const { sanitized, issues } = validateScore(s);
        dataIssues.push(...issues.map((i) => `评分(动作ID ${s?.actionId?.slice(0, 8) || "未知"}): ${i}`));
        return sanitized;
      }).filter(Boolean);
      if (dataIssues.length) {
        warnings.push(`评分数据已自动修复 ${dataIssues.length} 处问题`);
      }
    }

    if (!Array.isArray(backup.data.plans)) {
      backup.data.plans = [];
      warnings.push("备份文件中缺少练习计划数据，使用空数据");
    } else {
      const dataIssues = [];
      backup.data.plans = backup.data.plans.map((p) => {
        const { sanitized, issues } = validatePlan(p);
        dataIssues.push(...issues.map((i) => `练习计划(${p?.date || "未知日期"}): ${i}`));
        return sanitized;
      }).filter(Boolean);
      if (dataIssues.length) {
        warnings.push(`练习计划数据已自动修复 ${dataIssues.length} 处问题`);
      }
    }

    if (!backup.media || typeof backup.media !== "object") {
      backup.media = { meta: [], data: {} };
      warnings.push("备份文件中缺少素材数据");
    } else {
      if (!Array.isArray(backup.media.meta)) {
        backup.media.meta = [];
      } else {
        backup.media.meta = backup.media.meta.filter((m) => m && typeof m === "object" && m.id);
      }
      if (!backup.media.data || typeof backup.media.data !== "object") {
        backup.media.data = {};
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  function migrateBackupData(backup) {
    const warnings = [];
    const version = backup.version || 0;

    if (version < 2) {
      if (Array.isArray(backup.data.actions)) {
        backup.data.actions.forEach((action) => {
          if (!Array.isArray(action.frames)) action.frames = [];
          if (!Array.isArray(action.annotations)) action.annotations = [];
          if (!action.createdAt) action.createdAt = backup.exportedAt || new Date().toISOString();
        });
      }
      if (Array.isArray(backup.data.choreographies)) {
        backup.data.choreographies.forEach((choreo) => {
          if (!Array.isArray(choreo.items)) choreo.items = [];
          if (!choreo.createdAt) choreo.createdAt = backup.exportedAt || new Date().toISOString();
          if (!choreo.updatedAt) choreo.updatedAt = backup.exportedAt || new Date().toISOString();
        });
      }
      warnings.push("已从旧版本格式迁移数据（补充默认字段）");
    }

    if (version < 3) {
      if (!Array.isArray(backup.data.plans)) {
        backup.data.plans = [];
      }
      warnings.push("已从旧版本格式迁移数据（补充练习计划字段）");
    }

    if (version < 4) {
      if (Array.isArray(backup.data.actions)) {
        backup.data.actions.forEach((action) => {
          if (Array.isArray(action.annotations)) {
            action.annotations.forEach((ann) => {
              if (ann.frameId === undefined) {
                ann.frameId = null;
              }
            });
          }
        });
      }
      warnings.push("已从旧版本格式迁移数据（补充批注关联字段）");
    }

    return { backup, warnings };
  }

  function getStatusClass(status) {
    switch (status) {
      case ImportStatus.ADD:
        return "item-add";
      case ImportStatus.OVERWRITE:
        return "item-overwrite";
      case ImportStatus.SKIP:
        return "item-skip";
      case ImportStatus.CONFLICT:
        return "item-conflict";
      case ImportStatus.ERROR:
        return "item-error";
      default:
        return "";
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case ImportStatus.ADD:
        return "新增";
      case ImportStatus.OVERWRITE:
        return "覆盖";
      case ImportStatus.SKIP:
        return "跳过";
      case ImportStatus.CONFLICT:
        return "冲突";
      case ImportStatus.ERROR:
        return "错误";
      default:
        return "";
    }
  }

  function getEffectiveStatus(item, overwriteEnabled) {
    if (item.status === ImportStatus.ERROR) return ImportStatus.ERROR;
    if (item.status === ImportStatus.ADD) return ImportStatus.ADD;
    if (item.status === ImportStatus.CONFLICT) {
      const mode = item.resolveMode || (overwriteEnabled ? ResolveMode.ADD_COPY : ResolveMode.SKIP);
      if (mode === ResolveMode.OVERWRITE) return ImportStatus.OVERWRITE;
      if (mode === ResolveMode.SKIP) return ImportStatus.SKIP;
      return ImportStatus.ADD;
    }
    if (item.status === ImportStatus.OVERWRITE) {
      return overwriteEnabled ? ImportStatus.OVERWRITE : ImportStatus.SKIP;
    }
    return item.status;
  }

  function computeSectionStats(section, items, overwriteEnabled) {
    const stats = { add: 0, overwrite: 0, skip: 0, conflict: 0, error: 0, total: items.length };
    items.forEach((item) => {
      const eff = getEffectiveStatus(item, overwriteEnabled);
      stats[eff] = (stats[eff] || 0) + 1;
    });
    return stats;
  }

  function computeAllSectionStats(preview, overwriteEnabled, includeMedia) {
    const sectionStats = {};
    [SectionType.ACTIONS, SectionType.CHOREOGRAPHIES, SectionType.SCORES, SectionType.PLANS].forEach((section) => {
      sectionStats[section] = computeSectionStats(section, preview[section] || [], overwriteEnabled);
    });
    if (includeMedia && preview.media) {
      sectionStats[SectionType.MEDIA] = {
        add: preview.media.available.length,
        overwrite: 0,
        skip: preview.media.existing.length,
        conflict: 0,
        error: preview.media.missing.length,
        total: preview.media.available.length + preview.media.existing.length + preview.media.missing.length
      };
    } else {
      sectionStats[SectionType.MEDIA] = {
        add: 0, overwrite: 0, skip: 0, conflict: 0, error: 0,
        total: preview.media ? (preview.media.available.length + preview.media.existing.length + preview.media.missing.length) : 0
      };
    }
    return sectionStats;
  }

  function getSectionLabel(section) {
    const labels = {
      [SectionType.ACTIONS]: "动作",
      [SectionType.CHOREOGRAPHIES]: "编排",
      [SectionType.SCORES]: "评分",
      [SectionType.PLANS]: "练习计划",
      [SectionType.MEDIA]: "素材"
    };
    return labels[section] || section;
  }

  function getConflictItemId(section, index) {
    return `conflict-${section}-${index}`;
  }

  function renderConflictDetail(item, section, index) {
    if (!item.existingData) return "";

    const conflictId = getConflictItemId(section, index);
    const isExpanded = expandedConflictIds.has(conflictId);

    let importSummary = "";
    let existingSummary = "";

    if (section === SectionType.ACTIONS) {
      const action = item.data;
      const existing = item.existingData;
      const frameCount = Array.isArray(action.frames) ? action.frames.length : 0;
      const annCount = Array.isArray(action.annotations) ? action.annotations.length : 0;
      const exFrameCount = Array.isArray(existing.frames) ? existing.frames.length : 0;
      const exAnnCount = Array.isArray(existing.annotations) ? existing.annotations.length : 0;

      importSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">关键帧：</span>
          <span class="conflict-summary-value">${frameCount} 个</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">批注：</span>
          <span class="conflict-summary-value">${annCount} 个</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">创建时间：</span>
          <span class="conflict-summary-value">${formatDate(action.createdAt)}</span>
        </div>
      `;

      existingSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">关键帧：</span>
          <span class="conflict-summary-value">${exFrameCount} 个</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">批注：</span>
          <span class="conflict-summary-value">${exAnnCount} 个</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">创建时间：</span>
          <span class="conflict-summary-value">${formatDate(existing.createdAt)}</span>
        </div>
      `;
    } else if (section === SectionType.CHOREOGRAPHIES) {
      const choreo = item.data;
      const existing = item.existingData;
      const itemCount = Array.isArray(choreo.items) ? choreo.items.length : 0;
      const exItemCount = Array.isArray(existing.items) ? existing.items.length : 0;

      importSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">动作数：</span>
          <span class="conflict-summary-value">${itemCount} 个</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">更新时间：</span>
          <span class="conflict-summary-value">${formatDate(choreo.updatedAt)}</span>
        </div>
      `;

      existingSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">动作数：</span>
          <span class="conflict-summary-value">${exItemCount} 个</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">更新时间：</span>
          <span class="conflict-summary-value">${formatDate(existing.updatedAt)}</span>
        </div>
      `;
    } else if (section === SectionType.SCORES) {
      const score = item.data;
      const existing = item.existingData;
      const scoreCount = Array.isArray(score.items) ? score.items.length : 0;
      const exScoreCount = Array.isArray(existing.items) ? existing.items.length : 0;

      importSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">总分：</span>
          <span class="conflict-summary-value">${score.total || 0}/${score.maxTotal || 100}</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">评分项：</span>
          <span class="conflict-summary-value">${scoreCount} 项</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">评分时间：</span>
          <span class="conflict-summary-value">${formatDate(score.createdAt)}</span>
        </div>
      `;

      existingSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">总分：</span>
          <span class="conflict-summary-value">${existing.total || 0}/${existing.maxTotal || 100}</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">评分项：</span>
          <span class="conflict-summary-value">${exScoreCount} 项</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">评分时间：</span>
          <span class="conflict-summary-value">${formatDate(existing.createdAt)}</span>
        </div>
      `;
    } else if (section === SectionType.PLANS) {
      const plan = item.data;
      const existing = item.existingData;

      importSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">日期：</span>
          <span class="conflict-summary-value">${plan.date}</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">类型：</span>
          <span class="conflict-summary-value">${plan.type === "choreography" ? "编排" : "动作"}</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">状态：</span>
          <span class="conflict-summary-value">${plan.completed ? "已完成" : "未完成"}</span>
        </div>
        ${plan.goal ? `<div class="conflict-summary-row"><span class="conflict-summary-label">目标：</span><span class="conflict-summary-value">${escapeHtml(plan.goal)}</span></div>` : ""}
      `;

      existingSummary = `
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">日期：</span>
          <span class="conflict-summary-value">${existing.date}</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">类型：</span>
          <span class="conflict-summary-value">${existing.type === "choreography" ? "编排" : "动作"}</span>
        </div>
        <div class="conflict-summary-row">
          <span class="conflict-summary-label">状态：</span>
          <span class="conflict-summary-value">${existing.completed ? "已完成" : "未完成"}</span>
        </div>
        ${existing.goal ? `<div class="conflict-summary-row"><span class="conflict-summary-label">目标：</span><span class="conflict-summary-value">${escapeHtml(existing.goal)}</span></div>` : ""}
      `;
    }

    const expandIcon = isExpanded ? "▼" : "▶";

    return `
      <button type="button" class="conflict-expand-btn" data-conflict-expand="${conflictId}">
        <span class="conflict-expand-icon">${expandIcon}</span>
        <span class="conflict-expand-text">${isExpanded ? "收起冲突详情" : "查看冲突详情"}</span>
      </button>
      <div class="conflict-detail ${isExpanded ? "expanded" : ""}" data-conflict-detail="${conflictId}">
        <div class="conflict-detail-grid">
          <div class="conflict-detail-col conflict-detail-import">
            <div class="conflict-detail-header">
              <span class="conflict-detail-badge import-badge">导入数据</span>
              <span class="conflict-detail-name">${escapeHtml(item.data?.name || item.data?.date || "(无名称)")}</span>
            </div>
            <div class="conflict-detail-body">
              ${importSummary}
            </div>
          </div>
          <div class="conflict-detail-divider">
            <span class="conflict-detail-vs">VS</span>
          </div>
          <div class="conflict-detail-col conflict-detail-existing">
            <div class="conflict-detail-header">
              <span class="conflict-detail-badge existing-badge">现有数据</span>
              <span class="conflict-detail-name">${escapeHtml(item.existingData?.name || item.existingData?.date || "(无名称)")}</span>
            </div>
            <div class="conflict-detail-body">
              ${existingSummary}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function computeDiff(item, section) {
    if (!item || !item.data || !item.existingData) return null;

    const diff = {
      fields: [],
      hasMajorChanges: false
    };

    const data = item.data;
    const existing = item.existingData;

    if (section === SectionType.ACTIONS) {
      if (data.name !== existing.name) {
        diff.fields.push({ key: "name", label: "名称", old: existing.name, new: data.name, type: "text" });
      }
      if (data.tags !== existing.tags) {
        diff.fields.push({ key: "tags", label: "标签", old: existing.tags || "(无)", new: data.tags || "(无)", type: "text" });
      }
      const oldFrames = Array.isArray(existing.frames) ? existing.frames.length : 0;
      const newFrames = Array.isArray(data.frames) ? data.frames.length : 0;
      if (oldFrames !== newFrames) {
        diff.fields.push({ key: "frames", label: "关键帧数量", old: `${oldFrames} 个`, new: `${newFrames} 个`, type: "count" });
        diff.hasMajorChanges = true;
      }
      const oldAnns = Array.isArray(existing.annotations) ? existing.annotations.length : 0;
      const newAnns = Array.isArray(data.annotations) ? data.annotations.length : 0;
      if (oldAnns !== newAnns) {
        diff.fields.push({ key: "annotations", label: "批注数量", old: `${oldAnns} 个`, new: `${newAnns} 个`, type: "count" });
        diff.hasMajorChanges = true;
      }
      const oldMediaId = existing.mediaId || (existing.mediaRef && existing.mediaRef.id);
      const newMediaId = data.mediaId || (data.mediaRef && data.mediaRef.id);
      if (oldMediaId !== newMediaId) {
        diff.fields.push({ key: "media", label: "关联素材", old: oldMediaId ? "已关联" : "无", new: newMediaId ? "已关联" : "无", type: "media" });
        diff.hasMajorChanges = true;
      }
    } else if (section === SectionType.CHOREOGRAPHIES) {
      if (data.name !== existing.name) {
        diff.fields.push({ key: "name", label: "名称", old: existing.name, new: data.name, type: "text" });
      }
      if (data.description !== existing.description) {
        diff.fields.push({ key: "description", label: "描述", old: existing.description || "(无)", new: data.description || "(无)", type: "text" });
      }
      const oldItems = Array.isArray(existing.items) ? existing.items.length : 0;
      const newItems = Array.isArray(data.items) ? data.items.length : 0;
      if (oldItems !== newItems) {
        diff.fields.push({ key: "items", label: "动作序列长度", old: `${oldItems} 个`, new: `${newItems} 个`, type: "count" });
        diff.hasMajorChanges = true;
      }
    } else if (section === SectionType.SCORES) {
      if (data.total !== existing.total || data.maxTotal !== existing.maxTotal) {
        diff.fields.push({ key: "score", label: "总分", old: `${existing.total || 0}/${existing.maxTotal || 100}`, new: `${data.total || 0}/${data.maxTotal || 100}`, type: "score" });
        diff.hasMajorChanges = true;
      }
      const oldItems = Array.isArray(existing.items) ? existing.items.length : 0;
      const newItems = Array.isArray(data.items) ? data.items.length : 0;
      if (oldItems !== newItems) {
        diff.fields.push({ key: "items", label: "评分项数量", old: `${oldItems} 项`, new: `${newItems} 项`, type: "count" });
      }
    } else if (section === SectionType.PLANS) {
      if (data.completed !== existing.completed) {
        diff.fields.push({ key: "completed", label: "完成状态", old: existing.completed ? "已完成" : "未完成", new: data.completed ? "已完成" : "未完成", type: "status" });
        diff.hasMajorChanges = true;
      }
      if (data.goal !== existing.goal) {
        diff.fields.push({ key: "goal", label: "练习目标", old: existing.goal || "(无)", new: data.goal || "(无)", type: "text" });
      }
      if (data.note !== existing.note) {
        diff.fields.push({ key: "note", label: "备注", old: existing.note || "(无)", new: data.note || "(无)", type: "text" });
      }
    }

    return diff;
  }

  async function analyzeImport(backup) {
    const appState = getAppState();
    const result = {
      actions: [],
      choreographies: [],
      scores: [],
      plans: [],
      media: {
        available: [],
        missing: [],
        existing: []
      },
      warnings: [...(backup._migrationWarnings || [])],
      stats: {
        add: 0,
        overwrite: 0,
        skip: 0,
        conflict: 0,
        error: 0
      },
      referenceChecks: {
        mediaIds: { valid: [], invalid: [] },
        actionRefs: { valid: [], invalid: [] },
        choreoRefs: { valid: [], invalid: [] },
        planRefs: { valid: [], invalid: [] }
      }
    };

    const existingActionIds = new Set((appState.actions || []).map((a) => a.id));
    const existingActionNames = new Map();
    (appState.actions || []).forEach((a) => existingActionNames.set((a.name || "").toLowerCase(), a));
    const existingChoreoIds = new Set((appState.choreographies || []).map((c) => c.id));
    const existingChoreoNames = new Map();
    (appState.choreographies || []).forEach((c) => existingChoreoNames.set((c.name || "").toLowerCase(), c));
    const existingScoreIds = new Set((appState.scores || []).map((s) => s.id));
    const existingPlanIds = new Set(window.PracticeCalendar ? window.PracticeCalendar.getAllPlans().map((p) => p.id) : []);

    const allExistingMedia = await MediaLibrary.getAllMedia();
    const existingMediaIds = new Set(allExistingMedia.map((m) => m.id));

    backup.data.actions.forEach((action) => {
      if (!action || !action.id || !action.name) {
        result.stats.error++;
        result.actions.push({
          status: ImportStatus.ERROR,
          data: action,
          message: "动作数据无效（缺少ID或名称）",
          resolveMode: ResolveMode.SKIP
        });
        return;
      }

      let status;
      let message = "";
      const idExists = existingActionIds.has(action.id);
      const nameConflict = existingActionNames.get((action.name || "").toLowerCase());

      if (idExists) {
        status = ImportStatus.OVERWRITE;
        message = "ID已存在，将覆盖当前数据";
      } else if (nameConflict && nameConflict.id !== action.id) {
        status = ImportStatus.CONFLICT;
        message = `存在同名动作「${nameConflict.name}」，可选择创建副本、覆盖或跳过`;
      } else {
        status = ImportStatus.ADD;
      }

      const existingData = idExists ? appState.actions.find((a) => a.id === action.id) : (nameConflict || null);
      const previewItem = {
        status,
        data: action,
        message,
        existingData,
        nameConflict: !!nameConflict && !idExists,
        resolveMode: status === ImportStatus.CONFLICT ? ResolveMode.ADD_COPY : null,
        section: SectionType.ACTIONS
      };
      if (existingData && (status === ImportStatus.CONFLICT || status === ImportStatus.OVERWRITE)) {
        previewItem.diff = computeDiff(previewItem, SectionType.ACTIONS);
      }
      result.stats[status]++;
      result.actions.push(previewItem);

      if (action.mediaId || (action.mediaRef && action.mediaRef.id)) {
        const mediaId = action.mediaId || (action.mediaRef && action.mediaRef.id);
        result.referenceChecks.mediaIds.valid.push({ actionId: action.id, mediaId });
      }
    });

    (backup.data.choreographies || []).forEach((choreo) => {
      if (!choreo || !choreo.id || !choreo.name) {
        result.stats.error++;
        result.choreographies.push({
          status: ImportStatus.ERROR,
          data: choreo,
          message: "编排数据无效（缺少ID或名称）",
          resolveMode: ResolveMode.SKIP
        });
        return;
      }

      let status;
      let message = "";
      const idExists = existingChoreoIds.has(choreo.id);
      const nameConflict = existingChoreoNames.get((choreo.name || "").toLowerCase());

      if (idExists) {
        status = ImportStatus.OVERWRITE;
        message = "ID已存在，将覆盖当前数据";
      } else if (nameConflict && nameConflict.id !== choreo.id) {
        status = ImportStatus.CONFLICT;
        message = `存在同名编排「${nameConflict.name}」`;
      } else {
        status = ImportStatus.ADD;
      }

      const existingData = idExists ? appState.choreographies.find((c) => c.id === choreo.id) : (nameConflict || null);
      const previewItem = {
        status,
        data: choreo,
        message,
        existingData,
        resolveMode: status === ImportStatus.CONFLICT ? ResolveMode.ADD_COPY : null,
        section: SectionType.CHOREOGRAPHIES
      };
      if (existingData && (status === ImportStatus.CONFLICT || status === ImportStatus.OVERWRITE)) {
        previewItem.diff = computeDiff(previewItem, SectionType.CHOREOGRAPHIES);
      }
      result.stats[status]++;
      result.choreographies.push(previewItem);

      if (Array.isArray(choreo.items)) {
        choreo.items.forEach((item, idx) => {
          if (item && item.actionId) {
            result.referenceChecks.actionRefs.valid.push({
              choreoId: choreo.id,
              itemIndex: idx,
              actionId: item.actionId,
              actionName: item.actionSnapshotName
            });
          }
        });
      }
    });

    (backup.data.scores || []).forEach((score) => {
      if (!score || !score.id || !score.actionId) {
        result.stats.error++;
        result.scores.push({
          status: ImportStatus.ERROR,
          data: score,
          message: "评分数据无效",
          resolveMode: ResolveMode.SKIP
        });
        return;
      }

      let status, message;
      const existingData = existingScoreIds.has(score.id)
        ? appState.scores.find((s) => s.id === score.id)
        : null;

      if (existingData) {
        status = ImportStatus.OVERWRITE;
        message = "ID已存在";
      } else {
        status = ImportStatus.ADD;
        message = "";
      }

      const previewItem = {
        status,
        data: score,
        message,
        existingData,
        section: SectionType.SCORES
      };
      if (existingData && (status === ImportStatus.CONFLICT || status === ImportStatus.OVERWRITE)) {
        previewItem.diff = computeDiff(previewItem, SectionType.SCORES);
      }
      result.stats[status]++;
      result.scores.push(previewItem);

      result.referenceChecks.actionRefs.valid.push({
        scoreId: score.id,
        actionId: score.actionId,
        type: "score"
      });
    });

    const backupMediaIds = collectMediaIdsFromState(backup.data.actions);
    const backupMediaMeta = backup.media.meta || [];
    const backupMediaData = backup.media.data || {};

    backupMediaMeta.forEach((m) => {
      if (existingMediaIds.has(m.id)) {
        result.media.existing.push(m);
      } else if (backupMediaData[m.id]) {
        result.media.available.push(m);
      } else {
        result.media.missing.push(m);
      }
      backupMediaIds.delete(m.id);
    });

    backupMediaIds.forEach((mid) => {
      if (!result.media.missing.some((m) => m.id === mid)) {
        result.media.missing.push({ id: mid, name: "未知素材", type: "unknown" });
      }
    });

    if (result.media.missing.length > 0) {
      result.warnings.push(`${result.media.missing.length} 个素材在备份中缺失或无法在当前素材库找到，导入后这些素材将无法显示`);
    }

    const importedActionIds = new Set(backup.data.actions.filter((a) => a && a.id).map((a) => a.id));
    backup.data.scores.forEach((score) => {
      if (score && score.actionId && !importedActionIds.has(score.actionId)) {
        if (!existingActionIds.has(score.actionId)) {
          result.warnings.push(`部分评分引用的动作ID（${score.actionId.slice(0, 8)}...）在备份和本地都不存在，导入后这些评分可能无法关联显示`);
        }
      }
    });

    const allActionIds = new Set([...existingActionIds, ...importedActionIds]);
    backup.data.choreographies.forEach((choreo) => {
      if (choreo && Array.isArray(choreo.items)) {
        choreo.items.forEach((item) => {
          if (item && item.actionId && !allActionIds.has(item.actionId)) {
            result.warnings.push(`编排「${choreo.name}」中的动作「${item.actionSnapshotName || item.actionId}」在导入后可能无法关联`);
          }
        });
      }
    });

    (backup.data.plans || []).forEach((plan) => {
      if (!plan || !plan.id || !plan.date) {
        result.stats.error++;
        result.plans.push({
          status: ImportStatus.ERROR,
          data: plan,
          message: "练习计划数据无效（缺少ID或日期）",
          resolveMode: ResolveMode.SKIP
        });
        return;
      }

      let status;
      let message = "";
      if (existingPlanIds.has(plan.id)) {
        status = ImportStatus.OVERWRITE;
        message = "ID已存在，将覆盖当前数据";
      } else {
        status = ImportStatus.ADD;
      }

      const existingData = existingPlanIds.has(plan.id)
        ? (window.PracticeCalendar ? window.PracticeCalendar.getPlanById(plan.id) : null)
        : null;

      const previewItem = {
        status,
        data: plan,
        message,
        existingData,
        section: SectionType.PLANS
      };
      if (existingData && (status === ImportStatus.CONFLICT || status === ImportStatus.OVERWRITE)) {
        previewItem.diff = computeDiff(previewItem, SectionType.PLANS);
      }
      result.stats[status]++;
      result.plans.push(previewItem);

      if (plan.refId) {
        if (plan.type === "choreography") {
          result.referenceChecks.choreoRefs.valid.push({
            planId: plan.id,
            choreoId: plan.refId,
            refName: plan.refName
          });
        } else {
          result.referenceChecks.actionRefs.valid.push({
            planId: plan.id,
            actionId: plan.refId,
            refName: plan.refName,
            type: "plan"
          });
        }
      }
    });

    const importedChoreoIds = new Set(backup.data.choreographies.filter((c) => c && c.id).map((c) => c.id));
    const allChoreoIds = new Set([...existingChoreoIds, ...importedChoreoIds]);
    backup.data.plans.forEach((plan) => {
      if (plan && plan.refId) {
        const validIds = plan.type === "choreography" ? allChoreoIds : allActionIds;
        if (!validIds.has(plan.refId)) {
          result.warnings.push(`练习计划(${plan.date})引用的${plan.type === "choreography" ? "编排" : "动作"}「${plan.refName}」在导入后可能无法关联，将显示为失效状态`);
        }
      }
    });

    validateReferences(result, existingActionIds, importedActionIds, existingChoreoIds, importedChoreoIds, existingMediaIds);

    return result;
  }

  function validateReferences(result, existingActionIds, importedActionIds, existingChoreoIds, importedChoreoIds, existingMediaIds) {
    const allActionIds = new Set([...existingActionIds, ...importedActionIds]);
    const allChoreoIds = new Set([...existingChoreoIds, ...importedChoreoIds]);
    const allMediaIds = new Set([...existingMediaIds, ...result.media.available.map((m) => m.id)]);

    result.referenceChecks.mediaIds.invalid = [];
    result.referenceChecks.actionRefs.invalid = [];
    result.referenceChecks.choreoRefs.invalid = [];

    const validMediaRefs = [];
    result.referenceChecks.mediaIds.valid.forEach((ref) => {
      if (!allMediaIds.has(ref.mediaId)) {
        result.referenceChecks.mediaIds.invalid.push(ref);
      } else {
        validMediaRefs.push(ref);
      }
    });
    result.referenceChecks.mediaIds.valid = validMediaRefs;

    const validActionRefs = [];
    result.referenceChecks.actionRefs.valid.forEach((ref) => {
      if (!allActionIds.has(ref.actionId)) {
        result.referenceChecks.actionRefs.invalid.push(ref);
      } else {
        validActionRefs.push(ref);
      }
    });
    result.referenceChecks.actionRefs.valid = validActionRefs;

    const validChoreoRefs = [];
    result.referenceChecks.choreoRefs.valid.forEach((ref) => {
      if (!allChoreoIds.has(ref.choreoId)) {
        result.referenceChecks.choreoRefs.invalid.push(ref);
      } else {
        validChoreoRefs.push(ref);
      }
    });
    result.referenceChecks.choreoRefs.valid = validChoreoRefs;
  }

  function resolveLabel(mode) {
    switch (mode) {
      case ResolveMode.ADD_COPY:
        return "创建副本";
      case ResolveMode.OVERWRITE:
        return "覆盖现有";
      case ResolveMode.SKIP:
        return "跳过";
      default:
        return "-";
    }
  }

  function renderResolveSelect(item, section, index) {
    if (item.status !== ImportStatus.CONFLICT) return "";
    return `
      <div class="resolve-controls">
        <span class="resolve-label">处理方式：</span>
        <select class="resolve-select" data-section="${section}" data-index="${index}">
          <option value="${ResolveMode.ADD_COPY}" ${item.resolveMode === ResolveMode.ADD_COPY ? "selected" : ""}>创建副本（重命名）</option>
          <option value="${ResolveMode.OVERWRITE}" ${item.resolveMode === ResolveMode.OVERWRITE ? "selected" : ""}>覆盖现有数据</option>
          <option value="${ResolveMode.SKIP}" ${item.resolveMode === ResolveMode.SKIP ? "selected" : ""}>跳过此条目</option>
        </select>
      </div>
    `;
  }

  function renderPreviewList(section) {
    const listEl = document.getElementById("importPreviewList");
    if (!listEl || !currentPreview) return;

    let items = [];
    let title = "";

    switch (section) {
      case "actions":
        items = currentPreview.actions;
        title = "动作";
        break;
      case "choreographies":
        items = currentPreview.choreographies;
        title = "编排";
        break;
      case "scores":
        items = currentPreview.scores;
        title = "评分";
        break;
      case "plans":
        items = currentPreview.plans;
        title = "练习计划";
        break;
      case "media":
        renderMediaList(listEl);
        return;
    }

    if (!items.length) {
      listEl.innerHTML = `<p class="muted">暂无${title}数据</p>`;
      return;
    }

    listEl.innerHTML = items.map((item, idx) => renderItemCard(item, section, idx)).join("");
    bindResolveSelectEvents();
  }

  function renderItemCard(item, section, index) {
    const overwriteEnabled = document.getElementById("importOverwriteDuplicates")?.checked ?? true;
    const effectiveStatus = getEffectiveStatus(item, overwriteEnabled);
    const statusCls = getStatusClass(effectiveStatus);
    const statusLabel = getStatusLabel(effectiveStatus);
    const data = item.data;
    let name = "";
    let detail = "";

    if (section === "actions") {
      name = data.name || "未命名动作";
      const frameCount = Array.isArray(data.frames) ? data.frames.length : 0;
      const annCount = Array.isArray(data.annotations) ? data.annotations.length : 0;
      const scoreCount = (parsedBackupData?.data?.scores || []).filter((s) => s.actionId === data.id).length;
      detail = `${frameCount} 个关键帧 · ${annCount} 个批注 · ${scoreCount} 条评分 · ${formatDate(data.createdAt)}`;
    } else if (section === "choreographies") {
      name = data.name || "未命名编排";
      const itemCount = Array.isArray(data.items) ? data.items.length : 0;
      detail = `${itemCount} 个动作 · 更新于 ${formatDate(data.updatedAt)}`;
    } else if (section === "scores") {
      const action = (parsedBackupData?.data?.actions || []).find((a) => a.id === data.actionId);
      name = action ? `${action.name} 的评分` : "未知动作评分";
      detail = `总分 ${data.total || 0}/${data.maxTotal || 0} · ${formatDate(data.createdAt)}`;
    } else if (section === "plans") {
      name = `${data.date} · ${data.refName || "未知内容"}`;
      detail = `${data.type === "choreography" ? "编排" : "动作"} · ${data.completed ? "已完成" : "未完成"} · ${formatDate(data.createdAt)}`;
    }

    const conflictHint = item.existingData
      ? `<div class="item-existing">当前：${escapeHtml(item.existingData.name || item.existingData.date || "(无名称)")}</div>`
      : "";

    const diffSummary = item.diff && item.diff.fields.length > 0
      ? `<div class="diff-summary">📊 ${item.diff.hasMajorChanges ? "重要" : ""}差异：${item.diff.fields.map((f) => `<span class="diff-tag">${escapeHtml(f.label)}</span>`).join("")}</div>`
      : "";

    const conflictDetail = (item.status === ImportStatus.CONFLICT || item.status === ImportStatus.OVERWRITE)
      ? renderConflictDetail(item, section, index)
      : "";

    return `
      <div class="import-item-card ${statusCls}">
        <div class="item-status-badge">${statusLabel}</div>
        <div class="item-body">
          <div class="item-name">${escapeHtml(name)}</div>
          <div class="item-detail">${escapeHtml(detail)}</div>
          ${item.message ? `<div class="item-message">${escapeHtml(item.message)}</div>` : ""}
          ${diffSummary}
          ${renderResolveSelect(item, section, index)}
          ${conflictHint}
          ${conflictDetail}
        </div>
      </div>
    `;
  }

  function renderMediaList(listEl) {
    if (!currentPreview) return;

    const { available, missing, existing } = currentPreview.media;
    const parts = [];

    if (available.length) {
      parts.push(`<h4 class="media-section-title">可导入素材 (${available.length})</h4>`);
      parts.push(`<div class="media-grid">`);
      available.forEach((m) => {
        parts.push(`
          <div class="media-item item-add">
            <div class="media-thumb">${MediaLibrary.isVideoType(m.type) ? "🎬" : "🖼"}</div>
            <div class="media-name">${escapeHtml(m.name || "未命名")}</div>
            <div class="media-meta">${m.size ? formatSize(m.size) : "-"} · ${MediaLibrary.isVideoType(m.type) ? "视频" : "图片"}</div>
            <div class="media-status add">将新增</div>
          </div>
        `);
      });
      parts.push(`</div>`);
    }

    if (existing.length) {
      parts.push(`<h4 class="media-section-title">已存在素材 (${existing.length})</h4>`);
      parts.push(`<div class="media-grid">`);
      existing.forEach((m) => {
        parts.push(`
          <div class="media-item item-skip">
            <div class="media-thumb">${MediaLibrary.isVideoType(m.type) ? "🎬" : "🖼"}</div>
            <div class="media-name">${escapeHtml(m.name || "未命名")}</div>
            <div class="media-meta">${m.size ? formatSize(m.size) : "-"}</div>
            <div class="media-status skip">已存在，跳过</div>
          </div>
        `);
      });
      parts.push(`</div>`);
    }

    if (missing.length) {
      parts.push(`<h4 class="media-section-title">缺失素材 (${missing.length})</h4>`);
      parts.push(`<div class="media-grid">`);
      missing.forEach((m) => {
        parts.push(`
          <div class="media-item item-error">
            <div class="media-thumb">❓</div>
            <div class="media-name">${escapeHtml(m.name || "未知素材")}</div>
            <div class="media-meta">${m.type && m.type !== "unknown" ? m.type : "类型未知"}</div>
            <div class="media-status error">数据缺失</div>
          </div>
        `);
      });
      parts.push(`</div>`);
    }

    if (!available.length && !existing.length && !missing.length) {
      parts.push(`<p class="muted">暂无素材数据</p>`);
    }

    listEl.innerHTML = parts.join("");
  }

  function renderSectionStats() {
    if (!currentPreview) return "";
    const overwriteEnabled = document.getElementById("importOverwriteDuplicates")?.checked ?? true;
    const includeMedia = document.getElementById("importIncludeMedia")?.checked ?? true;

    const sectionStats = computeAllSectionStats(currentPreview, overwriteEnabled, includeMedia);
    const sections = [
      SectionType.ACTIONS,
      SectionType.CHOREOGRAPHIES,
      SectionType.SCORES,
      SectionType.PLANS,
      SectionType.MEDIA
    ];

    const parts = [];
    parts.push(`<div class="section-stats-header">
      <span class="section-stats-title">📋 按类别差异预览</span>
      <span class="section-stats-hint">点击标签快速跳转</span>
    </div>`);
    parts.push(`<div class="section-stats-grid">`);

    sections.forEach((section) => {
      const stats = sectionStats[section];
      const label = getSectionLabel(section);
      const isActive = currentSection === section;

      if (stats.total === 0) return;

      parts.push(`
        <button type="button" class="section-stat-card ${isActive ? "active" : ""}" data-jump-section="${section}">
          <div class="section-stat-label">${label}</div>
          <div class="section-stat-counts">
            ${stats.add > 0 ? `<span class="section-stat-badge add" title="新增">➕ ${stats.add}</span>` : ""}
            ${stats.overwrite > 0 ? `<span class="section-stat-badge overwrite" title="覆盖">🔄 ${stats.overwrite}</span>` : ""}
            ${stats.skip > 0 ? `<span class="section-stat-badge skip" title="跳过">⏭ ${stats.skip}</span>` : ""}
            ${stats.conflict > 0 ? `<span class="section-stat-badge conflict" title="冲突">⚠ ${stats.conflict}</span>` : ""}
            ${stats.error > 0 ? `<span class="section-stat-badge error" title="错误">❌ ${stats.error}</span>` : ""}
          </div>
          <div class="section-stat-total">共 ${stats.total} 项</div>
        </button>
      `);
    });

    parts.push(`</div>`);
    return parts.join("");
  }

  function computePreviewStats() {
    if (!currentPreview) return null;
    const overwriteEnabled = document.getElementById("importOverwriteDuplicates")?.checked ?? true;
    const includeMedia = document.getElementById("importIncludeMedia")?.checked ?? true;

    const stats = { add: 0, overwrite: 0, skip: 0, conflict: 0, error: 0 };

    ["actions", "choreographies", "scores", "plans"].forEach((section) => {
      currentPreview[section].forEach((item) => {
        const eff = getEffectiveStatus(item, overwriteEnabled);
        stats[eff] = (stats[eff] || 0) + 1;
      });
    });

    const mediaAddCount = includeMedia ? currentPreview.media.available.length : 0;
    const mediaSkipCount = includeMedia ? currentPreview.media.existing.length : 0;

    return {
      add: stats.add + mediaAddCount,
      overwrite: stats.overwrite,
      skip: stats.skip + mediaSkipCount,
      conflict: stats.conflict,
      error: stats.error + (includeMedia ? 0 : 0)
    };
  }

  function updatePreviewStats() {
    const stats = computePreviewStats();
    if (!stats) return;

    const elAdd = document.getElementById("statAddCount");
    const elOver = document.getElementById("statOverwriteCount");
    const elSkip = document.getElementById("statSkipCount");
    const elConf = document.getElementById("statConflictCount");

    if (elAdd) elAdd.textContent = stats.add;
    if (elOver) elOver.textContent = stats.overwrite;
    if (elSkip) elSkip.textContent = stats.skip;
    const confText = stats.error > 0 ? `${stats.conflict + stats.error} (错误${stats.error})` : String(stats.conflict);
    if (elConf) elConf.textContent = confText;
  }

  function renderPreviewContent() {
    if (!currentPreview || !parsedBackupData) return;

    document.getElementById("importBackupVersion").textContent = `v${parsedBackupData.version || "未知"}`;
    document.getElementById("importBackupDate").textContent = formatDate(parsedBackupData.exportedAt);
    document.getElementById("importActionCount").textContent = `${parsedBackupData.data.actions.length} 个`;
    document.getElementById("importChoreoCount").textContent = `${parsedBackupData.data.choreographies.length} 个`;
    document.getElementById("importScoreCount").textContent = `${parsedBackupData.data.scores.length} 条`;
    document.getElementById("importPlanCount").textContent = `${parsedBackupData.data.plans.length} 个`;
    const mediaCount = (parsedBackupData.media?.meta?.length || 0);
    document.getElementById("importMediaCount").textContent = `${mediaCount} 个引用`;

    const sectionStatsContainer = document.getElementById("importSectionStats");
    if (sectionStatsContainer) {
      sectionStatsContainer.innerHTML = renderSectionStats();
    }

    updatePreviewStats();

    const warningsEl = document.getElementById("importWarnings");
    const warningsListEl = document.getElementById("importWarningsList");
    if (currentPreview.warnings && currentPreview.warnings.length) {
      warningsListEl.innerHTML = currentPreview.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
      warningsEl.hidden = false;
    } else {
      warningsEl.hidden = true;
    }

    document.querySelectorAll(".import-section-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.importSection === currentSection);
    });

    renderPreviewList(currentSection);

    const confirmBtn = document.getElementById("confirmImportBtn");
    if (confirmBtn) {
      const stats = computePreviewStats();
      const hasImportable = stats && (stats.add > 0 || stats.overwrite > 0);
      confirmBtn.disabled = !hasImportable;
    }

    bindSectionStatsEvents();
    bindConflictExpandEvents();
  }

  function showError(title, message) {
    const loadingEl = document.getElementById("importLoading");
    const errorEl = document.getElementById("importError");
    const contentEl = document.getElementById("importPreviewContent");

    if (loadingEl) loadingEl.hidden = true;
    if (contentEl) contentEl.hidden = true;
    if (errorEl) {
      errorEl.hidden = false;
      const titleEl = document.getElementById("importErrorTitle");
      const msgEl = document.getElementById("importErrorMsg");
      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
    }
  }

  function showLoading(show) {
    const loadingEl = document.getElementById("importLoading");
    const errorEl = document.getElementById("importError");
    const contentEl = document.getElementById("importPreviewContent");

    if (loadingEl) loadingEl.hidden = !show;
    if (errorEl) errorEl.hidden = true;
    if (contentEl) contentEl.hidden = show;
  }

  function showContent() {
    const loadingEl = document.getElementById("importLoading");
    const errorEl = document.getElementById("importError");
    const contentEl = document.getElementById("importPreviewContent");

    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
  }

  function resetPreview(keepResult = false) {
    currentPreview = null;
    parsedBackupData = null;
    currentSection = "actions";
    if (!keepResult) {
      lastImportResult = null;
    }
    const fileInput = document.getElementById("importFileInput");
    if (fileInput) fileInput.value = "";
  }

  function closeImportPreview(keepResultModal = false) {
    const modal = document.getElementById("importPreviewModal");
    if (modal) modal.hidden = true;
    if (!keepResultModal) {
      hideImportResultModal();
    }
    resetPreview(keepResultModal);
  }

  function openImportPreview() {
    const modal = document.getElementById("importPreviewModal");
    if (modal) modal.hidden = false;
    showLoading(true);

    setTimeout(() => {
      const fileInput = document.getElementById("importFileInput");
      if (fileInput) fileInput.click();
    }, 100);
  }

  async function handleImportFile(file) {
    if (!file) {
      closeImportPreview();
      return;
    }

    showLoading(true);
    currentPreview = null;
    parsedBackupData = null;

    try {
      if (file.size > 500 * 1024 * 1024) {
        showError("文件过大", `备份文件大小为 ${formatSize(file.size)}，超过 500MB 的限制。\n建议拆分为多个较小的备份文件分别导入。`);
        return;
      }

      const text = await file.text();
      let backup;

      try {
        backup = JSON.parse(text);
      } catch (parseErr) {
        let hint = "";
        if (file.name && !file.name.toLowerCase().endsWith(".json")) {
          hint = `\n\n提示：您选择的文件是「${file.name}」，请确认为本应用导出的 .json 备份文件。`;
        }
        showError("JSON 解析失败", `备份文件「${file.name || "未知文件"}」不是有效的 JSON 格式，可能已损坏或被篡改。\n\n错误详情：${parseErr.message || parseErr}${hint}`);
        return;
      }

      const validation = validateBackupStructure(backup);
      if (!validation.valid) {
        showError("备份文件无效", validation.errors.join("\n"));
        if (validation.warnings.length) {
          console.warn("备份校验警告:", validation.warnings);
        }
        return;
      }

      const migration = migrateBackupData(backup);
      backup = migration.backup;
      backup._migrationWarnings = migration.warnings;

      if (validation.warnings.length) {
        backup._migrationWarnings = [...(backup._migrationWarnings || []), ...validation.warnings];
      }

      parsedBackupData = backup;
      currentPreview = await analyzeImport(backup);

      showContent();
      renderPreviewContent();
    } catch (err) {
      console.error("导入解析失败:", err);
      showError("导入失败", err.message || "未知错误");
    }
  }

  function cloneStateSnapshot(state) {
    return {
      actions: JSON.parse(JSON.stringify(state.actions || [])),
      choreographies: JSON.parse(JSON.stringify(state.choreographies || [])),
      scores: JSON.parse(JSON.stringify(state.scores || [])),
      activeId: state.activeId,
      activeSessionId: state.activeSessionId,
      activeChoreographyId: state.activeChoreographyId,
      sessions: JSON.parse(JSON.stringify(state.sessions || []))
    };
  }

  function restoreStateSnapshot(state, snapshot) {
    state.actions = snapshot.actions;
    state.choreographies = snapshot.choreographies;
    state.scores = snapshot.scores;
    state.activeId = snapshot.activeId;
    state.activeSessionId = snapshot.activeSessionId;
    state.activeChoreographyId = snapshot.activeChoreographyId;
    state.sessions = snapshot.sessions;
  }

  async function performImport() {
    if (!currentPreview || !parsedBackupData) return;

    const overwriteEnabled = document.getElementById("importOverwriteDuplicates")?.checked ?? true;
    const includeMediaChecked = document.getElementById("importIncludeMedia")?.checked ?? true;

    const appState = getAppState();
    if (!appState) {
      showToast("导入失败：无法获取应用状态", "error");
      return;
    }

    const confirmBtn = document.getElementById("confirmImportBtn");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "正在导入...";
    }

    const importResult = {
      success: [],
      failed: [],
      skipped: [],
      mediaAdded: [],
      rollbackMedia: [],
      startTime: Date.now()
    };

    const stateSnapshot = cloneStateSnapshot(appState);
    const importedMediaIds = new Set();
    const idRemap = {};
    const failedMediaIds = new Set();
    const importedActionIds = new Set();
    const skippedActionIds = new Set();
    const skippedChoreoIds = new Set();

    try {
      (currentPreview.media.missing || []).forEach((m) => failedMediaIds.add(m.id));
      if (!includeMediaChecked) {
        (currentPreview.media.available || []).forEach((m) => failedMediaIds.add(m.id));
      }

      currentPreview.actions.forEach((item) => {
        const effStatus = getEffectiveStatus(item, overwriteEnabled);
        if (item.status === ImportStatus.ERROR || effStatus === ImportStatus.SKIP ||
            (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.SKIP)) {
          skippedActionIds.add(item.data.id);
        }
      });
      currentPreview.choreographies.forEach((item) => {
        const effStatus = getEffectiveStatus(item, overwriteEnabled);
        if (item.status === ImportStatus.ERROR || effStatus === ImportStatus.SKIP ||
            (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.SKIP)) {
          skippedChoreoIds.add(item.data.id);
        }
      });

      if (includeMediaChecked && currentPreview.media.available.length) {
        for (const mediaMeta of currentPreview.media.available) {
          try {
            const dataUrl = parsedBackupData.media.data[mediaMeta.id];
            if (dataUrl) {
              const saved = await MediaLibrary.addMedia(dataUrl, mediaMeta.type, mediaMeta.name);
              idRemap[`media:${mediaMeta.id}`] = saved.id;
              importedMediaIds.add(saved.id);
              importResult.mediaAdded.push({ ...mediaMeta, newId: saved.id });
              importResult.rollbackMedia.push(saved.id);
              importResult.success.push({ type: "素材", name: mediaMeta.name, status: "新增" });
            }
          } catch (mediaErr) {
            failedMediaIds.add(mediaMeta.id);
            importResult.failed.push({ type: "素材", name: mediaMeta.name, error: mediaErr.message || mediaErr });
            console.error("素材导入失败:", mediaErr);
          }
        }
      }

      const existingActionNames = new Map();
      (appState.actions || []).forEach((a) => existingActionNames.set((a.name || "").toLowerCase(), a));

      for (let i = 0; i < currentPreview.actions.length; i++) {
        const item = currentPreview.actions[i];
        const effStatus = getEffectiveStatus(item, overwriteEnabled);
        try {
          if (item.status === ImportStatus.ERROR || effStatus === ImportStatus.SKIP) {
            if (item.status === ImportStatus.ERROR) {
              importResult.failed.push({ type: "动作", name: item.data?.name || "(无效数据)", error: item.message });
            } else {
              importResult.skipped.push({ type: "动作", name: item.data?.name, reason: "用户选择跳过" });
            }
            continue;
          }

          const actionData = JSON.parse(JSON.stringify(item.data));
          const isConflictedCopy = item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.ADD_COPY;

          if (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.SKIP) {
            importResult.skipped.push({ type: "动作", name: actionData.name, reason: "同名冲突，选择跳过" });
            continue;
          }

          if (isConflictedCopy) {
            actionData.id = crypto.randomUUID();
            let baseName = actionData.name;
            let counter = 1;
            let newName = `${baseName} (导入副本)`;
            while (existingActionNames.has(newName.toLowerCase())) {
              counter++;
              newName = `${baseName} (导入副本 ${counter})`;
            }
            actionData.name = newName;
            existingActionNames.set(newName.toLowerCase(), actionData);
          }

          if (actionData.mediaId) {
            if (idRemap[`media:${actionData.mediaId}`]) {
              actionData.mediaId = idRemap[`media:${actionData.mediaId}`];
            } else if (failedMediaIds.has(actionData.mediaId)) {
              delete actionData.mediaId;
              if (actionData.mediaRef) delete actionData.mediaRef;
              importResult.warnings = importResult.warnings || [];
              importResult.warnings.push(`动作「${actionData.name}」引用的素材导入失败，已移除素材引用`);
            }
          }
          if (actionData.mediaRef && actionData.mediaRef.id) {
            if (idRemap[`media:${actionData.mediaRef.id}`]) {
              actionData.mediaRef.id = idRemap[`media:${actionData.mediaRef.id}`];
            } else if (failedMediaIds.has(actionData.mediaRef.id)) {
              delete actionData.mediaRef;
            }
          }

          idRemap[`action:${item.data.id}`] = actionData.id;

          const isOverwrite = item.status === ImportStatus.OVERWRITE ||
            (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.OVERWRITE);

          if (isOverwrite) {
            const targetId = item.status === ImportStatus.CONFLICT ? item.existingData.id : actionData.id;
            const idx = appState.actions.findIndex((a) => a.id === targetId);
            if (idx >= 0) {
              if (item.status === ImportStatus.CONFLICT) {
                actionData.id = targetId;
                idRemap[`action:${item.data.id}`] = targetId;
              }
              appState.actions[idx] = actionData;
              importedActionIds.add(actionData.id);
              importResult.success.push({ type: "动作", name: actionData.name, status: "覆盖" });
            } else {
              appState.actions.unshift(actionData);
              importedActionIds.add(actionData.id);
              importResult.success.push({ type: "动作", name: actionData.name, status: "新增" });
            }
          } else {
            appState.actions.unshift(actionData);
            importedActionIds.add(actionData.id);
            importResult.success.push({ type: "动作", name: actionData.name, status: isConflictedCopy ? "新增(副本)" : "新增" });
          }
        } catch (actionErr) {
          importResult.failed.push({ type: "动作", name: item.data?.name || "未知", error: actionErr.message || actionErr });
          console.error("动作导入失败:", actionErr);
        }
      }

      const existingChoreoNames = new Map();
      (appState.choreographies || []).forEach((c) => existingChoreoNames.set((c.name || "").toLowerCase(), c));

      for (let i = 0; i < currentPreview.choreographies.length; i++) {
        const item = currentPreview.choreographies[i];
        const effStatus = getEffectiveStatus(item, overwriteEnabled);
        try {
          if (item.status === ImportStatus.ERROR || effStatus === ImportStatus.SKIP) {
            if (item.status === ImportStatus.ERROR) {
              importResult.failed.push({ type: "编排", name: item.data?.name || "(无效数据)", error: item.message });
            } else {
              importResult.skipped.push({ type: "编排", name: item.data?.name, reason: "用户选择跳过" });
            }
            continue;
          }

          const choreoData = JSON.parse(JSON.stringify(item.data));
          const isConflictedCopy = item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.ADD_COPY;

          if (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.SKIP) {
            importResult.skipped.push({ type: "编排", name: choreoData.name, reason: "同名冲突，选择跳过" });
            continue;
          }

          if (isConflictedCopy) {
            choreoData.id = crypto.randomUUID();
            let baseName = choreoData.name;
            let counter = 1;
            let newName = `${baseName} (导入副本)`;
            while (existingChoreoNames.has(newName.toLowerCase())) {
              counter++;
              newName = `${baseName} (导入副本 ${counter})`;
            }
            choreoData.name = newName;
            existingChoreoNames.set(newName.toLowerCase(), choreoData);
          }

          idRemap[`choreography:${item.data.id}`] = choreoData.id;

          if (Array.isArray(choreoData.items)) {
            const validLocalActionIds = new Set((appState.actions || []).map((a) => a.id));
            let removedCount = 0;
            choreoData.items = choreoData.items.filter((choreoItem) => {
              if (!choreoItem.actionId) return true;
              if (idRemap[`action:${choreoItem.actionId}`]) {
                choreoItem.actionId = idRemap[`action:${choreoItem.actionId}`];
                return true;
              }
              if (validLocalActionIds.has(choreoItem.actionId)) return true;
              if (skippedActionIds.has(choreoItem.actionId)) {
                removedCount++;
                return false;
              }
              removedCount++;
              return false;
            });
            if (removedCount > 0) {
              importResult.warnings = importResult.warnings || [];
              importResult.warnings.push(`编排「${choreoData.name}」中有 ${removedCount} 个动作引用失效（对应动作导入失败/跳过），已自动移除`);
            }
          }

          const isOverwrite = item.status === ImportStatus.OVERWRITE ||
            (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.OVERWRITE);

          if (isOverwrite) {
            const targetId = item.status === ImportStatus.CONFLICT ? item.existingData.id : choreoData.id;
            const idx = appState.choreographies.findIndex((c) => c.id === targetId);
            if (idx >= 0) {
              if (item.status === ImportStatus.CONFLICT) {
                choreoData.id = targetId;
                idRemap[`choreography:${item.data.id}`] = targetId;
              }
              appState.choreographies[idx] = choreoData;
              importResult.success.push({ type: "编排", name: choreoData.name, status: "覆盖" });
            } else {
              appState.choreographies.unshift(choreoData);
              importResult.success.push({ type: "编排", name: choreoData.name, status: "新增" });
            }
          } else {
            appState.choreographies.unshift(choreoData);
            importResult.success.push({ type: "编排", name: choreoData.name, status: isConflictedCopy ? "新增(副本)" : "新增" });
          }
        } catch (choreoErr) {
          importResult.failed.push({ type: "编排", name: item.data?.name || "未知", error: choreoErr.message || choreoErr });
          console.error("编排导入失败:", choreoErr);
        }
      }

      for (let i = 0; i < currentPreview.scores.length; i++) {
        const item = currentPreview.scores[i];
        const effStatus = getEffectiveStatus(item, overwriteEnabled);
        try {
          if (item.status === ImportStatus.ERROR || effStatus === ImportStatus.SKIP) {
            if (item.status === ImportStatus.ERROR) {
              importResult.failed.push({ type: "评分", name: `动作ID ${item.data?.actionId?.slice(0, 8) || "未知"}...`, error: item.message });
            } else {
              importResult.skipped.push({ type: "评分", name: `动作ID ${item.data?.actionId?.slice(0, 8) || "?"}...`, reason: "用户选择跳过" });
            }
            continue;
          }

          const scoreData = JSON.parse(JSON.stringify(item.data));

          const validLocalActionIds = new Set((appState.actions || []).map((a) => a.id));
          let mappedActionId = null;
          if (scoreData.actionId && idRemap[`action:${scoreData.actionId}`]) {
            mappedActionId = idRemap[`action:${scoreData.actionId}`];
            scoreData.actionId = mappedActionId;
          } else if (scoreData.actionId && validLocalActionIds.has(scoreData.actionId)) {
            mappedActionId = scoreData.actionId;
          }

          if (scoreData.actionId && !mappedActionId) {
            const skipped = skippedActionIds.has(scoreData.actionId);
            importResult.skipped.push({
              type: "评分",
              name: `动作ID ${scoreData.actionId.slice(0, 8)}...`,
              reason: `引用的动作${skipped ? "被跳过" : "导入失败"}，评分无法关联`
            });
            continue;
          }

          if (item.status === ImportStatus.OVERWRITE) {
            const idx = appState.scores.findIndex((s) => s.id === scoreData.id);
            if (idx >= 0) {
              appState.scores[idx] = scoreData;
              importResult.success.push({ type: "评分", name: `动作ID ${scoreData.actionId?.slice(0, 8) || "?"}...`, status: "覆盖" });
            } else {
              appState.scores.unshift(scoreData);
              importResult.success.push({ type: "评分", name: `动作ID ${scoreData.actionId?.slice(0, 8) || "?"}...`, status: "新增" });
            }
          } else {
            appState.scores.unshift(scoreData);
            importResult.success.push({ type: "评分", name: `动作ID ${scoreData.actionId?.slice(0, 8) || "?"}...`, status: "新增" });
          }
        } catch (scoreErr) {
          importResult.failed.push({ type: "评分", name: "未知", error: scoreErr.message || scoreErr });
          console.error("评分导入失败:", scoreErr);
        }
      }

      if (window.PracticeCalendar) {
        const validLocalActionIds = new Set((appState.actions || []).map((a) => a.id));
        const validLocalChoreoIds = new Set((appState.choreographies || []).map((c) => c.id));

        for (let i = 0; i < currentPreview.plans.length; i++) {
          const item = currentPreview.plans[i];
          const effStatus = getEffectiveStatus(item, overwriteEnabled);
          try {
            if (item.status === ImportStatus.ERROR || effStatus === ImportStatus.SKIP) {
              if (item.status === ImportStatus.ERROR) {
                importResult.failed.push({ type: "练习计划", name: item.data?.date || "(无效数据)", error: item.message });
              } else {
                importResult.skipped.push({ type: "练习计划", name: item.data?.date, reason: "用户选择跳过" });
              }
              continue;
            }

            if (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.SKIP) {
              importResult.skipped.push({ type: "练习计划", name: item.data?.date, reason: "ID冲突，选择跳过" });
              continue;
            }

            const planData = JSON.parse(JSON.stringify(item.data));
            const isConflictedCopy = item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.ADD_COPY;

            if (isConflictedCopy) {
              planData.id = crypto.randomUUID();
            }

            idRemap[`plan:${item.data.id}`] = planData.id;

            if (planData.refId && idRemap[`${planData.type}:${planData.refId}`]) {
              planData.refId = idRemap[`${planData.type}:${planData.refId}`];
            }

            const validIds = planData.type === "choreography" ? validLocalChoreoIds : validLocalActionIds;
            const skippedIds = planData.type === "choreography" ? skippedChoreoIds : skippedActionIds;

            if (planData.refId && !validIds.has(planData.refId) && !idRemap[`${planData.type}:${planData.refId}`]) {
              const skipped = skippedIds.has(planData.refId);
              importResult.warnings = importResult.warnings || [];
              importResult.warnings.push(`练习计划(${planData.date})引用的${planData.type === "choreography" ? "编排" : "动作"}${skipped ? "被跳过" : "导入失败"}，计划将保留但显示为失效状态`);
            }

            const isOverwrite = item.status === ImportStatus.OVERWRITE ||
              (item.status === ImportStatus.CONFLICT && item.resolveMode === ResolveMode.OVERWRITE);

            if (isOverwrite) {
              const targetId = item.status === ImportStatus.CONFLICT ? item.existingData.id : planData.id;
              if (item.status === ImportStatus.CONFLICT) {
                planData.id = targetId;
                idRemap[`plan:${item.data.id}`] = targetId;
              }
              const updated = window.PracticeCalendar.updatePlan(targetId, planData);
              if (updated) {
                importResult.success.push({ type: "练习计划", name: `${planData.date} · ${planData.refName}`, status: "覆盖" });
              } else {
                window.PracticeCalendar.createPlan(planData);
                importResult.success.push({ type: "练习计划", name: `${planData.date} · ${planData.refName}`, status: "新增(原ID不存在)" });
              }
            } else {
              window.PracticeCalendar.createPlan(planData);
              importResult.success.push({ type: "练习计划", name: `${planData.date} · ${planData.refName}`, status: isConflictedCopy ? "新增(副本)" : "新增" });
            }
          } catch (planErr) {
            importResult.failed.push({ type: "练习计划", name: item.data?.date || "未知", error: planErr.message || planErr });
            console.error("练习计划导入失败:", planErr);
          }
        }
      }

      saveAppState();

      if (importedMediaIds.size > 0) {
        try {
          await MediaLibrary.syncUsedByReferences(appState);
        } catch (syncErr) {
          console.warn("素材引用同步失败:", syncErr);
        }
      }

      if (typeof window.__renderAll === "function") {
        window.__renderAll();
      } else if (typeof window.renderAll === "function") {
        window.renderAll();
      }

      const successCount = importResult.success.length;
      const failCount = importResult.failed.length;
      const skipCount = importResult.skipped.length;
      let msg = `导入完成：成功 ${successCount} 项`;
      if (skipCount > 0) msg += `，跳过 ${skipCount} 项`;
      if (failCount > 0) msg += `，失败 ${failCount} 项`;
      showToast(msg, failCount > 0 ? "warning" : "success", 5000);

      lastImportResult = importResult;
      showImportResultModal(importResult);

      closeImportPreview(true);
    } catch (err) {
      console.error("导入执行失败，正在回滚:", err);
      try {
        restoreStateSnapshot(appState, stateSnapshot);
        saveAppState();
        for (const mid of importResult.rollbackMedia) {
          try { await MediaLibrary.deleteMedia(mid); } catch (e) { console.warn("回滚素材删除失败:", e); }
        }
      } catch (rollbackErr) {
        console.error("回滚失败，数据可能处于不一致状态:", rollbackErr);
        showToast("严重错误：导入失败且回滚未完全成功，请刷新页面检查数据", "error", 8000);
      }
      showToast("导入执行失败：" + (err.message || err), "error");
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "确认导入";
      }
    }
  }

  function showImportResultModal(result) {
    let modal = document.getElementById("importResultModal");
    if (!modal) {
      const tpl = `
        <div class="modal-mask" id="importResultModal" hidden>
          <div class="modal import-result-modal">
            <header class="modal-head">
              <h3>导入结果</h3>
              <button class="modal-close" type="button" data-close-import-result>×</button>
            </header>
            <div class="modal-body">
              <div class="import-result-summary" id="importResultSummary"></div>
              <div class="import-result-tabs">
                <button class="ir-tab active" type="button" data-ir-tab="success">成功 (<span id="irSuccessCount">0</span>)</button>
                <button class="ir-tab" type="button" data-ir-tab="failed">失败 (<span id="irFailedCount">0</span>)</button>
                <button class="ir-tab" type="button" data-ir-tab="skipped">跳过 (<span id="irSkippedCount">0</span>)</button>
              </div>
              <div class="import-result-list" id="importResultList"></div>
            </div>
            <footer class="modal-foot">
              <div class="modal-actions">
                <button type="button" class="btn-accent" data-close-import-result>确定</button>
              </div>
            </footer>
          </div>
        </div>
      `;
      const wrapper = document.createElement("div");
      wrapper.innerHTML = tpl;
      const el = wrapper.firstElementChild;
      document.body.appendChild(el);
      modal = el;
      modal.querySelectorAll("[data-close-import-result]").forEach((btn) => {
        btn.addEventListener("click", () => hideImportResultModal());
      });
      modal.addEventListener("click", (e) => {
        if (e.target === modal) hideImportResultModal();
      });
      modal.querySelectorAll(".ir-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          const name = tab.dataset.irTab;
          modal.querySelectorAll(".ir-tab").forEach((t) => t.classList.toggle("active", t.dataset.irTab === name));
          renderImportResultList(name);
        });
      });
    }

    const duration = Date.now() - result.startTime;
    document.getElementById("importResultSummary").innerHTML = `
      <div class="ir-summary-grid">
        <div class="ir-summary-item ir-success">
          <div class="ir-s-num">${result.success.length}</div>
          <div class="ir-s-label">成功</div>
        </div>
        <div class="ir-summary-item ir-failed">
          <div class="ir-s-num">${result.failed.length}</div>
          <div class="ir-s-label">失败</div>
        </div>
        <div class="ir-summary-item ir-skipped">
          <div class="ir-s-num">${result.skipped.length}</div>
          <div class="ir-s-label">跳过</div>
        </div>
        <div class="ir-summary-item ir-time">
          <div class="ir-s-num">${(duration / 1000).toFixed(1)}s</div>
          <div class="ir-s-label">耗时</div>
        </div>
      </div>
    `;
    document.getElementById("irSuccessCount").textContent = result.success.length;
    document.getElementById("irFailedCount").textContent = result.failed.length;
    document.getElementById("irSkippedCount").textContent = result.skipped.length;

    modal.querySelectorAll(".ir-tab").forEach((t) => t.classList.toggle("active", t.dataset.irTab === "success"));
    renderImportResultList("success");
    modal.hidden = false;
  }

  function renderImportResultList(tab) {
    const listEl = document.getElementById("importResultList");
    if (!listEl || !lastImportResult) return;
    let data;
    if (tab === "success") data = lastImportResult.success;
    else if (tab === "failed") data = lastImportResult.failed;
    else data = lastImportResult.skipped;

    if (!data.length) {
      listEl.innerHTML = `<p class="muted">没有${tab === "success" ? "成功" : tab === "failed" ? "失败" : "跳过"}的记录</p>`;
      return;
    }

    listEl.innerHTML = data.map((item) => {
      if (tab === "success") {
        return `
          <div class="ir-card ir-card-success">
            <div class="ir-card-status">${escapeHtml(item.status)}</div>
            <div class="ir-card-body">
              <div class="ir-card-name">${escapeHtml(item.name)}</div>
              <div class="ir-card-type">${escapeHtml(item.type)}</div>
            </div>
          </div>
        `;
      } else if (tab === "failed") {
        return `
          <div class="ir-card ir-card-failed">
            <div class="ir-card-status">失败</div>
            <div class="ir-card-body">
              <div class="ir-card-name">${escapeHtml(item.name)}</div>
              <div class="ir-card-type">${escapeHtml(item.type)}</div>
              <div class="ir-card-error">${escapeHtml(item.error)}</div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="ir-card ir-card-skipped">
            <div class="ir-card-status">跳过</div>
            <div class="ir-card-body">
              <div class="ir-card-name">${escapeHtml(item.name)}</div>
              <div class="ir-card-type">${escapeHtml(item.type)}</div>
              <div class="ir-card-reason">${escapeHtml(item.reason)}</div>
            </div>
          </div>
        `;
      }
    }).join("");
  }

  function hideImportResultModal() {
    const modal = document.getElementById("importResultModal");
    if (modal) modal.hidden = true;
  }

  function bindResolveSelectEvents() {
    document.querySelectorAll(".resolve-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const section = e.target.dataset.section;
        const index = parseInt(e.target.dataset.index, 10);
        const mode = e.target.value;
        if (!isNaN(index) && currentPreview && currentPreview[section]) {
          const item = currentPreview[section][index];
          if (item) {
            item.resolveMode = mode;
            renderPreviewContent();
          }
        }
      });
    });
  }

  function bindSectionStatsEvents() {
    document.querySelectorAll("[data-jump-section]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const section = e.currentTarget.dataset.jumpSection;
        if (section) {
          currentSection = section;
          renderPreviewContent();
        }
      });
    });
  }

  function bindConflictExpandEvents() {
    document.querySelectorAll("[data-conflict-expand]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const conflictId = e.currentTarget.dataset.conflictExpand;
        if (conflictId) {
          if (expandedConflictIds.has(conflictId)) {
            expandedConflictIds.delete(conflictId);
          } else {
            expandedConflictIds.add(conflictId);
          }
          renderPreviewContent();
          setTimeout(() => {
            const detailEl = document.querySelector(`[data-conflict-detail="${conflictId}"]`);
            if (detailEl && expandedConflictIds.has(conflictId)) {
              detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }, 50);
        }
      });
    });
  }

  function bindImportEvents() {
    const exportBtn = document.getElementById("exportBackupBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", handleExport);
    }

    const importBtn = document.getElementById("importBackupBtn");
    if (importBtn) {
      importBtn.addEventListener("click", openImportPreview);
    }

    const fileInput = document.getElementById("importFileInput");
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        handleImportFile(file);
      });
    }

    document.querySelectorAll("[data-close-import-preview]").forEach((el) => {
      el.addEventListener("click", closeImportPreview);
    });

    const modal = document.getElementById("importPreviewModal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          closeImportPreview();
        }
      });
    }

    document.querySelectorAll(".import-section-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const section = tab.dataset.importSection;
        if (section) {
          currentSection = section;
          renderPreviewContent();
        }
      });
    });

    const confirmBtn = document.getElementById("confirmImportBtn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        const stats = computePreviewStats();
        const add = stats?.add || 0;
        const overwrite = stats?.overwrite || 0;
        if (add === 0 && overwrite === 0) {
          showToast("没有可导入的数据", "warning");
          return;
        }
        const msg = [
          `即将执行导入操作：`,
          `  • 新增: ${add} 项`,
          `  • 覆盖: ${overwrite} 项`,
          overwrite > 0 ? `\n⚠ 此操作将覆盖 ${overwrite} 项现有数据，无法撤销。` : ``,
          `\n确认执行？`
        ].join("\n");
        if (confirm(msg)) {
          performImport();
        }
      });
    }

    const overwriteCheckbox = document.getElementById("importOverwriteDuplicates");
    if (overwriteCheckbox) {
      overwriteCheckbox.addEventListener("change", () => {
        renderPreviewContent();
      });
    }

    const includeMediaCheckbox = document.getElementById("importIncludeMedia");
    if (includeMediaCheckbox) {
      includeMediaCheckbox.addEventListener("change", () => {
        updatePreviewStats();
        renderPreviewContent();
      });
    }
  }

  function init() {
    bindImportEvents();
    if (!window.__renderAll && window.renderAll) {
      window.__renderAll = window.renderAll;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    init,
    exportBackup,
    handleExport,
    handleImportFile,
    closeImportPreview,
    performImport
  };
})();

window.ImportExport = ImportExport;
