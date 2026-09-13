import { google } from "googleapis";
import { Readable } from "stream";

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }

  const credentials = JSON.parse(raw);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
}

/**
 * Upload 1 file len Google Drive.
 * Nhan thang buffer (video da tai ve tu Runway, dang giu trong RAM) thay vi
 * doc tu dia, vi dia cua Railway khong dung de luu ben vung nua.
 * LUU Y: folder dich (GOOGLE_DRIVE_FOLDER_ID) phai duoc CHIA SE (share)
 * cho email cua service account voi quyen Editor, neu khong se bi loi quota.
 */
export async function uploadToDrive(buffer, filename) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: folderId ? [folderId] : undefined
    },
    media: {
      mimeType: "video/mp4",
      body: Readable.from(buffer)
    },
    fields: "id, webViewLink"
  });

  return res.data;
}
