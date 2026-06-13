const MediaLibrary = (function () {
  const DB_NAME = "wxyy-3-media-library";
  const DB_VERSION = 1;
  const STORE_MEDIA = "media";
  const MIGRATION_KEY = "wxyy-3-media-migration-done";

  let db = null;
  let initPromise = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_MEDIA)) {
          const store = database.createObjectStore(STORE_MEDIA, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("type", "type", { unique: false });
        }
      };
    });
  }

  async function ensureDB() {
    if (db) return db;
    if (!initPromise) {
      initPromise = openDB().then((database) => {
        db = database;
        db.onclose = () => { db = null; initPromise = null; };
        db.onerror = () => { db = null; initPromise = null; };
        return db;
      }).catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }

  function dataURLToBlob(dataURL) {
    const parts = dataURL.split(",");
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const binary = atob(parts[1]);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function generateThumbnail(blob, type) {
    if (!type.startsWith("image/")) return null;
    try {
      const dataURL = await blobToDataURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 160;
          let w = img.width, h = img.height;
          if (w > h) {
            if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          } else {
            if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => resolve(null);
        img.src = dataURL;
      });
    } catch {
      return null;
    }
  }

  async function addMedia(fileOrDataURL, type, name = "") {
    await ensureDB();
    let blob, mimeType;
    if (typeof fileOrDataURL === "string" && fileOrDataURL.startsWith("data:")) {
      blob = dataURLToBlob(fileOrDataURL);
      mimeType = type || blob.type;
    } else if (fileOrDataURL instanceof File || fileOrDataURL instanceof Blob) {
      blob = fileOrDataURL;
      mimeType = type || fileOrDataURL.type;
    } else {
      throw new Error("不支持的媒体格式");
    }

    const thumbnail = await generateThumbnail(blob, mimeType);
    const media = {
      id: crypto.randomUUID(),
      name: name || (fileOrDataURL instanceof File ? fileOrDataURL.name : "未命名素材"),
      type: mimeType,
      size: blob.size,
      data: blob,
      thumbnail: thumbnail,
      createdAt: new Date().toISOString(),
      usedBy: []
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEDIA, "readwrite");
      const store = tx.objectStore(STORE_MEDIA);
      const request = store.add(media);
      request.onsuccess = () => resolve({
        id: media.id,
        type: media.type,
        name: media.name,
        size: media.size,
        thumbnail: media.thumbnail
      });
      request.onerror = () => reject(request.error);
    });
  }

  async function getMedia(id) {
    if (!id) return null;
    try {
      await ensureDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MEDIA, "readonly");
        const store = tx.objectStore(STORE_MEDIA);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  async function getMediaDataURL(id) {
    const media = await getMedia(id);
    if (!media || !media.data) return null;
    return blobToDataURL(media.data);
  }

  async function getMediaThumbnail(id) {
    const media = await getMedia(id);
    if (!media) return null;
    if (media.thumbnail) return media.thumbnail;
    if (media.type.startsWith("image/") && media.data) {
      return blobToDataURL(media.data);
    }
    return null;
  }

  async function getAllMedia() {
    try {
      await ensureDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MEDIA, "readonly");
        const store = tx.objectStore(STORE_MEDIA);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return [];
    }
  }

  async function deleteMedia(id) {
    if (!id) return false;
    try {
      await ensureDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MEDIA, "readwrite");
        const store = tx.objectStore(STORE_MEDIA);
        const request = store.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return false;
    }
  }

  async function updateMediaUsedBy(id, usedBy) {
    if (!id) return;
    try {
      const media = await getMedia(id);
      if (!media) return;
      media.usedBy = Array.isArray(usedBy) ? [...new Set(usedBy)] : [];
      await ensureDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_MEDIA, "readwrite");
        const store = tx.objectStore(STORE_MEDIA);
        const request = store.put(media);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      });
    } catch {}
  }

  async function getStorageInfo() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        return {
          used: estimate.usage || 0,
          quota: estimate.quota || 0,
          usageRatio: estimate.quota ? (estimate.usage / estimate.quota) : 0
        };
      }
    } catch {}
    return { used: 0, quota: 0, usageRatio: 0 };
  }

  function getUsedMediaIds(appState) {
    const ids = new Set();
    if (appState?.actions && Array.isArray(appState.actions)) {
      appState.actions.forEach((action) => {
        if (action.mediaId) ids.add(action.mediaId);
        if (action.mediaRef && action.mediaRef.id) ids.add(action.mediaRef.id);
        if (action.media && action.media.id) ids.add(action.media.id);
      });
    }
    return [...ids];
  }

  async function findOrphanedMedia(appState) {
    const allMedia = await getAllMedia();
    const usedIds = new Set(getUsedMediaIds(appState));
    return allMedia.filter((m) => !usedIds.has(m.id));
  }

  async function cleanupOrphanedMedia(appState) {
    const orphans = await findOrphanedMedia(appState);
    const results = [];
    for (const m of orphans) {
      const ok = await deleteMedia(m.id);
      if (ok) results.push(m.id);
    }
    return results;
  }

  async function syncUsedByReferences(appState) {
    const allMedia = await getAllMedia();
    const usedIds = getUsedMediaIds(appState);
    const usedMap = {};
    if (appState?.actions && Array.isArray(appState.actions)) {
      appState.actions.forEach((action) => {
        const mid = action.mediaId || (action.mediaRef && action.mediaRef.id) || (action.media && action.media.id);
        if (mid) {
          if (!usedMap[mid]) usedMap[mid] = [];
          usedMap[mid].push({ type: "action", id: action.id, name: action.name });
        }
      });
    }
    for (const m of allMedia) {
      const usedBy = usedIds.includes(m.id) ? (usedMap[m.id] || []) : [];
      await updateMediaUsedBy(m.id, usedBy);
    }
  }

  async function migrateFromLocalStorage(appState) {
    const migrated = localStorage.getItem(MIGRATION_KEY);
    if (migrated === "true") {
      return { migrated: 0, failed: 0, alreadyDone: true };
    }

    if (!appState?.actions || !Array.isArray(appState.actions)) {
      localStorage.setItem(MIGRATION_KEY, "true");
      return { migrated: 0, failed: 0, alreadyDone: false };
    }

    const results = { migrated: 0, failed: 0, alreadyDone: false, failures: [] };

    for (let i = 0; i < appState.actions.length; i++) {
      const action = appState.actions[i];
      if (action.media && action.media.src && typeof action.media.src === "string" && action.media.src.startsWith("data:")) {
        try {
          const saved = await addMedia(action.media.src, action.media.type, `${action.name || "动作"}素材`);
          action.mediaId = saved.id;
          const type = action.media.type;
          delete action.media;
          action.mediaRef = { id: saved.id, type: type, name: saved.name, thumbnail: saved.thumbnail };
          results.migrated++;
        } catch (err) {
          results.failed++;
          results.failures.push({ actionId: action.id, actionName: action.name, error: String(err) });
        }
      }
    }

    if (results.failed === 0) {
      localStorage.setItem(MIGRATION_KEY, "true");
    } else {
      console.warn("媒体迁移部分失败，保留原始数据以便重试", results.failures);
    }

    return results;
  }

  function resetMigrationFlag() {
    localStorage.removeItem(MIGRATION_KEY);
  }

  function isVideoType(type) {
    return typeof type === "string" && type.startsWith("video/");
  }

  function isImageType(type) {
    return typeof type === "string" && type.startsWith("image/");
  }

  async function init() {
    try {
      await ensureDB();
      return true;
    } catch (err) {
      console.error("素材库初始化失败:", err);
      return false;
    }
  }

  return {
    init,
    addMedia,
    getMedia,
    getMediaDataURL,
    getMediaThumbnail,
    getAllMedia,
    deleteMedia,
    updateMediaUsedBy,
    getStorageInfo,
    getUsedMediaIds,
    findOrphanedMedia,
    cleanupOrphanedMedia,
    syncUsedByReferences,
    migrateFromLocalStorage,
    resetMigrationFlag,
    isVideoType,
    isImageType
  };
})();

window.MediaLibrary = MediaLibrary;
