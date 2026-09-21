export const MAX_PUBLISH_PDFS = 2;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME_LENGTH = 120;

export interface PdfFileLike { name: string; type: string; size: number }

export function sanitizeAttachmentName(name: string) {
  const sanitized = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (sanitized || "未命名文件.pdf").slice(0, MAX_ATTACHMENT_NAME_LENGTH);
}

export function isSupportedPdf(file: PdfFileLike) {
  return file.type === "application/pdf" && file.name.toLowerCase().endsWith(".pdf");
}

export function selectPublishPdfs<T extends PdfFileLike>(items: readonly T[], currentCount: number) {
  const pdfs = items.filter(isSupportedPdf);
  const invalidTypeCount = items.length - pdfs.length;
  const validSize = pdfs.filter(item => item.size <= MAX_PDF_BYTES);
  const oversizedCount = pdfs.length - validSize.length;
  const available = Math.max(0, MAX_PUBLISH_PDFS - currentCount);
  return {
    accepted: validSize.slice(0, available),
    invalidTypeCount,
    oversizedCount,
    overLimitCount: Math.max(0, validSize.length - available),
  };
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
