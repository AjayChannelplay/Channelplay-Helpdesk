import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface EmailContentRendererProps {
  content: string;
  isHtml?: boolean;
}

/**
 * Enhanced Email Content Renderer
 * 
 * This component handles complex email content including:
 * - Multipart MIME messages with boundary markers
 * - HTML content with proper sanitization
 * - Quoted text from previous messages
 * - Email signatures and disclaimers
 * 
 * Designed to display emails similar to regular email clients
 */
export function EmailContentRenderer({ content, isHtml = false }: EmailContentRendererProps) {
  const [showQuoted, setShowQuoted] = useState(false);
  
  // Skip rendering if content is empty
  if (!content || content.trim() === '') {
    return <p className="text-sm text-slate-500">No content available</p>;
  }
  
  // Function to extract main content and quoted parts
  const extractEmailParts = () => {
    // If it's an HTML email, handle accordingly
    if (isHtml || content.includes('<html') || content.includes('<body')) {
      try {
        // Process HTML content to improve display
        const processedHtml = sanitizeEmailHtml(content);
        
        return { 
          mainContent: <div className="email-html-content" dangerouslySetInnerHTML={{ __html: processedHtml }} />,
          hasQuotedContent: content.includes('blockquote') || content.includes('class="gmail_quote"') || content.includes('id="divRplyFwdMsg"')
        };
      } catch (e) {
        // If HTML processing fails, fallback to simple rendering
        return { 
          mainContent: <div dangerouslySetInnerHTML={{ __html: content }} />,
          hasQuotedContent: content.includes('blockquote') || content.includes('class="gmail_quote"')
        };
      }
    }
    
    // For plain text emails
    let mainContent = content;
    let quotedContent = '';
    let hasQuotedContent = false;
    
    // Check for outlook-style boundaries
    if (content.includes('--_000_') || content.includes('Content-Type: text/plain') || content.includes('Content-Transfer-Encoding:')) {
      // Extract meaningful content and clean up
      mainContent = cleanOutlookEmail(content);
      hasQuotedContent = content.includes('From:') && (content.includes('Sent:') || content.includes('Date:'));
    } else {
      // Check for standard quoted content marked with '>' or lines after "On ... wrote:"
      const lines = content.split('\n');
      const mainLines: string[] = [];
      const quotedLines: string[] = [];
      
      // Look for the standard reply separator patterns
      const onWrotePattern = /On .+?wrote:$/i;
      const fromPattern = /^From:.*$/i;
      const sentPattern = /^Sent:.*$/i;
      
      let foundQuote = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Once we hit a quoted section marker, all subsequent lines are considered quoted
        if (!foundQuote && (line.trim().startsWith('>') || 
                           onWrotePattern.test(line) || 
                           (fromPattern.test(line) && i + 1 < lines.length && sentPattern.test(lines[i + 1])))) {
          foundQuote = true;
        }
        
        if (foundQuote) {
          quotedLines.push(line);
          hasQuotedContent = true;
        } else {
          mainLines.push(line);
        }
      }
      
      mainContent = mainLines.join('\n');
      quotedContent = quotedLines.join('\n');
    }
    
    return {
      mainContent: <div className="whitespace-pre-wrap">{mainContent}</div>,
      quotedContent: quotedContent ? <div className="whitespace-pre-wrap">{quotedContent}</div> : null,
      hasQuotedContent
    };
  };
  
  // Helper function to clean up Outlook-style emails
  const cleanOutlookEmail = (rawContent: string): string => {
    // Remove MIME boundaries and headers
    let cleaned = rawContent;
    
    // Remove content type headers
    cleaned = cleaned.replace(/Content-Type: text\/(plain|html);[\s\S]*?charset="[^"]*"/g, '');
    cleaned = cleaned.replace(/Content-Transfer-Encoding: [^\n]+\n/g, '');
    
    // Remove MIME boundaries
    cleaned = cleaned.replace(/--_+[^\n]+\n/g, '');
    
    // Clean up Outlook style quoted content
    const fromIndex = cleaned.indexOf('From:');
    if (fromIndex > 0) {
      // Keep only the content before the "From:" line
      cleaned = cleaned.substring(0, fromIndex).trim();
    }
    
    // Remove extra blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned.trim();
  };
  
  // Helper function to sanitize and improve HTML email display
  const sanitizeEmailHtml = (htmlContent: string): string => {
    let cleaned = htmlContent;
    
    // Remove harmful scripts if any
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Extract the body content if available
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      cleaned = bodyMatch[1];
    }
    
    // Add default styling
    cleaned = `<div style="font-family: Arial, sans-serif; line-height: 1.5;">${cleaned}</div>`;
    
    // Handle Outlook specific elements
    if (cleaned.includes('divRplyFwdMsg')) {
      // Try to separate main content from quoted content
      const parts = cleaned.split(/<div id=["']?divRplyFwdMsg["']?/i);
      if (parts.length > 1) {
        // Keep only the main content part
        cleaned = parts[0] + '<div style="display:none;">' + parts[1];
      }
    }
    
    // Replace common email disclaimer patterns with a cleaner format
    cleaned = cleaned.replace(/(<hr[^>]*>[\s\S]*?This e-mail message may contain confidential information[\s\S]*?company\.)/gi, 
      '<div style="font-size: 0.8em; color: #666; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px;">$1</div>');
    
    return cleaned;
  };
  
  const { mainContent, quotedContent, hasQuotedContent } = extractEmailParts();
  
  return (
    <Card className="shadow-sm border-slate-200 overflow-hidden">
      <CardContent className="p-0">
        <div className="text-sm text-slate-700 p-4">
          <div className="prose prose-sm max-w-none">
            {mainContent}
            
            {hasQuotedContent && (
              <div className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs flex items-center gap-1 bg-slate-50 hover:bg-slate-100"
                  onClick={() => setShowQuoted(!showQuoted)}
                >
                  {showQuoted ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Hide previous messages
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Show previous messages
                    </>
                  )}
                </Button>
                
                {showQuoted && quotedContent && (
                  <div className="mt-3 p-3 border-l-2 border-slate-200 text-slate-600 text-xs bg-slate-50 rounded">
                    {quotedContent}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
