/**
 * Mailgun Stub Service
 * 
 * This is a stub implementation that replaces the Mailgun service
 * while removing actual Mailgun functionality. This allows existing code
 * to compile while we transition to direct SMTP/IMAP.
 */

// Create a stub service that implements the same interface as the original
export const mailgunService = {
  isInitialized: () => false,
  getDomain: () => 'stub-domain',
  supportEmail: 'no-reply@example.com',
  apiEndpoint: 'https://example.com',
  checkApiKeyStatus: async () => ({ isValid: false, error: 'Mailgun is disabled' }),
  configureWebhook: () => console.log('Mailgun webhooks disabled'),
  sendEmail: async () => ({ success: false, error: 'Mailgun is disabled' }),
  getStatus: () => ({
    initialized: false,
    domain: 'stub-domain',
    apiEndpoint: 'https://example.com',
    supportEmail: 'no-reply@example.com'
  })
};

// Create a stub for the authorization check
export function isRecipientAuthorized(email: string): Promise<boolean> {
  console.log(`[STUB] Email authorization check for ${email} - always returning true`);
  return Promise.resolve(true);
}

// Stub for direct Gmail sending
export async function sendDirectGmail() {
  console.log(`[STUB] Direct Gmail send requested - not implemented`);
  return { success: false, error: 'Direct Gmail send is no longer available through this stub' };
}