const Choreography = (function () {
  const state = {
    choreographies: [],
    activeChoreographyId: null,
    editingChoreographyId: null,
    addingActionToChoreography: false,
  };

  function init(initialChoreos = []) {
    state.choreographies = initialChoreos;
    bindEvents();
    renderAll();
  }

  function getState() {
    return {
      choreographies: state.choreographies,
      activeChoreographyId: state.activeChoreographyId,
    };
  }

  function activeChoreography() {
    return state.choreographies.find((c) => c.id === state.activeChoreographyId) || null;
  }

  function editingChoreography() {
    return state.choreographies.find((c) => c.id === state.editingChoreographyId) || null;
  }

  function createChoreography(name, description = "") {
    const choreo = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.choreographies.unshift(choreo);
    saveToParent();
    renderChoreographyList();
    return choreo;
  }

  function updateChoreography(id, updates) {
    const choreo = state.choreographies.find((c) => c.id === id);
    if (!choreo) return null;
    Object.assign(choreo, updates, { updatedAt: new Date().toISOString() });
    saveToParent();
    renderAll();
    return choreo;
  }

  function deleteChoreography(id) {
    state.choreographies = state.choreographies.filter((c) => c.id !== id);
    if (state.activeChoreographyId === id) {
      state.activeChoreographyId = null;
    }
    if (state.editingChoreographyId === id) {
      state.editingChoreographyId = null;
      closeChoreographyModal();
    }
    saveToParent();
    renderAll();
  }

  function addActionToChoreography(choreoId, actionId, beats = 8, transitionHint = "", note = "") {
    const choreo = state.choreographies.find((c) => c.id === choreoId);
    const action = window.__appState?.actions?.find((a) => a.id === actionId);
    if (!choreo || !action) return null;

    const item = {
      id: crypto.randomUUID(),
      actionId: action.id,
      actionSnapshotName: action.name,
      beats: parseInt(beats, 10) || 8,
      transitionHint: transitionHint.trim(),
      note: note.trim(),
      order: choreo.items.length,
    };
    choreo.items.push(item);
    choreo.updatedAt = new Date().toISOString();
    saveToParent();
    renderAll();
    return item;
  }

  function updateChoreographyItem(choreoId, itemId, updates) {
    const choreo = state.choreographies.find((c) => c.id === choreoId);
    if (!choreo) return null;
    const item = choreo.items.find((i) => i.id === itemId);
    if (!item) return null;
    Object.assign(item, updates);
    choreo.updatedAt = new Date().toISOString();
    saveToParent();
    renderAll();
    return item;
  }

  function removeChoreographyItem(choreoId, itemId) {
    const choreo = state.choreographies.find((c) => c.id === choreoId);
    if (!choreo) return;
    choreo.items = choreo.items.filter((i) => i.id !== itemId);
    choreo.items.forEach((item, idx) => (item.order = idx));
    choreo.updatedAt = new Date().toISOString();
    saveToParent();
    renderAll();
  }

  function reorderChoreographyItem(choreoId, itemId, newIndex) {
    const choreo = state.choreographies.find((c) => c.id === choreoId);
    if (!choreo) return;
    const itemIndex = choreo.items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) return;
    const [item] = choreo.items.splice(itemIndex, 1);
    choreo.items.splice(newIndex, 0, item);
    choreo.items.forEach((i, idx) => (i.order = idx));
    choreo.updatedAt = new Date().toISOString();
    saveToParent();
    renderAll();
  }

  function getReferencingChoreographies(actionId) {
    return state.choreographies.filter((choreo) =>
      choreo.items.some((item) => item.actionId === actionId)
    );
  }

  function checkActionReferences(actionId) {
    const references = getReferencingChoreographies(actionId);
    return {
      hasReferences: references.length > 0,
      references,
    };
  }

  function detectActionChanges() {
    const actions = window.__appState?.actions || [];
    const changes = [];

    state.choreographies.forEach((choreo) => {
      choreo.items.forEach((item) => {
        const action = actions.find((a) => a.id === item.actionId);
        if (!action) {
          changes.push({
            type: "deleted",
            choreoId: choreo.id,
            choreoName: choreo.name,
            itemId: item.id,
            actionId: item.actionId,
            actionName: item.actionSnapshotName,
          });
        } else if (action.name !== item.actionSnapshotName) {
          changes.push({
            type: "renamed",
            choreoId: choreo.id,
            choreoName: choreo.name,
            itemId: item.id,
            actionId: action.id,
            oldName: item.actionSnapshotName,
            newName: action.name,
          });
        }
      });
    });

    return changes;
  }

  function syncActionNames() {
    const actions = window.__appState?.actions || [];
    let changed = false;

    state.choreographies.forEach((choreo) => {
      choreo.items.forEach((item) => {
        const action = actions.find((a) => a.id === item.actionId);
        if (action && action.name !== item.actionSnapshotName) {
          item.actionSnapshotName = action.name;
          changed = true;
        }
      });
    });

    if (changed) {
      saveToParent();
      renderAll();
    }
  }

  function updateSnapshotName(actionId, newName) {
    let changed = false;
    state.choreographies.forEach((choreo) => {
      choreo.items.forEach((item) => {
        if (item.actionId === actionId) {
          item.actionSnapshotName = newName;
          changed = true;
        }
      });
    });
    if (changed) {
      saveToParent();
      renderAll();
    }
  }

  function getTotalBeats(choreo) {
    return choreo.items.reduce((sum, item) => sum + (item.beats || 0), 0);
  }

  function getChoreographyWarnings(choreo) {
    const warnings = [];
    const actions = window.__appState?.actions || [];

    choreo.items.forEach((item) => {
      const action = actions.find((a) => a.id === item.actionId);
      if (!action) {
        warnings.push({
          type: "deleted",
          itemId: item.id,
          message: `动作「${item.actionSnapshotName}」已被删除`,
        });
      } else if (action.name !== item.actionSnapshotName) {
        warnings.push({
          type: "renamed",
          itemId: item.id,
          message: `动作已改名：「${item.actionSnapshotName}」→「${action.name}」`,
        });
      }
    });

    return warnings;
  }

  function renderChoreographyList() {
    const listEl = document.querySelector("#choreographyList");
    if (!listEl) return;

    if (!state.choreographies.length) {
      listEl.innerHTML = `<p class="muted">还没有编排，点击右上角"+ 新建编排"开始。</p>`;
      return;
    }

    const sorted = [...state.choreographies].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );

    listEl.innerHTML = sorted
      .map((choreo) => {
        const warnings = getChoreographyWarnings(choreo);
        const warningBadge = warnings.length
          ? `<span class="choreo-warning-badge">⚠ ${warnings.length}</span>`
          : "";
        return `
          <article class="choreo-card ${choreo.id === state.activeChoreographyId ? "active" : ""}" data-choreo="${choreo.id}">
            <header class="choreo-head">
              <strong>${escapeHtml(choreo.name)}</strong>
              ${warningBadge}
            </header>
            <p class="choreo-meta">
              ${choreo.items.length} 个动作 · ${getTotalBeats(choreo)} 拍
            </p>
            <p class="choreo-meta muted">
              更新于 ${formatDate(choreo.updatedAt)}
            </p>
            <div class="choreo-actions">
              <button type="button" class="btn-small btn-secondary" data-edit-choreo="${choreo.id}">编辑</button>
              <button type="button" class="btn-small btn-accent" data-view-choreo="${choreo.id}">查看</button>
              <button type="button" class="btn-small btn-danger" data-delete-choreo="${choreo.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderChoreographyEditor() {
    const choreo = editingChoreography();
    if (!choreo) return;

    const formEl = document.querySelector("#choreographyForm");
    const itemsListEl = document.querySelector("#choreoItemsList");
    const actionSelectEl = document.querySelector("#choreoActionSelect");
    const warningsEl = document.querySelector("#choreoEditorWarnings");

    if (formEl) {
      formEl.querySelector('input[name="name"]').value = choreo.name;
      formEl.querySelector('textarea[name="description"]').value = choreo.description || "";
    }

    const actions = window.__appState?.actions || [];
    if (actionSelectEl) {
      actionSelectEl.innerHTML = `<option value="">选择动作</option>` +
        actions.map((a) => `<option value="${a.id}">${a.name} (${a.frames.length}帧)</option>`).join("");
    }

    const warnings = getChoreographyWarnings(choreo);
    if (warningsEl) {
      if (warnings.length) {
        warningsEl.innerHTML = `
          <div class="choreo-warnings">
            <h4>⚠ 检测到 ${warnings.length} 个问题</h4>
            ${warnings.map((w) => `
              <div class="choreo-warning-item ${w.type}">
                ${escapeHtml(w.message)}
                ${w.type === "renamed" ? `<button type="button" class="btn-small btn-accent" data-sync-name="${w.itemId}">同步名称</button>` : ""}
              </div>
            `).join("")}
          </div>
        `;
        warningsEl.hidden = false;
      } else {
        warningsEl.innerHTML = "";
        warningsEl.hidden = true;
      }
    }

    if (itemsListEl) {
      if (!choreo.items.length) {
        itemsListEl.innerHTML = `<p class="muted">还没有添加动作，从下方选择并添加</p>`;
        return;
      }

      itemsListEl.innerHTML = choreo.items
        .sort((a, b) => a.order - b.order)
        .map((item, idx) => {
          const action = actions.find((a) => a.id === item.actionId);
          const isDeleted = !action;
          const isRenamed = action && action.name !== item.actionSnapshotName;
          const rowClass = isDeleted ? "deleted" : isRenamed ? "renamed" : "";

          return `
            <div class="choreo-item-row ${rowClass}" data-item="${item.id}">
              <div class="item-order">${idx + 1}</div>
              <div class="item-body">
                <div class="item-header">
                  <strong class="item-name">${escapeHtml(item.actionSnapshotName)}</strong>
                  ${isDeleted ? '<span class="item-badge deleted">已删除</span>' : ""}
                  ${isRenamed ? `<span class="item-badge renamed">已改名 → ${escapeHtml(action.name)}</span>` : ""}
                </div>
                <div class="item-fields">
                  <label>拍数
                    <input type="number" class="item-beats" data-item-beats="${item.id}" value="${item.beats}" min="1" max="64">
                  </label>
                  <label>过门提示
                    <input type="text" class="item-transition" data-item-transition="${item.id}" value="${escapeHtml(item.transitionHint)}" placeholder="如：圆场、亮相">
                  </label>
                </div>
                <label class="item-note-label">衔接备注
                  <textarea class="item-note" data-item-note="${item.id}" rows="2" placeholder="动作衔接要点...">${escapeHtml(item.note)}</textarea>
                </label>
              </div>
              <div class="item-actions">
                <button type="button" class="btn-small btn-secondary" data-item-up="${item.id}" ${idx === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="btn-small btn-secondary" data-item-down="${item.id}" ${idx === choreo.items.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="btn-small btn-danger" data-item-remove="${item.id}">×</button>
              </div>
            </div>
          `;
        })
        .join("");
    }
  }

  function renderChoreographyTimeline() {
    const timelineEl = document.querySelector("#choreographyTimeline");
    const choreo = activeChoreography();
    const actions = window.__appState?.actions || [];

    if (!timelineEl) return;

    if (!choreo) {
      timelineEl.innerHTML = `<div class="choreo-timeline-empty"><p>从左侧选择一个编排查看时间线</p></div>`;
      return;
    }

    const warnings = getChoreographyWarnings(choreo);
    const totalBeats = getTotalBeats(choreo);
    const sortedItems = [...choreo.items].sort((a, b) => a.order - b.order);

    let warningHtml = "";
    if (warnings.length) {
      warningHtml = `
        <div class="choreo-timeline-warnings">
          <h4>⚠ 编排包含 ${warnings.length} 个需要注意的问题</h4>
          ${warnings.map((w) => `<div class="choreo-timeline-warning ${w.type}">${escapeHtml(w.message)}</div>`).join("")}
        </div>
      `;
    }

    let cumulativeBeats = 0;
    const timelineHtml = sortedItems
      .map((item) => {
        const action = actions.find((a) => a.id === item.actionId);
        const isDeleted = !action;
        const isRenamed = action && action.name !== item.actionSnapshotName;
        const startBeat = cumulativeBeats;
        cumulativeBeats += item.beats;
        const endBeat = cumulativeBeats;
        const widthPercent = (item.beats / totalBeats) * 100;

        return `
          <div class="tl-track ${isDeleted ? "deleted" : isRenamed ? "renamed" : ""}" style="width: ${widthPercent}%">
            <div class="tl-track-inner">
              <div class="tl-order">${item.order + 1}</div>
              <div class="tl-name">${escapeHtml(item.actionSnapshotName)}</div>
              <div class="tl-beats">${item.beats} 拍</div>
              <div class="tl-range">${startBeat + 1}-${endBeat}</div>
              ${item.transitionHint ? `<div class="tl-transition">🎭 ${escapeHtml(item.transitionHint)}</div>` : ""}
              ${item.note ? `<div class="tl-note">${escapeHtml(item.note)}</div>` : ""}
              ${isDeleted ? '<div class="tl-badge deleted">动作已删除</div>' : ""}
              ${isRenamed ? `<div class="tl-badge renamed">原: ${escapeHtml(item.actionSnapshotName)}</div>` : ""}
            </div>
          </div>
        `;
      })
      .join("");

    const rulerHtml = `
      <div class="tl-ruler">
        ${Array.from({ length: totalBeats }, (_, i) => {
          const isMajor = (i + 1) % 4 === 0 || i === 0;
          return `<div class="tl-ruler-mark ${isMajor ? "major" : ""}">${isMajor ? i + 1 : ""}</div>`;
        }).join("")}
      </div>
    `;

    timelineEl.innerHTML = `
      <div class="choreo-timeline-head">
        <div>
          <h3>${escapeHtml(choreo.name)}</h3>
          ${choreo.description ? `<p class="muted">${escapeHtml(choreo.description)}</p>` : ""}
        </div>
        <div class="choreo-timeline-stats">
          <span>${sortedItems.length} 个动作</span>
          <span>${totalBeats} 拍</span>
          <button type="button" class="btn-small btn-secondary" data-edit-choreo="${choreo.id}">编辑编排</button>
        </div>
      </div>
      ${warningHtml}
      <div class="tl-container">
        ${rulerHtml}
        <div class="tl-tracks">
          ${timelineHtml}
        </div>
      </div>
      <div class="choreo-sequence">
        <h4>动作序列详情</h4>
        ${sortedItems.map((item, idx) => {
          const action = actions.find((a) => a.id === item.actionId);
          const isDeleted = !action;
          const isRenamed = action && action.name !== item.actionSnapshotName;
          return `
            <div class="seq-row ${isDeleted ? "deleted" : isRenamed ? "renamed" : ""}">
              <div class="seq-order">${idx + 1}</div>
              <div class="seq-info">
                <div class="seq-name">
                  ${escapeHtml(item.actionSnapshotName)}
                  ${isDeleted ? '<span class="seq-badge deleted">已删除</span>' : ""}
                  ${isRenamed ? `<span class="seq-badge renamed">→ ${escapeHtml(action.name)}</span>` : ""}
                </div>
                <div class="seq-meta">
                  <span class="seq-beats">🎵 ${item.beats} 拍</span>
                  ${item.transitionHint ? `<span class="seq-transition">🎭 ${escapeHtml(item.transitionHint)}</span>` : ""}
                </div>
                ${item.note ? `<div class="seq-note">${escapeHtml(item.note)}</div>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderAll() {
    renderChoreographyList();
    renderChoreographyEditor();
    renderChoreographyTimeline();
  }

  function openChoreographyModal(choreo = null) {
    const modal = document.querySelector("#choreographyModal");
    if (!modal) return;

    state.editingChoreographyId = choreo ? choreo.id : null;
    state.addingActionToChoreography = false;

    const title = document.querySelector("#choreographyModalTitle");
    if (title) title.textContent = choreo ? "编辑编排" : "新建编排";

    const form = document.querySelector("#choreographyForm");
    if (form) form.reset();

    if (choreo) {
      renderChoreographyEditor();
    } else {
      const itemsListEl = document.querySelector("#choreoItemsList");
      const actionSelectEl = document.querySelector("#choreoActionSelect");
      const warningsEl = document.querySelector("#choreoEditorWarnings");
      if (itemsListEl) itemsListEl.innerHTML = `<p class="muted">先保存编排，再添加动作</p>`;
      if (actionSelectEl) {
        const actions = window.__appState?.actions || [];
        actionSelectEl.innerHTML = `<option value="">选择动作</option>` +
          actions.map((a) => `<option value="${a.id}">${a.name} (${a.frames.length}帧)</option>`).join("");
      }
      if (warningsEl) {
        warningsEl.innerHTML = "";
        warningsEl.hidden = true;
      }
    }

    modal.hidden = false;
  }

  function closeChoreographyModal() {
    const modal = document.querySelector("#choreographyModal");
    if (modal) modal.hidden = true;
    state.editingChoreographyId = null;
    state.addingActionToChoreography = false;
  }

  function saveToParent() {
    if (window.__appState) {
      window.__appState.choreographies = state.choreographies;
      if (typeof window.__saveAppState === "function") {
        window.__saveAppState();
      }
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

  function formatDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function bindEvents() {
    const choreoList = document.querySelector("#choreographyList");
    if (choreoList) {
      choreoList.addEventListener("click", (e) => {
        const editId = e.target.closest("[data-edit-choreo]")?.dataset.editChoreo;
        const viewId = e.target.closest("[data-view-choreo]")?.dataset.viewChoreo;
        const deleteId = e.target.closest("[data-delete-choreo]")?.dataset.deleteChoreo;
        const cardId = e.target.closest("[data-choreo]")?.dataset.choreo;

        if (editId) {
          const choreo = state.choreographies.find((c) => c.id === editId);
          openChoreographyModal(choreo);
          return;
        }
        if (deleteId) {
          if (!confirm("确定删除该编排？此操作不可恢复。")) return;
          deleteChoreography(deleteId);
          return;
        }
        if (viewId) {
          state.activeChoreographyId = viewId;
          saveToParent();
          if (typeof window.__switchMainTab === "function") {
            window.__switchMainTab("choreography");
          }
          renderAll();
          return;
        }
        if (cardId) {
          state.activeChoreographyId = cardId;
          saveToParent();
          renderAll();
        }
      });
    }

    const newChoreoBtn = document.querySelector("#newChoreographyBtn");
    if (newChoreoBtn) {
      newChoreoBtn.addEventListener("click", () => openChoreographyModal());
    }

    const choreoModal = document.querySelector("#choreographyModal");
    if (choreoModal) {
      choreoModal.addEventListener("click", (e) => {
        if (e.target.hasAttribute("data-close-choreo-modal") || e.target === choreoModal) {
          closeChoreographyModal();
        }
      });
    }

    const choreoForm = document.querySelector("#choreographyForm");
    if (choreoForm) {
      choreoForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = new FormData(choreoForm);
        const name = data.get("name").trim();
        const description = data.get("description")?.trim() || "";

        if (!name) {
          alert("请输入编排名称");
          return;
        }

        if (state.editingChoreographyId) {
          updateChoreography(state.editingChoreographyId, { name, description });
        } else {
          const choreo = createChoreography(name, description);
          state.editingChoreographyId = choreo.id;
          renderChoreographyEditor();
        }
      });
    }

    const addActionBtn = document.querySelector("#addChoreoItemBtn");
    if (addActionBtn) {
      addActionBtn.addEventListener("click", () => {
        if (!state.editingChoreographyId) {
          alert("请先保存编排");
          return;
        }
        const actionSelect = document.querySelector("#choreoActionSelect");
        const beatsInput = document.querySelector("#choreoBeatsInput");
        const transitionInput = document.querySelector("#choreoTransitionInput");
        const noteInput = document.querySelector("#choreoNoteInput");

        const actionId = actionSelect?.value;
        if (!actionId) {
          alert("请选择一个动作");
          return;
        }

        addActionToChoreography(
          state.editingChoreographyId,
          actionId,
          beatsInput?.value || 8,
          transitionInput?.value || "",
          noteInput?.value || ""
        );

        if (actionSelect) actionSelect.value = "";
        if (beatsInput) beatsInput.value = "8";
        if (transitionInput) transitionInput.value = "";
        if (noteInput) noteInput.value = "";
      });
    }

    const choreoItemsList = document.querySelector("#choreoItemsList");
    if (choreoItemsList) {
      choreoItemsList.addEventListener("input", (e) => {
        if (!state.editingChoreographyId) return;
        const choreo = editingChoreography();
        if (!choreo) return;

        const beatsItemId = e.target.closest("[data-item-beats]")?.dataset.itemBeats;
        const transitionItemId = e.target.closest("[data-item-transition]")?.dataset.itemTransition;
        const noteItemId = e.target.closest("[data-item-note]")?.dataset.itemNote;

        if (beatsItemId) {
          updateChoreographyItem(state.editingChoreographyId, beatsItemId, {
            beats: parseInt(e.target.value, 10) || 8,
          });
        }
        if (transitionItemId) {
          updateChoreographyItem(state.editingChoreographyId, transitionItemId, {
            transitionHint: e.target.value,
          });
        }
        if (noteItemId) {
          updateChoreographyItem(state.editingChoreographyId, noteItemId, {
            note: e.target.value,
          });
        }
      });

      choreoItemsList.addEventListener("click", (e) => {
        if (!state.editingChoreographyId) return;
        const choreo = editingChoreography();
        if (!choreo) return;

        const upId = e.target.closest("[data-item-up]")?.dataset.itemUp;
        const downId = e.target.closest("[data-item-down]")?.dataset.itemDown;
        const removeId = e.target.closest("[data-item-remove]")?.dataset.itemRemove;
        const syncId = e.target.closest("[data-sync-name]")?.dataset.syncName;

        if (upId) {
          const item = choreo.items.find((i) => i.id === upId);
          if (item && item.order > 0) {
            reorderChoreographyItem(state.editingChoreographyId, upId, item.order - 1);
          }
        }
        if (downId) {
          const item = choreo.items.find((i) => i.id === downId);
          if (item && item.order < choreo.items.length - 1) {
            reorderChoreographyItem(state.editingChoreographyId, downId, item.order + 1);
          }
        }
        if (removeId) {
          if (!confirm("确定从编排中移除该动作？")) return;
          removeChoreographyItem(state.editingChoreographyId, removeId);
        }
        if (syncId) {
          const actions = window.__appState?.actions || [];
          const item = choreo.items.find((i) => i.id === syncId);
          if (item) {
            const action = actions.find((a) => a.id === item.actionId);
            if (action) {
              updateChoreographyItem(state.editingChoreographyId, syncId, {
                actionSnapshotName: action.name,
              });
            }
          }
        }
      });
    }

    const choreoWarnings = document.querySelector("#choreoEditorWarnings");
    if (choreoWarnings) {
      choreoWarnings.addEventListener("click", (e) => {
        const syncId = e.target.closest("[data-sync-name]")?.dataset.syncName;
        if (syncId && state.editingChoreographyId) {
          const actions = window.__appState?.actions || [];
          const choreo = editingChoreography();
          if (!choreo) return;
          const item = choreo.items.find((i) => i.id === syncId);
          if (item) {
            const action = actions.find((a) => a.id === item.actionId);
            if (action) {
              updateChoreographyItem(state.editingChoreographyId, syncId, {
                actionSnapshotName: action.name,
              });
            }
          }
        }
      });
    }

    const timeline = document.querySelector("#choreographyTimeline");
    if (timeline) {
      timeline.addEventListener("click", (e) => {
        const editId = e.target.closest("[data-edit-choreo]")?.dataset.editChoreo;
        if (editId) {
          const choreo = state.choreographies.find((c) => c.id === editId);
          openChoreographyModal(choreo);
        }
      });
    }
  }

  return {
    init,
    getState,
    activeChoreography,
    editingChoreography,
    createChoreography,
    updateChoreography,
    deleteChoreography,
    addActionToChoreography,
    updateChoreographyItem,
    removeChoreographyItem,
    reorderChoreographyItem,
    getReferencingChoreographies,
    checkActionReferences,
    detectActionChanges,
    syncActionNames,
    updateSnapshotName,
    getTotalBeats,
    getChoreographyWarnings,
    renderAll,
    renderChoreographyList,
    renderChoreographyEditor,
    renderChoreographyTimeline,
    openChoreographyModal,
    closeChoreographyModal,
  };
})();

window.Choreography = Choreography;
