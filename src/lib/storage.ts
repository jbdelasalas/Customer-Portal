import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface StoredFile {
  storagePath: string;
  checksum: string;
  size: number;
}

/**
 * Writes an uploaded file and returns where it landed.
 *
 * Two drivers: 'local' (./uploads, for development) and 'supabase' (Storage,
 * for anything real). The stored name is always a fresh UUID — the applicant's
 * filename is kept in the database only, so it can never steer the write.
 */
export async function storeFile(
  file: File,
  prefix: string,
): Promise<StoredFile> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const ext = extensionFor(file.name, file.type);
  const objectName = `${prefix}/${randomUUID()}${ext}`;

  const driver = process.env.UPLOAD_DRIVER ?? 'local';

  if (driver === 'supabase') {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'onboarding-docs';
    if (!url || !key) throw new Error('Supabase storage is not configured.');

    const res = await fetch(`${url}/storage/v1/object/${bucket}/${objectName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: buffer,
    });
    if (!res.ok) {
      throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
    }
    return { storagePath: `${bucket}/${objectName}`, checksum, size: buffer.length };
  }

  const dir = join(process.cwd(), 'uploads', prefix);
  await mkdir(dir, { recursive: true });
  const full = join(process.cwd(), 'uploads', objectName);
  await writeFile(full, buffer);
  return { storagePath: `uploads/${objectName}`, checksum, size: buffer.length };
}

function extensionFor(name: string, mime: string): string {
  const fromName = name.match(/\.([a-z0-9]{1,8})$/i)?.[0];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
  };
  return map[mime] ?? '';
}

/** True when `mime` satisfies one of the schema's accept patterns. */
export function mimeAllowed(mime: string, accept?: string[]): boolean {
  if (!accept?.length) return true;
  return accept.some((rule) => {
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1));
    return rule === mime;
  });
}
