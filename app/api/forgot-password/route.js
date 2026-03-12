import { NextResponse } from "next/server";
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { convexQuery, convexMutation } = require("../../lib/convexServer");

function maskEmail(value) {
  if (!value) return value;
  const [user, domain] = String(value).split("@");
  if (!domain) return "***";
  const maskedUser =
    user.length <= 2 ? `${user[0] || "*"}*` : `${user.slice(0, 2)}***${user.slice(-1)}`;
  return `${maskedUser}@${domain}`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = body?.email && String(body.email).trim();
    const requestedRole = body?.role && String(body.role).trim();
    if (!email || !requestedRole) {
      return NextResponse.json({ error: "Email and role are required" }, { status: 400 });
    }

    const normalizedRole = requestedRole.toLowerCase();
    const isWorkerRole = normalizedRole === "worker";
    const isUserRole =
      normalizedRole === "user" ||
      normalizedRole === "admin" ||
      normalizedRole === "station" ||
      normalizedRole === "fuel_station";
    if (!isWorkerRole && !isUserRole) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const accountType = isWorkerRole ? "workers" : "users";
    const account = isWorkerRole
      ? await convexQuery("workers:getByEmail", { email })
      : await convexQuery("users:getByEmail", { email });

    if (account) {
      const token = crypto.randomBytes(24).toString("hex");
      await convexMutation("password_reset:createToken", {
        user_id: accountType === "users" ? account._id : undefined,
        account_type: accountType,
        account_id: account._id,
        token,
        created_at: new Date().toISOString(),
      });

      const appUrl = process.env.APP_URL || request.nextUrl?.origin || "http://localhost:3000";
      const resetLink = `${appUrl}/reset-password/${token}`;

      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const debugSmtp = process.env.DEBUG_SMTP === "1";

      if (smtpHost && smtpPort && smtpUser && smtpPass) {
        try {
          if (debugSmtp) {
            console.log("[smtp] using real SMTP", {
              host: smtpHost,
              port: smtpPort,
              user: maskEmail(smtpUser),
              from: process.env.SMTP_FROM,
            });
          }
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass },
            tls: { rejectUnauthorized: false },
          });
          await transporter.sendMail({
            from: process.env.SMTP_FROM || smtpUser,
            to: account.email,
            subject: "AGF Password Reset",
            text:
              `You requested a password reset for your AGF account. Please use the following link to reset your password:\n\n${resetLink}\n\n` +
              `This link will expire in 24 hours.\n\nIf you didn't request this, you can safely ignore this email.`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #333;">Password Reset Request</h2>
                <p>You requested a password reset for your AGF account. Click the button below to set a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
                </div>
                <p>If the button doesn't work, copy and paste this link into your browser:</p>
                <p><a href="${resetLink}">${resetLink}</a></p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #777;">This link will expire in 24 hours. If you didn't request this, please ignore this email.</p>
              </div>
            `,
          });
        } catch (err) {
          console.error("CRITICAL: Failed to send reset email using real SMTP:", err);
        }
      } else {
        try {
          if (debugSmtp) {
            console.log("[smtp] missing real SMTP env; falling back to Ethereal", {
              host: smtpHost,
              port: smtpPort,
              user: smtpUser ? maskEmail(smtpUser) : undefined,
              from: process.env.SMTP_FROM,
              hasPass: Boolean(smtpPass),
            });
          }
          const testAccount = await nodemailer.createTestAccount();
          const transporter = nodemailer.createTransport({
            host: testAccount.smtp.host,
            port: testAccount.smtp.port,
            secure: testAccount.smtp.secure,
            auth: { user: testAccount.user, pass: testAccount.pass },
          });
          const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || testAccount.user,
            to: account.email,
            subject: "AGF Password Reset (Test)",
            text: `(TEST ENV) Reset link: ${resetLink}`,
            html: `<p>(TEST ENV) Click here to reset: <a href="${resetLink}">${resetLink}</a></p>`,
          });
          const preview = nodemailer.getTestMessageUrl(info);
          console.log(`[forgot-password] Ethereal preview URL: ${preview}`);
        } catch (err) {
          console.warn(`[forgot-password] Failed to use Ethereal, reset link for ${account.email} is:`, resetLink);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Forgot password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
