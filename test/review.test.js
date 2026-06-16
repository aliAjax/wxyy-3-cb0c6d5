const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  installGlobals,
  resetAppState,
  loadScript,
  makeScore,
  makeAction
} = require("./setup.js");

installGlobals();
resetAppState();
loadScript("review.js");

const RS = window.ReviewScoring;

describe("ReviewScoring - DIMENSIONS", () => {
  it("should have 5 dimensions", () => {
    assert.equal(RS.DIMENSIONS.length, 5);
  });

  it("each dimension has key and label", () => {
    for (const d of RS.DIMENSIONS) {
      assert.ok(d.key, `missing key on ${JSON.stringify(d)}`);
      assert.ok(d.label, `missing label on ${JSON.stringify(d)}`);
    }
  });

  it("maxTotal = 5 dimensions * 5 points", () => {
    assert.equal(RS.DIMENSIONS.length * 5, 25);
  });
});

describe("ReviewScoring - addScore total calculation", () => {
  beforeEach(() => {
    resetAppState();
  });

  it("all max (5) → total = 25", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 5; });
    const score = RS.addScore("a1", dims, "max");
    assert.equal(score.total, 25);
    assert.equal(score.maxTotal, 25);
  });

  it("all min (1) → total = 5", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 1; });
    const score = RS.addScore("a1", dims, "min");
    assert.equal(score.total, 5);
  });

  it("mixed values sum correctly", () => {
    const dims = {
      centerStability: 4,
      sleeveContinuity: 3,
      wristDirection: 5,
      rhythmAlignment: 2,
      poseCompletion: 1
    };
    const score = RS.addScore("a1", dims, "mixed");
    assert.equal(score.total, 4 + 3 + 5 + 2 + 1);
  });

  it("missing dimension defaults to 0 in total", () => {
    const dims = { centerStability: 5 };
    const score = RS.addScore("a1", dims, "partial");
    assert.equal(score.total, 5);
  });

  it("note is trimmed", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 3; });
    const score = RS.addScore("a1", dims, "  hello  ");
    assert.equal(score.note, "hello");
  });

  it("score is added to appState.scores", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 3; });
    const before = window.__appState.scores.length;
    RS.addScore("a1", dims, "");
    assert.equal(window.__appState.scores.length, before + 1);
  });

  it("returns score with id, actionId, createdAt", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 3; });
    const score = RS.addScore("a1", dims, "");
    assert.ok(score.id);
    assert.equal(score.actionId, "a1");
    assert.ok(score.createdAt);
  });
});

describe("ReviewScoring - deleteScore", () => {
  beforeEach(() => {
    resetAppState();
  });

  it("removes score from appState.scores", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 3; });
    const s1 = RS.addScore("a1", dims, "");
    const s2 = RS.addScore("a1", dims, "");
    assert.equal(window.__appState.scores.length, 2);
    RS.deleteScore(s1.id);
    assert.equal(window.__appState.scores.length, 1);
    assert.equal(window.__appState.scores[0].id, s2.id);
  });

  it("deleting non-existent id does not crash", () => {
    RS.deleteScore("nonexistent-id");
    assert.ok(true);
  });
});

describe("ReviewScoring - calcAverage", () => {
  it("empty array returns 0", () => {
    assert.equal(RS.calcAverage([]), 0);
  });

  it("single score returns its total", () => {
    const scores = [makeScore({ total: 20 })];
    assert.equal(RS.calcAverage(scores), 20);
  });

  it("multiple scores returns mean", () => {
    const scores = [makeScore({ total: 10 }), makeScore({ total: 20 })];
    assert.equal(RS.calcAverage(scores), 15);
  });

  it("works with fractional result", () => {
    const scores = [makeScore({ total: 10 }), makeScore({ total: 15 }), makeScore({ total: 20 })];
    assert.equal(RS.calcAverage(scores), 15);
  });
});

describe("ReviewScoring - calcTrend", () => {
  it("0 scores → flat", () => {
    assert.equal(RS.calcTrend([]), "flat");
  });

  it("1 score → flat", () => {
    assert.equal(RS.calcTrend([makeScore({ total: 10 })]), "flat");
  });

  it("2 scores: recent > older → up", () => {
    const scores = [
      makeScore({ total: 20, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ total: 10, createdAt: "2025-01-09T00:00:00Z" })
    ];
    assert.equal(RS.calcTrend(scores), "up");
  });

  it("2 scores: recent < older → down", () => {
    const scores = [
      makeScore({ total: 10, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ total: 20, createdAt: "2025-01-09T00:00:00Z" })
    ];
    assert.equal(RS.calcTrend(scores), "down");
  });

  it("2 scores: recent == older → up (>=)", () => {
    const scores = [
      makeScore({ total: 15, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ total: 15, createdAt: "2025-01-09T00:00:00Z" })
    ];
    assert.equal(RS.calcTrend(scores), "up");
  });

  it("6+ scores: recent avg > older avg + 0.5 → up", () => {
    const scores = [];
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 20, createdAt: `2025-01-${10 + i}T00:00:00Z` }));
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 15, createdAt: `2025-01-${7 - i}T00:00:00Z` }));
    const trend = RS.calcTrend(scores);
    assert.equal(trend, "up");
  });

  it("6+ scores: recent avg < older avg - 0.5 → down", () => {
    const scores = [];
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 10, createdAt: `2025-01-${10 + i}T00:00:00Z` }));
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 20, createdAt: `2025-01-${7 - i}T00:00:00Z` }));
    const trend = RS.calcTrend(scores);
    assert.equal(trend, "down");
  });

  it("6+ scores: within ±0.5 → flat", () => {
    const scores = [];
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 15, createdAt: `2025-01-${10 + i}T00:00:00Z` }));
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 15, createdAt: `2025-01-${7 - i}T00:00:00Z` }));
    assert.equal(RS.calcTrend(scores), "flat");
  });

  it("boundary: recent avg = older avg + 0.5 → still flat (not >)", () => {
    const scores = [];
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 15.5, createdAt: `2025-01-${10 + i}T00:00:00Z` }));
    for (let i = 0; i < 3; i++) scores.push(makeScore({ total: 15, createdAt: `2025-01-${7 - i}T00:00:00Z` }));
    assert.equal(RS.calcTrend(scores), "flat");
  });
});

describe("ReviewScoring - calcDimensionAverage", () => {
  it("returns null for empty scores", () => {
    assert.equal(RS.calcDimensionAverage([], "centerStability"), null);
  });

  it("returns null when no score has the dimension", () => {
    const scores = [makeScore({ dimensions: { sleeveContinuity: 3 } })];
    assert.equal(RS.calcDimensionAverage(scores, "centerStability"), null);
  });

  it("averages the dimension across scores", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 3 } }),
      makeScore({ dimensions: { centerStability: 5 } })
    ];
    assert.equal(RS.calcDimensionAverage(scores, "centerStability"), 4);
  });

  it("ignores scores where dimension is null", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 4 } }),
      makeScore({ dimensions: { sleeveContinuity: 3 } })
    ];
    assert.equal(RS.calcDimensionAverage(scores, "centerStability"), 4);
  });
});

describe("ReviewScoring - calcDimensionTrend", () => {
  it("<2 valid scores → flat", () => {
    const result = RS.calcDimensionTrend(
      [makeScore({ dimensions: { centerStability: 3 } })],
      "centerStability"
    );
    assert.equal(result.trend, "flat");
  });

  it("2 scores: diff > 0.3 → up", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 5 }, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ dimensions: { centerStability: 3 }, createdAt: "2025-01-09T00:00:00Z" })
    ];
    const result = RS.calcDimensionTrend(scores, "centerStability");
    assert.equal(result.trend, "up");
    assert.equal(result.diff, 2);
  });

  it("2 scores: diff < -0.3 → down", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 1 }, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ dimensions: { centerStability: 4 }, createdAt: "2025-01-09T00:00:00Z" })
    ];
    const result = RS.calcDimensionTrend(scores, "centerStability");
    assert.equal(result.trend, "down");
  });

  it("|diff| ≤ 0.3 → flat", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 3 }, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ dimensions: { centerStability: 3 }, createdAt: "2025-01-09T00:00:00Z" })
    ];
    const result = RS.calcDimensionTrend(scores, "centerStability");
    assert.equal(result.trend, "flat");
  });

  it("6+ scores with older group uses group averages", () => {
    const scores = [];
    for (let i = 0; i < 3; i++) scores.push(makeScore({ dimensions: { centerStability: 5 }, createdAt: `2025-01-${10 + i}T00:00:00Z` }));
    for (let i = 0; i < 3; i++) scores.push(makeScore({ dimensions: { centerStability: 2 }, createdAt: `2025-01-${7 - i}T00:00:00Z` }));
    const result = RS.calcDimensionTrend(scores, "centerStability");
    assert.equal(result.trend, "up");
  });

  it("returns dataPoints count", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 3 } }),
      makeScore({ dimensions: { centerStability: 4 } }),
      makeScore({ dimensions: { sleeveContinuity: 3 } })
    ];
    const result = RS.calcDimensionTrend(scores, "centerStability");
    assert.equal(result.dataPoints, 2);
  });
});

describe("ReviewScoring - calcAllDimensionTrends", () => {
  it("includes all 5 dimension keys plus 'total'", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 3, sleeveContinuity: 3, wristDirection: 3, rhythmAlignment: 3, poseCompletion: 3 }, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ dimensions: { centerStability: 4, sleeveContinuity: 4, wristDirection: 4, rhythmAlignment: 4, poseCompletion: 4 }, createdAt: "2025-01-09T00:00:00Z" })
    ];
    const result = RS.calcAllDimensionTrends(scores);
    for (const d of RS.DIMENSIONS) {
      assert.ok(result[d.key], `missing dimension ${d.key}`);
      assert.ok("trend" in result[d.key], `missing trend in ${d.key}`);
    }
    assert.ok("total" in result, "missing total trend");
  });
});

describe("ReviewScoring - buildTrendSeries", () => {
  it("reverses chronological order (oldest first)", () => {
    const scores = [
      makeScore({ total: 20, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ total: 10, createdAt: "2025-01-09T00:00:00Z" }),
      makeScore({ total: 15, createdAt: "2025-01-08T00:00:00Z" })
    ];
    const series = RS.buildTrendSeries(scores);
    assert.deepEqual(series.total, [15, 10, 20]);
  });

  it("respects maxPoints limit", () => {
    const scores = [];
    for (let i = 0; i < 15; i++) {
      scores.push(makeScore({ total: i, createdAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
    }
    const series = RS.buildTrendSeries(scores, 5);
    assert.equal(series.total.length, 5);
  });

  it("missing dimension value becomes null", () => {
    const scores = [
      makeScore({ dimensions: { centerStability: 3, sleeveContinuity: 4, wristDirection: 3, rhythmAlignment: 3, poseCompletion: 3 }, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ dimensions: { sleeveContinuity: 4 }, createdAt: "2025-01-09T00:00:00Z" })
    ];
    const series = RS.buildTrendSeries(scores);
    assert.equal(series.dimensions.centerStability[0], null);
    assert.equal(series.dimensions.centerStability[1], 3);
    assert.equal(series.dimensions.sleeveContinuity[0], 4);
    assert.equal(series.dimensions.sleeveContinuity[1], 4);
  });

  it("maxTotal from last (most recent) score", () => {
    const scores = [
      makeScore({ total: 20, maxTotal: 25, createdAt: "2025-01-10T00:00:00Z" }),
      makeScore({ total: 10, maxTotal: 20, createdAt: "2025-01-09T00:00:00Z" })
    ];
    const series = RS.buildTrendSeries(scores);
    assert.equal(series.maxTotal, 25);
  });
});

describe("ReviewScoring - getScoresForAction", () => {
  beforeEach(() => {
    resetAppState();
  });

  it("filters by actionId", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 3; });
    RS.addScore("a1", dims, "");
    RS.addScore("a2", dims, "");
    RS.addScore("a1", dims, "");
    const result = RS.getScoresForAction("a1");
    assert.equal(result.length, 2);
    assert.ok(result.every(s => s.actionId === "a1"));
  });

  it("returns newest first", () => {
    const dims = {};
    RS.DIMENSIONS.forEach(d => { dims[d.key] = 3; });
    const s1 = RS.addScore("a1", dims, "");
    const s2 = RS.addScore("a1", dims, "");
    const result = RS.getScoresForAction("a1");
    assert.equal(result[0].id, s2.id);
    assert.equal(result[1].id, s1.id);
  });
});
