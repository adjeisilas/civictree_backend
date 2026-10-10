import { prisma } from '../../config/config.js';

/**
 * Creates an activity log in the database.
 * @param {object} params
 * @param {string} [params.userId] - ID of the user performing the action (optional)
 * @param {string} params.action - Name of the action (e.g. 'USER_LOGIN')
 * @param {object|string} [params.details] - Detailed metadata or description of the action
 * @param {object} [params.req] - Express request to extract IP Address and User Agent
 */
export const logActivity = async ({ userId, action, details, req }) => {
  try {
    let ipAddress = null;
    let userAgent = null;

    if (req) {
      // Extract IP address (checking headers for reverse proxy)
      ipAddress = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
      if (Array.isArray(ipAddress)) {
        ipAddress = ipAddress[0];
      } else if (ipAddress && ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
      }
      
      // Extract user agent
      userAgent = req.headers['user-agent'] || null;
    }

    const detailsString = details 
      ? (typeof details === 'object' ? JSON.stringify(details) : details)
      : null;

    const activityLog = await prisma.activityLog.create({
      data: {
        userId,
        action,
        details: detailsString,
        ipAddress,
        userAgent
      }
    });

    return activityLog;
  } catch (error) {
    console.error('Failed to write activity log:', error);
    // Silent catch to prevent logging issues from crashing application workflows
  }
};
