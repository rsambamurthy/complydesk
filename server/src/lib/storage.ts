/**
 * Where uploaded files live. Default "db": the bytes go in Postgres (file_blobs) — nothing to set up, backed up
 * with the database; right for the MVP's volumes. Set STORAGE=s3 with S3_BUCKET, S3_REGION, S3_ENDPOINT,
 * S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY for any S3-compatible store (Railway buckets, R2, AWS) — same driver
 * shape as VendorGate's storage layer.
 */
import { eq } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { db, schema } from './core.js';

export interface StorageDriver {
  name: 'db' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** A stream to pipe, or a short-lived URL to send the browser to. */
  get(key: string, opts: { fileName: string; contentType: string }): Promise<{ stream: NodeJS.ReadableStream } | { url: string }>;
  remove(key: string): Promise<void>;
  /** The whole file (for reading it on the server, e.g. the reviewer check). */
  read(key: string): Promise<Buffer>;
}

/** Keys look like tenantId/clientId/uuid.pdf — anything that could escape is refused. */
export function safeKey(key: string) {
  if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes('..') || key.startsWith('/')) throw new Error('Invalid storage key');
  return key;
}

const dbDriver: StorageDriver = {
  name: 'db',
  async put(key, body) { await db.insert(schema.fileBlobs).values({ key: safeKey(key), data: body }); },
  async get(key) {
    const [row] = await db.select().from(schema.fileBlobs).where(eq(schema.fileBlobs.key, safeKey(key)));
    if (!row) throw new Error('File not found');
    return { stream: Readable.from(row.data) };
  },
  async remove(key) { await db.delete(schema.fileBlobs).where(eq(schema.fileBlobs.key, safeKey(key))); },
  async read(key) {
    const [row] = await db.select().from(schema.fileBlobs).where(eq(schema.fileBlobs.key, safeKey(key)));
    if (!row) throw new Error('File not found');
    return row.data;
  },
};

async function s3Driver(): Promise<StorageDriver> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const e = process.env;
  const bucket = e.S3_BUCKET!;
  const client = new S3Client({ region: e.S3_REGION ?? 'auto', endpoint: e.S3_ENDPOINT || undefined, forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true', credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! } });
  return {
    name: 's3',
    async put(key, body, contentType) { await client.send(new PutObjectCommand({ Bucket: bucket, Key: safeKey(key), Body: body, ContentType: contentType })); },
    async get(key, { fileName, contentType }) {
      return { url: await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: safeKey(key), ResponseContentType: contentType, ResponseContentDisposition: `inline; filename="${encodeURIComponent(fileName)}"` }), { expiresIn: 60 }) };
    },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) })); },
    async read(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
  };
}

let driver: Promise<StorageDriver> | null = null;
export const storage = () => (driver ??= process.env.STORAGE === 's3' && process.env.S3_BUCKET ? s3Driver() : Promise.resolve(dbDriver));
