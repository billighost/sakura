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
