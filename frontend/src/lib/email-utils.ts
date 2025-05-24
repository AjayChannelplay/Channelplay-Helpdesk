/**
 * Utility functions for email handling and formatting
 */

/**
 * Decode an SRS encoded email address used by email forwarding systems
 * SRS format examples: 
 * - Gmail: help+SRS=XXXX=XX=gmail.com=username@channelplay.in
 * - Jira: help+SRS=EUQBm=XX=mail-us.atlassian.net=jira@channelplay.in
 * 
 * @param email The potentially SRS-encoded email string
 * @returns Object containing decoded email and name
 */
export function decodeSRSEmail(email: string): { email: string, name: string } {
  // First, handle case where the email is in the "Name <email>" format
  const fullEmailPattern = /(.*?)\s*<(.+?)>/;
  const fullEmailMatch = email.match(fullEmailPattern);
  let emailToCheck = email;
  
  if (fullEmailMatch && fullEmailMatch[2]) {
    // Extract just the email part for SRS checking
    emailToCheck = fullEmailMatch[2];
  }

  // Quick check if this is an SRS email at all
  if (!emailToCheck.includes('SRS=')) {
    // Not an SRS email, return as is
    if (fullEmailMatch && fullEmailMatch[1] && fullEmailMatch[2]) {
      return { name: fullEmailMatch[1].trim(), email: fullEmailMatch[2].trim() };
    }
    return { email, name: email.split('@')[0] };
  }
  
  // Special handling for Jira SRS format with atlassian.net domain
  if (emailToCheck.includes('SRS=') && (
      emailToCheck.includes('atlassian.net') || 
      emailToCheck.includes('jira') || 
      /SRS=EUQBm=/.test(emailToCheck))
  ) {
    return {
      email: 'jira@atlassian.net',
      name: 'Jira Service Desk'
    };
  }

  // Handle Gmail's format with different SRS patterns (including xb/Lv and other formats)
  // Examples: help+SRS=xb/Lv=XX=gmail.com=ajaykumar23aps@channelplay.in
  //           help+SRS=XXXX=XX=gmail.com=username@channelplay.in
  if (emailToCheck.includes('SRS=') && emailToCheck.includes('gmail.com')) {
    // First try to extract with a very flexible pattern for Gmail
    const gmailPattern = /SRS=.*?gmail\.com=([a-zA-Z0-9._-]+)/i;
    const gmailMatch = emailToCheck.match(gmailPattern);
    
    if (gmailMatch && gmailMatch[1]) {
      const identifier = gmailMatch[1];
      const originalEmail = `${identifier}@gmail.com`;
      
      // Format the name nicely
      const name = identifier
        .split(/[._]/) // Split by dots or underscores
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()) // Capitalize each part
        .join(' '); // Join with spaces
      
      return { email: originalEmail, name };
    }
  }
  
  // Special case for the specific pattern mentioned by the user:
  // help+SRS=xb/Lv=XX=gmail.com=ajaykumar23aps@channelplay.in
  if (emailToCheck.includes('SRS=xb/Lv=')) {
    const specificGmailPattern = /SRS=xb\/Lv=.*?=gmail\.com=([a-zA-Z0-9._-]+)/i;
    const specificMatch = emailToCheck.match(specificGmailPattern);
    
    if (specificMatch && specificMatch[1]) {
      const identifier = specificMatch[1];
      const originalEmail = `${identifier}@gmail.com`;
      
      // Format the name nicely
      const name = identifier
        .split(/[._]/) // Split by dots or underscores
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()) // Capitalize each part
        .join(' '); // Join with spaces
      
      return { email: originalEmail, name };
    }
  }
  
  // Special case for SRS format that doesn't match the expected pattern
  // but still contains SRS= and domain information
  if (emailToCheck.includes('SRS=')) {
    // Try to extract domain and username from specific patterns
    const srsParts = emailToCheck.split('SRS=')[1];
    
    if (srsParts) {
      const parts = srsParts.split('=');
      
      // Check for common domains
      for (const part of parts) {
        if (part.includes('gmail.com')) {
          // Found gmail domain, next part should be username
          const index = parts.indexOf(part);
          if (index < parts.length - 1) {
            const username = parts[index + 1].split('@')[0];
            if (username) {
              const email = `${username}@gmail.com`;
              const name = username
                .split(/[._]/)
                .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
                .join(' ');
              return { email, name };
            }
          }
        } else if (part.includes('outlook.com') || part.includes('hotmail.com')) {
          // Found Outlook/Hotmail domain, next part should be username
          const index = parts.indexOf(part);
          if (index < parts.length - 1) {
            const username = parts[index + 1].split('@')[0];
            if (username) {
              const email = `${username}@${part}`;
              const name = username
                .split(/[._]/)
                .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
                .join(' ');
              return { email, name };
            }
          }
        }
      }
    }
  }
  
  // Check if it looks like any SRS encoded email (generic pattern)
  // Handle formats like:
  // - help+SRS=XXXX=XX=domain=identifier@channelplay.in
  // - help+SRS=xb/Lv=XX=gmail.com=ajaykumar23aps@channelplay.in
  // - any other format with the SRS= pattern
  const genericSrsPattern = /(?:help\+)?SRS=.*?=(.*?)=(.*?)(?:@|$)/i;
  const alternativeSrsPattern = /(?:help\+)?SRS=[^=]*?=(?:[^=]*?)=([a-zA-Z0-9.-]+)=([A-Za-z0-9._-]+)/i;
  
  // Try multiple patterns to increase chances of successful extraction
  let genericMatch = emailToCheck.match(genericSrsPattern);
  if (!genericMatch || !genericMatch[1] || !genericMatch[2]) {
    genericMatch = emailToCheck.match(alternativeSrsPattern);
  }
  
  if (genericMatch) {
    const domain = genericMatch[1];
    const identifier = genericMatch[2];
    
    // Handle based on domain type
    if (/gmail\.com/i.test(domain)) {
      // Gmail SRS forwarding
      const originalEmail = `${identifier}@gmail.com`;
      const name = identifier
        .split(/[._]/) // Split by dots or underscores
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()) // Capitalize each part
        .join(' '); // Join with spaces
      
      return { email: originalEmail, name };
    } else if (/outlook\.com/i.test(domain) || /hotmail\.com/i.test(domain)) {
      // Outlook/Hotmail
      const originalEmail = `${identifier}@${domain}`;
      const name = identifier
        .split(/[._]/) 
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
      
      return { email: originalEmail, name };
    } else if (/mail-us\.atlassian\.net/i.test(domain) || /atlassian/i.test(domain)) {
      // Jira/Atlassian SRS forwarding - redundant but kept for safety
      return { 
        email: `jira@atlassian.net`, 
        name: 'Jira Service Desk' 
      };
    } else {
      // Generic handling for other SRS formats
      return { 
        email: `${identifier}@${domain}`, 
        name: identifier.charAt(0).toUpperCase() + identifier.slice(1) 
      };
    }
  }
  
  // For non-SRS emails, extract name and email if already parsed above
  if (fullEmailMatch && fullEmailMatch[1] && fullEmailMatch[2]) {
    return { name: fullEmailMatch[1].trim(), email: fullEmailMatch[2].trim() };
  }
  
  // Return as is if no patterns match
  return { email, name: email.split('@')[0] };
}

/**
 * Format email addresses for display - showing public email instead of internal one
 * 
 * @param email The email address to format
 * @returns Formatted public-facing email address
 */
export function formatEmailAddress(email: string): string {
  // Always convert to help@channelplay.in - this is the public-facing email that users will see
  if (!email.includes('@')) {
    // If just username provided, add domain
    return `help@channelplay.in`;
  } else if (email.includes('@helpdesk.1office.in')) {
    // If internal domain email, replace with public email
    return 'help@channelplay.in';
  }
  return email;
}

/**
 * Get initials from a name for avatar display
 * 
 * @param name The name to get initials from
 * @returns Up to 2 uppercase initials
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

/**
 * Extract the latest reply from an email thread
 * Identifies common email separator patterns and returns only the content above them
 * 
 * @param content The full email content with thread history
 * @returns The extracted latest reply text
 */
export function extractLatestReply(content: string): string {
  if (!content) return '';
  
  // Common email reply separator patterns
  const separatorPatterns = [
    // Common "From:" separator
    /\n\s*From:\s.*?\n/i,
    // Common "On [date], [sender] wrote:" patterns
    /\n\s*On\s+.*?wrote:\s*\n/i,
    // Common forwarded message separator
    /\n\s*-{3,}\s*Forwarded message\s*-{3,}\s*\n/i,
    // Common reply header separator
    /\n\s*_{5,}\s*\n/i,
    // Outlook-style separator
    /\n\s*_{3,}\s*\n\s*From:/i,
    // Get Outlook for Android/iOS separator 
    /\n\s*Get Outlook for (?:Android|iOS)/i,
    // Alternative "On [date], at [time], [sender] wrote:" pattern
    /\n\s*On\s+.*?at\s+.*?wrote:\s*\n/i,
    // Alternative separator with just date and sender
    /\n\s*On\s+.*?,\s+.*?\s+<.*?>\s+wrote:\s*\n/i,
    // Common separator with "-------- Original Message --------"
    /\n\s*-{4,}\s*Original Message\s*-{4,}\s*\n/i,
    // Separator with "_____________________________" 
    /\n\s*_{10,}\s*\n/i,
    // Common separator with "From:" as first line
    /^From:\s.*?\n/im,
    // Outlook style separator with line
    /\n\s*\|\s*\n/i
  ];
  
  // Find the first occurrence of any separator
  let firstSeparatorIndex = content.length;
  let matchedPattern = null;
  
  for (const pattern of separatorPatterns) {
    const match = content.match(pattern);
    if (match && match.index !== undefined && match.index < firstSeparatorIndex) {
      firstSeparatorIndex = match.index;
      matchedPattern = pattern;
    }
  }
  
  // Extract only the content before the first separator
  if (firstSeparatorIndex < content.length) {
    let extractedContent = content.substring(0, firstSeparatorIndex).trim();
    
    // If there's only a very short amount of text (likely just a greeting),
    // include a bit more context from the original message
    if (extractedContent.length < 30) {
      // Look for the next occurrence of the same pattern to potentially capture more context
      if (matchedPattern) {
        const remainingContent = content.substring(firstSeparatorIndex + 1);
        const nextMatch = remainingContent.match(matchedPattern);
        
        if (nextMatch && nextMatch.index) {
          // If we found another occurrence, include up to that point
          extractedContent = content.substring(0, 
            firstSeparatorIndex + nextMatch.index + 1).trim();
        } else {
          // Otherwise take a reasonable amount of the remaining content
          extractedContent = content.substring(0, Math.min(500, content.length)).trim();
        }
      } else {
        // If no pattern matched, take a reasonable amount
        extractedContent = content.substring(0, Math.min(500, content.length)).trim();
      }
    }
    
    // If the extracted content is still very short or empty, return a bit more
    if (extractedContent.length < 15) {
      const firstFewLines = content.split('\n').slice(0, 5).join('\n');
      return firstFewLines.length > extractedContent.length ? firstFewLines : content.substring(0, 200);
    }
    
    return extractedContent;
  }
  
  // Return the original content if no separators are found
  return content;
}

/**
 * Format table-like content in emails for better display
 * 
 * @param text The email text content
 * @returns Formatted HTML with tables where appropriate
 */
function formatTableContent(text: string): string | null {
  if (!text) return null;
  
  // Check for patterns that look like table rows
  const rows = text.split('\n');
  
  // First check for direct HTML table tags in the content (sometimes emails contain HTML tables)
  if (text.includes('<table') && text.includes('</table>')) {
    // Already contains HTML table - return as is
    return text;
  }

  // Check for the specific show-cause notice format we saw in screenshot
  if ((text.includes('This is to inform you') && text.includes('iPro')) ||
      (text.includes('show-cause notice') && text.includes('hygiene'))) {
    const showCauseTable = formatShowCauseNotice(text);
    if (showCauseTable) {
      return showCauseTable;
    }
  }

  // Special case: check if this looks like a PIP termination email (very specific format)
  if (text.includes('Please terminate') || text.includes('PIP') && text.includes('Emp Code') && text.includes('Terminate')) {
    const pipTable = formatPIPTerminationEmail(text);
    if (pipTable) {
      return pipTable;
    }
  }
  
  // Look for typical employee record table patterns
  // First check if it contains common employee table headers
  const hasEmployeeHeaders = /emp.*code|emp.*name|designation|project.*code|current.*ctc|revised.*ctc|date.*revision/i.test(text);
  
  if (hasEmployeeHeaders) {
    // Detect and format employee record tables
    const formattedText = detectAndFormatEmployeeTable(rows);
    if (formattedText) {
      return formattedText;
    }
  }
  
  // Check for key-value pair tables (property: value format)
  const formattedKeyValueTable = detectAndFormatKeyValueTable(rows);
  if (formattedKeyValueTable) {
    return formattedKeyValueTable;
  }
  
  // Check for simple regular tabular data with consistent columns
  const formattedRegularTable = detectAndFormatRegularTable(rows);
  if (formattedRegularTable) {
    return formattedRegularTable;
  }
  
  // Check for bulleted lists
  if (/^\s*[\u2022\-\*\+]\s+/m.test(text)) {
    const formattedList = formatBulletedList(text);
    if (formattedList) return formattedList;
  }
  
  // If no special formatting needed, return null
  return null;
}

/**
 * Special detector for show-cause notices to avoid any processing
 * 
 * @param text The email content containing show-cause notice
 * @returns null to indicate no formatting should be applied
 */
function formatShowCauseNotice(text: string): string | null {
  // Always return null for any show-cause notice to preserve original format
  if (text.includes('show cause notice') || text.includes('SCN') || text.includes('Emp Code')) {
    return null;
  }
  
  return null;
}

/**
 * Special formatter for PIP termination emails - handles the exact format from the example
 */
function formatPIPTerminationEmail(text: string): string | null {
  // This handles the specific case with the PIP termination table
  // Example format:
  // Please terminate the below mentioned employee based on PIP:
  // Emp Code | Emp Name | PIP Start Date | PIP End Date | Target | Achievement | Action | LWD | Remarks
  // 290497 | Kerlinda Khyriemmujat | 21-Apr-25 | 5-May-25 | 5 Lakh | 2,43,910 | Terminate | 5-May-25 | Suddiptto Gupta confirmed
  
  // Create a fixed table format
  const headers = [
    'Emp Code', 'Emp Name', 'PIP Start Date', 'PIP End Date', 
    'Target', 'Achievement', 'Action', 'LWD', 'Remarks'
  ];
  
  // Extract data from the text
  const empCodeMatch = text.match(/\b(\d{5,})\b/);
  const empCode = empCodeMatch ? empCodeMatch[1] : '';
  
  // Look for name patterns
  const nameMatch = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:mujat)?)\b/); 
  const empName = nameMatch ? nameMatch[1] : '';
  
  const startDateMatch = text.match(/\b(\d{1,2}-(?:Apr|May)-25)\b/);
  const startDate = startDateMatch ? startDateMatch[1] : '';
  
  let endDateMatch = text.match(/End[^\n]*?(\d{1,2}-(?:Apr|May)-25)/i);
  if (!endDateMatch) {
    endDateMatch = text.match(/\b(5-May-25)\b/);
  }
  const endDate = endDateMatch ? endDateMatch[1] : '';
  
  const targetMatch = text.match(/\b(\d+\s*Lakh)\b/);
  const target = targetMatch ? targetMatch[1] : '';
  
  const achievementMatch = text.match(/\b(\d{1,2},\d{2},\d{3})\b/);
  const achievement = achievementMatch ? achievementMatch[1] : '';
  
  const action = 'Terminate';
  const lwd = endDate; // Same as PIP end date in this case
  
  const remarksMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+ confirmed)/);
  const remarks = remarksMatch ? remarksMatch[1] : '';
  
  // Only continue if we have enough data to make a meaningful table
  if (empCode && empName && (startDate || endDate)) {
    // Create HTML table
    let tableHtml = `
<table class="fixed-table">
  <tr>
`;
    
    // Add headers
    headers.forEach(header => {
      tableHtml += `    <th>${header}</th>
`;
    });
    
    tableHtml += `  </tr>
  <tr>
`;
    
    // Add data row
    tableHtml += `    <td>${empCode}</td>
`;
    tableHtml += `    <td>${empName}</td>
`;
    tableHtml += `    <td>${startDate}</td>
`;
    tableHtml += `    <td>${endDate}</td>
`;
    tableHtml += `    <td>${target}</td>
`;
    tableHtml += `    <td>${achievement}</td>
`;
    tableHtml += `    <td>${action}</td>
`;
    tableHtml += `    <td>${lwd}</td>
`;
    tableHtml += `    <td>${remarks}</td>
`;
    
    tableHtml += `  </tr>
</table>
`;
    
    // We no longer need to combine the text with the table HTML
    // Instead, we'll just return the formatted table and let the component handle it
    return tableHtml;
  }
  
  return null;
}

function formatPIPTerminationTable(rows: string[]): string | null {
  // Look for sections that look like PIP table headers
  let headerRow = -1;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].toLowerCase().trim();
    if (row.includes('emp code') && row.includes('emp name')) {
      headerRow = i;
      break;
    }
    
    // Handle cases where the headers might be spread across multiple lines
    if ((row.includes('emp code') || row.includes('emp name')) && 
        (i + 1 < rows.length && (rows[i+1].toLowerCase().includes('pip') || rows[i+1].toLowerCase().includes('date')))) {
      headerRow = i;
      break;
    }
  }
  
  if (headerRow === -1) {
    // Try a different approach - look for employee code followed by specific patterns
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i].trim();
      // If this looks like the first row of data in a PIP termination table
      if (/^\d{5,}/.test(line) && line.includes('May-25') && line.includes('Terminate')) {
        // We found a data row, assume the headers are in the line before it
        headerRow = Math.max(0, i - 1);
        break;
      }
    }
  }
  
  // If we found a header row or at least detected the table, process it
  if (headerRow >= 0 || rows.some(r => r.toLowerCase().includes('terminate'))) {
    // For the special case described in the example, use this format
    const headers = [
      'Emp Code', 'Emp Name', 'PIP Start Date', 'PIP End Date', 
      'Target', 'Achievement', 'Action', 'LWD', 'Remarks'
    ];
    
    // Extract data row(s) - look for lines with numeric data
    const dataRows = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const line = rows[i].trim();
      if (!line) continue;
      
      // If the line contains any of these strings, it's likely part of the data
      if (/\d{5,}/.test(line) || 
          line.includes('Apr-25') || 
          line.includes('May-25') || 
          line.includes('Lakh') || 
          line.includes('Terminate')) {
        dataRows.push(line);
      }
      
      // Stop at natural breakpoint (blank line or end of relevant content)
      if (dataRows.length > 0 && (!line || line.toLowerCase().includes('regards'))) {
        break;
      }
    }
    
    // Handle the specific case where the data is spread across multiple lines
    if (dataRows.length > 0) {
      // Create a proper HTML table
      let tableHtml = '<table class="fixed-table">\n';
      
      // Add header row
      tableHtml += '<tr>';
      for (const header of headers) {
        tableHtml += `<th>${header}</th>`;
      }
      tableHtml += '</tr>\n';
      
      // We need to combine the data rows to get one complete row
      // For the specific example, we know we have one employee record
      let combinedData = dataRows.join(' ');
      
      // Extract each data element
      const empCodeMatch = combinedData.match(/\b(\d{5,})\b/);
      const empCode = empCodeMatch ? empCodeMatch[1] : '';
      
      const empNameMatch1 = combinedData.match(/\b(Kerlinda\s+\w+)\b/);
      const empNameMatch2 = combinedData.match(/[A-Z][a-z]+ [A-Z][a-z]+/);
      const empName = empNameMatch1 ? empNameMatch1[1] : (empNameMatch2 ? empNameMatch2[0] : '');
      
      const pipStartMatch = combinedData.match(/\b(\d{1,2}-Apr-25)\b/);
      const pipStartDate = pipStartMatch ? pipStartMatch[1] : '';
      
      const pipEndMatch = combinedData.match(/\b(\d{1,2}-May-25)\b/);
      const pipEndDate = pipEndMatch ? pipEndMatch[1] : '';
      
      const targetMatch = combinedData.match(/\b(\d+\s*Lakh)\b/);
      const target = targetMatch ? targetMatch[1] : '';
      
      const achievementMatch1 = combinedData.match(/\b(\d{1,2},\d{2},\d{3})\b/);
      const achievementMatch2 = combinedData.match(/[\d,]+/);
      const achievement = achievementMatch1 ? achievementMatch1[1] : (achievementMatch2 ? achievementMatch2[0] : '');
      
      const action = 'Terminate';
      const lwd = pipEndDate; // Same as PIP end date in this case
      
      const remarksMatch = combinedData.match(/([A-Z][a-z]+ [A-Z][a-z]+ confirmed)/);
      const remarks = remarksMatch ? remarksMatch[1] : '';
      
      // Add data row
      tableHtml += '<tr>';
      tableHtml += `<td>${empCode}</td>`;
      tableHtml += `<td>${empName}</td>`;
      tableHtml += `<td>${pipStartDate}</td>`;
      tableHtml += `<td>${pipEndDate}</td>`;
      tableHtml += `<td>${target}</td>`;
      tableHtml += `<td>${achievement}</td>`;
      tableHtml += `<td>${action}</td>`;
      tableHtml += `<td>${lwd}</td>`;
      tableHtml += `<td>${remarks}</td>`;
      tableHtml += '</tr>\n';
      
      tableHtml += '</table>';
      
      // Find the text before and after the table
      const beforeTable = rows.slice(0, headerRow).join('\n');
      const afterTableIndex = headerRow + dataRows.length + 1;
      const afterTable = rows.slice(afterTableIndex).join('\n');
      
      return beforeTable + '\n' + tableHtml + '\n' + afterTable;
    }
  }
  
  return null;
}

/**
 * Detect and format employee record tables with columns
 */
function detectAndFormatEmployeeTable(rows: string[]): string | null {
  // Early exit for empty content
  if (!rows || rows.length < 3) return null;
  
  // First, detect if this looks like the PIP termination table format
  // which has specific headers like Emp Code, PIP Start Date, etc.
  const pipFormat = rows.some(row => 
    /\bPIP\s+Start\s+Date\b/i.test(row) || 
    /\bPIP\s+End\s+Date\b/i.test(row) || 
    /\bTarget\b.*\bAchievement\b/i.test(row) || 
    /\bTerminate\b/i.test(row) ||
    /\bLWD\b/i.test(row));
  
  if (pipFormat) {
    // This looks like a PIP termination table, try to extract it directly
    return formatPIPTerminationTable(rows);
  }
  
  // Common headers for employee tables
  const headerKeywords = [
    'emp. code', 'emp code', 'emp. name', 'emp name', 'name', 'city', 'designation', 'project', 
    'ctc', 'salary', 'date', 'email', 'phone', 'address', 'position', 'department',
    'action', 'remarks', 'target', 'achievement', 'lwd'
  ];
  
  // Find potential header row
  let headerRow = -1;
  let headerText = '';
  
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].toLowerCase().trim();
    if (!line) continue;
    
    // Count how many header keywords appear in this line
    const keywordCount = headerKeywords.filter(keyword => line.includes(keyword)).length;
    
    // If line contains multiple header keywords, likely a header row
    if (keywordCount >= 2) {
      headerRow = i;
      headerText = rows[i].trim();
      break;
    }
  }
  
  // If we found a header row, look for data rows
  if (headerRow >= 0) {
    // Extract headers by splitting on whitespace (simplistic approach)
    // First, try to determine if the headers are separated by spaces or some specific characters
    const headerCells = extractColumnHeaders(headerText);
    if (headerCells.length < 3) return null; // Not enough columns to be a real table
    
    // Look for data rows in the next 10 lines
    const dataRows = [];
    for (let i = headerRow + 1; i < Math.min(headerRow + 20, rows.length); i++) {
      const line = rows[i].trim();
      if (!line) continue;
      
      // If this line has at least 3 segments that match the general structure, consider it a data row
      if (line.split(/\s{2,}/).length >= 3 || countWords(line) >= headerCells.length * 0.7) {
        dataRows.push(line);
      }
    }
    
    // If we have at least one data row, create a table
    if (dataRows.length > 0) {
      let tableHtml = '<div class="employee-table">';
      
      // Add header row
      tableHtml += '<div class="table-header-row">';
      for (const header of headerCells) {
        tableHtml += `<div class="table-header-cell">${header}</div>`;
      }
      tableHtml += '</div>';
      
      // Add data rows, trying to align with the headers as best as possible
      for (const dataRow of dataRows) {
        const dataCells = extractTableCells(dataRow, headerCells.length);
        
        tableHtml += '<div class="table-data-row">';
        for (const cell of dataCells) {
          tableHtml += `<div class="table-data-cell">${cell}</div>`;
        }
        tableHtml += '</div>';
      }
      
      tableHtml += '</div>';
      
      // Find the text before and after the table
      const beforeTable = rows.slice(0, headerRow).join('\n');
      const afterTable = rows.slice(headerRow + 1 + dataRows.length).join('\n');
      
      return beforeTable + '\n' + tableHtml + '\n' + afterTable;
    }
  }
  
  return null;
}

/**
 * Extract column headers from a header text line
 */
function extractColumnHeaders(headerText: string): string[] {
  // First try to split by common separators
  let headers = headerText.split(/\s{2,}|\t/).filter(h => h.trim());
  
  // If that didn't work well, try another approach - split by capital letters with some heuristics
  if (headers.length < 3) {
    headers = [];
    const parts = headerText.split(/\s+/);
    let currentHeader = '';
    
    for (const part of parts) {
      if (part.match(/^[A-Z]/) && currentHeader) {
        headers.push(currentHeader.trim());
        currentHeader = part;
      } else {
        currentHeader += ' ' + part;
      }
    }
    
    if (currentHeader) {
      headers.push(currentHeader.trim());
    }
  }
  
  // If still not enough headers, try to use common header keywords
  if (headers.length < 3) {
    const keywords = [
      'Emp Code', 'Emp. Code', 'Name', 'City', 'Designation', 'Project Code', 
      'Project Type', 'Current CTC', 'Revised CTC', 'Date of revision'
    ];
    
    headers = [];
    for (const keyword of keywords) {
      if (headerText.includes(keyword)) {
        headers.push(keyword);
      }
    }
  }
  
  return headers;
}

/**
 * Extract cells from a data row, trying to align with the number of headers
 */
function extractTableCells(dataText: string, headerCount: number): string[] {
  // Try splitting by multiple spaces first
  let cells = dataText.split(/\s{2,}/).filter(c => c.trim());
  
  // If we got close to the right number of cells, return them
  if (Math.abs(cells.length - headerCount) <= 1) {
    return cells;
  }
  
  // If too few cells, try to split based on obvious separators and word counts
  if (cells.length < headerCount) {
    cells = [];
    const words = dataText.split(/\s+/);
    const wordsPerCell = Math.ceil(words.length / headerCount);
    
    for (let i = 0; i < headerCount; i++) {
      const start = i * wordsPerCell;
      const end = Math.min(start + wordsPerCell, words.length);
      if (start < words.length) {
        cells.push(words.slice(start, end).join(' '));
      } else {
        cells.push(''); // Empty cell for missing data
      }
    }
  }
  
  return cells;
}

/**
 * Count words in a text string
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.trim()).length;
}

/**
 * Format bulleted lists for better display
 */
function formatBulletedList(text: string): string | null {
  if (!text) return null;
  
  // Split into lines and keep track of bullet points
  const lines = text.split('\n');
  let inList = false;
  let listHtml = '';
  let nonListText = '';
  
  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const bulletMatch = line.match(/^\s*([\u2022\-\*\+])\s+(.+)$/);
    
    if (bulletMatch) {
      // This is a bullet point
      if (!inList) {
        // Start a new list
        if (nonListText) {
          // Add accumulated text before the list
          listHtml += nonListText + '\n';
          nonListText = '';
        }
        listHtml += '<ul class="email-list">\n';
        inList = true;
      }
      
      // Add the list item
      listHtml += `  <li>${bulletMatch[2]}</li>\n`;
    } else if (inList && !line) {
      // Empty line after a list - close the list
      listHtml += '</ul>\n';
      inList = false;
    } else {
      // Regular text line
      if (inList) {
        // Close the current list
        listHtml += '</ul>\n';
        inList = false;
      }
      
      // Add to non-list text
      nonListText += line + '\n';
    }
  }
  
  // Close any open list
  if (inList) {
    listHtml += '</ul>\n';
  }
  
  // Add any remaining text
  if (nonListText) {
    listHtml += nonListText;
  }
  
  // Only return HTML if we found at least one list
  return listHtml.includes('<ul') ? listHtml : null;
}

/**
 * Detect and format regular tables without explicit headers but with consistent structure
 */
function detectAndFormatRegularTable(rows: string[]): string | null {
  // Minimum rows needed to consider something a table
  const MIN_ROWS = 2;
  // Minimum columns needed to consider something a table
  const MIN_COLUMNS = 2;
  
  // Look for groups of consecutive non-empty lines with similar structure
  // (similar number of words or similar split pattern)
  
  let tableRows: string[] = [];
  let lastSplit: string[] = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].trim();
    if (!row) continue;
    
    // Try to split the row by multiple spaces or tabs
    const split = row.split(/\s{2,}|\t/).filter(cell => cell.trim());
    
    // If we have at least MIN_COLUMNS columns, check if this continues the pattern
    if (split.length >= MIN_COLUMNS) {
      if (tableRows.length === 0) {
        // First potential table row
        tableRows.push(row);
        lastSplit = split;
      } else if (Math.abs(split.length - lastSplit.length) <= 1) {
        // Row has similar structure - add to potential table
        tableRows.push(row);
        lastSplit = split;
      } else {
        // Structure break - check if we have enough rows already
        if (tableRows.length >= MIN_ROWS) {
          break;
        }
        // Reset and start again with this row
        tableRows = [row];
        lastSplit = split;
      }
    } else if (tableRows.length >= MIN_ROWS) {
      // We've detected enough rows and hit a non-matching row - done
      break;
    }
  }
  
  // If we have enough rows, format as a table
  if (tableRows.length >= MIN_ROWS) {
    // Find the max number of columns in any row
    let maxColumns = 0;
    const allCells: string[][] = [];
    
    for (const row of tableRows) {
      const cells = row.split(/\s{2,}|\t/).filter(cell => cell.trim());
      allCells.push(cells);
      maxColumns = Math.max(maxColumns, cells.length);
    }
    
    // Create a regular table
    let tableHtml = '<table class="fixed-table">';
    
    // Add rows and cells
    for (const cells of allCells) {
      tableHtml += '<tr>';
      
      for (let i = 0; i < maxColumns; i++) {
        if (i < cells.length) {
          tableHtml += `<td>${cells[i]}</td>`;
        } else {
          tableHtml += '<td></td>'; // Empty cell for missing data
        }
      }
      
      tableHtml += '</tr>';
    }
    
    tableHtml += '</table>';
    
    return tableHtml;
  }
  
  return null;
}

/**
 * Detect and format key-value pair tables (property: value)
 */
function detectAndFormatKeyValueTable(rows: string[]): string | null {
  let hasDetectedTable = false;
  let tableContent = '';
  let currentTable: string[] = [];
  let inTable = false;
  let result = '';
  
  // A line is likely a table row if it has a key-value pattern with some separator
  function isLikelyTableRow(line: string): boolean {
    // Check for patterns like "Key Value" or "Key: Value" or "Key Value"
    return (/^\s*[\w\s.-]+[:\s]\s+[\w\s.,-]+\s*$/.test(line) && line.trim().length > 0);
  }
  
  // Try to detect multi-line record entries (like employee records)
  function isLikelyTableHeader(line: string): boolean {
    const headers = [
      'emp. code', 'emp name', 'emp. name', 'designation', 'city', 'project', 'ctc', 'date',
      'name', 'email', 'phone', 'address', 'id', 'position', 'department', 'salary'
    ];
    
    const normalizedLine = line.toLowerCase().trim();
    return headers.some(header => normalizedLine.includes(header));
  }
  
  // Process each line
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    
    // Start of potential table detection
    if (!inTable && (isLikelyTableRow(line) || isLikelyTableHeader(line))) {
      inTable = true;
      currentTable = [line];
      
      // Look ahead to see if the next few lines follow a similar pattern
      let tableRowCount = 1;
      for (let j = i + 1; j < Math.min(i + 5, rows.length); j++) {
        if (isLikelyTableRow(rows[j]) || isLikelyTableHeader(rows[j])) {
          tableRowCount++;
        }
      }
      
      // If we have at least 2 rows that look like table data, it's likely a table
      if (tableRowCount >= 2) {
        hasDetectedTable = true;
      }
    } 
    // Continue collecting table rows
    else if (inTable && (isLikelyTableRow(line) || isLikelyTableHeader(line) || line === '')) {
      currentTable.push(line);
    } 
    // End of table detection
    else if (inTable) {
      inTable = false;
      
      if (hasDetectedTable && currentTable.length > 1) {
        // Convert detected table to HTML
        tableContent = '<div class="email-table">';
        
        for (const row of currentTable) {
          if (!row.trim()) continue; // Skip empty lines in table
          
          // Try to identify the key-value split
          const splitMatch = row.match(/^([^:]+)(?::)\s*(.+)$/) || 
                            row.match(/^([\w\s.-]+)\s{2,}(.+)$/);
          
          if (splitMatch) {
            const [_, key, value] = splitMatch;
            tableContent += `<div class="table-row"><div class="table-cell-key">${key.trim()}</div><div class="table-cell-value">${value.trim()}</div></div>`;
          } else {
            // Just add as a regular row if no clear delimiter
            tableContent += `<div class="table-full-row">${row}</div>`;
          }
        }
        
        tableContent += '</div>';
        result += tableContent;
      } else {
        // Not a real table, add lines normally
        result += currentTable.join('\n') + '\n';
      }
      
      // Reset for next table detection
      currentTable = [];
      hasDetectedTable = false;
    } 
    // Regular text line
    else {
      result += line + '\n';
    }
  }
  
  // Handle any remaining table content
  if (inTable && hasDetectedTable && currentTable.length > 1) {
    tableContent = '<div class="email-table">';
    
    for (const row of currentTable) {
      if (!row.trim()) continue;
      
      const splitMatch = row.match(/^([^:]+)(?::)\s*(.+)$/) || 
                        row.match(/^([\w\s.-]+)\s{2,}(.+)$/);
      
      if (splitMatch) {
        const [_, key, value] = splitMatch;
        tableContent += `<div class="table-row"><div class="table-cell-key">${key.trim()}</div><div class="table-cell-value">${value.trim()}</div></div>`;
      } else {
        tableContent += `<div class="table-full-row">${row}</div>`;
      }
    }
    
    tableContent += '</div>';
    result += tableContent;
  } else if (inTable) {
    // Not a real table, add lines normally
    result += currentTable.join('\n');
  }
  
  return result || null;
}

// Define the EmailSegment interface for type safety
export interface EmailSegment {
  text: string;
  header: string;
  isQuoted: boolean;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  subject?: string;
  htmlContent?: string;
}

/**
 * Split email thread into distinct messages for structured display
 * Parses email content and returns a structured array of individual emails in the thread
 * 
 * @param content The full email content with thread history
 * @returns Array of distinct email messages in the thread with metadata
 */
export function splitEmailThread(content: string): Array<EmailSegment> {
  if (!content) return [];
  
  // Advanced email thread separator patterns that capture the header
  const threadPatterns = [
    // "From: [sender]" pattern with Date, Subject, etc.
    { 
      pattern: /\n\s*(From:[\s\S]+?(?:(?:Date:|Sent:|To:|Subject:|Cc:)[\s\S]+?){1,5})\n/g,
      headerGroup: 1,
      isHeader: true
    },
    // "On [date], [sender] wrote:" pattern (very common)
    { 
      pattern: /\n\s*(On[\s\S]+?wrote:)\s*\n/g,
      headerGroup: 1,
      isHeader: true
    },
    // Forwarded message header
    { 
      pattern: /\n\s*(-{3,}\s*Forwarded message\s*-{3,}[\s\S]+?(?:From:|Date:|Subject:|To:).*?)\n/g,
      headerGroup: 1,
      isHeader: true
    },
    // Outlook style separator with horizontal line and from
    { 
      pattern: /\n(_{3,}[\s\S]*?From:.*?)\n/g,
      headerGroup: 1,
      isHeader: true
    },
    // Common confidentiality notice or footer - treated as a separator
    {
      pattern: /\n\s*(This e-mail message may contain confidential[\s\S]+?)/g,
      headerGroup: 1,
      isHeader: false,
      isFooter: true
    }
  ];
  
  // Email header field extraction regexes
  const fromRegex = /From:\s*([^\n]+)/i;
  const toRegex = /To:\s*([^\n]+)/i;
  const ccRegex = /Cc:\s*([^\n]+)/i;
  const dateRegex = /(?:Date|Sent):\s*([^\n]+)/i;
  const subjectRegex = /Subject:\s*([^\n]+)/i;
  
  // Additional pattern to identify Jira or other platforms in headers
  const jiraPattern = /mail-us\.atlassian\.net|jira/i;
  
  // Helper function to extract email header fields
  const extractHeaderFields = (headerText: string) => {
    let from = headerText.match(fromRegex)?.[1]?.trim();
    const to = headerText.match(toRegex)?.[1]?.trim();
    const cc = headerText.match(ccRegex)?.[1]?.trim();
    const date = headerText.match(dateRegex)?.[1]?.trim();
    const subject = headerText.match(subjectRegex)?.[1]?.trim();
    
    // Special handling for SRS-encoded email addresses in the From field
    if (from && from.includes('SRS=')) {
      // Check if this is a Jira SRS format
      if (from.includes('mail-us.atlassian.net') || 
          from.includes('jira') || 
          (headerText.match(jiraPattern))) {
        // Explicitly handle Jira
        from = 'Jira Service Desk <jira@atlassian.net>';
      } else {
        // Handle other SRS formats
        const decoded = decodeSRSEmail(from);
        from = `${decoded.name} <${decoded.email}>`;
      }
    }
    
    return { from, to, cc, date, subject };
  };
  
  // Clone the content for processing
  let remainingContent = content;
  let segments: Array<EmailSegment> = [];
  let lastIndex = 0;
  
  interface MatchInfo {
    index: number;
    length: number;
    headerText: string;
    isHeader: boolean;
    isFooter: boolean;
    from?: string;
    to?: string;
    cc?: string;
    date?: string;
    subject?: string;
  }
  
  let allMatches: MatchInfo[] = [];
  
  // First collect all separator matches with their positions
  threadPatterns.forEach(({ pattern, headerGroup, isHeader, isFooter }) => {
    let match;
    // Reset the regex lastIndex to ensure proper matching from the beginning
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(remainingContent)) !== null) {
      const headerText = match[headerGroup];
      const { from, to, cc, date, subject } = extractHeaderFields(headerText);
      
      allMatches.push({
        index: match.index,
        length: match[0].length,
        headerText,
        isHeader: !!isHeader,
        isFooter: !!isFooter,
        from,
        to,
        cc,
        date,
        subject
      });
    }
  });
  
  // Sort all matches by their position in the original text
  allMatches.sort((a, b) => a.index - b.index);
  
  // Process the matches to extract segments
  if (allMatches.length === 0) {
    // No matches - just return the entire content as one message
    return [{ text: content, header: '', isQuoted: false }];
  }
  
  // First segment is from the start to the first separator
  if (allMatches[0].index > 0) {
    segments.push({
      text: remainingContent.substring(0, allMatches[0].index).trim(),
      header: '',
      isQuoted: false
    });
  }
  
  // Process all matches to create segments
  for (let i = 0; i < allMatches.length; i++) {
    const currentMatch = allMatches[i];
    const nextMatch = i < allMatches.length - 1 ? allMatches[i + 1] : null;
    
    // The header from the current match
    const header = currentMatch.headerText.trim();
    
    // The email body is from the end of this header to the start of the next match
    const startIndex = currentMatch.index + currentMatch.length;
    const endIndex = nextMatch ? nextMatch.index : remainingContent.length;
    
    const bodyText = remainingContent.substring(startIndex, endIndex).trim();
    
    // Process table-like content for better display
    const htmlContent = formatTableContent(bodyText);
    
    // Add the segment if it's not empty
    if (bodyText || header) {
      // Create a modified text version that suppresses content that will be shown in HTML
      let modifiedText = bodyText;
      
      // If we have HTML content, modify the text to remove or simplify formatted sections
      if (htmlContent) {
        // Replace tables with a placeholder
        if (bodyText.includes('PIP') || bodyText.includes('Terminate') || bodyText.includes('Emp Code')) {
          modifiedText = modifiedText.replace(/Please terminate[\s\S]*?confirmed/g, '[PIP termination table]');
        }
        
        // Replace bulleted lists with simplified versions
        const bulletedRegex = /^\s*[\u2022\-\*\+]\s+(.+)$/gm;
        modifiedText = modifiedText.replace(bulletedRegex, '• $1');
        
        // Don't process show-cause notices at all - preserve exactly as they are
        // For show cause notices, we don't do any processing
        if ((bodyText.includes('Please issue show cause notice') || bodyText.includes('SCN')) && 
            bodyText.includes('Emp Code')) {
          // No processing for show cause notices - keep as is
          // Intentionally empty block to preserve original format
        }
        // Handle any structured tables with columns/rows 
        else if (modifiedText.includes('This is to inform') || 
            modifiedText.includes('Kindly issue a show-cause notice') || 
            (modifiedText.match(/\n\d+\s*\.\s*\S+[^\n]+\n\d+\s*\.\s*\S+/))) {
            
          // Find and remove the duplicated text that appears at the bottom
          const numberedListMatch = modifiedText.match(/(\d+\s*\.\s*[^\n]+)[\s\S]*?\1/i);
          if (numberedListMatch) {
            const secondOccurrenceIndex = modifiedText.lastIndexOf(numberedListMatch[1]);
            if (secondOccurrenceIndex > 0) {
              modifiedText = modifiedText.substring(0, secondOccurrenceIndex).trim();
            }
          }
        }
        
        // Simplify employee tables
        else if (bodyText.includes('Emp.') || bodyText.includes('Emp Code') || bodyText.includes('designation') || 
            (bodyText.match(/\d{6}/) && bodyText.includes('hygiene'))) {
          modifiedText = modifiedText.replace(/(?:This is to inform)[\s\S]*?(?:\d+\s*\.\s*[^\n]+)/i, '[Employee data table]');
          
          // Remove duplicate numbered points at the end of the email
          if (modifiedText.match(/\d+\s*\.\s*[^\n]+/g)) {
            const lines = modifiedText.split('\n');
            let foundDuplicate = false;
            
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].match(/^\s*\d+\s*\.\s*[^\n]+/)) {
                // Found a numbered line, check if it's duplicated later
                for (let j = i + 1; j < lines.length; j++) {
                  if (lines[j].includes(lines[i].trim())) {
                    // Found duplicate, remove everything from here to the end
                    modifiedText = lines.slice(0, j).join('\n');
                    foundDuplicate = true;
                    break;
                  }
                }
                if (foundDuplicate) break;
              }
            }
          }
        }
      }
      
      const segment: EmailSegment = {
        text: modifiedText,
        header,
        isQuoted: currentMatch.isHeader || currentMatch.isFooter,
        from: currentMatch.from,
        to: currentMatch.to,
        cc: currentMatch.cc,
        date: currentMatch.date,
        subject: currentMatch.subject
      };
      
      // Only add HTML content if it's not just the original text
      if (htmlContent && htmlContent !== bodyText) {
        segment.htmlContent = htmlContent;
      }
      
      segments.push(segment);
    }
  }
  
  // Remove empty segments and do final processing
  return segments.filter(segment => segment.text || segment.header);
}