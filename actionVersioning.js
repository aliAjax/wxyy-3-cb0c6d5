const ActionVersioning = (function () {
  const MAX_VERSIONS_PER_ACTION = 20;
  const SNAPSHOT_DEBOUNCE_MS = 2000;

  const ChangeType = {
    NAME: "name",
    TAGS: "tags",
    FRAMES: "frames",
    ANNOTATIONS: "annotations",
    MEDIA: "media",
  };

  const ChangeLabels = {
    name: "动作名称",
    tags: "标签",
    frames: "关键帧",
    annotations: "媒体批注",
    media: "素材引用",
  };

  let debounceTimers = new Map();

  function getState() {
    return window.__appState || {};
  }

  function saveState() {
    if (typeof window.__saveAppState === "function") {
      window.__saveAppState();
    }
  }

  function ensureVersionsArray(action) {
    if (!action) return null;
    if (!Array.isArray(action.versions)) {
      action.versions = [];
    }
    return action.versions;
  }

  function createSnapshot(action, changeTypes = [], changeDescription = "") {
    if (!action) return null;

    const mediaRef = action.mediaRef || (action.mediaId ? { id: action.mediaId } : null);

    const snapshot = {
      id: crypto.randomUUID(),
      versionNumber: 0,
      createdAt: new Date().toISOString(),
      changeTypes: [...changeTypes],
      changeDescription: changeDescription,
      name: action.name || "",
      tags: action.tags || "",
      frames: Array.isArray(action.frames) ? JSON.parse(JSON.stringify(action.frames)) : [],
      annotations: Array.isArray(action.annotations) ? JSON.parse(JSON.stringify(action.annotations)) : [],
      mediaId: action.mediaId || null,
      mediaRef: mediaRef ? { ...mediaRef } : null,
      restoredFrom: null,
    };

    return snapshot;
  }

  function detectChanges(oldAction, newAction) {
    const changes = [];

    if (oldAction.name !== newAction.name) {
      changes.push(ChangeType.NAME);
    }

    if (oldAction.tags !== newAction.tags) {
      changes.push(ChangeType.TAGS);
    }

    const oldFrames = JSON.stringify(oldAction.frames || []);
    const newFrames = JSON.stringify(newAction.frames || []);
    if (oldFrames !== newFrames) {
      changes.push(ChangeType.FRAMES);
    }

    const oldAnnotations = JSON.stringify(oldAction.annotations || []);
    const newAnnotations = JSON.stringify(newAction.annotations || []);
    if (oldAnnotations !== newAnnotations) {
      changes.push(ChangeType.ANNOTATIONS);
    }

    const oldMediaId = oldAction.mediaId || (oldAction.mediaRef && oldAction.mediaRef.id) || null;
    const newMediaId = newAction.mediaId || (newAction.mediaRef && newAction.mediaRef.id) || null;
    if (oldMediaId !== newMediaId) {
      changes.push(ChangeType.MEDIA);
    }

    return changes;
  }

  function generateChangeDescription(changeTypes) {
    if (!changeTypes || changeTypes.length === 0) return "更新";
    const labels = changeTypes.map((t) => ChangeLabels[t] || t);
    if (labels.length <= 2) {
      return labels.join("、") + "更新";
    }
    return labels.slice(0, 2).join("、") + "等更新";
  }

  function saveVersion(actionId, changeTypes = [], changeDescription = "", force = false) {
    const state = getState();
    const action = state.actions && state.actions.find((a) => a.id === actionId);
    if (!action) return null;

    const versions = ensureVersionsArray(action);

    if (!force && debounceTimers.has(actionId)) {
      clearTimeout(debounceTimers.get(actionId));
    }

    const doSnapshot = () => {
      debounceTimers.delete(actionId);

      if (versions.length === 0) {
        const initialSnapshot = createSnapshot(action, [], "初始版本");
        if (initialSnapshot) {
          initialSnapshot.versionNumber = 1;
          versions.push(initialSnapshot);
        }
      }

      if (changeTypes.length === 0 && versions.length > 0) {
        return;
      }

      const lastSnapshot = versions[versions.length - 1];
      if (lastSnapshot) {
        const changes = detectChanges(lastSnapshot, action);
        if (changes.length === 0 && !force) {
          return;
        }
        if (changeTypes.length === 0) {
          changeTypes = changes;
        }
      }

      const snapshot = createSnapshot(action, changeTypes, changeDescription || generateChangeDescription(changeTypes));
      if (!snapshot) return;

      snapshot.versionNumber = versions.length + 1;

      versions.push(snapshot);

      if (versions.length > MAX_VERSIONS_PER_ACTION) {
        versions.splice(0, versions.length - MAX_VERSIONS_PER_ACTION);
        versions.forEach((v, i) => {
          v.versionNumber = i + 1;
        });
      }

      saveState();
    };

    if (force) {
      doSnapshot();
    } else {
      debounceTimers.set(actionId, setTimeout(doSnapshot, SNAPSHOT_DEBOUNCE_MS));
    }

    return action.versions;
  }

  function flushPendingSnapshots() {
    debounceTimers.forEach((timer, actionId) => {
      clearTimeout(timer);
      const state = getState();
      const action = state.actions && state.actions.find((a) => a.id === actionId);
      if (action) {
        saveVersion(actionId, [], "", true);
      }
    });
    debounceTimers.clear();
  }

  function getVersions(actionId) {
    const state = getState();
    const action = state.actions && state.actions.find((a) => a.id === actionId);
    if (!action) return [];
    return ensureVersionsArray(action) || [];
  }

  function getVersion(actionId, versionId) {
    const versions = getVersions(actionId);
    return versions.find((v) => v.id === versionId) || null;
  }

  function restoreVersion(actionId, versionId) {
    const state = getState();
    const action = state.actions && state.actions.find((a) => a.id === actionId);
    if (!action) return false;

    const version = getVersion(actionId, versionId);
    if (!version) return false;

    saveVersion(actionId, [], "恢复前快照", true);

    action.name = version.name;
    action.tags = version.tags;
    action.frames = JSON.parse(JSON.stringify(version.frames || []));
    action.annotations = JSON.parse(JSON.stringify(version.annotations || []));

    if (version.mediaId || version.mediaRef) {
      action.mediaId = version.mediaId;
      action.mediaRef = version.mediaRef ? { ...version.mediaRef } : null;
    } else {
      delete action.mediaId;
      delete action.mediaRef;
    }

    delete action.media;

    action.updatedAt = new Date().toISOString();

    const versions = ensureVersionsArray(action);
    const restoredSnapshot = createSnapshot(action, [], `恢复至 v${version.versionNumber}`);
    if (restoredSnapshot) {
      restoredSnapshot.versionNumber = versions.length + 1;
      restoredSnapshot.restoredFrom = versionId;
      versions.push(restoredSnapshot);

      if (versions.length > MAX_VERSIONS_PER_ACTION) {
        versions.splice(0, versions.length - MAX_VERSIONS_PER_ACTION);
        versions.forEach((v, i) => {
          v.versionNumber = i + 1;
        });
      }
    }

    saveState();

    if (typeof window.MediaLibrary !== "undefined" && typeof window.MediaLibrary.syncUsedByReferences === "function") {
      window.MediaLibrary.syncUsedByReferences(state);
    }

    return true;
  }

  function compareVersions(versionA, versionB) {
    if (!versionA || !versionB) return null;

    const diff = {
      name: { changed: versionA.name !== versionB.name, oldValue: versionA.name, newValue: versionB.name },
      tags: { changed: versionA.tags !== versionB.tags, oldValue: versionA.tags, newValue: versionB.tags },
      frames: { changed: false, added: [], removed: [], modified: [] },
      annotations: { changed: false, added: [], removed: [], modified: [] },
      media: {
        changed: (versionA.mediaId || null) !== (versionB.mediaId || null),
        oldValue: versionA.mediaRef || versionA.mediaId || null,
        newValue: versionB.mediaRef || versionB.mediaId || null,
      },
    };

    const framesA = versionA.frames || [];
    const framesB = versionB.frames || [];
    const frameMapA = new Map(framesA.map((f) => [f.id, f]));
    const frameMapB = new Map(framesB.map((f) => [f.id, f]));

    framesB.forEach((f) => {
      if (!frameMapA.has(f.id)) {
        diff.frames.added.push(f);
      } else {
        const old = frameMapA.get(f);
        if (JSON.stringify(old) !== JSON.stringify(f)) {
          diff.frames.modified.push({ old, new: f });
        }
      }
    });

    framesA.forEach((f) => {
      if (!frameMapB.has(f.id)) {
        diff.frames.removed.push(f);
      }
    });

    diff.frames.changed = diff.frames.added.length > 0 || diff.frames.removed.length > 0 || diff.frames.modified.length > 0;

    const annA = versionA.annotations || [];
    const annB = versionB.annotations || [];
    const annMapA = new Map(annA.map((a) => [a.id, a]));
    const annMapB = new Map(annB.map((a) => [a.id, a]));

    annB.forEach((a) => {
      if (!annMapA.has(a.id)) {
        diff.annotations.added.push(a);
      } else {
        const old = annMapA.get(a.id);
        if (JSON.stringify(old) !== JSON.stringify(a)) {
          diff.annotations.modified.push({ old, new: a });
        }
      }
    });

    annA.forEach((a) => {
      if (!annMapB.has(a.id)) {
        diff.annotations.removed.push(a);
      }
    });

    diff.annotations.changed = diff.annotations.added.length > 0 || diff.annotations.removed.length > 0 || diff.annotations.modified.length > 0;

    return diff;
  }

  function deleteVersion(actionId, versionId) {
    const state = getState();
    const action = state.actions && state.actions.find((a) => a.id === actionId);
    if (!action) return false;

    const versions = ensureVersionsArray(action);
    const index = versions.findIndex((v) => v.id === versionId);
    if (index === -1) return false;

    versions.splice(index, 1);
    versions.forEach((v, i) => {
      v.versionNumber = i + 1;
    });

    saveState();
    return true;
  }

  function clearAllVersions(actionId) {
    const state = getState();
    const action = state.actions && state.actions.find((a) => a.id === actionId);
    if (!action) return false;

    action.versions = [];
    saveState();
    return true;
  }

  function migrateActionVersions(action) {
    if (!action) return;
    if (!Array.isArray(action.versions)) {
      action.versions = [];
    }
    action.versions.forEach((v, i) => {
      if (!v.id) v.id = crypto.randomUUID();
      if (!v.versionNumber) v.versionNumber = i + 1;
      if (!v.createdAt) v.createdAt = action.updatedAt || action.createdAt || new Date().toISOString();
      if (!Array.isArray(v.changeTypes)) v.changeTypes = [];
      if (!v.changeDescription) v.changeDescription = "历史版本";
      if (!v.frames) v.frames = [];
      if (!v.annotations) v.annotations = [];
    });
  }

  function migrateAllVersions() {
    const state = getState();
    if (!state.actions) return;
    let migrated = false;
    state.actions.forEach((action) => {
      const before = JSON.stringify(action.versions || []);
      migrateActionVersions(action);
      const after = JSON.stringify(action.versions || []);
      if (before !== after) migrated = true;
    });
    if (migrated) {
      saveState();
    }
  }

  function getStorageEstimate(actionId) {
    const versions = getVersions(actionId);
    let totalSize = 0;
    versions.forEach((v) => {
      totalSize += JSON.stringify(v).length;
    });
    return {
      versionCount: versions.length,
      totalBytes: totalSize,
      averageBytes: versions.length > 0 ? Math.round(totalSize / versions.length) : 0,
    };
  }

  function init() {
    migrateAllVersions();
  }

  return {
    ChangeType,
    ChangeLabels,
    init,
    saveVersion,
    flushPendingSnapshots,
    getVersions,
    getVersion,
    restoreVersion,
    compareVersions,
    deleteVersion,
    clearAllVersions,
    getStorageEstimate,
    generateChangeDescription,
    MAX_VERSIONS_PER_ACTION,
  };
})();

if (typeof window !== 'undefined') {
  window.ActionVersioning = ActionVersioning;
}
