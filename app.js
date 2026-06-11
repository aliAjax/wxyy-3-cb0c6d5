const storageKey = "wxyy-3-kunqu-sleeve-board";
const state = JSON.parse(localStorage.getItem(storageKey) || '{"actions":[],"activeId":null}');

const actionForm = document.querySelector("#actionForm");
const frameForm = document.querySelector("#frameForm");
const mediaInput = document.querySelector("#mediaInput");
const actionList = document.querySelector("#actionList");
const mediaBox = document.querySelector("#mediaBox");
const timeline = document.querySelector("#timeline");
const mirrorPane = document.querySelector("#mirrorPane");
const tagFilter = document.querySelector("#tagFilter");

let pendingMedia = null;

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function activeAction() {
  return state.actions.find((action) => action.id === state.activeId) || null;
}

function readMedia(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve({ src: reader.result, type: file.type }));
    reader.readAsDataURL(file);
  });
}

function renderList() {
  const filter = tagFilter.value.trim();
  const actions = state.actions.filter((action) => !filter || action.tags.includes(filter));
  actionList.innerHTML = actions.length ? actions.map((action) => `
    <button class="action-item ${action.id === state.activeId ? "active" : ""}" type="button" data-action="${action.id}">
      <strong>${action.name}</strong>
      <span>${action.tags || "无标签"} · ${action.frames.length}个关键帧</span>
    </button>
  `).join("") : "<p>还没有动作条目。</p>";
}

function renderDetail() {
  const action = activeAction();
  if (!action) {
    mediaBox.innerHTML = "<p>选择或新建一个水袖动作</p>";
    timeline.innerHTML = "<p>暂无关键帧。</p>";
    mirrorPane.innerHTML = "<p>暂无对照内容。</p>";
    frameForm.style.display = "none";
    return;
  }

  frameForm.style.display = "block";
  if (action.media?.src) {
    const isVideo = action.media.type.startsWith("video/");
    mediaBox.innerHTML = isVideo
      ? `<video src="${action.media.src}" controls></video>`
      : `<img src="${action.media.src}" alt="${action.name}练习素材">`;
  } else {
    mediaBox.innerHTML = `<p>${action.name}还没有上传练习素材</p>`;
  }

  timeline.innerHTML = action.frames.length ? action.frames.map((frame) => `
    <article class="frame-card">
      <header><span>${frame.stage} · ${frame.time || "未定时点"}</span><button type="button" data-delete-frame="${frame.id}">删除</button></header>
      <p>重心：${frame.weight || "未记录"}</p>
      <p>手腕：${frame.wrist || "未记录"}</p>
      <p>节奏：${frame.tempo || "未记录"}</p>
      <p>${frame.note || "未填写批注"}</p>
    </article>
  `).join("") : "<p>还没有关键帧。</p>";

  const left = action.frames.filter((frame) => /左|偏左|左手/.test(`${frame.weight}${frame.wrist}${frame.note}`));
  const right = action.frames.filter((frame) => /右|偏右|右手/.test(`${frame.weight}${frame.wrist}${frame.note}`));
  mirrorPane.innerHTML = `
    <div class="hand"><strong>左手线索</strong>${(left.length ? left : action.frames).slice(0, 4).map((frame) => `<p>${frame.stage}: ${frame.wrist || frame.note || "待补充"}</p>`).join("") || "<p>暂无</p>"}</div>
    <div class="hand"><strong>右手线索</strong>${(right.length ? right : action.frames).slice(0, 4).map((frame) => `<p>${frame.stage}: ${frame.wrist || frame.note || "待补充"}</p>`).join("") || "<p>暂无</p>"}</div>
  `;
}

function render() {
  renderList();
  renderDetail();
}

mediaInput.addEventListener("change", async () => {
  pendingMedia = await readMedia(mediaInput.files[0]);
});

actionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(actionForm);
  if (!pendingMedia && mediaInput.files[0]) {
    pendingMedia = await readMedia(mediaInput.files[0]);
  }
  const action = {
    id: crypto.randomUUID(),
    name: data.get("name").trim(),
    tags: data.get("tags").trim(),
    media: pendingMedia,
    frames: [],
    createdAt: new Date().toISOString()
  };
  state.actions.unshift(action);
  state.activeId = action.id;
  pendingMedia = null;
  mediaInput.value = "";
  actionForm.reset();
  save();
  render();
});

frameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const action = activeAction();
  if (!action) return;
  const data = new FormData(frameForm);
  action.frames.push({
    id: crypto.randomUUID(),
    stage: data.get("stage"),
    time: data.get("time").trim(),
    weight: data.get("weight").trim(),
    wrist: data.get("wrist").trim(),
    tempo: data.get("tempo").trim(),
    note: data.get("note").trim()
  });
  frameForm.reset();
  save();
  render();
});

actionList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-action]")?.dataset.action;
  if (!id) return;
  state.activeId = id;
  save();
  render();
});

timeline.addEventListener("click", (event) => {
  const id = event.target.dataset.deleteFrame;
  const action = activeAction();
  if (!id || !action) return;
  action.frames = action.frames.filter((frame) => frame.id !== id);
  save();
  render();
});

document.querySelector("#newActionBtn").addEventListener("click", () => {
  state.activeId = null;
  save();
  render();
  actionForm.querySelector("input[name='name']").focus();
});

tagFilter.addEventListener("input", renderList);
render();
