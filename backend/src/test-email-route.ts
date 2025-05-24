import nodemailer from 'nodemailer';
import { Request, Response } from 'express';

// Create a reusable Gmail transporter object with TLS
const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ajaykumar23aps@gmail.com',
    pass: 'ncvoytdhdvayexnd'
  },
  debug: true, // Enable debug output
  logger: true  // Log information to the console
});

export async function handleTestEmail(req: Request, res: Response) {
  try {
    const { recipient, subject, content } = req.body;
    
    if (!recipient || !subject || !content) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: recipient, subject, or content'
      });
    }
    
    // Send email using Gmail SMTP
    const info = await gmailTransporter.sendMail({
      from: {
        name: 'Gmail Support',
        address: 'ajaykumar23aps@gmail.com'
      },
      to: recipient,
      subject,
      text: content,
      html: content.replace(/\n/g, '<br/>')
    });
    
    return res.status(200).json({
      success: true,
      message: 'Test email sent successfully',
      messageId: info.messageId
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'An error occurred while sending the email'
    });
  }
}