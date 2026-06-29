/**
 * Storage — MinIO (S3-compatible)
 * Env vars:
 *   MINIO_ENDPOINT   ex: http://172.17.0.1:9001
 *   MINIO_ACCESS_KEY autoinova
 *   MINIO_SECRET_KEY AutoInova2024!
 *   MINIO_BUCKET     media
 *   S3_BUCKET_URL    https://media.autoinovacrm.com.br/media  (public base URL)
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function getConfig() {
  const endpoint  = process.env.MINIO_ENDPOINT  || "";
  const accessKey = process.env.MINIO_ACCESS_KEY || "";
  const secretKey = process.env.MINIO_SECRET_KEY || "";
  const bucket    = process.env.MINIO_BUCKET     || "media";
  const publicUrl = (process.env.S3_BUCKET_URL   || "").replace(/\/$/, "");
  return { endpoint, accessKey, secretKey, bucket, publicUrl };
}

function getClient() {
  const { endpoint, accessKey, secretKey } = getConfig();
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error("MinIO não configurado: defina MINIO_ENDPOINT, MINIO_ACCESS_KEY e MINIO_SECRET_KEY no .env");
  }
  return new S3Client({
    endpoint,
    region: "us-east-1",          // MinIO ignora o valor mas exige o campo
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,          // obrigatório para MinIO
  });
}

/**
 * Faz upload de um arquivo e retorna a URL pública permanente.
 * @param relKey  caminho dentro do bucket, ex: "whatsapp/abc123.jpg"
 * @param data    Buffer ou string com o conteúdo
 * @param contentType  MIME type, ex: "image/jpeg"
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { bucket, publicUrl } = getConfig();
  const key = relKey.replace(/^\/+/, "");

  const body = typeof data === "string" ? Buffer.from(data) : data;

  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body as Buffer,
    ContentType: contentType,
  }));

  const url = publicUrl ? `${publicUrl}/${key}` : key;
  return { key, url };
}

/**
 * Retorna a URL pública de um arquivo já armazenado.
 */
export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const { publicUrl } = getConfig();
  const key = relKey.replace(/^\/+/, "");
  const url = publicUrl ? `${publicUrl}/${key}` : key;
  return { key, url };
}
