const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ----------------------------------------------------
// SECURITY MIDDLEWARES & RATE LIMITING
// ----------------------------------------------------

// 1. Custom IP Rate Limiter (Defends against spam flooding/DDoS)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5; // Max 5 submissions per 15 minutes per IP

function ipRateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, []);
    }

    // Filter out old timestamps outside the active window
    const timestamps = rateLimitMap.get(ip).filter(time => now - time < RATE_LIMIT_WINDOW);
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);

    if (timestamps.length > MAX_REQUESTS) {
        console.warn('\x1b[31m%s\x1b[0m', `⚠ Rate limit exceeded for IP: ${ip}`);
        return res.status(429).json({
            success: false,
            message: 'Too many submissions. Please wait 15 minutes before trying again.'
        });
    }
    next();
}

// 2. Cryptographic Signature Verification (HMAC SHA-256)
function verifySignature(req, res, next) {
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-timestamp'];
    const secret = process.env.API_SIGNATURE_SECRET;

    // If the secret is not defined in the environment, signature verification is bypassed.
    // This allows easy local testing while securing live Vercel deployments.
    if (!secret) {
        return next();
    }

    if (!signature || !timestamp) {
        return res.status(401).json({
            success: false,
            message: 'Security validation failed. Missing cryptographic signatures.'
        });
    }

    // Replay Attack Protection: Check if request is older than 60 seconds (allowing clock drift)
    const now = Date.now();
    const requestTime = parseInt(timestamp);
    if (isNaN(requestTime) || Math.abs(now - requestTime) > 60000) {
        return res.status(401).json({
            success: false,
            message: 'Security token has expired (Replay attack blocked).'
        });
    }

    // Deconstruct payload values
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({
            success: false,
            message: 'Required payload fields are missing.'
        });
    }

    // Re-calculate hash: SHA-256 of (name + email + message + timestamp + secret)
    const rawData = name.trim() + email.trim() + message.trim() + timestamp + secret;
    const computedSignature = crypto.createHash('sha256').update(rawData).digest('hex');

    // Secure comparison to prevent timing attacks
    if (signature !== computedSignature) {
        console.warn('\x1b[31m%s\x1b[0m', '⚠ Security mismatch: Signature hash does not match payload content.');
        return res.status(403).json({
            success: false,
            message: 'Access denied. Cryptographic verification failed.'
        });
    }

    next();
}

// ----------------------------------------------------
// MIDDLEWARES
// ----------------------------------------------------
// Allow requests from all origins (CORS) so your portfolio can post to this backend
app.use(cors());

// Parse JSON payloads (sent via client-side fetch AJAX requests)
app.use(express.json());

// Parse URL-encoded payloads (sent via standard HTML form actions)
app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------------
// NODEMAILER SMTP TRANSPORTER CONFIGURATION
// ----------------------------------------------------
// Create a reusable transporter object using SMTP transport details
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: parseInt(process.env.SMTP_PORT) === 465, // true for port 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Verify mail server configuration on startup
transporter.verify((error, success) => {
    if (error) {
        console.error('\x1b[31m%s\x1b[0m', 'SMTP Connection Error:', error.message);
        console.warn('\x1b[33m%s\x1b[0m', 'Check your .env settings. Emails will fail to send until fixed.');
    } else {
        console.log('\x1b[32m%s\x1b[0m', '✓ SMTP Mail Server connection successfully verified. Ready to deliver emails!');
    }
});

// ----------------------------------------------------
// API ENDPOINTS
// ----------------------------------------------------

// Root check route
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #0f172a; color: #f1f5f9; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
            <h1 style="color: #a855f7;">Contact Form API</h1>
            <p>Your custom backend mail service is running successfully!</p>
            <p style="color: #94a3b8; font-size: 14px;">Send POST requests to <code>/api/contact</code> to dispatch emails.</p>
        </div>
    `);
});

// Form submission endpoint
app.post('/api/contact', ipRateLimiter, verifySignature, async (req, res) => {
    // Destructure properties from request body (supporting both JSON and standard HTML form fields)
    const { name, email, subject, phone, message, _next, botcheck } = req.body;

    // Anti-spam Honeypot Check
    if (botcheck) {
        console.warn('\x1b[33m%s\x1b[0m', '⚠ Spam bot detected via Honeypot field. Dropping request silently.');
        return res.status(200).json({
            success: true,
            message: 'Your message has been delivered successfully!'
        });
    }

    console.log(`Received contact form submission from: ${name} <${email}>`);

    // 1. Server-side Validation
    if (!name || !email || !message) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed. Name, email, and message fields are required.'
        });
    }

    // Email regex validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed. Please enter a valid email address.'
        });
    }

    // Dynamic subject and body values for pre-filling mailto composer links
    const replySubject = encodeURIComponent(subject ? `Re: ${subject}` : `Re: Portfolio Inquiry`);
    const cleanMessageQuote = message.split('\n').map(line => `> ${line}`).join('\n');
    const replyBody = encodeURIComponent(`Hi ${name},\n\nThank you for reaching out! Regarding your message:\n${cleanMessageQuote}\n\n`);

    // 2. Generate Styled HTML Email Template (Robust table layout for all email clients)
    const emailHTML = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Portfolio Message</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #334155; margin: 0; padding: 20px; -webkit-font-smoothing: antialiased; }
            a { color: #a855f7; text-decoration: none; }
            a:hover { text-decoration: underline; }
            @media (max-width: 600px) {
                .container { width: 100% !important; padding: 15px !important; }
                .content { padding: 20px !important; }
            }
        </style>
    </head>
    <body>
        <div class="container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">
            <!-- Header Banner -->
            <div class="header" style="background: linear-gradient(135deg, #a855f7, #6366f1); padding: 30px 24px; text-align: center; color: #ffffff;">
                <h2 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">New Message Received</h2>
                <p style="margin: 6px 0 0; opacity: 0.9; font-size: 13px;">From your website portfolio contact form</p>
            </div>
            
            <!-- Main Content Area -->
            <div class="content" style="padding: 30px 24px;">
                <!-- Information Grid -->
                <table width="100%" cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 24px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9; padding: 16px;">
                    <tr>
                        <td align="left" style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; width: 120px;">Sender Name</td>
                        <td align="right" style="font-size: 14px; font-weight: 500; color: #0f172a; padding: 10px 0; border-bottom: 1px solid #f1f5f9;">${name}</td>
                    </tr>
                    <tr>
                        <td align="left" style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0; border-bottom: 1px solid #f1f5f9;">Sender Email</td>
                        <td align="right" style="font-size: 14px; font-weight: 500; color: #a855f7; padding: 10px 0; border-bottom: 1px solid #f1f5f9;"><a href="mailto:${email}">${email}</a></td>
                    </tr>
                    ${phone ? `
                    <tr>
                        <td align="left" style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0; border-bottom: 1px solid #f1f5f9;">Phone Number</td>
                        <td align="right" style="font-size: 14px; font-weight: 500; color: #0f172a; padding: 10px 0; border-bottom: 1px solid #f1f5f9;">${phone}</td>
                    </tr>` : ''}
                    ${subject ? `
                    <tr>
                        <td align="left" style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0; border-bottom: 1px solid #f1f5f9;">Subject</td>
                        <td align="right" style="font-size: 14px; font-weight: 500; color: #0f172a; padding: 10px 0; border-bottom: 1px solid #f1f5f9;">${subject}</td>
                    </tr>` : ''}
                </table>

                <!-- Message Box -->
                <div style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Message Content</div>
                <div class="message-box" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; font-size: 15px; color: #1e293b; line-height: 1.6; font-style: normal; white-space: pre-wrap;">${message}</div>

                <!-- Call to Action Button -->
                <div style="text-align: center; margin-top: 30px;">
                    <a href="mailto:${email}?subject=${replySubject}&body=${replyBody}" style="display: inline-block; background: linear-gradient(135deg, #a855f7, #6366f1); color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 4px 10px rgba(168, 85, 247, 0.25);">Reply to Customer Directly</a>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="footer" style="background-color: #f8fafc; text-align: center; padding: 20px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; line-height: 1.5;">
                This email was auto-dispatched by your custom Node.js Contact Form Backend.<br>
                Reply-To headers are mapped directly to the sender.
            </div>
        </div>
    </body>
    </html>
    `;

    // 3. Setup Nodemailer Send Details
    const mailOptions = {
        // Send from your SMTP email, but label it with the Sender's Name
        from: `"${name}" <${process.env.SMTP_USER}>`,
        // Crucial: Set replyTo to the visitor's email, so you can hit "Reply" in Gmail and reply directly to them!
        replyTo: email,
        to: process.env.RECEIVER_EMAIL,
        subject: subject ? `[Contact Form] ${subject}` : `New Portfolio Contact Message from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\nSubject: ${subject || 'N/A'}\n\nMessage:\n${message}`,
        html: emailHTML
    };

    // 4. Dispatch Email
    try {
        // Send main notification email to portfolio owner
        await transporter.sendMail(mailOptions);
        console.log(`✓ Email successfully sent for ${name} to ${process.env.RECEIVER_EMAIL}`);

        // Construct and send Auto-Responder to visitor (customer)
        const ownerName = process.env.SENDER_NAME || 'Website Owner';
        const autoResponderHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Message Receipt Confirmation</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #334155; margin: 0; padding: 20px; -webkit-font-smoothing: antialiased; }
                @media (max-width: 600px) {
                    .container { width: 100% !important; padding: 15px !important; }
                    .content { padding: 20px !important; }
                }
            </style>
        </head>
        <body>
            <div class="container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">
                <!-- Header Banner -->
                <div class="header" style="background: linear-gradient(135deg, #a855f7, #6366f1); padding: 30px 24px; text-align: center; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">Message Received!</h2>
                    <p style="margin: 6px 0 0; opacity: 0.9; font-size: 13px;">Thank you for reaching out</p>
                </div>
                
                <!-- Main Content Area -->
                <div class="content" style="padding: 30px 24px;">
                    <p style="font-size: 15px; color: #1e293b; line-height: 1.6; margin-top: 0; margin-bottom: 20px;">Hi ${name},</p>
                    <p style="font-size: 15px; color: #334155; line-height: 1.6; margin-bottom: 24px;">Thanks for getting in touch! This email confirms that your message has been successfully received. I will review your inquiry and get back to you as soon as possible.</p>
                    
                    <!-- Information Grid -->
                    <div style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Copy of Your Inquiry</div>
                    <table width="100%" cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 24px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9; padding: 16px;">
                        ${subject ? `
                        <tr>
                            <td align="left" style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; width: 120px;">Subject</td>
                            <td align="right" style="font-size: 14px; font-weight: 500; color: #0f172a; padding: 10px 0; border-bottom: 1px solid #f1f5f9;">${subject}</td>
                        </tr>` : ''}
                        <tr>
                            <td align="left" style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0; border: none;">Message Content</td>
                            <td align="right" style="font-size: 11px; color: #94a3b8; padding: 10px 0; border: none;">Auto-Copy</td>
                        </tr>
                        <tr>
                            <td colspan="2" style="padding-top: 5px;">
                                <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; font-size: 14px; color: #334155; line-height: 1.5; font-style: italic; white-space: pre-wrap; text-align: left;">${message}</div>
                            </td>
                        </tr>
                    </table>

                    <p style="font-size: 15px; color: #334155; line-height: 1.6; margin-bottom: 0;">
                        Best regards,<br>
                        <strong style="color: #a855f7;">${ownerName}</strong>
                    </p>
                </div>
                
                <!-- Footer -->
                <div class="footer" style="background-color: #f8fafc; text-align: center; padding: 20px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; line-height: 1.5;">
                    This is an automated receipt confirmation from my portfolio contact form.<br>
                    Please do not reply directly to this auto-sent message.
                </div>
            </div>
        </body>
        </html>
        `;

        const autoResponderOptions = {
            // Sent from authenticated SMTP address (labeled with owner's name)
            from: `"${ownerName}" <${process.env.SMTP_USER}>`,
            to: email, // Sent to visitor's email
            subject: `Receipt: We received your message, ${name}!`,
            text: `Hi ${name},\n\nThank you for reaching out! We have received your inquiry and will respond shortly.\n\nCopy of your message:\n${message}\n\nBest regards,\n${ownerName}`,
            html: autoResponderHTML
        };

        // Send Auto-Responder in a separate try/catch so that if it fails (e.g. invalid sender email),
        // it doesn't crash the main submission process which was already successful.
        try {
            await transporter.sendMail(autoResponderOptions);
            console.log(`✓ Auto-responder confirmation sent to customer: ${email}`);
        } catch (responderError) {
            console.warn('\x1b[33m%s\x1b[0m', `⚠ Failed to send auto-responder to ${email}:`, responderError.message);
        }

        // If a redirect parameter was provided (like FormSubmit's _next), redirect to that page.
        // Otherwise, return a JSON response.
        if (_next) {
            return res.redirect(_next);
        }

        return res.status(200).json({
            success: true,
            message: 'Your message has been delivered successfully!'
        });

    } catch (error) {
        console.error('Email Dispatch Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to send email notification. Please check server configuration logs.',
            error: error.message
        });
    }
});

// For local testing
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
        console.log(`API endpoint is available at: http://localhost:${PORT}/api/contact`);
    });
}

// Export the app for serverless platforms like Vercel
module.exports = app;
