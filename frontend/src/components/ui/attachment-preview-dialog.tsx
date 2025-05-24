import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, File, FileText, Image, X, Loader2, FileDigit } from "lucide-react";

interface AttachmentPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  attachment: {
    url: string;
    filename?: string;
    mimetype?: string;
    contentType?: string;
    size?: number;
    messageId?: number;
  } | null;
}

export function AttachmentPreviewDialog({ isOpen, onClose, attachment }: AttachmentPreviewDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  if (!attachment) {
    return null;
  }

  const mimeType = attachment.mimetype || attachment.contentType || '';
  const filename = attachment.filename || 'Attachment';
  
  // Check for image type in more permissive ways
  const isImage = mimeType.startsWith('image/') || 
                  attachment.url.startsWith('data:image/') ||
                  /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename) ||
                  (attachment.url.startsWith('data:') && (
                    attachment.url.includes('image') ||
                    // Check for PNG signature in base64
                    attachment.url.includes('iVBORw0KGgo') ||
                    // Check for JPEG signature in base64
                    attachment.url.includes('/9j/')
                  ));
                  
  // Check for PDF files first
  const isPdf = mimeType === 'application/pdf' || 
                filename.toLowerCase().endsWith('.pdf') || 
                attachment.url.startsWith('data:application/pdf');
  
  // For PNG files saved with PDF MIME type
  const isPngWithPdfMime = 
    isPdf && 
    (filename.toLowerCase().endsWith('.png') || 
     (attachment.url.includes('iVBOR') && !attachment.url.includes('JVBERi0')));
     
  // If it seems to be a PNG with PDF MIME type, treat it as an image
  if (isPngWithPdfMime) {
    console.log('Detected PNG with PDF MIME type');
  }
  
  // Final image type detection (include PNGs with PDF MIME)
  const shouldRenderAsImage = isImage || isPngWithPdfMime;
  
  // Only treat it as a PDF if it's not an image with PDF MIME type
  const shouldRenderAsPdf = isPdf && !isPngWithPdfMime && !shouldRenderAsImage;
  
  // Check for text files
  const isText = mimeType.startsWith('text/') || 
                /\.(txt|log|csv|md|html|css|js|ts|jsx|tsx)$/i.test(filename);
                
  // Debug the attachment info
  console.log('Attachment preview info:', {
    filename,
    mimeType,
    isImage,
    isPdf,
    isPngWithPdfMime,
    shouldRenderAsImage,
    shouldRenderAsPdf,
    renderType: shouldRenderAsPdf ? 'pdf' : shouldRenderAsImage ? 'image' : isText ? 'text' : 'unknown',
    url: attachment.url?.substring(0, 50) + '...',
  });
                
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-auto max-h-[80vh] flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <DialogTitle className="text-lg font-medium">{filename}</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              {mimeType} {attachment.size ? `(${Math.round(attachment.size / 1024)} KB)` : ''}
            </DialogDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a 
                href={attachment.messageId ? `/api/attachments/${attachment.messageId}/${encodeURIComponent(filename)}` : attachment.url} 
                download={filename}
                className="flex items-center gap-1"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onClose}
              className="p-0 h-8 w-8 flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto mt-4 bg-gray-50 rounded-md p-4 flex items-center justify-center">
          {isLoading && !error && (
            <div className="text-center p-8">
              <Loader2 className="h-8 w-8 mx-auto text-gray-400 animate-spin" />
              <p className="mt-4 text-gray-600">Loading attachment preview...</p>
            </div>
          )}
          
          {error && !shouldRenderAsPdf && (
            <div className="text-center p-8">
              <div className="bg-red-50 text-red-600 p-4 rounded-md">
                {error}
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Please download the file to view it.
              </p>
            </div>
          )}

          {shouldRenderAsImage && (
            <div className="flex items-center justify-center w-full h-full">
              <img 
                src={attachment.url} 
                alt={filename} 
                className="max-w-full max-h-[60vh] object-contain"
                onLoad={() => setIsLoading(false)}
                onError={() => {
                  setError('Failed to load image');
                  setIsLoading(false);
                }}
              />
            </div>
          )}

          {isText && !isLoading && !error && (
            <div className="text-center p-8">
              <div className="border border-gray-200 rounded-md p-8 bg-white">
                <FileText className="h-16 w-16 mx-auto text-gray-400" />
                <p className="mt-4 text-gray-600">Text content preview not available</p>
                <p className="mt-2 text-sm text-gray-500">Please download the file to view its contents</p>
              </div>
            </div>
          )}

          {shouldRenderAsPdf && !shouldRenderAsImage && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center w-full h-full">
              <div className="w-full h-[60vh] border rounded overflow-hidden bg-white">
                <iframe
                  src={attachment.url}
                  title={filename}
                  className="w-full h-full border-0"
                  onLoad={() => setIsLoading(false)}
                  onError={() => {
                    setError('Failed to load PDF in preview');
                    setIsLoading(false);
                  }}
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
              <div className="mt-4 text-sm text-gray-500 text-center">
                <p>If the PDF does not load, your browser may be restricting iframe content.</p>
                <p>Please use the download button to view the file.</p>
              </div>
            </div>
          )}

          {shouldRenderAsPdf && !shouldRenderAsImage && error && (
            <div className="text-center p-8">
              <div className="border border-gray-200 rounded-md p-8 bg-white">
                <FileDigit className="h-16 w-16 mx-auto text-gray-400" />
                <p className="mt-4 text-gray-600">PDF Preview Failed</p>
                <p className="mt-2 text-sm text-gray-500">{error}</p>
                <div className="mt-4">
                  <Button variant="outline" size="sm" asChild>
                    <a 
                      href={attachment.messageId ? `/api/attachments/${attachment.messageId}/${encodeURIComponent(filename)}` : attachment.url} 
                      download={filename}
                      className="flex items-center gap-1"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="h-4 w-4" />
                      Download PDF
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!shouldRenderAsImage && !isText && !shouldRenderAsPdf && !isLoading && !error && (
            <div className="text-center p-8">
              <div className="border border-gray-200 rounded-md p-8 bg-white">
                <File className="h-16 w-16 mx-auto text-gray-400" />
                <p className="mt-4 text-gray-600">Preview not available for this file type</p>
                <p className="mt-2 text-sm text-gray-500">Please download the file to view it</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
