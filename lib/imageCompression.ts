export const MAX_IMAGE_EDGE = 1920;
export const MAX_COMPRESSED_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_COMPRESSION_ERROR_MESSAGE = "圖片壓縮後仍超過 2 MB，請更換圖片後再發布。";

const WEBP_QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42] as const;

export class ImageCompressionError extends Error {
  constructor(message = "圖片處理失敗，請更換圖片後再試一次。") {
    super(message);
    this.name = "ImageCompressionError";
  }
}

export function fitImageWithinMaxEdge(width: number, height: number, maxEdge = MAX_IMAGE_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressImageToWebP(file: File): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const dimensions = fitImageWithinMaxEdge(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ImageCompressionError();
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

    for (const quality of WEBP_QUALITIES) {
      const blob = await canvasToWebP(canvas, quality);
      if (blob.size <= MAX_COMPRESSED_IMAGE_BYTES) return blob;
    }
    throw new ImageCompressionError(IMAGE_COMPRESSION_ERROR_MESSAGE);
  } catch (error) {
    if (error instanceof ImageCompressionError) throw error;
    throw new ImageCompressionError();
  } finally {
    bitmap?.close();
  }
}

function canvasToWebP(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new ImageCompressionError()),
      "image/webp",
      quality,
    );
  });
}
