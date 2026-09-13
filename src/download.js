import { getVideoBucket } from "./db.js";

/**
 * Tai video tu URL tam cua Runway ve, luu thang vao MongoDB GridFS
 * (khong ghi ra dia cua Railway vi dia se mat moi lan container restart/redeploy).
 * Tra ve ca buffer (de tien the upload thang len Google Drive khong can doc lai)
 * va fileId (de phat lai qua route /videos/:id).
 */
export async function downloadAndStoreVideo(url, filename) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const bucket = await getVideoBucket();

  const fileId = await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: "video/mp4"
    });
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });

  return { buffer, fileId };
}
