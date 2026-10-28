import webpush from 'web-push';
import config, { prisma } from '../../config/config.js';

// Configure Web Push only when the keys AND a contact subject are present.
// VAPID requires a subject and web-push throws on import without one, so a
// missing EMAIL_USER disables push rather than taking the whole app down.
if (config.vapid.publicKey && config.vapid.privateKey && config.vapid.email) {
  webpush.setVapidDetails(
    config.vapid.email,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
} else {
  console.warn('VAPID keys are missing from environment variables. Web push notifications will not work.');
}

/**
 * Sends a push notification to all active subscriptions of a user.
 * @param {string} userId - The ID of the user.
 * @param {object} payload - The payload to send (title, body, etc.).
 */
export const sendPushNotification = async (userId, payload) => {
  try {
    // 1. Fetch all subscriptions for the user
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId }
    });

    if (subscriptions.length === 0) {
      return { success: true, sentCount: 0 };
    }

    const payloadString = JSON.stringify(payload);

    // 2. Send to all subscriptions in parallel
    const sendPromises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      try {
        await webpush.sendNotification(pushSubscription, payloadString);
      } catch (error) {
        // If subscription is expired or invalid (410 Gone / 404 Not Found), delete it
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.warn(`Deleting invalid or expired push subscription: ${sub.endpoint}`);
          await prisma.pushSubscription.delete({
            where: { id: sub.id }
          }).catch((dbErr) => {
            console.error('Failed to delete stale push subscription:', dbErr);
          });
        } else {
          console.error(`Error sending push notification to endpoint ${sub.endpoint}:`, error);
        }
      }
    });

    await Promise.all(sendPromises);
    return { success: true, sentCount: subscriptions.length };
  } catch (error) {
    console.error('Error in sendPushNotification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Helper to create a notification in the database and automatically push it.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.type]
 */
export const createNotification = async ({ userId, title, message, type }) => {
  // 1. Store in the database
  const notification = await prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type
    }
  });

  // 2. Send push notification asynchronously
  // sendPushNotification(userId, {
  //   id: notification.id,
  //   title,
  //   body: message,
  //   type,
  //   createdAt: notification.createdAt
  // }).catch((err) => {
  //   console.error('Failed to trigger push notification:', err);
  // });

  return notification;
};

/**
 * Helper to notify all admins in the system.
 * Creates a notification in the database for each admin, and optionally sends web push notification.
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.type]
 * @param {boolean} [params.sendPush]
 */
export const notifyAllAdmins = async ({ title, message, type = 'SYSTEM', sendPush = false }) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' }
    });

    const notifyPromises = admins.map(async (admin) => {
      // 1. Create database notification record
      await prisma.notification.create({
        data: {
          userId: admin.id,
          title,
          message,
          type
        }
      });

      // 2. Send push if requested
      if (sendPush) {
        await sendPushNotification(admin.id, {
          title,
          body: message,
          type
        });
      }
    });

    await Promise.all(notifyPromises);
  } catch (error) {
    console.error('Error in notifyAllAdmins:', error);
  }
};

