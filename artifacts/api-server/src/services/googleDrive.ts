import { google } from "googleapis";
import { Readable } from "stream";

let driveClient: any = null;

function getDriveClient() {
  if (driveClient) return driveClient;

  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawJson) {
    console.warn("[googleDrive] GOOGLE_SERVICE_ACCOUNT_JSON not set. Using local fallback.");
    return null;
  }

  try {
    let credentials: any;
    const trimmed = rawJson.trim();
    if (trimmed.startsWith("{")) {
      credentials = JSON.parse(trimmed);
    } else {
      try {
        const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
        credentials = JSON.parse(decoded);
      } catch {
        credentials = JSON.parse(trimmed);
      }
    }

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key?.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
  } catch (err) {
    console.error("[googleDrive] Error initializing Google Drive client:", err);
    return null;
  }
}

/**
 * Uploads a payment receipt to Google Drive folder and sets public read permission.
 */
export async function uploadReceiptToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ webViewLink: string; fileId: string }> {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!drive) {
    // Local dev fallback if Google Drive credentials not yet added
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return {
      webViewLink: dataUrl,
      fileId: `local-receipt-${Date.now()}`,
    };
  }

  try {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const fileMetadata: any = {
      name: `comprobante-ruta44-${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    };
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    const res = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType,
        body: stream,
      },
      fields: "id, webViewLink, webContentLink",
    });

    const fileId = res.data.id!;

    // Grant read access to anyone with the link
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
    } catch (permErr) {
      console.warn("[googleDrive] Warning making file public:", permErr);
    }

    const webViewLink = res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    return {
      webViewLink,
      fileId,
    };
  } catch (err: any) {
    console.error("[googleDrive] Error uploading file to Google Drive. Falling back to data URI:", err?.message || err);
    // Safe fallback so checkout is never interrupted even if Drive is not configured
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return {
      webViewLink: dataUrl,
      fileId: `fallback-receipt-${Date.now()}`,
    };
  }
}
