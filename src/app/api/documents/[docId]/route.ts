import type { NextRequest } from 'next/server';
import { err, handler } from '@/lib/api';
import { queryOne } from '@/lib/db';
import { requireAuth, hasPermission } from '@/lib/auth';
import { signedUrlFor, readFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

interface DocRow {
  id: string;
  application_id: string;
  doc_key: string;
  file_name: string;
  content_type: string | null;
  storage_path: string;
  applicant_user_id: string | null;
}

/**
 * GET /api/documents/:docId — view an uploaded document or photo.
 *
 * These files are IDs, business permits and photographs of people. The
 * permission check is the whole point of routing through here rather than
 * exposing storage directly: only the applicant who uploaded a file, or staff
 * holding application.view, may read it. Anyone else gets a 404 — not a 403,
 * so the endpoint never confirms that a given document id exists.
 */
export const GET = handler(
  async (request: NextRequest, { params }: { params: { docId: string } }) => {
    const auth = await requireAuth(request);

    const doc = await queryOne<DocRow>(
      `SELECT d.id, d.application_id, d.doc_key, d.file_name, d.content_type,
              d.storage_path, a.applicant_user_id
         FROM application_documents d
         JOIN applications a ON a.id = d.application_id
        WHERE d.id = $1`,
      [params.docId],
    );
    if (!doc) return err('Not found.', 404);

    const isOwner = doc.applicant_user_id === auth.userId;
    const isReviewer = auth.userType === 'staff' && hasPermission(auth, 'application.view');
    if (!isOwner && !isReviewer) return err('Not found.', 404);

    // With object storage, hand back a short-lived signed URL and let the
    // browser fetch it directly — no need to stream megabytes through here.
    const signed = await signedUrlFor(doc.storage_path, 300);
    if (signed) {
      return Response.redirect(signed, 307);
    }

    // Local driver: read and stream it ourselves.
    const bytes = await readFile(doc.storage_path);
    if (!bytes) return err('The stored file could not be read.', 404);

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': doc.content_type ?? 'application/octet-stream',
        // inline so images preview in the review page rather than downloading.
        'Content-Disposition': `inline; filename="${doc.file_name.replace(/"/g, '')}"`,
        // Private and short: the URL is behind auth, but caches should not
        // hold someone's ID document.
        'Cache-Control': 'private, max-age=60',
      },
    });
  },
);
