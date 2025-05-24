import nodemailer from 'nodemailer';
import { Request, Response } from 'express';
import { z } from 'zod';

const testEmailSchema = z.object({
  recipient: z.string().email(),
  subject: z.string(),
  content: z.string()
});

// Gmail configuration with the provided details
const gmailConfig = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'ajaykumar23aps@gmail.com',
    pass: 'ncvoytdhdvayexnd'
  }
};

export async function handleTestEmail(req: Request, res: Response) {
  try {
    // Validate request body
    const validationResult = testEmailSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid request data', 
        errors: validationResult.error.errors 
      });
    }

    const { recipient, subject, content } = validationResult.data;

    // Create transporter with Gmail configuration
    const transporter = nodemailer.createTransport(gmailConfig);

    // Send mail
    const info = await transporter.sendMail({
      from: {
        name: 'Gmail Support',
        address: 'ajaykumar23aps@gmail.com'
      },
      to: recipient,
      subject: subject,
      text: content,
      html: content.replace(/\n/g, '<br/>')
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Email sent successfully',
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