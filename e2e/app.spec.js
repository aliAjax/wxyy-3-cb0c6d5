const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "wxyy-3-kunqu-sleeve-board";
const CALENDAR_KEY = "wxyy-3-practice-calendar";

async function clearStorageAndReload(page) {
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  await page.waitForFunction(() => {
    return window.__appState !== undefined && document.querySelector("#actionList") !== null;
  }, { timeout: 10000 });
}

test.describe("昆曲水袖动作拆解板 - E2E 集成测试", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      return window.__appState !== undefined && document.querySelector("#actionList") !== null;
    }, { timeout: 10000 });
    await clearStorageAndReload(page);
  });

  test("页面加载成功，标题和核心元素可见", async ({ page }) => {
    await expect(page).toHaveTitle(/昆曲水袖动作拆解板/);
    await expect(page.locator("h1")).toContainText("昆曲水袖动作拆解板");
    await expect(page.locator("#newActionBtn")).toBeVisible();
    await expect(page.locator("#actionForm")).toBeVisible();
    await expect(page.locator("#actionList")).toBeVisible();
    await expect(page.locator("#mainTabs")).toBeVisible();
  });

  test("动作创建 - 可以创建新动作并显示在列表中", async ({ page }) => {
    const actionName = "测试动作-抛袖接转身";
    const actionTags = "圆场,亮相,慢板";

    await page.locator("#actionForm input[name='name']").fill(actionName);
    await page.locator("#actionForm input[name='tags']").fill(actionTags);
    await page.locator("#actionForm button[type='submit']").click();

    await expect(page.locator("#actionList")).toContainText(actionName);

    const appState = await page.evaluate((key) => {
      return JSON.parse(localStorage.getItem(key) || "{}");
    }, STORAGE_KEY);

    expect(appState.actions.length).toBeGreaterThanOrEqual(1);
    expect(appState.actions.some(a => a.name === actionName)).toBe(true);
  });

  test("素材上传 - 可以上传图片并关联到动作", async ({ page }) => {
    const actionName = "素材测试动作";
    await page.locator("#actionForm input[name='name']").fill(actionName);

    const testImage = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );

    await page.locator("#mediaInput").setInputFiles({
      name: "test-image.png",
      mimeType: "image/png",
      buffer: testImage
    });

    await page.locator("#actionForm button[type='submit']").click();
    await expect(page.locator("#actionList")).toContainText(actionName);

    const appState = await page.evaluate((key) => {
      return JSON.parse(localStorage.getItem(key) || "{}");
    }, STORAGE_KEY);

    const action = appState.actions.find(a => a.name === actionName);
    expect(action).toBeTruthy();
    expect(action.mediaId || action.mediaRef?.id).toBeTruthy();
  });

  test("关键帧录入 - 可以为动作添加关键帧", async ({ page }) => {
    const actionName = "关键帧测试动作";
    await page.locator("#actionForm input[name='name']").fill(actionName);
    await page.locator("#actionForm button[type='submit']").click();
    await expect(page.locator("#actionList")).toContainText(actionName);

    await page.locator("#frameForm select[name='stage']").selectOption("起势");
    await page.locator("#frameForm input[name='time']").fill("00:05");
    await page.locator("#frameForm input[name='weight']").fill("偏左下沉");
    await page.locator("#frameForm input[name='wrist']").fill("内旋");
    await page.locator("#frameForm input[name='tempo']").fill("慢起快收");
    await page.locator("#frameForm textarea[name='note']").fill("注意身体重心转移");
    await page.locator("#frameForm button[type='submit']").click();

    await expect(page.locator("#timeline")).toBeVisible();

    const appState = await page.evaluate((key) => {
      return JSON.parse(localStorage.getItem(key) || "{}");
    }, STORAGE_KEY);

    const action = appState.actions.find(a => a.name === actionName);
    expect(action).toBeTruthy();
    expect(Array.isArray(action.frames)).toBe(true);
    expect(action.frames.length).toBeGreaterThanOrEqual(1);
    expect(action.frames[0].stage).toBe("起势");
  });

  test("评分功能 - 可以切换到复盘评分面板", async ({ page }) => {
    const actionName = "评分测试动作";
    await page.locator("#actionForm input[name='name']").fill(actionName);
    await page.locator("#actionForm button[type='submit']").click();
    await expect(page.locator("#actionList")).toContainText(actionName);

    await page.locator("[data-mtab='review']").click();
    await expect(page.locator("#mtab-review")).toHaveClass(/active/);
    await expect(page.locator("#reviewPanel")).toBeVisible();
  });

  test("日历计划 - 可以切换到练习日历面板", async ({ page }) => {
    await page.locator("[data-mtab='calendar']").click();
    await expect(page.locator("#mtab-calendar")).toHaveClass(/active/);
    await expect(page.locator("#practiceCalendar")).toBeVisible();
  });

  test("导出备份 - 可以触发导出功能", async ({ page }) => {
    const actionName = "导出测试动作";
    await page.locator("#actionForm input[name='name']").fill(actionName);
    await page.locator("#actionForm button[type='submit']").click();
    await expect(page.locator("#actionList")).toContainText(actionName);

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportBackupBtn").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain("backup");
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test("导入预览 - 点击导入按钮显示预览弹窗", async ({ page }) => {
    await page.locator("#importBackupBtn").click();
    await expect(page.locator("#importPreviewModal")).toBeVisible();
    await expect(page.locator("#importPreviewTitle")).toBeVisible();
  });

  test("Tab 切换 - 所有主标签页可以正常切换", async ({ page }) => {
    const tabs = ["detail", "dashboard", "practice", "calendar", "review", "choreography", "storyboard", "mirror"];

    for (const tab of tabs) {
      await page.locator(`[data-mtab='${tab}']`).click();
      await expect(page.locator(`#mtab-${tab}`)).toHaveClass(/active/);
    }
  });

  test("侧边栏 Tab 切换 - 动作库、课次记录、动作编排", async ({ page }) => {
    const sidebarTabs = ["actions", "sessions", "choreography"];

    for (const tab of sidebarTabs) {
      await page.locator(`#sidebarTabs [data-tab='${tab}']`).click();
      await expect(page.locator(`#sidebarTabs [data-tab='${tab}']`)).toHaveClass(/active/);
      await expect(page.locator(`#panel-${tab}`)).toHaveClass(/active/);
    }
  });

  test("数据持久化 - 刷新页面后数据保留", async ({ page }) => {
    const actionName = "持久化测试动作";
    await page.locator("#actionForm input[name='name']").fill(actionName);
    await page.locator("#actionForm button[type='submit']").click();
    await expect(page.locator("#actionList")).toContainText(actionName);

    await page.reload();
    await page.waitForFunction(() => {
      return window.__appState !== undefined && document.querySelector("#actionList") !== null;
    }, { timeout: 10000 });

    await expect(page.locator("#actionList")).toContainText(actionName);

    const appState = await page.evaluate((key) => {
      return JSON.parse(localStorage.getItem(key) || "{}");
    }, STORAGE_KEY);

    expect(appState.actions.some(a => a.name === actionName)).toBe(true);
  });

  test("新建动作按钮 - 可以重置表单", async ({ page }) => {
    const actionName = "测试动作A";
    await page.locator("#actionForm input[name='name']").fill(actionName);
    await page.locator("#actionForm button[type='submit']").click();
    await expect(page.locator("#actionList")).toContainText(actionName);

    await page.locator("#newActionBtn").click();

    const nameInputValue = await page.locator("#actionForm input[name='name']").inputValue();
    expect(nameInputValue).toBe("");
  });

  test("标签筛选 - 可以通过标签筛选动作列表", async ({ page }) => {
    await page.locator("#actionForm input[name='name']").fill("动作-基础");
    await page.locator("#actionForm input[name='tags']").fill("基础,入门");
    await page.locator("#actionForm button[type='submit']").click();

    await page.locator("#actionForm input[name='name']").fill("动作-进阶");
    await page.locator("#actionForm input[name='tags']").fill("进阶,高级");
    await page.locator("#actionForm button[type='submit']").click();

    await expect(page.locator("#actionList")).toContainText("动作-基础");
    await expect(page.locator("#actionList")).toContainText("动作-进阶");

    await page.locator("#tagFilter").fill("基础");
    await expect(page.locator("#actionList")).toContainText("动作-基础");
  });
});
