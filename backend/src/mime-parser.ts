/**
 * Enhanced MIME Parser
 * 
 * This utility helps parse complex multipart MIME messages
 * and extract content in a format suitable for display.
 */

import { simpleParser, ParsedMail } from 'mailparser';

interface MimeParserResult {
  html: string | null;
  text: string | null;
  subject: string;
  from: any;
  to: any;
  cc: any;
  date: Date | null; // Add date field to match ParsedMail
  messageId: string | null;
  inReplyTo: string | null;
  references: string | string[] | null;
  attachments: any[];
  headers: any; // Add headers field to match ParsedMail
}

/**
 * Extracts cleaner content from a MIME message with boundary markers
 * This is particularly useful for emails from Outlook, which often have
 * complex multipart structure
 */
export async function parseMimeContent(rawEmail: string): Promise<MimeParserResult> {
  try {
    // First try the standard parser
    const parsed = await simpleParser(rawEmail, {
      keepCidLinks: true,
      skipHtmlToText: false,
      skipTextToHtml: false,
    });
    
    // If the standard parser worked well, return its results
    if (parsed.html || parsed.text) {
      return {
        html: parsed.html || null,
        text: parsed.text || null,
        subject: parsed.subject || '',
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        date: parsed.date || null,
        messageId: parsed.messageId || null,
        inReplyTo: parsed.inReplyTo || null,
        references: parsed.references || null,
        attachments: parsed.attachments || [],
        headers: parsed.headers || {}
      };
    }
    
    // For more complex MIME messages, try to extract content manually
    // Extract multipart boundaries
    const boundaryMatch = rawEmail.match(/boundary="([^"]+)"/);
    if (!boundaryMatch) {
      // No boundary found, return the original parsed result
      return {
        html: parsed.html || null,
        text: parsed.text || null,
        subject: parsed.subject || '',
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        date: parsed.date || null,
        messageId: parsed.messageId || null,
        inReplyTo: parsed.inReplyTo || null,
        references: parsed.references || null,
        attachments: parsed.attachments || [],
        headers: parsed.headers || {}
      };
    }
    
    const boundary = boundaryMatch[1];
    const parts = rawEmail.split(`--${boundary}`);
    
    let htmlContent = null;
    let textContent = null;
    
    // Process each part based on content type
    for (const part of parts) {
      if (part.includes('Content-Type: text/html')) {
        // Extract HTML content
        const matches = part.match(/<html[\s\S]*<\/html>/i);
        if (matches && matches[0]) {
          htmlContent = matches[0];
        }
      } else if (part.includes('Content-Type: text/plain')) {
        // Extract plain text content
        const contentStartIndex = part.indexOf('\r\n\r\n');
        if (contentStartIndex !== -1) {
          textContent = part.substring(contentStartIndex + 4).trim();
        }
      }
    }
    
    // If we found content manually, return it along with the headers from the parsed result
    if (htmlContent || textContent) {
      return {
        html: htmlContent,
        text: textContent,
        subject: parsed.subject || '',
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        attachments: parsed.attachments || []
      };
    }
    
    // If all else fails, return the original parsed result
    return {
      html: parsed.html || null,
      text: parsed.text || null,
      subject: parsed.subject || '',
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      date: parsed.date || null,
      messageId: parsed.messageId || null,
      inReplyTo: parsed.inReplyTo || null,
      references: parsed.references || null,
      attachments: parsed.attachments || [],
      headers: parsed.headers || {}
    };
  } catch (error) {
    console.error('Error parsing MIME content:', error);
    throw error;
  }
}

/**
 * Simplified function to clean up email content for display
 * Specifically handles common issues with Outlook formatted emails
 */
export function cleanEmailContent(content: string): string {
  if (!content) return '';
  
  // Remove excessive line breaks
  let cleaned = content.replace(/(\r\n|\n){3,}/g, '\n\n');
  
  // Clean up Outlook disclaimer formatting
  cleaned = cleaned.replace(/________________________________/g, '<hr>');
  
  // Make Outlook "From:" sections more readable
  cleaned = cleaned.replace(/From: (.*?)Sent: (.*?)To: (.*?)Subject: (.*?)$/gm, 
    '<div class="email-header"><strong>From:</strong> $1<br><strong>Sent:</strong> $2<br><strong>To:</strong> $3<br><strong>Subject:</strong> $4</div>');
  
  return cleaned;
}
