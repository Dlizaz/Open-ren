import "dotenv/config";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";

import {
  runQueue,
  enqueueItem,
  pauseQueue,
  resumeQueue,
  stopQueue,
  pauseItem,
  resumeItem,
  stopItem,
  getQueueState
} from "./queue.js";
import { loadStatus, getItem, updateItemStatus, getUnfinishedItems, deleteItem } from "./storage.js";
import { getVideoBucket, getImageBucket, ObjectId } from "./db.js";
import { PROMPT_MAX_LENGTHS, getPromptMaxLength, normalizeProvider } from "./promptLimits.js";

const app = express();
app.use(express.json());

// Can cho Express biet dang chay sau reverse proxy (Railway, Render, Nginx...)
// de req.protocol tra ve dung "https" (khong bi tut ve "http") - quan trong
// vi link anh public gui cho Pixazo phai la link that, dung giao thuc.
app.set("trust proxy", true);

// Luu file trong RAM (khong ghi ra dia cua Railway) - anh se duoc chuyen
// thanh base64 (dung cho Runway) va/hoac luu vao GridFS de co link public
// (dung cho Pixazo) tuy theo provider cua tung dong.
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

app.get("/api/status", async (req, res) => {
  try {
    const items = await loadStatus();
    res.json({ items, queue: getQueueState(), promptMaxLengths: PROMPT_MAX_LENGTHS });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// --- Dieu khien chung ca hang doi (giu tuong thich ban cu) ---
app.post("/api/pause", (req, res) => {
  pauseQueue();
  res.json({ ok: true });
});

app.post("/api/resume", (req, res) => {
  resumeQueue();
  res.json({ ok: true });
});

app.post("/api/stop", (req, res) => {
  stopQueue();
  res.json({ ok: true });
});

// --- Dieu khien rieng tung video ---
app.post("/api/item/:id/pause", async (req, res) => {
  try {
    const id = req.params.id;
    pauseItem(id);
    // Cap nhat trang thai hien thi ngay; qua trinh xu ly ben duoi (queue.js)
    // se tu kiem tra co "paused" o buoc kiem tra tiep theo va dung lai that su.
    await updateItemStatus(id, { state: "PAUSED" });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/item/:id/resume", async (req, res) => {
  try {
    const id = req.params.id;
    const item = await getItem(id);
    if (!item) return res.status(404).json({ error: "Khong tim thay video nay" });

    const wasTerminal = ["STOPPED", "FAILED"].includes(item.state);
    resumeItem(id);

    // Neu video da dung han (Stop) hoac loi han (Failed), phai dua lai vao
    // hang doi xu ly tu dau (provider khong the "tiep tuc" 1 task da huy/loi).
    // Neu chi dang Pause (van con trong vong lap cho o queue.js) thi chi
    // can bo co paused la du, khong can enqueue lai.
    if (wasTerminal) {
      enqueueItem(item).catch((err) => console.error(`Resume ${id} loi:`, err));
    }

    res.json({ ok: true, requeued: wasTerminal });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/item/:id/stop", async (req, res) => {
  try {
    await stopItem(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Xoa han 1 hang khoi bang (nut "X" tren web). Neu video dang render dang
// do se tu Stop truoc, roi xoa luon file video/anh lien quan trong GridFS
// (best-effort, khong chan neu loi - vd file da bi xoa tu truoc), cuoi cung
// moi xoa ban ghi trong DB.
app.post("/api/item/:id/delete", async (req, res) => {
  try {
    const id = req.params.id;
    await stopItem(id);
    const item = await getItem(id);

    if (item?.videoFileId) {
      try {
        const bucket = await getVideoBucket();
        await bucket.delete(new ObjectId(item.videoFileId));
      } catch {
        // Da bi xoa tu truoc hoac khong ton tai, bo qua.
      }
    }

    if (item?.imageUrl) {
      const match = item.imageUrl.match(/\/uploads\/([a-fA-F0-9]+)$/);
      if (match) {
        try {
          const bucket = await getImageBucket();
          await bucket.delete(new ObjectId(match[1]));
        } catch {
          // Da bi xoa tu truoc hoac khong ton tai, bo qua.
        }
      }
    }

    await deleteItem(id);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Phat video da render tu MongoDB GridFS (thay cho express.static("downloads")
// truoc day, vi dia cua host bi xoa moi lan redeploy/restart).
app.get("/videos/:id", async (req, res) => {
  try {
    const bucket = await getVideoBucket();
    const _id = new ObjectId(req.params.id);
    const files = await bucket.find({ _id }).toArray();
    if (!files[0]) return res.status(404).send("Khong tim thay video");

    res.set("Content-Type", files[0].contentType || "video/mp4");
    res.set("Content-Disposition", `inline; filename="${files[0].filename}"`);
    bucket.openDownloadStream(_id).on("error", () => res.end()).pipe(res);
  } catch (error) {
    res.status(404).send("Khong tim thay video");
  }
});

// Phat lai anh da upload tu GridFS - day la thu duy nhat tao ra 1 LINK CONG
// KHAI cho Pixazo (LTX) tai anh ve, vi Pixazo khong nhan data:base64 nhu
// Runway. Route nay khong yeu cau dang nhap (Pixazo can goi thang tu server
// cua ho), nen KHONG luu anh nhay cam/rieng tu qua day.
app.get("/uploads/:id", async (req, res) => {
  try {
    const bucket = await getImageBucket();
    const _id = new ObjectId(req.params.id);
    const files = await bucket.find({ _id }).toArray();
    if (!files[0]) return res.status(404).send("Khong tim thay anh");

    res.set("Content-Type", files[0].contentType || "image/jpeg");
    bucket.openDownloadStream(_id).on("error", () => res.end()).pipe(res);
  } catch (error) {
    res.status(404).send("Khong tim thay anh");
  }
});

function bufferToDataUrl(buffer, originalName) {
  const ext = (originalName.split(".").pop() || "jpg").toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${buffer.toString("base64")}`;
}

function extToMime(originalName) {
  const ext = (originalName.split(".").pop() || "jpg").toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `image/${mime}`;
}

// Tinh domain public de ghep thanh link anh cho Pixazo. Uu tien bien moi
// truong PUBLIC_BASE_URL neu nguoi dung tu cau hinh (vd chay sau CDN/domain
// rieng); neu khong co thi tu suy ra tu chinh request hien tai (dung tren
// Railway hoac cac host co domain public khac). CHAY LOCALHOST se KHONG hoat
// dong voi Pixazo vi Pixazo khong the ket noi vao may local cua ban.
function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
}

/**
 * Luu 1 anh (buffer) vao GridFS bucket "images" va tra ve link cong khai
 * tuong ung (dung cho Pixazo). Chi goi ham nay khi thuc su can (provider la
 * pixazo), tranh luu thua anh khong dung toi.
 */
async function storePublicImage(buffer, originalName, publicBaseUrl) {
  const bucket = await getImageBucket();
  const fileId = await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(originalName, {
      contentType: extToMime(originalName)
    });
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
  return `${publicBaseUrl}/uploads/${fileId.toString()}`;
}

// Nhan 2 kieu du lieu:
// 1) Kieu form nhap tay (mac dinh tren web): field "rowsJson" = JSON string
//    [{ id, prompt, image? }], cong voi field global "provider", "model",
//    "duration", "upscale".
// 2) Kieu CSV (nang cao): field "csv" la 1 file CSV voi cot id, prompt,
//    provider, model, duration, image. Cot "provider" o tung dong (neu co)
//    se ghi de len provider chung cua ca lo.
// Ca 2 kieu deu co the kem field "images" = nhieu file anh, ten file phai
// trung voi gia tri cot/truong "image" tuong ung.
app.post(
  "/api/upload",
  upload.fields([
    { name: "csv", maxCount: 1 },
    { name: "images", maxCount: 300 }
  ]),
  async (req, res) => {
    try {
      const globalProvider = normalizeProvider(req.body.provider);

      if (globalProvider === "runway" && !process.env.RUNWAYML_API_SECRET) {
        return res.status(400).json({ error: "Server missing RUNWAYML_API_SECRET" });
      }
      if (globalProvider === "pixazo" && !process.env.PIXAZO_KEY) {
        return res.status(400).json({ error: "Server missing PIXAZO_KEY" });
      }

      // imageMap: dung cho Runway (data URL, khong can luu vao DB truoc).
      const imageMap = {};
      // imageBufferMap: giu lai buffer goc, chi dung khi can luu GridFS cho
      // Pixazo (tranh luu du neu khong ai dung provider pixazo).
      const imageBufferMap = {};
      for (const file of req.files.images || []) {
        imageMap[file.originalname] = bufferToDataUrl(file.buffer, file.originalname);
        imageBufferMap[file.originalname] = file.buffer;
      }

      let rawItems = [];

      if (req.files?.csv?.[0]) {
        // Kieu CSV
        const csvContent = req.files.csv[0].buffer.toString("utf8");
        const rows = parse(csvContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true
        });

        rawItems = rows.map((row) => ({
          id: row.id,
          prompt: row.prompt,
          provider: normalizeProvider(row.provider || globalProvider),
          model: row.model || req.body.model,
          duration: row.duration || req.body.duration,
          pixazoSendDuration: (row.pixazoSendDuration ?? req.body.pixazoSendDuration) === "true",
          imageName: row.image || undefined
        }));
      } else if (req.body?.rowsJson) {
        // Kieu form nhap tay
        const rows = JSON.parse(req.body.rowsJson);

        rawItems = rows.map((row) => ({
          id: row.id,
          prompt: row.prompt,
          provider: globalProvider,
          model: req.body.model,
          duration: req.body.duration,
          pixazoSendDuration: req.body.pixazoSendDuration === "true",
          imageName: row.image || undefined
        }));
      } else {
        return res.status(400).json({ error: "Thieu du lieu: can rowsJson hoac file csv" });
      }

      rawItems = rawItems.filter((item) => item.prompt && item.prompt.trim());

      if (rawItems.length === 0) {
        return res.status(400).json({ error: "Chua co prompt nao" });
      }

      const state = getQueueState();
      if (state.isRunning) {
        return res.status(409).json({ error: "Hang doi dang chay, doi xong hoac Stop truoc" });
      }

      const upscaleEnabled = req.body.upscale !== "false";
      const ratio = "1280:720";
      const publicBaseUrl = getPublicBaseUrl(req);

      // Chan truoc nhung dong khong hop le, tranh dua vao hang doi roi moi
      // that bai giua chung:
      // - Prompt vuot qua gioi han cua provider tuong ung (1000 voi Runway,
      //   4500 voi Pixazo).
      // - Dong dung Pixazo nhung khong co anh (Pixazo/LTX chi ho tro
      //   image-to-video).
      const items = [];
      const rejected = [];

      for (const raw of rawItems) {
        const prompt = raw.prompt.trim();
        const provider = raw.provider;
        const promptMaxLength = getPromptMaxLength(provider);
        const providerLabel = provider === "pixazo" ? "X" : "Runway";

        if (prompt.length > promptMaxLength) {
          rejected.push({ id: raw.id, length: prompt.length, reason: "too_big" });
          await updateItemStatus(raw.id, {
            state: "FAILED",
            prompt,
            provider,
            error: `promptText: Prompt dài ${prompt.length} ký tự, vượt quá giới hạn ${promptMaxLength} ký tự của ${providerLabel}`,
            errorCode: "too_big",
            errorField: "promptText",
            errorStatus: 400
          });
          continue;
        }

        const imageBuffer = raw.imageName ? imageBufferMap[raw.imageName] : undefined;

        if (provider === "pixazo" && !imageBuffer) {
          rejected.push({ id: raw.id, reason: "missing_image" });
          await updateItemStatus(raw.id, {
            state: "FAILED",
            prompt,
            provider,
            error: "X bắt buộc phải có ảnh đầu vào (chỉ hỗ trợ image-to-video)",
            errorCode: "missing_image",
            errorField: "image",
            errorStatus: 400
          });
          continue;
        }

        let imageDataUrl;
        let imageUrl;

        if (imageBuffer) {
          imageDataUrl = imageMap[raw.imageName];
          if (provider === "pixazo") {
            // Chi luu vao GridFS (co URL public) khi thuc su dung Pixazo.
            imageUrl = await storePublicImage(imageBuffer, raw.imageName, publicBaseUrl);
          }
        }

        items.push({
          id: raw.id,
          prompt,
          provider,
          model: provider === "pixazo" ? "ltx" : raw.model || "gen4.5",
          duration: Number(raw.duration) || 5,
          pixazoSendDuration: provider === "pixazo" ? Boolean(raw.pixazoSendDuration) : false,
          ratio,
          imageDataUrl,
          imageUrl,
          upscaleEnabled: provider === "runway" ? upscaleEnabled : false,
          upscaleResolution: "4k"
        });
      }

      if (items.length === 0) {
        return res.status(400).json({
          error: `Không có dòng nào hợp lệ để đưa vào hàng đợi`,
          rejected
        });
      }

      res.json({ ok: true, count: items.length, rejected });

      // Ghi truoc trang thai QUEUED cho tung item (dung tru khi server bi
      // restart giua chung, item van con nam trong DB de tu resume duoc).
      for (const item of items) {
        await updateItemStatus(item.id, { ...item, state: "QUEUED", error: null });
      }

      // Chay nen, khong block response - de nguoi dung dong tab di lam viec khac
      runQueue(items).catch((err) => console.error("Queue error:", err));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * Neu server bi restart/redeploy giua luc dang render, cac video chua toi
 * trang thai cuoi (DONE/FAILED/STOPPED) se duoc tu dong day lai vao hang doi
 * khi server khoi dong lai, vi toan bo du lieu can thiet (prompt, provider,
 * model, anh...) da nam san trong MongoDB.
 */
async function resumeInterruptedItems() {
  try {
    const items = await getUnfinishedItems();
    if (items.length === 0) return;
    console.log(`Tim thay ${items.length} video do dang, tu dong render tiep...`);
    for (const item of items) {
      enqueueItem(item).catch((err) => console.error(`Resume ${item.id} loi:`, err));
    }
  } catch (error) {
    console.error("Khong resume duoc video do dang:", error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  resumeInterruptedItems();
});
