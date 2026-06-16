const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

function createLocalStorageMock() {
  const store = {};
  return {
    getItem(key) { return store[key] || null; },
    setItem(key, val) { store[key] = String(val); },
    removeItem(key) { delete store[key]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); },
    get _store() { return store; }
  };
}

function createDocumentMock() {
  return {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ innerHTML: "", appendChild: () => {}, addEventListener: () => {} }),
  };
}

function installGlobals(opts = {}) {
  const localStorage = createLocalStorageMock();
  const document = createDocumentMock();

  if (!globalThis.window) globalThis.window = globalThis;
  if (!globalThis.document) globalThis.document = document;
  if (!globalThis.localStorage) globalThis.localStorage = localStorage;
  if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
  if (!globalThis.confirm) globalThis.confirm = () => true;
  if (!globalThis.alert) globalThis.alert = () => {};
  if (!globalThis.setTimeout) globalThis.setTimeout = setTimeout;
  if (!globalThis.clearTimeout) globalThis.clearTimeout = clearTimeout;

  return { localStorage, document };
}

function resetAppState() {
  globalThis.__appState = {
    actions: [],
    activeId: null,
    sessions: [],
    activeSessionId: null,
    choreographies: [],
    activeChoreographyId: null,
    scores: [],
    timelineViewMode: "action"
  };
  let saveCallCount = 0;
  globalThis.__saveAppState = function () { saveCallCount++; };
  globalThis.__saveAppState._getCallCount = () => saveCallCount;
  globalThis.__saveAppState._resetCount = () => { saveCallCount = 0; };
}

function loadScript(filename) {
  const filePath = path.resolve(__dirname, "..", filename);
  const code = fs.readFileSync(filePath, "utf-8");
  vm.runInThisContext(code, { filename });
}

function makeScore(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    actionId: overrides.actionId || "action-1",
    dimensions: overrides.dimensions || {
      centerStability: 3,
      sleeveContinuity: 3,
      wristDirection: 3,
      rhythmAlignment: 3,
      poseCompletion: 3
    },
    total: overrides.total ?? 15,
    maxTotal: overrides.maxTotal ?? 25,
    note: overrides.note || "",
    createdAt: overrides.createdAt || new Date().toISOString(),
    ...overrides
  };
}

function makeAction(overrides = {}) {
  return {
    id: overrides.id || "action-1",
    name: overrides.name || "测试动作",
    frames: overrides.frames || [],
    ...overrides
  };
}

function makeChoreography(overrides = {}) {
  return {
    id: overrides.id || "choreo-1",
    name: overrides.name || "测试编排",
    ...overrides
  };
}

module.exports = {
  installGlobals,
  resetAppState,
  loadScript,
  makeScore,
  makeAction,
  makeChoreography,
  createLocalStorageMock,
  createDocumentMock
};
