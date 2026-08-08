import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadAudio = async (filePath: string) => {
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: 'video',
    folder: 'sakura/audio',
  });
  return result.secure_url;
};

export const uploadImage = async (filePath: string) => {
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: 'image',
    folder: 'sakura/images',
  });
  return result.secure_url;
};

export const uploadAvatar = async (buffer: Buffer) => {
  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'sakura/avatars', resource_type: 'image' },
      (error: Error | undefined, result: unknown) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(buffer);
  });
  return (result as any).secure_url as string;
};

/**
 * Upload audio straight from a readable stream.
 *
 * `uploadAudio` takes a file path, which is no use for content that arrives as
 * a stream from Telegram — using it would mean staging the whole file on a
 * serverless filesystem first. Piping avoids both the temp file and holding the
 * entire track in memory.
 *
 * `public_id` is caller-supplied and stable (the Telegram message id) so a
 * retry after a partial failure overwrites the same object instead of filling
 * the account with orphaned copies of the same song.
 *
 * The timeout is deliberately large. Cloudinary's default is 60s, which is not
 * a limit on the upload so much as on how long it will wait for the *source* —
 * and the source here is Telegram, which measured ~70KB/s, so a 9MB track takes
 * over two minutes to arrive and every promotion failed with a 499. The upload
 * runs in the background behind an already-sent response, so waiting is free;
 * giving up early is what costs something.
 */
export const uploadAudioStream = (
  stream: NodeJS.ReadableStream,
  publicId: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<{ url: string; bytes: number }> =>
  new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video', // Cloudinary classes audio under 'video'
        folder: 'sakura/audio',
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        timeout: timeoutMs,
        chunk_size: 6 * 1024 * 1024,
      },
      (error: Error | undefined, result: any) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error('Cloudinary returned no URL'));
        resolve({ url: result.secure_url as string, bytes: Number(result.bytes) || 0 });
      },
    );
    stream.on('error', reject);
    stream.pipe(upload);
  });
