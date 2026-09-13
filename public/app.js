const form = document.getElementById("uploadForm");
const formMsg = document.getElementById("formMsg");
const submitBtn = document.getElementById("submitBtn");
const statusBody = document.getElementById("statusBody");
const queueStateEl = document.getElementById("queueState");
const rowsContainer = document.getElementById("rowsContainer");
const addRowBtn = document.getElementById("addRowBtn");
const rowTemplate = document.getElementById("rowTemplate");

const providerInput = document.getElementById("providerInput");
const modelField = document.getElementById("modelField");
const pixazoModelField = document.getElementById("pixazoModelField");
const durationField = document.getElementById("durationField");
const pixazoDurationToggleField = document.getElementById("pixazoDurationToggleField");
const pixazoDurationToggleInput = document.getElementById("pixazoDurationToggleInput");
const pixazoDurationField = document.getElementById("pixazoDurationField");
const pixazoDurationInput = document.getElementById("pixazoDurationInput");
const upscaleField = document.getElementById("upscaleField");
const promptLimitNote = document.getElementById("promptLimitNote");
const pixazoImageNote = document.getElementById("pixazoImageNote");

let rowCounter = 0;

// Gia tri mac dinh, se duoc dong bo lai tu server (PROMPT_MAX_LENGTHS trong
// promptLimits.js) ngay lan poll status dau tien.
let promptMaxLengths = { runway: 1000, pixazo: 4500 };

function currentProvider() {
  return providerInput.value;
}

function currentPromptMaxLength() {
  return promptMaxLengths[currentProvider()] || 1000;
}

// Bat/tat cac truong tuy theo provider dang chon: Pixazo (LTX) chi co 1
// model duy nhat va khong ho tro upscale rieng. Truong duration binh
// thuong AN cho Pixazo, thay vao do hien 1 cong tac rieng (mac dinh TAT)
// de nguoi dung TU CHON co muon thu nghiem gui thoi luong cho Pixazo hay
// khong - mac dinh khong gui gi ca (an toan, giong hanh vi da xac nhan
// hoat dong on dinh).
function updateProviderUi() {
  const isPixazo = currentProvider() === "pixazo";

  modelField.style.display = isPixazo ? "none" : "";
  pixazoModelField.style.display = isPixazo ? "" : "none";
  durationField.style.display = isPixazo ? "none" : "";
  pixazoDurationToggleField.style.display = isPixazo ? "" : "none";
  pixazoDurationField.style.display = isPixazo ? "" : "none";
  upscaleField.style.display = isPixazo ? "none" : "";

  promptLimitNote.innerHTML = isPixazo
    ? `⚠️ Pixazo (LTX) giới hạn mỗi prompt tối đa <strong>${currentPromptMaxLength()} ký tự</strong>.`
    : `⚠️ Runway giới hạn mỗi prompt tối đa <strong>${currentPromptMaxLength()} ký tự</strong> (giới hạn cứng từ chính API của Runway, không chỉnh được).`;

  pixazoImageNote.style.display = isPixazo ? "" : "none";

  // Doi lai gioi han hien thi + trang thai vuot gioi han cho tat ca dong da co.
  const promptEls = rowsContainer.querySelectorAll(".row-prompt");
  const countEls = rowsContainer.querySelectorAll(".row-char-count");
  promptEls.forEach((promptEl, i) => updateCharCount(promptEl, countEls[i]));

  // Danh dau o chon anh la bat buoc khi dang dung Pixazo (chi de nhac,
  // validate that su van lam luc submit).
  rowsContainer.querySelectorAll(".row-image").forEach((imgEl) => {
    imgEl.required = isPixazo;
  });
}

providerInput.addEventListener("change", updateProviderUi);

pixazoDurationToggleInput.addEventListener("change", () => {
  pixazoDurationInput.disabled = !pixazoDurationToggleInput.checked;
});

function addRow() {
  rowCounter++;
  const id = String(rowCounter).padStart(3, "0");

  const node = rowTemplate.content.cloneNode(true);
  const rowEl = node.querySelector(".row-item");
  rowEl.dataset.id = id;
  rowEl.querySelector(".row-id").textContent = id;

  const promptEl = rowEl.querySelector(".row-prompt");
  const countEl = rowEl.querySelector(".row-char-count");
  updateCharCount(promptEl, countEl);
  promptEl.addEventListener("input", () => updateCharCount(promptEl, countEl));

  rowEl.querySelector(".row-image").required = currentProvider() === "pixazo";

  rowEl.querySelector(".row-remove").addEventListener("click", () => {
    rowEl.remove();
  });

  rowsContainer.appendChild(node);
}

function updateCharCount(promptEl, countEl) {
  const max = currentPromptMaxLength();
  const len = promptEl.value.length;
  countEl.textContent = `${len} / ${max}`;
  countEl.classList.toggle("over-limit", len > max);
}

addRowBtn.addEventListener("click", addRow);

// Luon co san 1 dong khi vao trang
addRow();
updateProviderUi();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const provider = currentProvider();
  const promptMaxLength = currentPromptMaxLength();

  const rowEls = Array.from(rowsContainer.querySelectorAll(".row-item"));
  const rows = [];
  const fd = new FormData();
  const overLimitIds = [];
  const missingImageIds = [];

  for (const rowEl of rowEls) {
    const id = rowEl.dataset.id;
    const prompt = rowEl.querySelector(".row-prompt").value.trim();
    const imageFile = rowEl.querySelector(".row-image").files[0];

    if (!prompt) continue;

    if (prompt.length > promptMaxLength) {
      overLimitIds.push(id);
      continue;
    }

    // Pixazo (LTX) chi ho tro image-to-video - bat buoc phai co anh.
    if (provider === "pixazo" && !imageFile) {
      missingImageIds.push(id);
      continue;
    }

    let imageName;
    if (imageFile) {
      const ext = imageFile.name.includes(".") ? imageFile.name.split(".").pop() : "jpg";
      imageName = `img_${id}.${ext}`;
      fd.append("images", imageFile, imageName);
    }

    rows.push({ id, prompt, image: imageName });
  }

  if (overLimitIds.length > 0) {
    formMsg.textContent = `Prompt của dòng ${overLimitIds.join(", ")} vượt quá ${promptMaxLength} ký tự, hãy rút ngắn lại rồi gửi lại.`;
    return;
  }

  if (missingImageIds.length > 0) {
    formMsg.textContent = `Dòng ${missingImageIds.join(", ")} chưa có ảnh - Pixazo (LTX) bắt buộc phải có ảnh đầu vào.`;
    return;
  }

  if (rows.length === 0) {
    formMsg.textContent = "Bạn cần nhập ít nhất 1 prompt.";
    return;
  }

  fd.append("rowsJson", JSON.stringify(rows));
  fd.append("provider", provider);
  fd.append("model", document.getElementById("modelInput").value);
  fd.append(
    "duration",
    provider === "pixazo" ? pixazoDurationInput.value : document.getElementById("durationInput").value
  );
  fd.append("pixazoSendDuration", pixazoDurationToggleInput.checked ? "true" : "false");
  fd.append("upscale", document.getElementById("upscaleInput").checked ? "true" : "false");

  formMsg.textContent = "Đang upload...";
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      formMsg.textContent = "Lỗi: " + data.error;
    } else {
      formMsg.textContent = `Đã nhận ${data.count} prompt. Đang render, có thể đóng tab và quay lại sau.`;
      rowsContainer.innerHTML = "";
      rowCounter = 0;
      addRow();
      updateProviderUi();
    }
  } catch (err) {
    formMsg.textContent = "Lỗi kết nối: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById("pauseBtn").onclick = () => fetch("/api/pause", { method: "POST" });
document.getElementById("resumeBtn").onclick = () => fetch("/api/resume", { method: "POST" });
document.getElementById("stopBtn").onclick = () => fetch("/api/stop", { method: "POST" });

function pauseVideo(id) {
  fetch(`/api/item/${encodeURIComponent(id)}/pause`, { method: "POST" });
}

function resumeVideo(id) {
  fetch(`/api/item/${encodeURIComponent(id)}/resume`, { method: "POST" });
}

function stopVideo(id) {
  fetch(`/api/item/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

function deleteVideo(id) {
  if (!confirm(`Xoá hẳn video "${id}" khỏi danh sách? Không thể hoàn tác.`)) return;
  fetch(`/api/item/${encodeURIComponent(id)}/delete`, { method: "POST" }).then(pollStatus);
}

async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (data.promptMaxLengths) promptMaxLengths = data.promptMaxLengths;
    renderTable(data.items);
    renderQueueState(data.queue);
  } catch (err) {
    // im lang, thu lai lan sau
  }
}

function renderQueueState(q) {
  if (!q) return;
  let text = q.isRunning ? "Đang chạy" : "Không chạy";
  if (q.isPaused) text += " (đã Pause)";
  if (q.isStopped) text += " (đã Stop)";
  queueStateEl.textContent = text;
}

// Nut nao hien ra tuy theo trang thai hien tai cua tung video.
function renderItemControls(id, state) {
  const wrap = document.createElement("div");
  wrap.className = "item-controls";

  const activeStates = ["QUEUED", "RENDERING", "UPSCALING", "DOWNLOADING", "UPLOADING", "RETRYING"];
  const canPause = activeStates.includes(state);
  const canResume = state === "PAUSED" || state === "STOPPED" || state === "FAILED";
  const canStop = canPause;

  if (canPause) {
    const btn = document.createElement("button");
    btn.className = "btn-pause";
    btn.textContent = "⏸";
    btn.title = "Pause video này";
    btn.onclick = () => pauseVideo(id);
    wrap.appendChild(btn);
  }

  if (canResume) {
    const btn = document.createElement("button");
    btn.className = "btn-resume";
    btn.textContent = "▶";
    btn.title = state === "PAUSED" ? "Resume video này" : "Render lại video này";
    btn.onclick = () => resumeVideo(id);
    wrap.appendChild(btn);
  }

  if (canStop) {
    const btn = document.createElement("button");
    btn.className = "btn-stop";
    btn.textContent = "⏹";
    btn.title = "Stop video này";
    btn.onclick = () => stopVideo(id);
    wrap.appendChild(btn);
  }

  // Nut xoa han (X): chi hien khi video KHONG con dang xu ly do (tranh xoa
  // giua chung gay loi), tuc la dung trang thai nguoc lai voi canPause.
  if (!canPause) {
    const btn = document.createElement("button");
    btn.className = "btn-delete";
    btn.textContent = "✕";
    btn.title = "Xoá video này khỏi danh sách";
    btn.onclick = () => deleteVideo(id);
    wrap.appendChild(btn);
  }

  return wrap;
}

function renderTable(items) {
  const ids = Object.keys(items || {}).sort();
  statusBody.innerHTML = "";

  for (const id of ids) {
    const item = items[id];
    const tr = document.createElement("tr");

    const videoCell = item.localPath
      ? `<a href="${item.localPath}" target="_blank">Tải video</a>`
      : "-";

    const driveCell = item.driveLink
      ? `<a href="${item.driveLink}" target="_blank">Mở Drive</a>`
      : (item.driveError ? "lỗi upload" : "-");

    const providerLabel = item.provider === "pixazo" ? "Pixazo" : "Runway";
    const errorCell = renderErrorCell(item);

    tr.innerHTML = `
      <td>${id}</td>
      <td>${providerLabel}</td>
      <td>${escapeHtml((item.prompt || "").slice(0, 60))}</td>
      <td class="state-${item.state}">${item.state}</td>
      <td class="error-cell"></td>
      <td>${videoCell}</td>
      <td>${driveCell}</td>
      <td class="controls-cell"></td>
    `;
    tr.querySelector(".error-cell").appendChild(errorCell);
    tr.querySelector(".controls-cell").appendChild(renderItemControls(id, item.state));
    statusBody.appendChild(tr);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Hien loi provider tra ve ngay tren bang.
// Uu tien loi chinh (item.error), neu khong co thi hien loi upscale/drive
// (nhung do khong lam video that bai han toan, chi la buoc phu bi loi).
function renderErrorCell(item) {
  const wrap = document.createElement("div");
  wrap.className = "error-wrap";

  if (item.error) {
    const badge = document.createElement("div");
    badge.className = "error-message";
    let tag = "";
    if (item.errorStatus) tag += `HTTP ${item.errorStatus}`;
    if (item.errorCode) tag += (tag ? " · " : "") + item.errorCode;
    if (tag) {
      const tagEl = document.createElement("span");
      tagEl.className = "error-tag";
      tagEl.textContent = tag;
      badge.appendChild(tagEl);
    }
    badge.appendChild(document.createTextNode(item.error));
    wrap.appendChild(badge);
  } else if (item.upscaleError) {
    const badge = document.createElement("div");
    badge.className = "error-message error-secondary";
    badge.textContent = `Upscale lỗi (đã dùng bản gốc): ${item.upscaleError}`;
    wrap.appendChild(badge);
  } else {
    wrap.textContent = "-";
  }

  return wrap;
}

pollStatus();
setInterval(pollStatus, 3000);
