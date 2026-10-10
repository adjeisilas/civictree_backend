import { v2 as cloudinary } from 'cloudinary';
import config from '../../config/config.js';

// Configure cloudinary
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret
});

/**
 * Uploads a file buffer to Cloudinary as a raw resource (CSV/Excel).
 * @param {Buffer} fileBuffer - The file buffer from multer
 * @param {string} originalName - Original name of the file
 * @returns {Promise<object>} Cloudinary upload result containing secure_url
 */
export const uploadFileToCloudinary = (fileBuffer, originalName) => {
  return new Promise((resolve, reject) => {
    // Generate a clean public ID without double extension
    const nameWithoutExt = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');
    const publicId = `vouchers/${Date.now()}_${sanitizedName}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw', // Critical: raw for CSV/Excel files
        public_id: publicId,
        overwrite: true
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

/**
 * Formats byte count to human-readable size string (e.g. 1.2 MB, 850 KB)
 * @param {number} bytes 
 * @returns {string} Formatted size
 */
export const formatFileSize = (bytes) => {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/**
 * Uploads a timetable PDF/DOC/DOCX file buffer to Cloudinary.
 * @param {Buffer} fileBuffer - The file buffer from multer
 * @param {string} originalName - Original name of the document
 * @returns {Promise<object>} Cloudinary upload result containing secure_url and metadata
 */
export const uploadTimetableDocumentToCloudinary = (fileBuffer, originalName) => {
  return new Promise((resolve, reject) => {
    const nameWithoutExt = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');
    const publicId = `timetables/${Date.now()}_${sanitizedName}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto', // Allows PDF, DOC, DOCX, etc.
        public_id: publicId,
        overwrite: true
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary timetable upload error:', error);
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

