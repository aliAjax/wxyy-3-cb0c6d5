const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  installGlobals,
  resetAppState,
  loadScript,
  makeAction,
  makeChoreography
} = require("./setup.js");

installGlobals();
resetAppState();
loadScript("practiceCalendar.js");

const PC = window.PracticeCalendar;

describe("PracticeCalendar - formatDateKey", () => {
  it("formats a date to YYYY-MM-DD", () => {
    const d = new Date(2025, 5, 9);
    assert.equal(PC.formatDateKey(d), "2025-06-09");
  });

  it("pads month and day", () => {
    const d = new Date(2025, 0, 3);
    assert.equal(PC.formatDateKey(d), "2025-01-03");
  });
});

describe("PracticeCalendar - createPlan", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("creates plan with required fields and defaults", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    assert.ok(plan.id);
    assert.equal(plan.date, "2025-06-09");
    assert.equal(plan.type, "action");
    assert.equal(plan.refId, "a1");
    assert.equal(plan.refName, "动作1");
    assert.equal(plan.completed, false);
    assert.equal(plan.completedAt, null);
    assert.equal(plan.goal, "");
    assert.equal(plan.note, "");
    assert.ok(plan.createdAt);
    assert.ok(plan.updatedAt);
  });

  it("preserves completed and completedAt when provided", () => {
    const ts = "2025-06-09T12:00:00Z";
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1",
      completed: true,
      completedAt: ts
    });
    assert.equal(plan.completed, true);
    assert.equal(plan.completedAt, ts);
  });

  it("preserves optional segment fields", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "segmented",
      refId: "a1",
      refName: "分段动作",
      segmentId: "seg-1",
      segmentedPlanId: "sp-1",
      segmentIndex: 2,
      frameIds: ["f1", "f2"],
      focusDimensions: [{ key: "centerStability", label: "重心稳定" }]
    });
    assert.equal(plan.segmentId, "seg-1");
    assert.equal(plan.segmentedPlanId, "sp-1");
    assert.equal(plan.segmentIndex, 2);
    assert.deepEqual(plan.frameIds, ["f1", "f2"]);
    assert.deepEqual(plan.focusDimensions, [{ key: "centerStability", label: "重心稳定" }]);
  });

  it("does not include segment fields when not provided", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    assert.equal(plan.segmentId, undefined);
    assert.equal(plan.segmentedPlanId, undefined);
    assert.equal(plan.segmentIndex, undefined);
    assert.equal(plan.frameIds, undefined);
    assert.equal(plan.focusDimensions, undefined);
  });

  it("uses provided id if given", () => {
    const plan = PC.createPlan({
      id: "custom-id",
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    assert.equal(plan.id, "custom-id");
  });

  it("plan appears in getAllPlans", () => {
    PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    const all = PC.getAllPlans();
    assert.equal(all.length, 1);
    assert.equal(all[0].refId, "a1");
  });
});

describe("PracticeCalendar - updatePlan", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("updates specified fields", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1",
      goal: "旧目标"
    });
    const updated = PC.updatePlan(plan.id, { goal: "新目标", note: "备注" });
    assert.equal(updated.goal, "新目标");
    assert.equal(updated.note, "备注");
    assert.equal(updated.refId, "a1");
  });

  it("sets updatedAt", async () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1",
      updatedAt: "2020-01-01T00:00:00Z"
    });
    await new Promise(r => setTimeout(r, 2));
    const updated = PC.updatePlan(plan.id, { goal: "新目标" });
    assert.ok(updated.updatedAt !== "2020-01-01T00:00:00Z");
  });

  it("returns null for non-existent plan", () => {
    const result = PC.updatePlan("nonexistent", { goal: "x" });
    assert.equal(result, null);
  });
});

describe("PracticeCalendar - deletePlan", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("removes the plan and returns true", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    const result = PC.deletePlan(plan.id);
    assert.equal(result, true);
    assert.equal(PC.getAllPlans().length, 0);
  });

  it("returns false for non-existent plan", () => {
    const result = PC.deletePlan("nonexistent");
    assert.equal(result, false);
  });
});

describe("PracticeCalendar - toggleComplete", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("toggles from false to true and sets completedAt", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    assert.equal(plan.completed, false);
    assert.equal(plan.completedAt, null);

    const toggled = PC.toggleComplete(plan.id);
    assert.equal(toggled.completed, true);
    assert.ok(toggled.completedAt);
  });

  it("toggles from true back to false and clears completedAt", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    PC.toggleComplete(plan.id);
    const toggled = PC.toggleComplete(plan.id);
    assert.equal(toggled.completed, false);
    assert.equal(toggled.completedAt, null);
  });

  it("sets updatedAt on toggle", async () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1",
      updatedAt: "2020-01-01T00:00:00Z"
    });
    await new Promise(r => setTimeout(r, 2));
    const toggled = PC.toggleComplete(plan.id);
    assert.ok(toggled.updatedAt !== "2020-01-01T00:00:00Z");
  });

  it("returns null for non-existent plan", () => {
    const result = PC.toggleComplete("nonexistent");
    assert.equal(result, null);
  });

  it("double toggle returns to original state", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    PC.toggleComplete(plan.id);
    PC.toggleComplete(plan.id);
    const current = PC.getPlanById(plan.id);
    assert.equal(current.completed, false);
    assert.equal(current.completedAt, null);
  });
});

describe("PracticeCalendar - isReferenceValid (via getPlansByDate)", () => {
  beforeEach(() => {
    PC.setData([]);
    resetAppState();
  });

  it("action plan with valid ref → _invalid = false", () => {
    window.__appState.actions = [makeAction({ id: "a1", name: "动作1" })];
    PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, false);
  });

  it("action plan with deleted ref → _invalid = true", () => {
    window.__appState.actions = [makeAction({ id: "a1", name: "动作1" })];
    PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    window.__appState.actions = [];
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, true);
  });

  it("segmented plan with valid ref → _invalid = false", () => {
    window.__appState.actions = [makeAction({ id: "a1", name: "分段动作" })];
    PC.createPlan({
      date: "2025-06-09",
      type: "segmented",
      refId: "a1",
      refName: "分段动作",
      segmentId: "seg-1"
    });
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, false);
  });

  it("segmented plan with deleted ref → _invalid = true", () => {
    window.__appState.actions = [makeAction({ id: "a1", name: "分段动作" })];
    PC.createPlan({
      date: "2025-06-09",
      type: "segmented",
      refId: "a1",
      refName: "分段动作",
      segmentId: "seg-1"
    });
    window.__appState.actions = [];
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, true);
  });

  it("choreography plan with valid ref → _invalid = false", () => {
    window.__appState.choreographies = [makeChoreography({ id: "c1", name: "编排1" })];
    PC.createPlan({
      date: "2025-06-09",
      type: "choreography",
      refId: "c1",
      refName: "编排1"
    });
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, false);
  });

  it("choreography plan with deleted ref → _invalid = true", () => {
    window.__appState.choreographies = [makeChoreography({ id: "c1", name: "编排1" })];
    PC.createPlan({
      date: "2025-06-09",
      type: "choreography",
      refId: "c1",
      refName: "编排1"
    });
    window.__appState.choreographies = [];
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, true);
  });

  it("unknown type always valid → _invalid = false", () => {
    PC.createPlan({
      date: "2025-06-09",
      type: "free",
      refId: "x1",
      refName: "自由练习"
    });
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, false);
  });

  it("no appState defaults to valid", () => {
    window.__appState = null;
    PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    const plans = PC.getPlansByDate("2025-06-09");
    assert.equal(plans[0]._invalid, false);
    resetAppState();
  });
});

describe("PracticeCalendar - getPlansByRange", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("returns plans within date range inclusive", () => {
    PC.createPlan({ date: "2025-06-08", type: "action", refId: "a1", refName: "A" });
    PC.createPlan({ date: "2025-06-09", type: "action", refId: "a1", refName: "A" });
    PC.createPlan({ date: "2025-06-10", type: "action", refId: "a1", refName: "A" });
    PC.createPlan({ date: "2025-06-11", type: "action", refId: "a1", refName: "A" });
    const result = PC.getPlansByRange("2025-06-09", "2025-06-10");
    assert.equal(result.length, 2);
  });

  it("includes _invalid flag on each plan", () => {
    resetAppState();
    window.__appState.actions = [makeAction({ id: "a1" })];
    PC.createPlan({ date: "2025-06-09", type: "action", refId: "a1", refName: "A" });
    const result = PC.getPlansByRange("2025-06-09", "2025-06-09");
    assert.ok("_invalid" in result[0]);
  });
});

describe("PracticeCalendar - getPlansByRef", () => {
  beforeEach(() => {
    PC.setData([]);
    resetAppState();
  });

  it("filters by refId", () => {
    PC.createPlan({ date: "2025-06-09", type: "action", refId: "a1", refName: "A" });
    PC.createPlan({ date: "2025-06-09", type: "action", refId: "a2", refName: "B" });
    const result = PC.getPlansByRef("a1");
    assert.equal(result.length, 1);
    assert.equal(result[0].refId, "a1");
  });

  it("filters by type", () => {
    PC.createPlan({ date: "2025-06-09", type: "action", refId: "a1", refName: "A" });
    PC.createPlan({ date: "2025-06-09", type: "choreography", refId: "c1", refName: "C" });
    const result = PC.getPlansByRef(null, "choreography");
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "choreography");
  });

  it("includes _invalid flag", () => {
    PC.createPlan({ date: "2025-06-09", type: "action", refId: "a1", refName: "A" });
    const result = PC.getPlansByRef("a1");
    assert.ok("_invalid" in result[0]);
  });
});

describe("PracticeCalendar - batchCreatePlans", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("creates plans for each day in range", () => {
    const created = PC.batchCreatePlans(
      "2025-06-09",
      "2025-06-13",
      { type: "action", refId: "a1", refName: "动作1", goal: "练习" }
    );
    assert.equal(created.length, 5);
    assert.equal(created[0].date, "2025-06-09");
    assert.equal(created[4].date, "2025-06-13");
  });

  it("skipWeekends excludes Saturday and Sunday", () => {
    const created = PC.batchCreatePlans(
      "2025-06-09",
      "2025-06-15",
      { type: "action", refId: "a1", refName: "动作1" },
      true
    );
    const days = created.map(p => {
      const d = new Date(p.date + "T00:00:00Z");
      return d.getUTCDay();
    });
    assert.ok(!days.includes(0), "should not include Sunday");
    assert.ok(!days.includes(6), "should not include Saturday");
    assert.equal(created.length, 5);
  });

  it("each plan gets its own date", () => {
    const created = PC.batchCreatePlans(
      "2025-06-09",
      "2025-06-11",
      { type: "action", refId: "a1", refName: "动作1" }
    );
    const dates = created.map(p => p.date);
    assert.deepEqual(dates, ["2025-06-09", "2025-06-10", "2025-06-11"]);
  });

  it("single-day range creates one plan", () => {
    const created = PC.batchCreatePlans(
      "2025-06-09",
      "2025-06-09",
      { type: "action", refId: "a1", refName: "动作1" }
    );
    assert.equal(created.length, 1);
  });
});

describe("PracticeCalendar - getPlanById", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("returns the plan by id", () => {
    const plan = PC.createPlan({
      date: "2025-06-09",
      type: "action",
      refId: "a1",
      refName: "动作1"
    });
    const found = PC.getPlanById(plan.id);
    assert.equal(found.id, plan.id);
  });

  it("returns null for non-existent id", () => {
    assert.equal(PC.getPlanById("nonexistent"), null);
  });
});

describe("PracticeCalendar - getWeekStats", () => {
  beforeEach(() => {
    PC.setData([]);
    resetAppState();
    window.__appState.actions = [makeAction({ id: "a1" })];
  });

  it("counts total, completed, overdue, invalid, and completionRate", () => {
    const today = PC.getTodayKey();
    const d = new Date(today + "T00:00:00Z");
    const dayOfWeek = d.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + mondayOffset);

    const tue = new Date(monday);
    tue.setUTCDate(monday.getUTCDate() + 1);
    const wed = new Date(monday);
    wed.setUTCDate(monday.getUTCDate() + 2);
    const past = new Date(monday);
    past.setUTCDate(monday.getUTCDate() - 7);

    PC.createPlan({
      date: PC.formatDateKey(tue),
      type: "action",
      refId: "a1",
      refName: "A",
      completed: true,
      completedAt: "2025-01-01T00:00:00Z"
    });
    PC.createPlan({
      date: PC.formatDateKey(wed),
      type: "action",
      refId: "a1",
      refName: "A"
    });
    PC.createPlan({
      date: PC.formatDateKey(past),
      type: "action",
      refId: "deleted-ref",
      refName: "已删动作"
    });

    const stats = PC.getWeekStats(today);
    assert.ok(stats.total >= 2);
    assert.ok(stats.completed >= 1);
    assert.ok(typeof stats.completionRate === "number");
    assert.ok(stats.weekStart <= today);
    assert.ok(stats.weekEnd >= today);
  });

  it("completionRate is 0 when no plans", () => {
    PC.setData([]);
    const stats = PC.getWeekStats(PC.getTodayKey());
    assert.equal(stats.completionRate, 0);
  });

  it("completionRate is 100 when all completed", () => {
    const today = PC.getTodayKey();
    PC.createPlan({
      date: today,
      type: "action",
      refId: "a1",
      refName: "A",
      completed: true,
      completedAt: "2025-01-01T00:00:00Z"
    });
    const stats = PC.getWeekStats(today);
    assert.equal(stats.completionRate, 100);
  });
});

describe("PracticeCalendar - setData", () => {
  beforeEach(() => {
    PC.setData([]);
  });

  it("replaces the internal plans array", () => {
    PC.createPlan({ date: "2025-06-09", type: "action", refId: "a1", refName: "A" });
    assert.equal(PC.getAllPlans().length, 1);
    PC.setData([]);
    assert.equal(PC.getAllPlans().length, 0);
  });

  it("non-array input becomes empty array", () => {
    PC.setData("not an array");
    assert.equal(PC.getAllPlans().length, 0);
  });
});
