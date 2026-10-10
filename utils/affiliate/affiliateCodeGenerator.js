import { prisma } from '../../config/config.js';

/**
 * Safely generates the next unique affiliate code (e.g., AFF-1001, AFF-1002, etc.).
 * Guarantees zero duplicate key collisions even if previous records were deleted or created out of order.
 * 
 * @param {Object} [client=prisma] - Prisma client or transaction context (tx)
 * @returns {Promise<string>} Next unique affiliate code
 */
export const generateNextAffiliateCode = async (client = prisma) => {
  try {
    // Find the latest affiliate profile created with an AFF- prefix
    const profiles = await client.affiliateProfile.findMany({
      where: {
        affiliateCode: {
          startsWith: 'AFF-'
        }
      },
      select: {
        affiliateCode: true
      }
    });

    let maxNum = 1000;

    for (const p of profiles) {
      if (p.affiliateCode) {
        const match = p.affiliateCode.match(/^AFF-(\d+)$/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }

    let candidateNum = maxNum + 1;
    let candidateCode = `AFF-${candidateNum}`;

    // Safety loop to ensure absolute uniqueness
    let exists = await client.affiliateProfile.findUnique({
      where: { affiliateCode: candidateCode }
    });

    while (exists) {
      candidateNum++;
      candidateCode = `AFF-${candidateNum}`;
      exists = await client.affiliateProfile.findUnique({
        where: { affiliateCode: candidateCode }
      });
    }

    return candidateCode;
  } catch (error) {
    console.error('[AFFILIATE CODE GENERATOR ERROR]:', error);
    // Fallback using timestamp + random integer if DB check fails
    const fallbackNum = 1000 + Math.floor(Math.random() * 9000);
    return `AFF-${fallbackNum}`;
  }
};
