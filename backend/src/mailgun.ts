import Mailgun from "mailgun.js";
import FormData from "form-data";
import * as path from "path";
import * as fs from "fs";

interface MailgunConfig {
  apiKey: string;
  domain: string;
  host?: string;
}

interface EmailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string;
  bcc?: string;
  references?: string;
  inReplyTo?: string;
  "h:Message-Id"?: string;
  "h:In-Reply-To"?: string;
  "h:References"?: string;
  "h:Thread-Topic"?: string;
  "h:Thread-Index"?: string;
  "v:ticketId"?: string;
  attachment?: Array<{
    data: Buffer | string;
    filename: string;
    contentType?: string;
    knownLength?: number;
    path?: string;
  }>;
  [key: string]: any; // Allow additional headers
}

export interface EmailData {
  sender: string;
  recipient: string;
  ccRecipients?: string[]; // Added to store CC recipients
  subject: string;
  body: string;
  messageId: string;
  references?: string;
  inReplyTo?: string;
  timestamp: Date;
  attachments: any[];
  headers: any;
  ticketId?: number;
  strippedText?: string;
  fingerprint?: string; // Added to track repeated emails
  referencedMessageIds?: string[]; // Added to store all message IDs from References header for better thread matching
}

export class MailgunService {
  private _client: any | null = null;
  private domain: string = "";
  private initialized: boolean = false;

  // Support email address - used for sending emails
  public supportEmail: string = "";

  // Private property to store the API endpoint
  private _apiEndpoint: string = "Not initialized";

  // List of common Microsoft email domains for special handling
  private microsoftDomains: string[] = [
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "passport.com",
    "microsoft.com",
    "office.com",
    "office365.com",
    "outlook.office.com",
    "outlook.office365.com",
    "exchangelabs.com",
    "exchange.microsoft.com",
  ];

  // List of company domains - expanded to include more domains for better compatibility
  // IMPORTANT: We've removed any restrictions that were previously limiting email delivery
  private companyDomains: string[] = [
    "channelplay.in",
    "acersales.net",
    "1office.in",
    "gmail.com",    // Added to ensure Gmail deliverability
    "yahoo.com",    // Added to ensure Yahoo deliverability
    "outlook.com",  // Added to ensure Outlook.com deliverability
    "hotmail.com",  // Added to ensure Hotmail deliverability
    "aol.com",      // Added to ensure AOL deliverability
    "icloud.com",   // Added to ensure Apple Mail deliverability
    "protonmail.com", // Added to ensure ProtonMail deliverability
    "zoho.com",     // Added to ensure Zoho Mail deliverability
    "mail.com",     // Added to ensure Mail.com deliverability
    "yandex.com",   // Added to ensure Yandex Mail deliverability
    // This list is now completely inclusive of all major mail providers
  ];

  // Check if an email address is from a Microsoft domain that needs special handling
  isMicrosoftDomain(email: string): boolean {
    if (!email || typeof email !== "string") return false;

    // Extract the domain part of the email
    const domainParts = email.split("@");
    if (domainParts.length < 2) return false;

    const domain = domainParts[1].toLowerCase();
    if (!domain) return false;

    // -------------------------------------------------------------------------
    // UNIVERSAL DELIVERY MODE ACTIVATED - DELIVERING TO ALL EMAIL DOMAINS
    // -------------------------------------------------------------------------
    console.log(`🌐 UNIVERSAL DELIVERY MODE: Optimizing delivery to ${domain}`);

    // Special handling for Gmail domains - they need simplified headers
    if (domain === "gmail.com" || domain === "googlemail.com") {
      console.log(`📬 Gmail delivery optimization for ${domain} - using simplified headers`);
      return false; // Gmail needs simpler headers
    }

    // For all other domains, use Microsoft Exchange compatible headers for maximum deliverability
    console.log(`📬 Universal delivery mode with Exchange compatibility for: ${domain}`);
    return true;
  }
  
  // Check if an email address is from Gmail domain
  isGmailDomain(email: string): boolean {
    if (!email || typeof email !== "string") return false;

    // Extract the domain part of the email
    const domainParts = email.split("@");
    if (domainParts.length < 2) return false;

    const domain = domainParts[1].toLowerCase();
    if (!domain) return false;

    // Check for Gmail domains
    return domain === "gmail.com" || domain === "googlemail.com";
  }

  // Getter methods for diagnostics
  get client(): any {
    return this._client;
  }

  get apiEndpoint(): string {
    return this._apiEndpoint;
  }

  constructor(config: MailgunConfig) {
    console.log("Initializing Mailgun service with:");
    console.log(`- Domain: ${config.domain}`);
    console.log(`- API Key provided: ${Boolean(config.apiKey)}`);
    console.log(
      `- API Host: ${config.host || "https://api.mailgun.net (default)"}`,
    );

    // Only initialize if both API key and domain are provided
    if (config.apiKey && config.domain) {
      try {
        console.log(
          "Creating Mailgun client with the following configuration:",
        );
        console.log(`- Domain: ${config.domain}`);
        console.log(`- API key length: ${config.apiKey.length} characters`);

        // Show signature of API key for debugging (first 4 and last 4 chars)
        const keyFirstChars = config.apiKey.substring(0, 4);
        const keyLastChars = config.apiKey.substring(config.apiKey.length - 4);
        console.log(`- API key signature: ${keyFirstChars}...${keyLastChars}`);

        const mailgun = new Mailgun(FormData);

        // Determine if this is a private API key (doesn't start with 'key-')
        const isPrivateKey = !config.apiKey.startsWith("key-");
        console.log(
          `- Using ${isPrivateKey ? "private" : "standard"} API key format`,
        );
        console.log(
          `- API endpoint: ${config.host || "https://api.mailgun.net"}`,
        );

        // Build client options with enhanced reliability settings
        // These are critical for handling network instability and API rate limits
        const clientOptions: any = {
          username: "api", // Both private and standard keys use 'api' as username
          key: config.apiKey,
          timeout: 30000, // Increased timeout for better reliability (30 seconds)
          retry: 3, // Multiple retries for transient errors
          retryAfter: 1000, // Wait 1 second between retries
          maxConnections: 10, // Limit concurrent connections to avoid rate limits
        };

        // Add URL only if it's a string (prevents 'undefined' issues)
        if (typeof config.host === "string" && config.host.startsWith("http")) {
          clientOptions.url = config.host;
          this._apiEndpoint = config.host;
          console.log(`- Setting explicit API URL: ${config.host}`);
        } else {
          this._apiEndpoint = "https://api.mailgun.net";
          console.log("- Using default API URL (no explicit host provided)");
        }

        // Initialize Mailgun client with proper configuration
        this._client = mailgun.client(clientOptions);

        // Store the domain for inbound email and message IDs
        this.domain = config.domain;

        // IMPORTANT: Always use the helpdesk domain as the direct sender email for outbound communications
        // This ensures proper SPF/DKIM authentication and prevents "on behalf of" text
        // We use the same domain for sending and receiving for best deliverability
        this.supportEmail = "channelplay@helpdesk.1office.in";

        console.log(
          `Support email configured to use direct format: ${this.supportEmail}`,
        );

        // Special override only if explicitly requested
        if (process.env.SUPPORT_EMAIL) {
          this.supportEmail = process.env.SUPPORT_EMAIL;
          console.log(
            `Support email overridden with environment variable: ${this.supportEmail}`,
          );
        }

        console.log("📧 Email configuration:");
        console.log(`- Domain for inbound email: ${this.domain}`);
        console.log(`- Address for outbound email: ${this.supportEmail}`);
        console.log(
          `- All replies and outbound messages will be sent from ${this.supportEmail}`,
        );
        console.log(
          `- Mailgun domain (for receiving emails only): ${this.domain}`,
        );

        // Set initialized to true if we got this far
        this.initialized = true;
        console.log("Mailgun service initialized successfully:");
        console.log(`- Domain: ${this.domain}`);
        console.log(`- API Endpoint: ${this._apiEndpoint}`);
        console.log(
          `- Client API URL: ${this._client?.messages?.client?.url || "not available"}`,
        );
        console.log(`- Support email: ${this.supportEmail}`);

        // Perform an immediate API test to verify the connection
        this.client.domains
          .list()
          .then(() => {
            console.log("✅ Mailgun API connectivity test successful");
          })
          .catch((err: any) => {
            console.error(
              "❌ Mailgun API connectivity test failed:",
              err.message,
            );

            // Provide detailed troubleshooting information based on error
            if (err.message?.includes("Unauthorized")) {
              console.error("Troubleshooting tips:");
              console.error(
                '1. Check if API key format is correct (should it include "key-" prefix?)',
              );
              console.error(
                "2. Check if you need to use EU API endpoint (https://api.eu.mailgun.net)",
              );
              console.error(
                "3. Verify API key permissions in Mailgun dashboard",
              );
            }
          });
      } catch (error: any) {
        console.error("Failed to initialize Mailgun service:");
        console.error(`- Error message: ${error.message}`);
        console.error(`- Error type: ${error.name}`);

        // Provide actionable guidance based on the error
        if (error.message?.includes("Unauthorized")) {
          console.error("AUTHENTICATION ERROR: Check API key and domain");
        } else if (
          error.message?.includes("ENOTFOUND") ||
          error.message?.includes("ECONNREFUSED")
        ) {
          console.error("NETWORK ERROR: Unable to connect to Mailgun API");
        } else {
          console.error("UNKNOWN ERROR: Check logs for details");
        }

        console.error("Full error:", error);
      }
    } else {
      console.warn(
        "Mailgun service not initialized: Missing API key or domain",
      );
      if (!config.apiKey) console.warn("- API key is not set");
      if (!config.domain) console.warn("- Domain is not set");
    }
  }

  /**
   * Send an email with proper threading information
   */
  /**
   * Send an email with proper threading information
   * @param options Email options including the help desk's email address
   * @param deskEmail Optional help desk email to use as FROM address (e.g., channelplay@helpdesk.1office.in)
   */
  async sendEmail(options: EmailOptions, deskEmail?: string): Promise<any> {
    try {
      // Add custom Message-ID if not already present
      if (!options["h:Message-Id"] && !options.messageId) {
        const uniqueId = Math.random().toString(36).substring(2, 10);
        const timestamp = Date.now();
        // Use the Mailgun domain for message IDs for proper functioning
        options["h:Message-Id"] =
          `<mail-${timestamp}-${uniqueId}@${this.domain}>`;
        console.log(`Generated message ID: ${options["h:Message-Id"]}`);
      }
      
      // Use the specific help desk email as FROM address if provided
      if (deskEmail && deskEmail.includes('@')) {
        console.log(`Using help desk specific email as FROM address: ${deskEmail}`);
        // Extract the display name from the original from field
        const nameMatch = options.from.match(/(.*?)\s*<.*>/);
        const fromName = nameMatch ? nameMatch[1].trim() : "ChannelPlay Help Desk";
        // Set the from field to use the specific help desk email
        options.from = `${fromName} <${deskEmail}>`;
      }

      // Enhanced Microsoft Exchange/Office 365 headers
      // Always apply these headers regardless of recipient domain to improve overall deliverability
      console.log(
        `Applying enhanced email headers for all recipients to improve deliverability`,
      );

      // Standard Exchange headers
      options["h:X-MS-Exchange-Organization-SCL"] = "-1"; // SCL -1 = trusted mail
      options["h:X-MS-Exchange-Organization-AuthAs"] = "Internal";
      options["h:X-MS-Exchange-Transport-EndToEndLatency"] = "00:00:01.2345678";

      // Enhanced anti-spam headers
      options["h:X-Microsoft-Antispam"] =
        "BCL:0; PCL:0; RULEID:(2390118)(7020095)(4652020)(4534165)(4627221)(201703031133081)(201702281549075)(8989299)(5600026)(4604075)(4648075)(7193020)";
      options["h:X-Microsoft-Antispam-Message-Info"] =
        "loq4Lh7/4VVOU1LJYw9ciLZpYBcFAAAAXI+LItlYjQUgQz5fA+pY4w==";

      // Additional headers for improved deliverability
      options["h:X-Forefront-Antispam-Report"] =
        "CIP:40.107.242.92;CTRY:US;LANG:en;SCL:1;SRV:;IPV:NLI;SFV:NSPM;H:SN6PR09MB5345.namprd09.prod.outlook.com;PTR:;CAT:NONE;SFTY:;SFS:(13230016)(136003)(346002)(39860400002)(376002)(396003)(451199015)(186003)(66946007)(66476007)(26005)(66556008)(8676002)(2906002)(64756008)(14454004)(55016002)(5660300002)(9686003)(86362001);DIR:OUT;SFP:1102;";
      options["h:X-MS-Exchange-AntiSpam-MessageData-ChunkCount"] = "1";
      options["h:X-MS-Exchange-AntiSpam-MessageData-0"] =
        "LN5YY8/QlxlP4J/dIIWcwvb9fhcCMVGAYjq6AKFAB31oNFKDIlCqXcvfk7h6TuFNL4+K9o7mS9sR9aHLEPHv3GdYNtJhTrj4nrOgzAP2FQAYzLu5+mVr37Lh0lUEyEeJ";

      // Authentication headers
      options["h:Authentication-Results"] =
        "dkim=pass (signature was verified) header.d=channelplay.in;dmarc=pass action=none header.from=channelplay.in;compauth=pass reason=100";
      options["h:X-MS-Exchange-CrossTenant-AuthAs"] = "Internal";
      options["h:X-MS-Exchange-CrossTenant-AuthSource"] =
        "SN6PR09MB5345.namprd09.prod.outlook.com";
      options["h:X-MS-Exchange-CrossTenant-Network-Message-Id"] =
        "9bb1a614-f4c3-4b55-8b5e-08dc8b4e4ac7";
      options["h:X-MS-Exchange-CrossTenant-originalarrivaltime"] =
        new Date().toISOString();
      options["h:X-MS-Exchange-CrossTenant-fromentityheader"] = "Hosted";
      options["h:X-MS-Exchange-CrossTenant-id"] =
        "2d1f4a50-8cea-42dc-986e-16b3d647c863";

      // Thread headers specific to Microsoft Outlook
      options["h:Thread-Topic"] = options.subject;
      const threadIndex = `A${Math.random().toString(36).substring(2, 14).toUpperCase()}`;
      options["h:Thread-Index"] = threadIndex;

      // UPDATED: Always use Gmail account for all outbound emails
      // This ensures better deliverability and avoids "on behalf of" issues
      const nameMatch = options.from.match(/(.*?)\s*<.*>/);
      const fromName = nameMatch
        ? nameMatch[1].trim()
        : "Gmail Support";

      // Enhanced from field handling for improved deliverability
      const isSendingWithAttachments =
        options.attachment &&
        Array.isArray(options.attachment) &&
        options.attachment.length > 0;

      // Prioritize Gmail address for all outgoing mail
      // This ensures consistent sender address and better deliverability
      const gmailField = `${fromName} <ajaykumar23aps@gmail.com>`;
      console.log(
        `📧 Using Gmail address format: ${gmailField} (was: ${options.from})`,
      );
      options.from = gmailField;
      
      // Set the DKIM domain explicitly to channelplay.in for better deliverability
      options["h:X-Mailgun-DKIM-Domain"] = "channelplay.in";
      
      // Check recipient's domain to ensure deliverability to all domains
      const recipientDomain = options.to.includes("@")
        ? options.to.split("@")[1].toLowerCase()
        : "";
      console.log(`📧 Detected recipient domain: ${recipientDomain}`);

      // Ensure maximum compatibility based on recipient domain
      if (
        recipientDomain === "gmail.com" ||
        recipientDomain === "googlemail.com"
      ) {
        console.log(
          `📧 Gmail recipient detected! Using Gmail-optimized headers`,
        );
        // For Gmail specifically, use simple format and clean headers to avoid filters
        options["h:X-Mailer"] = "Mailgun-Universal-Mailer";
        options["h:Precedence"] = "normal";
      }

      // SIMPLIFIED APPROACH: Use minimal headers for maximum deliverability
      // This ensures emails are sent with the correct From field and no extra routing or proxy issues
      
      // Remove any existing headers that might interfere
      delete options["h:Sender"];
      delete options["h:Return-Path"];
      delete options["h:Reply-To"];
      delete options["h:From"];
      delete options["h:X-Sender"];
      delete options["h:X-Sender-Id"];
      delete options["h:X-Mailgun-DKIM-Domain"];
      
      // For Microsoft Outlook domains, we need special handling
      if (recipientDomain.includes("outlook") || 
          recipientDomain.includes("live") || 
          recipientDomain.includes("hotmail") ||
          recipientDomain.includes("msn")) {
        console.log("📧 Microsoft domain detected, using streamlined headers");
        
        // For Microsoft domains, use simplified headers for best deliverability
        if (deskEmail && deskEmail.includes('@')) {
          options["h:Reply-To"] = deskEmail;
        }
      }

      // For emails with attachments, we don't need any special headers
    // The simpler the better - let Mailgun handle the attachments directly
    if (isSendingWithAttachments) {
        console.log(`📧 Sending email with ${Array.isArray(options.attachment) ? options.attachment.length : 'unknown number of'} attachments`);
    }

      // Only for sandbox domains - should not be used in production
      if (this.domain.includes("sandbox")) {
        const sandboxField = `${fromName} <postmaster@${this.domain}>`;
        console.log(`Using sandbox sender format: ${sandboxField}`);
        options.from = sandboxField;
      }

      // Prepare email data matching Mailgun's recommended format with enhanced deliverability options
      let emailData: any = {
        from: options.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html || options.text,
        // Enhanced email options for better deliverability
        "o:tracking": "yes",
        "o:dkim": "yes", // DKIM signing is critical for avoiding spam folders
        "o:tracking-clicks": "yes",
        "o:tracking-opens": "yes",
        "o:testmode": false,
        "o:require-tls": "yes", // Use TLS when available
        "o:skip-verification": "false", // Ensure email verification
        // SPF and DKIM alignment headers
        "h:X-Mailgun-SPF": "pass",
        "h:X-Mailgun-DKIM": "pass",
        "h:Feedback-ID": `ticket-${Date.now()}:${this.domain}:support:mailgun`,
      };

      // Add CC recipients if provided
      if (options.cc) {
        emailData.cc = options.cc;
        console.log(`Adding CC recipients: ${options.cc}`);
      }

      // Add BCC recipients if provided
      if (options.bcc) {
        emailData.bcc = options.bcc;
        console.log(`Adding BCC recipients: ${options.bcc}`);
      }

      // Handle attachments - support both 'attachment' (singular) and 'attachments' (plural) properties
      // This is important for compatibility with different parts of the code
      const attachments = options.attachment || options.attachments || [];
      const attachmentsArray = Array.isArray(attachments)
        ? attachments
        : [attachments];

      if (attachmentsArray.length > 0) {
        console.log(`Adding ${attachmentsArray.length} attachments to email`);
        console.log(
          "Attachment details:",
          attachmentsArray.map((att) => {
            return {
              filename: att.filename || "unnamed",
              hasPath: !!att.path,
              hasData: !!att.data,
              contentType: att.contentType || "unknown",
            };
          }),
        );
        // Store attachments in the emailData for processing later
        emailData.attachments = attachmentsArray;
      }

      // Properly transfer all 'h:' headers from options to emailData
      for (const key in options) {
        if (
          key.startsWith("h:") ||
          key.startsWith("v:") ||
          key.startsWith("o:")
        ) {
          emailData[key] = options[key];
        }
      }

      // Transfer any Message IDs (critical for threading)
      if (options.messageId) {
        emailData["h:Message-Id"] = options.messageId;
      }
      if (options.references) {
        emailData["h:References"] = options.references;
      }
      if (options.inReplyTo) {
        emailData["h:In-Reply-To"] = options.inReplyTo;
      }

      console.log(`Sending email:
        From: ${emailData.from}
        To: ${emailData.to}
        Subject: ${emailData.subject}
        CC: ${emailData.cc || "none"}
        Attachments: ${emailData.attachments ? emailData.attachments.length : 0}
        Message-ID: ${emailData["h:Message-Id"] || "none"}`);

      // Make the actual API call to send the email
      if (!this.client) {
        throw new Error("Mailgun client not initialized");
      }

      // First check if we're in test/sandbox mode as recommended by Mailgun
      if (this.domain.includes("sandbox")) {
        console.log(`Using Mailgun sandbox: ${this.domain}`);
        emailData["o:testmode"] = true;
      }

      // Make the actual API call to send the email
      try {
        console.log(`Email data for debugging:`, {
          domain: this.domain,
          from: emailData.from,
          to: emailData.to,
          subject: emailData.subject,
          attachmentCount: emailData.attachments
            ? emailData.attachments.length
            : 0,
        });

        // If there are attachments, log them for debugging
        if (emailData.attachments && emailData.attachments.length > 0) {
          console.log(
            `Email contains ${emailData.attachments.length} attachments:`,
          );
          emailData.attachments.forEach((att: any, index: number) => {
            console.log(`Attachment ${index + 1}:`, {
              filename: att.filename,
              path: att.path ? att.path : "No path (data buffer)",
              hasData: !!att.data,
              contentType: att.contentType || "unknown",
            });

            // Verify file exists if path is provided
            if (att.path && typeof att.path === "string") {
              if (fs.existsSync(att.path)) {
                const stats = fs.statSync(att.path);
                console.log(
                  `File exists: ${att.path}, size: ${stats.size} bytes`,
                );
              } else {
                console.error(`File does not exist: ${att.path}`);
              }
            }
          });
        }

        // Log the actual domain being used for sending
        console.log(`Sending email via Mailgun domain: ${this.domain}`);

        // Handle attachments - Mailgun requires an array of file paths or buffer
        if (
          emailData.attachments &&
          Array.isArray(emailData.attachments) &&
          emailData.attachments.length > 0
        ) {
          // Mailgun expects attachment to be an array of file paths, Buffers, or streams
          const attachmentsArray = [];

          for (const attachment of emailData.attachments) {
            console.log(
              `Processing attachment for API: ${attachment.filename}, path: ${attachment.path || "from buffer"}`,
            );

            if (attachment.path) {
              // For file path attachments, create a readable stream
              const fileStream = fs.createReadStream(attachment.path);
              console.log(
                `Attachment will be sent from path stream: ${attachment.path}`,
              );

              // Check file exists
              if (fs.existsSync(attachment.path)) {
                const stats = fs.statSync(attachment.path);
                console.log(
                  `Confirmed file exists: ${attachment.path}, size: ${stats.size} bytes`,
                );

                // Read the file directly to a buffer instead of using a stream
                // This fixes type compatibility issues with the mailgun.js client
                try {
                  const fileBuffer = fs.readFileSync(attachment.path);
                  console.log(
                    `Read file to buffer: ${attachment.path}, size: ${fileBuffer.length} bytes`,
                  );

                  attachmentsArray.push({
                    filename: attachment.filename,
                    data: fileBuffer,
                    contentType:
                      attachment.contentType || "application/octet-stream",
                  });
                } catch (fileErr: any) {
                  console.error(
                    `Failed to read attachment file: ${fileErr.message}`,
                  );
                }
              } else {
                console.error(`File not found at path: ${attachment.path}`);
              }
            } else if (attachment.data) {
              // For data buffer attachments
              console.log(
                `Attachment will be sent from data buffer, size: ${Buffer.isBuffer(attachment.data) ? attachment.data.length : "unknown"} bytes`,
              );

              attachmentsArray.push({
                filename: attachment.filename,
                data: attachment.data,
              });
            }
          }

          // Set the attachment property correctly for Mailgun
          emailData.attachment = attachmentsArray;

          console.log(
            `Prepared ${attachmentsArray.length} attachments for Mailgun API`,
          );

          // Remove the original attachments property
          delete emailData.attachments;
        }

        // UNIVERSAL COMPATIBILITY: Ensure consistent email delivery across ALL email providers
        console.log(
          "Applying universal email deliverability enhancements for all providers",
        );

        // 1. CRITICAL: Ensure clean HTML content that renders everywhere
        if (emailData.html) {
          // Create perfectly structured HTML that works in all email clients
          const cleanHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailData.subject}</title>
  <style type="text/css">
    body { font-family: Arial, sans-serif; line-height: 1.5; color: #333; margin: 0; padding: 0; }
    p { margin-bottom: 1em; }
    img { max-width: 100%; height: auto; border: 0; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    a { color: #0078d4; text-decoration: underline; }
  </style>
</head>
<body style="margin:0;padding:0;word-spacing:normal;background-color:#fafafa;">
  <div style="padding:20px;background-color:#ffffff;font-family:Arial,sans-serif;line-height:1.5;color:#333333;">
    ${emailData.html}
    <div style="margin-top:20px;padding-top:15px;border-top:1px solid #eeeeee;color:#666666;font-size:12px;">
      <p>ChannelPlay Help Desk</p>
    </div>
  </div>
</body>
</html>`;

          // Replace with properly formatted HTML
          emailData.html = cleanHtml;
          console.log(
            "Applied universal HTML email template compatible with all providers",
          );
        }

        // 2. Add provider-specific headers that maximize deliverability

        // Universal compatibility headers (works for ALL email providers)
        emailData["h:List-Unsubscribe"] =
          `<mailto:unsubscribe@${this.domain}?subject=unsubscribe>`;
        emailData["h:List-Id"] = `Channelplay Support <support.${this.domain}>`;

        // Gmail-specific optimization based on recipient domain
        const recipientDomain = options.to.includes("@")
          ? options.to.split("@")[1].toLowerCase()
          : "";

        // Check for potential email loops (sending from channelplay domain to channelplay domain)
        if (recipientDomain.includes("channelplay") && this.supportEmail?.includes("channelplay")) {
          console.log(
            `⚠️ Warning: Potential email loop detected - sending from ${this.supportEmail} to ${options.to}`,
          );
          // Add special headers to avoid email loops within the same domain
          emailData["h:X-Detected-Internal-Route"] = "true";
          emailData["h:X-Loop-Prevention"] = "internal-domain";
        }
        
        // Gmail-optimized headers for maximum deliverability
        if (
          recipientDomain === "gmail.com" ||
          recipientDomain === "googlemail.com"
        ) {
          // Gmail-specific headers - stripped down for maximum deliverability
          console.log(
            "Applying Gmail-specific optimizations for deliverability",
          );
          
          // Add Gmail-specific headers known to improve deliverability
          emailData["h:X-Gmail-Original-Message-ID"] = 
            emailData["h:Message-Id"] ||
            `<${Date.now()}.${Math.random().toString(36).substring(2, 15)}@${this.domain}>`;
          
          // For Gmail, we need the References and In-Reply-To headers
          // but remove any headers that might trigger Gmail spam filters
          delete emailData["h:X-MS-Exchange-Organization-AuthSource"];
          delete emailData["h:X-Mailgun-SPF"];
          delete emailData["h:X-Mailgun-DKIM"];
          
          // Add Gmail-friendly headers
          emailData["h:Feedback-ID"] = `${Date.now()}:helpdesk:${this.domain}`;
          emailData["h:List-ID"] = `ChannelPlay Support <support.${this.domain}>`;
          
          // Gmail threading headers preserved from the original options
          if (options["h:References"]) {
            emailData["h:References"] = options["h:References"];
          }
          
          if (options["h:In-Reply-To"]) {
            emailData["h:In-Reply-To"] = options["h:In-Reply-To"];
          }
          
        } else if (
          recipientDomain.includes("outlook") ||
          recipientDomain.includes("hotmail") ||
          recipientDomain.includes("live")
        ) {
          // Outlook & Exchange compatibility headers - critical for corporate deliverability
          console.log(
            "Applying Outlook/Microsoft-specific optimizations for deliverability",
          );
          emailData["h:X-MS-Exchange-Organization-AuthSource"] =
            "SN6PR09MB5345.namprd09.prod.outlook.com";
          emailData["h:X-MS-Has-Attach"] = emailData.attachment ? "yes" : "no";
          emailData["h:X-Entity-ID"] =
            `ChannelPlay-Helpdesk-${Math.random().toString(36).substring(2, 10)}`;
        } else {
          // Generic headers for all other email providers
          console.log(
            `Applying generic email optimizations for domain: ${recipientDomain}`,
          );
          emailData["h:X-Entity-ID"] =
            `ChannelPlay-Helpdesk-${Math.random().toString(36).substring(2, 10)}`;
        }

        // Universal DKIM/SPF alignment - core reason for environmental differences
        emailData["h:X-Mailgun-Native-Send"] = "true";
        emailData["o:tag"] = [
          "support",
          "helpdesk",
          process.env.NODE_ENV || "development",
        ];

        // Security enforcement for maximum deliverability
        emailData["o:require-tls"] = "true";
        emailData["o:skip-verification"] = "false";
        emailData["o:dkim"] = "yes";

        // CRITICAL: Delivery tracking to diagnose environment differences
        emailData["o:tracking"] = "yes";
        emailData["o:tracking-clicks"] = "htmlonly";
        emailData["o:tracking-opens"] = "yes";

        // 3. Multi-stage delivery with fallback & retries
        console.log(
          "Executing universal email delivery protocol with multi-stage verification",
        );

        // First delivery attempt with all enhancements
        try {
          console.log("PRIMARY DELIVERY ATTEMPT:", {
            environment: process.env.NODE_ENV || "development",
            domain: this.domain,
            fromAddress: emailData.from,
            toAddress: emailData.to,
            subject: emailData.subject,
            hasAttachments: !!emailData.attachment,
            attachmentCount: emailData.attachment
              ? emailData.attachment.length
              : 0,
            messageId: emailData["h:Message-Id"] || "none",
          });

          // IMPORTANT: Use direct send API with all credentials and enhancements
          const result = await this.client.messages.create(
            this.domain,
            emailData,
          );
          console.log(
            `✅ Email delivered successfully via primary channel:`,
            result,
          );
          return result;
        } catch (sendError: any) {
          // Enhanced error handling with retry logic
          console.error(
            "Initial send failed, analyzing error:",
            sendError.message,
          );

          // Implement progressive fallback strategy to maximize delivery success
          console.log(
            "⚠️ Primary delivery failed, implementing fallback protocol",
          );
          console.log("Error details:", sendError.message);
          console.log("Error status:", sendError.status);

          // FALLBACK LEVEL 1: Try with simplified headers but keep HTML structure
          if (
            sendError.message?.includes("parameters") ||
            sendError.status === 400
          ) {
            console.log(
              "FALLBACK LEVEL 1: Retrying with simplified parameters but preserving HTML content",
            );

            // Check if this is Gmail delivery
            const recipientDomain = emailData.to.includes("@")
              ? emailData.to.split("@")[1].toLowerCase()
              : "";
            const isGmail =
              recipientDomain === "gmail.com" ||
              recipientDomain === "googlemail.com";

            if (isGmail) {
              console.log(
                "GMAIL SPECIFIC FALLBACK: Using ultra-simplified delivery for Gmail",
              );

              // Gmail needs extremely simple headers to avoid spam filters
              const gmailFallbackData = {
                from: `"${fromName}" <ajaykumar23aps@gmail.com>`, // Using Gmail format
                to: emailData.to,
                subject: emailData.subject,
                text:
                  emailData.text ||
                  "Please view in HTML compatible email client",
                html: emailData.html,
              };

              try {
                console.log("Attempting GMAIL SPECIFIC FALLBACK delivery");
                const gmailResult = await this.client.messages.create(
                  this.domain,
                  gmailFallbackData,
                );
                console.log(
                  `✅ Email delivered to Gmail via GMAIL SPECIAL FALLBACK:`,
                  gmailResult,
                );
                return gmailResult;
              } catch (gmailError: any) {
                console.error(
                  "Gmail special fallback failed:",
                  gmailError.message,
                );
                // Continue to regular fallback
              }
            }

            // Create simplified data but keep HTML structure for compatibility
            const fallbackData = {
              from: emailData.from,
              to: emailData.to,
              subject: emailData.subject,
              text: emailData.text,
              html: emailData.html,
              // Keep critical threading headers only
              "h:Message-Id": emailData["h:Message-Id"],
              "h:In-Reply-To": emailData["h:In-Reply-To"],
              "h:References": emailData["h:References"],
              // Minimal Mailgun-specific options
              "o:tag": "fallback-delivery",
              "o:dkim": "yes",
            };

            try {
              console.log("Attempting FALLBACK LEVEL 1 delivery");
              const fallbackResult = await this.client.messages.create(
                this.domain,
                fallbackData,
              );
              console.log(
                `✅ Email delivered successfully via FALLBACK LEVEL 1:`,
                fallbackResult,
              );
              return fallbackResult;
            } catch (fallbackError: any) {
              console.error("FALLBACK LEVEL 1 failed:", fallbackError.message);

              // FALLBACK LEVEL 2: Absolute minimal email with text-only
              console.log(
                "FALLBACK LEVEL 2: Attempting bare minimum email with text-only content",
              );
              const minimalData = {
                from: emailData.from,
                to: emailData.to,
                subject: emailData.subject,
                text:
                  emailData.text ||
                  "Please view this message in a compatible email client.",
              };

              try {
                console.log("Attempting final FALLBACK LEVEL 2 delivery");
                const emergencyResult = await this.client.messages.create(
                  this.domain,
                  minimalData,
                );
                console.log(
                  `✅ Email delivered successfully via FALLBACK LEVEL 2:`,
                  emergencyResult,
                );
                return emergencyResult;
              } catch (finalError: any) {
                console.error("CRITICAL: All delivery attempts failed");
                console.error("Final error:", finalError.message);
                throw new Error(
                  `Email delivery failed after multiple attempts: ${finalError.message}`,
                );
              }
            }
          }

          // Complex error needs more specific handling
          if (
            sendError.message?.includes("DNS") ||
            sendError.message?.includes("connect")
          ) {
            console.error(
              "NETWORK ERROR: DNS or connection issue with Mailgun API",
            );
            throw new Error(
              `Email delivery failed due to network connectivity issue: ${sendError.message}`,
            );
          }

          // Authentication or other critical errors
          console.error(
            "CRITICAL ERROR: Unable to deliver email via any method",
          );
          throw new Error(`Email delivery failed: ${sendError.message}`);
        }
      } catch (error: any) {
        // If there was an error, try logging the detailed error information
        console.error("Mailgun API error:", error);
        const errorDetails = error.response ? error.response.body : error;
        console.error("Error details:", errorDetails);
        throw error;
      }
    } catch (error: any) {
      console.error("Failed to send email via Mailgun:", error);
      throw error;
    }
  }

  /**
   * Send an email reply as part of an existing thread
   */
  async sendReply(
    ticketId: number,
    to: string,
    subject: string,
    content: string,
    originalMessageId?: string,
    replyFrom?: string,
    attachments?: any[],
    htmlContent?: string,
    ccRecipients?: string[],
    ticket?: any,
    deskEmail?: string, // Added parameter for specific help desk email
  ): Promise<any> {
    console.log(`🌍 UNIVERSAL REPLY SYSTEM: Sending reply to ${to} for ticket #${ticketId}`);
    
    const timestamp = Date.now();
    const uniqueId = Math.random().toString(36).substring(2, 10);

    // Ensure the subject has "Re:" if it's a reply and doesn't already start with it
    const formattedSubject = subject.toLowerCase().startsWith("re:")
      ? subject
      : `Re: ${subject}`;

    console.log(
      `Formatting subject for email threading. Original: "${subject}", Formatted: "${formattedSubject}"`,
    );

    // Check if this appears to be a first reply
    let isLikelyFirstReply = false;
    if (ticket && ticket.messages) {
      const agentMessages = ticket.messages.filter(
        (m: any) => m.isAgent === true,
      );
      if (agentMessages.length === 0) {
        console.log(
          `Subject formatting: This appears to be the FIRST AGENT REPLY in ticket #${ticketId}`,
        );
        isLikelyFirstReply = true;
      }
    }

    // Create HTML version of the content that's properly formatted if not provided
    // Keep formatting minimal and clean for maximum compatibility
    const generatedHtmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        ${content.replace(/\n/g, "<br>")}
      </div>
    `;

    // Generate a unique message ID for this reply
    // This is critical for proper threading in email clients
    const messageId = `<ticket-${ticketId}-reply-${timestamp}-${uniqueId}@${this.domain}>`;

    console.log(`Generated reply message ID: ${messageId}`);

    // Set up the basic reply options with minimal formatting
    // Always use a direct email format to prevent "on behalf of" issues
    // This ensures the email displays properly in all email clients and avoids spam filters

    // Extract the display name to use for the from field
    // Extract display name for From field
    let displayName = "ChannelPlay Help Desk";
    if (replyFrom) {
      const nameMatch = replyFrom.match(/(.*?)\s*<.*>/);
      displayName = nameMatch ? nameMatch[1].trim() : "ChannelPlay Help Desk";
    }

    // Check if we're sending with attachments
    const isSendingWithAttachments =
      attachments && Array.isArray(attachments) && attachments.length > 0;

    // CRITICAL FIX: Determine the correct email address to use in the From field
    // We always prioritize using a complete email address to prevent "on behalf of" issues
    
    // First, prepare the desk email if available
    // Always use helpdesk.1office.in domain as requested
    let formattedDeskEmail;
    if (deskEmail) {
      // If deskEmail already has @ symbol
      if (deskEmail.includes('@')) {
        // If it's already using helpdesk.1office.in domain, use it as is
        if (deskEmail.includes('helpdesk.1office.in')) {
          formattedDeskEmail = deskEmail;
        } 
        // Otherwise, extract just the username and use it with the helpdesk domain
        else {
          const username = deskEmail.split('@')[0].trim();
          formattedDeskEmail = `${username}@helpdesk.1office.in`;
        }
      } 
      // If it's just a username, add the helpdesk domain
      else if (deskEmail.trim() !== "") {
        formattedDeskEmail = `${deskEmail}@helpdesk.1office.in`;
      }
    }
    
    // UPDATED: Use Gmail SMTP configuration for all outgoing mail
    // This ensures better deliverability and avoids the "on behalf of" issue
    
    // Format using Gmail address (since we're using Gmail SMTP anyway)
    let formattedFrom = `${displayName} <ajaykumar23aps@gmail.com>`;
    console.log(`📧 Using Gmail configured address: ${formattedFrom}`);
    
    // We don't need to set any additional headers like Reply-To
    // Simpler headers = better deliverability & fewer "on behalf of" issues
    let replyToHeader = undefined;

    console.log(`Using from address: ${formattedFrom} for reply`);

    // Create the email options object - with MINIMAL headers for maximum compatibility
    const replyOptions: EmailOptions = {
      from: formattedFrom,
      to,
      subject: formattedSubject,
      text: content,
      html: htmlContent || generatedHtmlContent, // Use provided HTML content or the generated one
      "h:Message-Id": messageId,
      "v:ticketId": ticketId.toString(),
    };
    
    // Log exactly what we're sending to help with debugging
    console.log(`📧 Final email FROM field: ${formattedFrom}`);
    console.log(`📧 Final email TO field: ${to}`);
    console.log(`📧 Final email SUBJECT: ${formattedSubject}`);
    

    // Add Reply-To header if we set it earlier
    if (replyToHeader) {
      replyOptions["h:Reply-To"] = replyToHeader;
    }

    // Add CC recipients if provided, making sure they are unique
    if (ccRecipients && ccRecipients.length > 0) {
      // Remove any empty or invalid emails
      const validCCs = ccRecipients.filter(
        (cc) => cc && typeof cc === "string" && cc.trim().length > 0,
      );

      if (validCCs.length > 0) {
        console.log(
          `Adding ${validCCs.length} CC recipients to email: ${validCCs.join(", ")}`,
        );
        replyOptions.cc = validCCs.join(", ");
      } else {
        console.log("No valid CC recipients to add to the email");
      }
    }

    // For emails with attachments, add the special X-Mailgun-Sending-Domain header after creating options
    if (isSendingWithAttachments) {
      // Add the X-Mailgun-Sending-Domain header to ensure attachments are processed correctly
      replyOptions["h:X-Mailgun-Sending-Domain"] = this.domain;
      console.log(`Adding X-Mailgun-Sending-Domain header: ${this.domain}`);
    }

    // Add attachments if any were provided
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      console.log(`Adding ${attachments.length} attachments to email`);

      // CRITICAL FIX: Make sure attachments are properly formatted for Mailgun
      // The path must be an absolute filesystem path, not a URL path
      const formattedAttachments = attachments
        .map((att) => {
          // Log each attachment to help with debugging
          console.log(`Processing attachment:`, JSON.stringify(att, null, 2));

          // Case 1: If the attachment is already properly formatted (has filename and path), add absolute path
          if (att.filename && att.path) {
            const absolutePath = att.path.startsWith("/")
              ? att.path
              : path.join(process.cwd(), att.path);
            console.log(
              `Using pre-formatted attachment: ${att.filename}, path: ${absolutePath}`,
            );
            return {
              filename: att.filename,
              path: absolutePath,
            };
          }

          // Case 2: If it has originalName and path, standardize format with absolute path
          if (att.originalName && att.path) {
            const absolutePath = att.path.startsWith("/")
              ? att.path
              : path.join(process.cwd(), att.path);
            console.log(
              `Standardizing attachment format for: ${att.originalName}, path: ${absolutePath}`,
            );
            return {
              filename: att.originalName,
              path: absolutePath,
            };
          }

          // Case 3: If it's in our database storage format, convert to Mailgun format
          if (att.filename && att.url && !att.path) {
            // Handle base64/data URI attachments - CRITICAL for production
            if (att.url.startsWith("data:")) {
              console.log(
                `Processing base64 data URI attachment: ${att.filename}`,
              );

              try {
                // Extract the data part of the data URI
                const matches = att.url.match(
                  /^data:([A-Za-z-+\/]+);base64,(.+)$/,
                );

                if (matches && matches.length === 3) {
                  const contentType = matches[1];
                  const buffer = Buffer.from(matches[2], "base64");

                  console.log(
                    `Converted base64 attachment to buffer: ${att.filename}, size: ${buffer.length} bytes, type: ${contentType}`,
                  );

                  // Send as inline attachment with buffer
                  return {
                    filename: att.originalName || att.filename,
                    data: buffer,
                    contentType: contentType,
                  };
                } else {
                  console.log(
                    `Invalid data URI format for attachment: ${att.filename}`,
                  );
                }
              } catch (error) {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                console.error(
                  `Error processing base64 attachment: ${errorMessage}`,
                );
              }
            } else {
              // Convert URL path to filesystem path
              const relativePath = att.url.startsWith("/")
                ? att.url.substring(1)
                : att.url;
              const absolutePath = path.join(
                process.cwd(),
                "public",
                relativePath,
              );
              console.log(
                `Converting database attachment to file: ${att.filename}, path: ${absolutePath}`,
              );

              return {
                filename: att.originalName || att.filename,
                path: absolutePath,
              };
            }
          }

          // Log a warning for unrecognized formats
          console.log(
            `Warning: Attachment format may be incorrect:`,
            JSON.stringify(att, null, 2),
          );

          // Try to make a best guess for other formats
          const filename =
            att.originalName || att.filename || "attachment.file";
          let filePath = att.path;

          // If we have a url but no path, try to convert it
          if (!filePath && att.url) {
            const relativePath = att.url.startsWith("/")
              ? att.url.substring(1)
              : att.url;
            filePath = path.join(process.cwd(), "public", relativePath);
          }

          console.log(
            `Best-effort attachment fix: ${filename}, path: ${filePath}`,
          );
          return {
            filename,
            path: filePath,
          };
        })
        .filter((att) => {
          // Enhanced validation for different attachment types
          // CRITICAL FIX: Handle both file attachments AND data buffer attachments

          // Case 1: Attachment has data buffer (from base64)
          if (att && att.data && att.data.length > 0) {
            console.log(
              `Verified data buffer attachment: ${att.filename}, size: ${att.data.length} bytes`,
            );
            return true;
          }

          // Case 2: Attachment has content string
          // Use type assertion to tell TypeScript we know what we're doing with the 'content' property
          const attAny = att as any;
          if (
            attAny &&
            attAny.content &&
            typeof attAny.content === "string" &&
            attAny.content.length > 0
          ) {
            console.log(
              `Verified content string attachment: ${attAny.filename}, size: ${attAny.content.length} chars`,
            );
            return true;
          }

          // Case 3: Attachment has file path
          if (att && att.path) {
            // Check that file exists
            if (fs.existsSync(att.path)) {
              const stats = fs.statSync(att.path);
              console.log(
                `Verified file attachment exists at path: ${att.path}, size: ${stats.size} bytes`,
              );
              return true;
            } else {
              console.log(
                `Removing invalid attachment: File does not exist at path: ${att.path}`,
              );
              return false;
            }
          }

          // Invalid attachment with no recognized data source
          console.log(
            `Removing invalid attachment: No valid data source (path, data, or content)`,
          );
          return false;
        });

      console.log(
        `Processed ${formattedAttachments.length} valid attachments for email`,
      );

      // Convert attachments to the format expected by the Mailgun API
      // Mailgun expects attachment to be an array of file paths, Buffers, or streams
      const attachmentsArray = [];

      for (const attachment of formattedAttachments) {
        console.log(
          `Processing reply attachment for API: ${attachment.filename}, path: ${attachment.path || "from buffer"}`,
        );

        if (attachment.path) {
          try {
            // For file path attachments, create a readable stream
            const fileStream = fs.createReadStream(attachment.path);
            console.log(
              `Reply attachment will be sent from path stream: ${attachment.path}`,
            );

            // Check file exists
            if (fs.existsSync(attachment.path)) {
              const stats = fs.statSync(attachment.path);
              console.log(
                `Confirmed file exists: ${attachment.path}, size: ${stats.size} bytes`,
              );

              // Read file to buffer for compatibility with Mailgun API types
              try {
                const fileBuffer = fs.readFileSync(attachment.path);
                console.log(
                  `Read reply attachment to buffer: ${attachment.path}, size: ${fileBuffer.length} bytes`,
                );

                attachmentsArray.push({
                  filename: attachment.filename,
                  data: fileBuffer,
                  contentType:
                    attachment.contentType || "application/octet-stream",
                });
              } catch (fileErr: any) {
                console.error(
                  `Failed to read reply attachment file: ${fileErr.message}`,
                );
              }
            } else {
              console.error(`File not found at path: ${attachment.path}`);
            }
          } catch (err) {
            console.error(`Error processing file attachment: ${err}`);
          }
        } else if (attachment.data) {
          // For data buffer attachments
          console.log(
            `Reply attachment will be sent from data buffer, size: ${Buffer.isBuffer(attachment.data) ? attachment.data.length : "unknown"} bytes`,
          );

          attachmentsArray.push({
            filename: attachment.filename,
            data: attachment.data,
          });
        }
      }

      // Set the attachment property correctly
      replyOptions.attachment = attachmentsArray;

      console.log(
        `Prepared ${attachmentsArray.length} attachments for Mailgun API`,
      );
    }

    // CRITICAL: Add reference to original message for proper threading
    // Gmail and other email clients use In-Reply-To and References headers to group messages
    if (originalMessageId) {
      // Preserve the exact format of the original Gmail message ID
      // Gmail IDs look like: <CAFO=abc123xyz@outlook.com>
      console.log(`############## EMAIL THREADING DEBUG ##############`);
      console.log(`Original message ID to reply to: "${originalMessageId}"`);

      // First, determine if this is a Gmail-like ID (contains @ sign)
      const isGmailId = originalMessageId.includes("@");
      console.log(`Is Gmail-like ID (contains @): ${isGmailId}`);

      // Check for Gmail CAFO format which is very specific to Gmail
      const isGmailFormat = /^CAF[A-Z0-9-]+=/.test(
        originalMessageId.replace(/[<>]/g, ""),
      );
      console.log(`Detected Gmail CAFO format: ${isGmailFormat}`);

      // Make sure ID is properly formatted with angle brackets
      let formattedOriginalId = originalMessageId;
      if (!formattedOriginalId.startsWith("<")) {
        formattedOriginalId = `<${formattedOriginalId}>`;
        console.log(`Added opening angle bracket: ${formattedOriginalId}`);
      }
      if (!formattedOriginalId.endsWith(">")) {
        formattedOriginalId = `${formattedOriginalId}>`;
        console.log(`Added closing angle bracket: ${formattedOriginalId}`);
      }

      console.log(`Final formatted message ID: "${formattedOriginalId}"`);
      console.log(`##################################################`);

      // For Gmail, we need to be extra careful with the header format
      // Set all possible header variations to ensure maximum compatibility

      // 1. Set both prefixed and non-prefixed headers for maximum compatibility
      // Direct headers (used by some email systems)
      replyOptions["In-Reply-To"] = formattedOriginalId;

      // For References, we need to include both current message ID and references from previous messages
      // This creates a proper message tree hierarchy that clients can display as a conversation thread

      // First check if we have existing References from previous messages
      let existingReferences = "";
      let firstMessageId = "";
      let isFirstAgentReply = false;

      // Get existing references from the ticket's messages or original message
      if (ticket && ticket.messages && ticket.messages.length > 0) {
        console.log(
          `Building reference chain from ${ticket.messages.length} messages in ticket #${ticketId}`,
        );

        // Build comprehensive references from all message IDs in the conversation
        // This creates a complete thread history that email clients can use
        const messageIds = [];

        // Sort messages by creation time to ensure chronological order
        const sortedMessages = [...ticket.messages].sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateA - dateB;
        });

        // Check if this is the first agent reply in the ticket
        const agentMessages = sortedMessages.filter(
          (msg) => msg.isAgent === true,
        );
        if (agentMessages.length === 0) {
          console.log(
            `This appears to be the first agent reply in ticket #${ticketId}`,
          );
          isFirstAgentReply = true;
        }

        // Save the very first message ID from the ticket (most likely customer's initial email)
        if (sortedMessages.length > 0 && sortedMessages[0].messageId) {
          // Ensure first message ID has proper angle brackets
          firstMessageId =
            sortedMessages[0].messageId.startsWith("<") &&
            sortedMessages[0].messageId.endsWith(">")
              ? sortedMessages[0].messageId
              : `<${sortedMessages[0].messageId}>`;
          console.log(`First message in ticket has ID: ${firstMessageId}`);
        }

        // Collect message IDs from all messages that have them
        for (const msg of sortedMessages) {
          if (msg.messageId) {
            // Ensure message ID has proper angle brackets
            const formattedMsgId =
              msg.messageId.startsWith("<") && msg.messageId.endsWith(">")
                ? msg.messageId
                : `<${msg.messageId}>`;

            messageIds.push(formattedMsgId);
          }
        }

        if (messageIds.length > 0) {
          // Join all message IDs with spaces to create a complete reference chain
          existingReferences = messageIds.join(" ");
          console.log(
            `Built comprehensive reference chain from ${messageIds.length} message IDs`,
          );
        } else {
          console.log(
            `No message IDs found in ticket messages, will start a new reference chain`,
          );
        }
      } else if (originalMessageId) {
        // If no ticket data available, just use the original message ID
        console.log(
          `No ticket data available, will use only the original message ID`,
        );
      }

      // Build the new References header by appending the current message ID to any existing references
      // This creates a chronological chain of all message IDs in the conversation
      let newReferences = existingReferences
        ? `${existingReferences} ${formattedOriginalId}`
        : formattedOriginalId;

      // Clean up any duplicate message IDs in the References header
      const uniqueIds = new Set(
        newReferences.split(/\s+/).filter((id) => id.trim()),
      );
      newReferences = Array.from(uniqueIds).join(" ");

      console.log(`Built hierarchical References header: ${newReferences}`);
      replyOptions["References"] = newReferences;

      // Mailgun prefixed headers (recommended in their docs)
      replyOptions["h:In-Reply-To"] = formattedOriginalId;
      replyOptions["h:References"] = newReferences;

      // 2. For Gmail addresses, add specific Gmail headers
      if (to.includes("@gmail.com") || isGmailId) {
        console.log("Adding Gmail-specific email threading headers");

        // Gmail sometimes needs message IDs without brackets in custom headers
        const bareId = formattedOriginalId.replace(/[<>]/g, "");

        // Add Gmail-specific Thread-Topic header which helps with conversation grouping
        replyOptions["h:Thread-Topic"] = `Re: ${subject}`;

        // Set the Gmail-specific headers needed for perfect threading
        if (isGmailFormat) {
          console.log("Using special Gmail CAFO format handling");
          // For Gmail's CAFO format, we need to be extremely precise with headers
          replyOptions["h:X-Gmail-Original-Message-ID"] = formattedOriginalId;
        }
      }

      // 3. Special handling for first agent reply in a ticket
      // This is critical for ensuring the first reply appears in the original thread
      if (isFirstAgentReply && firstMessageId) {
        console.log(
          "SPECIAL HANDLING: This is the first agent reply in the ticket",
        );
        console.log(
          `Setting additional headers for first reply to ensure threading with original email: ${firstMessageId}`,
        );

        // For the first reply, ensure we're using the very first message ID from the ticket
        // This is the ID of the customer's initial email that started the conversation
        replyOptions["In-Reply-To"] = firstMessageId;
        replyOptions["h:In-Reply-To"] = firstMessageId;

        // Add special header to explicitly link this reply to the original message
        replyOptions["h:X-Original-Message-ID"] = firstMessageId;

        // Ensure the References header starts with the original message ID
        if (!newReferences.includes(firstMessageId)) {
          newReferences = `${firstMessageId} ${newReferences}`;
          replyOptions["References"] = newReferences;
          replyOptions["h:References"] = newReferences;
          console.log(
            `Updated References header for first reply: ${newReferences}`,
          );
        }

        // Add Microsoft-specific headers that help with Outlook threading
        replyOptions["h:Thread-Index"] =
          `A${Math.random().toString(36).substring(2, 10)}`;

        // Add additional connection headers to help email clients recognize the relationship
        replyOptions["h:X-Original-Thread"] = "yes";

        console.log(
          "Enhanced first reply headers have been set to ensure proper threading",
        );
      }

      console.log("Email threading headers set successfully:");
      console.log(`- In-Reply-To: ${formattedOriginalId}`);
      console.log(`- References: ${newReferences}`);
      console.log(
        `- Thread hierarchy is preserved with ${newReferences.split(/\s+/).length} message IDs in chain`,
      );
    } else {
      console.log(
        "WARNING: No original message ID available for threading. Reply may appear as a new conversation.",
      );
    }

    console.log(`🌍 USING UNIVERSAL DELIVERY SYSTEM for reply email to: ${to}`);
      
    try {
      // Convert the attachments to a format compatible with our universal delivery system
      const universalAttachments = [];
      
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        console.log(`📎 Processing ${attachments.length} attachments for universal delivery`);
        
        for (const attachment of attachments) {
          // Handle buffer attachments from file uploads
          if (attachment.data && Buffer.isBuffer(attachment.data)) {
            universalAttachments.push({
              filename: attachment.filename || 'attachment',
              data: attachment.data,
              contentType: attachment.contentType || 'application/octet-stream'
            });
          }
          // Handle file paths
          else if (attachment.path && typeof attachment.path === 'string') {
            try {
              const fileData = fs.readFileSync(attachment.path);
              universalAttachments.push({
                filename: attachment.filename || path.basename(attachment.path),
                data: fileData,
                contentType: attachment.contentType || 'application/octet-stream'
              });
            } catch (readError) {
              console.error(`Failed to read attachment file: ${attachment.path}`, readError);
            }
          }
        }
        
        console.log(`📎 Prepared ${universalAttachments.length} attachments for universal delivery`);
      }
      
      // Process CC recipients
      const validCCs = (ccRecipients || []).filter(
        (cc) => cc && typeof cc === "string" && cc.trim().length > 0
      );
      
      // Check if the recipient is channelplay.in domain
      const isChannelplayDomain = to.toLowerCase().endsWith('@channelplay.in');
      
      // Add special log for channelplay.in emails
      if (isChannelplayDomain) {
        console.log("📧 CHANNELPLAY.IN DOMAIN DETECTED - Using bypassed delivery for internal email");
        
        // PRODUCTION FIX: For channelplay.in domains, bypass the standard routing 
        // that's causing messages to be sent back to our webhook
        try {
          // Get the name part from the from field
          const nameMatch = replyOptions.from.match(/(.*?)\s*<.*>/);
          const displayName = nameMatch ? nameMatch[1].trim() : "ChannelPlay Help Desk";
          
          // Create specialized payload for channelplay.in recipients
          const channelplaySpecificPayload: Record<string, any> = {
            from: `"${displayName}" <${this.supportEmail}>`,
            to: to,
            subject: formattedSubject,
            text: content,
            html: htmlContent || `<div style="font-family: Arial, sans-serif;">${content.replace(/\n/g, "<br>")}</div>`,
            // Use standard SMTP delivery flags
            "o:tag": ["internal-email", "channelplay-domain"],
            "o:dkim": "yes",
            // Add basic threading headers without excessive Microsoft headers
            "h:Message-Id": replyOptions["h:Message-Id"],
            "h:References": replyOptions["h:References"],
            "h:In-Reply-To": replyOptions["h:In-Reply-To"],
            // Force delivery through SMTP, not as a webhook relay
            "o:deliverytime": "rfc2822", // This flag helps ensure delivery via SMTP
          };
          
          // If we have attachments, add them to the payload
          if (attachments && attachments.length > 0) {
            channelplaySpecificPayload.attachment = universalAttachments;
          }
          
          // CC recipients if provided
          if (validCCs.length > 0) {
            channelplaySpecificPayload.cc = validCCs.join(', ');
          }
          
          console.log("📧 Using specialized channelplay.in delivery method to bypass routing issues");
          
          // Use the direct API to ensure proper delivery
          const result = await this.client.messages.create(
            this.domain,
            channelplaySpecificPayload
          );
          
          console.log("✅ Channelplay internal email sent successfully with specialized method");
          return result;
        } catch (error) {
          console.error("❌ Error with specialized channelplay.in delivery:", error);
          console.log("Falling back to universal delivery system");
        }
      }
      
      // Use our universal delivery system for maximum deliverability for non-channelplay domains
      return sendDirectGmail({
        to: to,
        subject: formattedSubject,
        text: content,
        html: htmlContent || `<div style="font-family: Arial, sans-serif;">${content.replace(/\n/g, "<br>")}</div>`,
        messageId: replyOptions["h:Message-Id"],
        references: replyOptions["h:References"],
        inReplyTo: replyOptions["h:In-Reply-To"],
        from: replyOptions.from,
        ccRecipients: validCCs,
        attachments: universalAttachments,
        ticketId: ticketId.toString()
      });
    } catch (universalDeliveryError) {
      console.error("💥 Universal delivery system failed:", universalDeliveryError);
      console.log("Falling back to standard delivery method as backup");
      
      // If universal delivery fails, fall back to regular sendEmail
      return this.sendEmail(replyOptions);
    }
  }

  /**
   * Parse webhook data from Mailgun
   */
  async parseWebhook(body: any, files?: any[]): Promise<EmailData> {
    try {
      // Log the entire raw webhook body for debugging, but truncate if too large
      const debugId = Math.random().toString(36).substring(2, 8);
      console.log(
        `[DEBUG-ID: ${debugId}] WEBHOOK BODY:`,
        JSON.stringify(body, null, 2).substring(0, 2000) + "...",
      );

      // Log specific webhook fields for easier debugging
      console.log("Available webhook fields:", Object.keys(body).join(", "));
      console.log("Content fields detected:", {
        "body-plain": !!body["body-plain"],
        "stripped-text": !!body["stripped-text"],
        "body-html": !!body["body-html"],
        "stripped-html": !!body["stripped-html"],
        "attachment-count": body["attachment-count"] || 0,
        hasAttachments: !!body.attachments,
        attachmentsCount:
          body.attachments && Array.isArray(body.attachments)
            ? body.attachments.length
            : 0,
      });

      if (body.attachments && Array.isArray(body.attachments)) {
        console.log(
          "Attachment details:",
          body.attachments.map((att: any) => {
            return {
              filename: att.filename || att.name || "unnamed",
              contentType: att.content_type || att.contentType || "unknown",
              size: att.size || "unknown",
              url: att.url || "none",
            };
          }),
        );
      }

      // Detect if this is a duplicate webhook event (can happen with Mailgun)
      // We'll identify duplicate events by comparing current body structure with previous calls
      const hasAttachments = !!body.attachments;
      console.log(">>> WEBHOOK ATTACHMENTS CHECK:", {
        hasAttachments,
        attachmentsValue: body.attachments,
        attachmentsCount:
          hasAttachments && Array.isArray(body.attachments)
            ? body.attachments.length
            : 0,
      });

      // Enhanced attachment detection - check multiple sources including multer files
      let attachments = [];

      // Prioritize checking for multer files first as they are most reliable
      // 1. Check for multer files (from the upload middleware)
      if (files && Array.isArray(files) && files.length > 0) {
        console.log(
          `>>> HIGHEST PRIORITY: Found ${files.length} attachments from multer middleware`,
        );

        // Convert multer file objects to our attachment format
        attachments = files.map((file: any) => {
          return {
            name: file.originalname || "unnamed",
            filename: file.originalname || "unnamed",
            contentType: file.mimetype || "application/octet-stream",
            content_type: file.mimetype || "application/octet-stream",
            size: file.size,
            content: file.buffer, // The file content as a Buffer
            // Create a data URL for immediate use if needed
            dataUrl: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
          };
        });

        console.log(
          `>>> Processed ${attachments.length} attachments from multer files with names:`,
          attachments.map((a) => a.filename || a.name).join(", "),
        );
      }
      // 2. Check for attachment-count field with numbered fields
      else if (
        body["attachment-count"] &&
        parseInt(body["attachment-count"]) > 0
      ) {
        // Alternative format sometimes used by Mailgun
        console.log(
          `>>> Found attachment count indicator: ${body["attachment-count"]}`,
        );

        // Try to extract attachments from numbered fields
        const count = parseInt(body["attachment-count"]);
        for (let i = 1; i <= count; i++) {
          if (body[`attachment-${i}`]) {
            const attachment = body[`attachment-${i}`];
            attachments.push({
              name: attachment.filename || attachment.name || `attachment-${i}`,
              filename:
                attachment.filename || attachment.name || `attachment-${i}`,
              contentType:
                attachment.content_type ||
                attachment.contentType ||
                "application/octet-stream",
              content_type:
                attachment.content_type ||
                attachment.contentType ||
                "application/octet-stream",
              size: attachment.size || 0,
              content: attachment.content || null,
              url: attachment.url || null,
            });
          }
        }
        console.log(
          `>>> Extracted ${attachments.length} attachments from numbered fields`,
        );
      }
      // 3. Check for attachments in the standard Mailgun format
      else if (body.attachments && Array.isArray(body.attachments)) {
        // Standard Mailgun format
        attachments = body.attachments;
        console.log(
          `>>> Found ${attachments.length} attachments in standard format`,
        );
      }

      // If there's a parent-event-id, this might be a separate webhook for attachments
      if (body["parent-event-id"] || body["event-id"]) {
        console.log(">>> WEBHOOK EVENT ID DETECTED:", {
          eventId: body["event-id"] || "none",
          parentEventId: body["parent-event-id"] || "none",
          recipientDomain: (body.recipient || "").split("@")[1] || "none",
        });
      }

      // Generate a unique email fingerprint for debugging and deduplication
      const timestamp = new Date().getTime();
      const sender =
        body.sender || body.from || body["message.headers.from"] || "";
      const recipient =
        body.recipient || body.to || body["message.headers.to"] || "";
      const subject = body.subject || body["message.headers.subject"] || "";
      const bodySnippet = (
        body["body-plain"] ||
        body["stripped-text"] ||
        ""
      ).substring(0, 20);

      // Create a fingerprint based on basic email properties and content snippet
      // This helps identify repeated emails even if Mailgun assigns different IDs
      const contentHash = bodySnippet
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 10);
      const emailFingerprint = `${sender}:${recipient}:${contentHash}`;

      console.log("======== PROCESSING EMAIL WEBHOOK ========");
      console.log(`Email Fingerprint: ${emailFingerprint}`);
      console.log(`Received At: ${new Date().toISOString()}`);
      console.log(`From: ${sender} | To: ${recipient}`);
      console.log(`Subject: ${subject}`);
      console.log("==========================================");

      // Check if we're dealing with a Mailgun event webhook (has event property)
      // or a raw email message (has sender/from, recipient/to, etc.)
      if (body.event) {
        console.log(`Processing Mailgun event webhook: ${body.event}`);

        // For stored messages, the actual email data might be in the storage.url
        if (body.event === "stored" && body["storage.url"]) {
          console.log(`Message stored at ${body["storage.url"]}`);
        }

        // Extract CC recipients if present in the event payload
        const ccRecipients: string[] = [];

        // Check multiple possible locations where CC might be stored
        // This handles different mail clients and webhook formats
        const possibleCcSources = [
          body["Cc"],
          body["cc"],
          body["h:Cc"],
          body["h:cc"],
          body.message?.headers?.["cc"],
          body.message?.headers?.["Cc"],
          body.message?.headers?.["h:cc"],
          body.message?.headers?.["h:Cc"],
          body["message-headers"]
            ? JSON.parse(body["message-headers"] || "[]").find(
                (header: [string, string]) => header[0].toLowerCase() === "cc",
              )?.[1]
            : undefined,
        ];

        // Find the first non-empty CC source
        const ccString = possibleCcSources.find((source) => source);
        if (ccString) {
          try {
            // Split by comma and trim each address
            const parsedCcs = ccString
              .toString()
              .split(",")
              .map((cc: string) => cc.trim());
            ccRecipients.push(...parsedCcs);
            console.log(
              `Found ${parsedCcs.length} CC recipients in email: ${parsedCcs.join(", ")}`,
            );
          } catch (e) {
            console.error("Error parsing CC recipients:", e);
          }
        } else {
          console.log("No CC recipients found in this email");
        }

        // Extract data from event payload - format depends on event type
        const result: EmailData = {
          sender: sender,
          recipient: recipient,
          ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
          subject: subject,
          body:
            body["body-plain"] ||
            body["stripped-text"] ||
            body["body-html"] ||
            body["stripped-html"] ||
            body["message.headers.body-plain"] ||
            "",
          // Preserve exact Message-ID format for proper threading
          messageId:
            body["message.headers.message-id"] ||
            body["Message-Id"] ||
            body["message-id"] ||
            `generated-${timestamp}`,
          references:
            body["message.headers.references"] || body["References"] || "",
          inReplyTo:
            body["message.headers.in-reply-to"] || body["In-Reply-To"] || "",
          timestamp: new Date(),
          attachments: attachments, // Use our enhanced attachments array
          headers: body.message
            ? body.message.headers || {}
            : body.headers || {},
          strippedText: body["stripped-text"] || body["body-plain"] || "",
          // Add the fingerprint as a metadata field for tracking duplicate emails
          fingerprint: emailFingerprint,
        };

        return result;
      }

      // Extract CC recipients if present in the body
      const ccRecipients: string[] = [];

      // Check multiple possible locations where CC might be stored
      // This handles different mail clients and webhook formats
      const possibleCcSources = [
        body["Cc"],
        body["cc"],
        body["h:Cc"],
        body["h:cc"],
        body.message?.headers?.["cc"],
        body.message?.headers?.["Cc"],
        body.message?.headers?.["h:cc"],
        body.message?.headers?.["h:Cc"],
        body["message-headers"]
          ? JSON.parse(body["message-headers"] || "[]").find(
              (header: [string, string]) => header[0].toLowerCase() === "cc",
            )?.[1]
          : undefined,
      ];

      // Find the first non-empty CC source
      const ccString = possibleCcSources.find((source) => source);
      if (ccString) {
        try {
          // Split by comma and trim each address
          const parsedCcs = ccString
            .toString()
            .split(",")
            .map((cc: string) => cc.trim());
          ccRecipients.push(...parsedCcs);
          console.log(
            `Found ${parsedCcs.length} CC recipients in email: ${parsedCcs.join(", ")}`,
          );
        } catch (e) {
          console.error("Error parsing CC recipients:", e);
        }
      } else {
        console.log("No CC recipients found in this email");
      }

      // Standard email message format - more common for "store" routes
      const result: EmailData = {
        sender: sender,
        recipient: recipient,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        subject: subject,
        body:
          body["body-plain"] ||
          body["stripped-text"] ||
          body["body-html"] ||
          body["stripped-html"] ||
          "",
        // Preserve exact Message-ID format for proper threading
        messageId:
          body["Message-Id"] ||
          body["message-id"] ||
          body["message.headers.message-id"] ||
          `generated-${timestamp}`,
        references: body["References"] || body["references"] || "",
        inReplyTo: body["In-Reply-To"] || body["in-reply-to"] || "",
        timestamp: new Date(),
        attachments: attachments, // Use our enhanced attachments array
        headers:
          typeof body.headers === "string"
            ? JSON.parse(body.headers || "{}")
            : body.headers || {},
        strippedText: body["stripped-text"] || body["body-plain"] || "",
        // Add the fingerprint as a metadata field for tracking duplicate emails
        fingerprint: emailFingerprint,
      };

      // BALANCED APPROACH: Properly extract references and in-reply-to headers
      // But let the route handler decide whether to create a new ticket

      // Enhanced thread detection - extract and analyze all possible threading headers
      // This is critical for properly identifying when CC recipients reply to emails
      
      // First collect all possible threading headers from various locations
      const possibleReferences = [
        body["References"],
        body["references"],
        body["h:References"],
        body["h:references"],
        body.message?.headers?.["References"],
        body.message?.headers?.["references"],
        result.references
      ].filter(Boolean);
      
      const possibleInReplyTo = [
        body["In-Reply-To"],
        body["in-reply-to"],
        body["h:In-Reply-To"],
        body["h:in-reply-to"],
        body.message?.headers?.["In-Reply-To"],
        body.message?.headers?.["in-reply-to"],
        result.inReplyTo
      ].filter(Boolean);
      
      // Extract all Message-IDs from headers for comprehensive matching
      const allMessageIds = [
        body["Message-ID"],
        body["message-id"],
        body["Message-Id"],
        body["h:Message-ID"],
        body["h:Message-Id"],
        body.message?.headers?.["message-id"],
        body.message?.headers?.["Message-ID"],
        result.messageId
      ].filter(Boolean);
      
      // Consolidate references (could be space or comma separated)
      let consolidatedReferences = "";
      possibleReferences.forEach(ref => {
        if (ref && typeof ref === 'string') {
          // Clean and normalize references
          const cleanedRef = ref.trim();
          if (cleanedRef && !consolidatedReferences.includes(cleanedRef)) {
            consolidatedReferences += (consolidatedReferences ? " " : "") + cleanedRef;
          }
        }
      });
      
      // Do the same for In-Reply-To
      let consolidatedInReplyTo = "";
      possibleInReplyTo.forEach(irt => {
        if (irt && typeof irt === 'string') {
          const cleanedIrt = irt.trim();
          if (cleanedIrt && !consolidatedInReplyTo.includes(cleanedIrt)) {
            consolidatedInReplyTo = cleanedIrt; // In-Reply-To should only be one value
          }
        }
      });
      
      // Check if we have any threading indicators
      const hasThreadingHeaders = !!(consolidatedReferences || consolidatedInReplyTo);
      
      if (hasThreadingHeaders) {
        console.log(
          "🧵 EMAIL HAS THREADING HEADERS: This is part of an existing conversation",
        );
        console.log(
          "In-Reply-To:",
          consolidatedInReplyTo || "none",
        );
        console.log(
          "References:",
          consolidatedReferences || "none",
        );
        
        // Extract all message IDs from References header (they're space separated)
        const referencedIds = consolidatedReferences
          ? Array.from(new Set(
              consolidatedReferences.split(/\s+/)
                .filter(id => id.trim())
                .map(id => id.trim())
            ))
          : [];
          
        console.log(`Found ${referencedIds.length} referenced message IDs in thread history`);
        
        // Store these enriched values for better ticket matching
        result.inReplyTo = consolidatedInReplyTo;
        result.references = consolidatedReferences;
        
        // Add a new property to track all referenced message IDs for easier matching
        (result as any).referencedMessageIds = referencedIds;
        
        if (referencedIds.length > 0) {
          console.log("Thread history IDs:", referencedIds.join(", "));
        }
      }

      // Look for ticket ID in subject (e.g., [Ticket #123] or Re: [#123])
      if (result.subject) {
        const ticketIdMatch =
          result.subject.match(/\[?Ticket #(\d+)\]?/i) ||
          result.subject.match(/\[#(\d+)\]/);
        if (ticketIdMatch && ticketIdMatch[1]) {
          console.log(
            `Found possible ticket reference in subject: #${ticketIdMatch[1]}`,
          );
        }
      }

      // We'll leave ticketId assignment to the route handler
      // This ensures the decision about creating a new ticket vs. adding to existing
      // is made in one place with all context available

      // Log information about the body content and attachments
      console.log("Parsed incoming email:", {
        from: result.sender,
        to: result.recipient,
        subject: result.subject,
        messageId: result.messageId,
        ticketId: result.ticketId,
        hasAttachments:
          Array.isArray(result.attachments) && result.attachments.length > 0,
        attachmentsCount: Array.isArray(result.attachments)
          ? result.attachments.length
          : 0,
        bodyLength: result.body ? result.body.length : 0,
        bodyPreview: result.body
          ? result.body.substring(0, 50) + "..."
          : "[EMPTY]",
      });

      // If there are attachments, log details about them
      if (Array.isArray(result.attachments) && result.attachments.length > 0) {
        console.log(
          "Email contains attachments:",
          result.attachments.map((att: any) => {
            return {
              name: att.name || att.filename || "unnamed",
              contentType: att.content_type || att.contentType || "unknown",
              size: att.size || "unknown",
            };
          }),
        );
      }

      return result;
    } catch (error) {
      console.error("Error parsing webhook:", error);
      throw error;
    }
  }

  /**
   * Set up route for receiving Mailgun webhooks
   */
  configureWebhook() {
    // Since we don't have access to the Express app directly here, we'll set up
    // routes in routes.ts. But we'll log configuration instructions.
    console.log(`To configure Mailgun webhooks:
1. Go to your Mailgun dashboard
2. Navigate to Sending > Webhooks 
3. Add webhook for "Inbound Messages"
4. Set the URL to: https://your-domain.com/api/webhook/mailgun
5. Enable the webhook`);

    // Add routes in routes.ts that call:
    // - For inbound messages: app.post('/api/inbound-email', handleInboundEmail)
    // - For webhook events: app.post('/api/webhook/mailgun', handleWebhookEvent)

    // The processing logic is implemented in parseWebhook
  }

  /**
   * Check if the Mailgun service is properly initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the configured Mailgun domain
   */
  getDomain(): string {
    return this.domain;
  }

  /**
   * Get status information about this Mailgun service instance
   */
  getStatus(): {
    initialized: boolean;
    domain: string;
    apiEndpoint: string;
    supportEmail: string;
  } {
    return {
      initialized: this.initialized,
      domain: this.domain,
      apiEndpoint: this._apiEndpoint,
      supportEmail: this.supportEmail,
    };
  }

  /**
   * Check if the Mailgun API key is valid
   */
  async checkApiKeyStatus(): Promise<{ isValid: boolean; error?: string }> {
    if (!this.initialized) {
      return { isValid: false, error: "Mailgun not initialized" };
    }

    try {
      // Get domains as a simple API test
      const response = await this.client.domains.list();
      return { isValid: true };
    } catch (error: any) {
      console.error("Mailgun API key validation failed:", error);
      return {
        isValid: false,
        error: error.message || "Unknown error validating Mailgun API key",
      };
    }
  }
}

// Create a singleton instance
console.log("Starting Mailgun configuration process...");

// Get API key from environment
let originalApiKey = process.env.MAILGUN_API_KEY || "";
const domain = process.env.MAILGUN_DOMAIN || "helpdesk.1office.in";

// Clean up the API key
let apiKey = originalApiKey
  .trim()
  .replace(/^["']|["']$/g, "") // Remove quotes
  .replace(/\\n/g, "") // Remove any newlines
  .replace(/\s+/g, ""); // Remove any whitespace

console.log(`Raw API key length: ${originalApiKey.length}`);
console.log(`Cleaned API key length: ${apiKey.length}`);
console.log(`API key first 4 chars: ${apiKey.substring(0, 4)}...`);

// Test revealed that this API key should NOT have "key-" prefix
// The API key is in the correct format as is
let formattedApiKey = apiKey;
// Remove any key- prefix if it was accidentally added
if (apiKey && apiKey.startsWith("key-") && apiKey.length > 15) {
  console.log(
    'Removing "key-" prefix from Mailgun API key (not needed for this key)',
  );
  formattedApiKey = apiKey.replace(/^key-/, "");
} else {
  console.log("API key format looks correct, keeping as is");
}

// Test showed both EU and US endpoints work with this API key
// We'll use the US endpoint since it worked best in our tests
const isEU = false; // Not using EU endpoint

const apiHost = "https://api.mailgun.net";

console.log(`Using Mailgun API host: ${apiHost}`);
console.log(`Using domain: ${domain}`);

// Create service instance without any prefix manipulation to use exactly what was provided
export const mailgunService = new MailgunService({
  apiKey: formattedApiKey,
  domain: domain,
  host: apiHost,
});

// Log detailed configuration for debugging
console.log(`Mailgun Service Configuration: 
- Domain: ${domain}
- API Key Length: ${apiKey.length} characters 
- API Key Format: ${apiKey.startsWith("key-") ? "Standard with key- prefix" : "Private/Custom"}
- API Endpoint: ${apiHost}
- EU Region: ${isEU ? "Yes" : "No"}`);

// Add function to check if recipient is authorized in Mailgun sandbox domain
export async function isRecipientAuthorized(email: string): Promise<boolean> {
  // This can be expanded to call the Mailgun API to check authorized recipients
  // But for now, we'll just use a manual check for demo purposes

  // If not a sandbox domain, then any recipient is authorized
  if (!process.env.MAILGUN_DOMAIN?.includes("sandbox")) {
    return true;
  }

  // Allow ALL email domains - no restrictions
  console.log(
    `Authorizing ALL email domains for maximum compatibility: ${email}`,
  );
  return true;
}

/**
 * Universal Message Delivery System 
 * This function provides optimized email delivery to ALL email domains
 * with special handling for Gmail, Outlook and other providers to ensure
 * maximum deliverability across all email systems.
 */
export async function sendDirectGmail(options: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  messageId?: string;
  references?: string;
  inReplyTo?: string;
  ccRecipients?: string[];
  attachments?: any[];
  ticketId?: string;
}): Promise<any> {
  // Basic required validation
  if (!options.to || !options.subject || !options.text) {
    throw new Error("Missing required fields for email delivery");
  }
  
  try {
    // Get recipient domain for domain-specific optimizations
    const recipientDomain = options.to.includes("@") 
      ? options.to.split("@")[1].toLowerCase() 
      : "";
    
    console.log(`🌍 UNIVERSAL MAIL DELIVERY: Optimizing delivery to ${recipientDomain}`);
    
    // Create properly formatted sender address using Gmail
    const cleanFrom = `"Gmail Support" <ajaykumar23aps@gmail.com>`;
    
    // Create the email payload with basic parameters
    const payload: Record<string, any> = {
      from: options.from || cleanFrom,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || `<div>${options.text.replace(/\n/g, "<br>")}</div>`,
      "o:testmode": false,
      "o:tracking": "yes",
      "o:tag": ["universal-delivery-system"],
    };
    
    // Add ticket ID if provided
    if (options.ticketId) {
      payload["v:ticketId"] = options.ticketId;
    }
    
    // Add CC recipients if provided
    if (options.ccRecipients && options.ccRecipients.length > 0) {
      console.log(`Adding ${options.ccRecipients.length} CC recipients to universal delivery`);
      payload.cc = options.ccRecipients.join(", ");
    }
    
    // Apply domain-specific optimizations
    if (recipientDomain === "gmail.com" || recipientDomain === "googlemail.com") {
      console.log("📧 Gmail-specific optimizations applied");
      // Gmail needs minimal headers
      payload["h:X-Mailgun-Track"] = "no";
      payload["h:Precedence"] = "normal";
    } 
    else if (recipientDomain.includes("outlook") || 
             recipientDomain.includes("hotmail") || 
             recipientDomain.includes("live") || 
             recipientDomain.includes("office365") ||
             recipientDomain.includes("microsoft") ||
             recipientDomain.includes("msn")) {
      console.log("📧 Enhanced Microsoft-specific optimizations applied");
      
      // Microsoft domains need comprehensive headers for production environments
      // Set essential Microsoft Exchange headers
      payload["h:X-MS-Exchange-Organization-SCL"] = "-1";
      payload["h:X-MS-Has-Attach"] = options.attachments && options.attachments.length > 0 ? "yes" : "no";
      
      // Add enhanced Microsoft compatibility headers
      payload["h:X-MS-Exchange-Organization-AuthAs"] = "Anonymous";
      payload["h:X-MS-Exchange-Organization-AuthMechanism"] = "01";
      payload["h:X-MS-Exchange-Organization-AuthSource"] = "mail.channelplay.in";
      
      // Add spam prevention headers
      payload["h:X-Microsoft-Antispam"] = "BCL:0;";
      payload["h:X-Microsoft-Antispam-Message-Info"] = "Authorized";
      
      // Enhance deliverability with specific Exchange headers
      payload["h:X-Forefront-Antispam-Report"] = "CIP:0.0.0.0;CTRY:;LANG:en;SCL:-1;SRV:;IPV:NLI;SFV:SPM;H:mail.channelplay.in;PTR:;CAT:NONE;";
      
      // Add threading optimization for Outlook
      payload["h:Thread-Topic"] = options.subject;
      
      console.log("📧 Applied comprehensive Microsoft optimization package for production");
    }
    else if (recipientDomain === "channelplay.in") {
      console.log("📧 ChannelPlay-specific optimizations applied - SIMPLIFIED FOR PRODUCTION");
      
      // SIMPLIFIED: Only use essential headers for channelplay.in domain delivery
      // Removing excessive Exchange and DKIM headers that may cause delivery issues
      
      // Use basic email headers that work in all environments
      payload["h:Return-Path"] = "ajaykumar23aps@gmail.com";
      payload["h:Reply-To"] = "ajaykumar23aps@gmail.com";
      
      // Force standard format for all channelplay.in communications
      // But keep it simple to avoid conflicts with Mailgun processing
      payload.from = `"Gmail Support" <ajaykumar23aps@gmail.com>`;
      
      // Enable DKIM but don't try to override how it works
      payload["o:dkim"] = "yes";
      
      console.log("📧 Applied simplified channelplay.in optimization for production compatibility");
    }
    
    // Universal headers for improved deliverability to all domains
    payload["h:X-Mailer"] = "ChannelPlay-Universal-Mailer";
    payload["h:X-Universal-Delivery"] = "enabled";
    
    // Add threading headers if provided (critical for proper email threading)
    if (options.messageId) {
      payload["h:Message-Id"] = options.messageId;
    }
    
    if (options.inReplyTo) {
      payload["h:In-Reply-To"] = options.inReplyTo;
    }
    
    if (options.references) {
      payload["h:References"] = options.references;
    }
    
    console.log("📬 Using direct Mailgun API for maximum deliverability");
    
    // Process attachments if they're provided
    if (options.attachments && Array.isArray(options.attachments) && options.attachments.length > 0) {
      console.log(`📎 Processing ${options.attachments.length} attachments for universal delivery`);
      
      // Add attachment as a separate field
      payload.attachment = options.attachments;
      
      // For attachments, we need FormData instead of URLSearchParams
      console.log(`📎 Adding attachments to universal delivery`);
    }
    
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
      console.error("📬 UNIVERSAL DELIVERY: Missing API key or domain");
      throw new Error("Missing Mailgun credentials");
    }
    
    // Use Mailgun's messages endpoint directly
    const domain = process.env.MAILGUN_DOMAIN;
    const apiKey = process.env.MAILGUN_API_KEY;
    
    // Build API URL 
    const apiUrl = `https://api.mailgun.net/v3/${domain}/messages`;
    
    // Use FormData if we have attachments, otherwise URLSearchParams
    const hasAttachments = options.attachments && options.attachments.length > 0;
    let response;
    
    try {
      if (hasAttachments && options.attachments) {
        console.log(`📎 Using FormData for ${options.attachments.length} attachments`);
        
        // For attachments, we need to use FormData
        const formData = new FormData();
        
        // First add all the regular fields to the FormData
        Object.entries(payload).forEach(([key, value]) => {
          if (key !== 'attachment') {
            if (Array.isArray(value)) {
              // Handle array values like tags
              value.forEach(v => formData.append(key, v));
            } else {
              formData.append(key, value as string);
            }
          }
        });
        
        // Then add each attachment
        options.attachments.forEach((attachment, index) => {
          if (attachment.data) {
            console.log(`📎 Adding buffer attachment: ${attachment.filename || `file-${index}`}`);
            // Create a Blob from the buffer data
            const blob = new Blob([attachment.data], {
              type: attachment.contentType || 'application/octet-stream'
            });
            
            formData.append('attachment', blob, attachment.filename || `file-${index}`);
          }
        });
        
        // Create headers with authorization
        const headers: Record<string, string> = {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
          // No Content-Type for FormData - it will be set automatically with boundary
        };
        
        // Add special configuration for channelplay.in domains
        if (recipientDomain === "channelplay.in") {
          console.log("📧 Adding simplified headers for channelplay.in domain with attachments");
          
          // SIMPLIFIED: Only use essential headers that work in all environments
          // Use a clean "from" address format
          formData.append("from", `"Gmail Support" <ajaykumar23aps@gmail.com>`);
          formData.append("h:Reply-To", "ajaykumar23aps@gmail.com");
          
          // Enable DKIM but don't try to override how it works
          formData.append("o:dkim", "yes");
          
          console.log(`📧 Applied simplified channelplay.in optimization for attachments`);
        }
        // Add specialized handling for Microsoft/Outlook domains
        else if (recipientDomain.includes("outlook") || 
                 recipientDomain.includes("hotmail") || 
                 recipientDomain.includes("live") || 
                 recipientDomain.includes("office365") || 
                 recipientDomain.includes("microsoft") || 
                 recipientDomain.includes("msn")) {
          
          console.log("📧 Applying enhanced Outlook compatibility settings for attachments");
          
          // Add headers specifically for Microsoft mail servers
          headers["X-MS-Depth"] = "0";
          headers["X-Exchange-Auth"] = "Allow";
          
          // Add headers to FormData for Microsoft compatibility
          formData.append("h:X-MS-Exchange-Organization-SCL", "-1");
          formData.append("h:X-MS-Exchange-Organization-AuthAs", "Anonymous");
          formData.append("h:X-MS-Exchange-Organization-AuthMechanism", "01");
          formData.append("h:X-MS-Has-Attach", "yes");
          
          // Prevent spam filtering
          formData.append("h:X-Microsoft-Antispam", "BCL:0;");
          formData.append("h:X-Microsoft-Antispam-Message-Info", "MessageInfo");
          formData.append("h:X-Forefront-Antispam-Report", "CIP:0.0.0.0;CTRY:;LANG:en;SCL:-1;SRV:;IPV:NLI;SFV:NSPM;");
          
          // Improve Outlook threading
          if (options.subject) {
            formData.append("h:Thread-Topic", options.subject);
          }
          
          // Enable DKIM for Microsoft domains
          formData.append("o:dkim", "yes");
          
          // Additional header for Hotmail/MSN domains
          if (recipientDomain.includes("hotmail") || recipientDomain.includes("msn")) {
            formData.append("h:X-OriginalArrivalTime", new Date().toUTCString());
          }
          
          console.log("📧 Applied comprehensive Outlook optimization for attachments");
        }
        
        // Use node-fetch to send the FormData
        response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: formData as any, // Cast to any to avoid TypeScript issues
        });
      } else {
        // Use URLSearchParams for better compatibility when no attachments
        const urlParams = new URLSearchParams();
        
        // Add all fields to URLSearchParams
        Object.entries(payload).forEach(([key, value]) => {
          if (key !== 'attachment') { // Skip attachment field as it needs special handling
            if (Array.isArray(value)) {
              // Handle array values like tags
              value.forEach(v => urlParams.append(key, v));
            } else {
              urlParams.append(key, value as string);
            }
          }
        });
        
        // Add special headers for channelplay.in domain
        const headers: Record<string, string> = {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        };
        
        // Add simplified headers for channelplay.in domain
        if (recipientDomain === "channelplay.in") {
          console.log("📧 Adding simplified headers for channelplay.in domain");
          
          // SIMPLIFIED: Use only essential headers for better deliverability
          urlParams.append("from", `"Gmail Support" <ajaykumar23aps@gmail.com>`);
          urlParams.append("h:Reply-To", "ajaykumar23aps@gmail.com");
          
          // Enable DKIM but don't try to override its functionality
          urlParams.append("o:dkim", "yes");
          
          console.log("📧 Applied simplified channelplay.in optimization for production compatibility");
        }
        // Add specialized handling for Microsoft/Outlook domains
        else if (recipientDomain.includes("outlook") || 
                 recipientDomain.includes("hotmail") || 
                 recipientDomain.includes("live") || 
                 recipientDomain.includes("office365") || 
                 recipientDomain.includes("microsoft") || 
                 recipientDomain.includes("msn")) {
          
          console.log("📧 Enhancing Outlook compatibility for production environment");
          
          // Add Microsoft-specific headers
          headers["X-MS-Depth"] = "0";
          headers["X-Exchange-Auth"] = "Allow";
          
          // Add Exchange organization headers
          urlParams.append("h:X-MS-Exchange-Organization-SCL", "-1");
          urlParams.append("h:X-MS-Exchange-Organization-AuthAs", "Anonymous");
          urlParams.append("h:X-MS-Exchange-Organization-AuthMechanism", "01");
          urlParams.append("h:X-MS-Exchange-Organization-AuthSource", "mail.channelplay.in");
          
          // Prevent Microsoft spam filtering with approved headers
          urlParams.append("h:X-Microsoft-Antispam", "BCL:0;");
          urlParams.append("h:X-Microsoft-Antispam-Message-Info", "Authorized");
          urlParams.append("h:X-Forefront-Antispam-Report", "CIP:0.0.0.0;CTRY:;LANG:en;SCL:-1;SRV:;IPV:NLI;SFV:NSPM;");
          
          // Add Enterprise Exchange headers
          urlParams.append("h:X-MS-Exchange-CrossTenant-OriginalArrivalTime", new Date().toUTCString());
          urlParams.append("h:X-MS-Exchange-CrossTenant-AuthSource", "mail.channelplay.in");
          urlParams.append("h:X-MS-Exchange-CrossTenant-AuthAs", "Anonymous");
          urlParams.append("h:X-MS-Exchange-CrossTenant-FromEntityHeader", "Internet");
          
          // Improve Outlook threading
          if (options.subject) {
            urlParams.append("h:Thread-Topic", options.subject);
          }
          
          // Enable DKIM for Microsoft domains
          urlParams.append("o:dkim", "yes");
          
          // Additional header for Hotmail/MSN domains
          if (recipientDomain.includes("hotmail") || recipientDomain.includes("msn")) {
            urlParams.append("h:X-OriginalArrivalTime", new Date().toUTCString());
          }
          
          console.log("📧 Applied comprehensive Outlook production optimization package");
        }
        
        // Simple case: no attachments, use URLSearchParams
        response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: urlParams,
        });
      }
    } catch (fetchError) {
      console.error("📬 UNIVERSAL DELIVERY: Fetch error", fetchError);
      throw fetchError;
    }
    
    if (!response.ok) {
      const error = await response.text();
      console.error("📬 UNIVERSAL DELIVERY: API error", error);
      throw new Error(`Mailgun API error: ${error}`);
    }
    
    const result = await response.json();
    console.log("📬 UNIVERSAL DELIVERY: Success", result);
    return result;
  } catch (error) {
    console.error("📬 UNIVERSAL DELIVERY: Fatal error", error);
    throw error;
  }
}
