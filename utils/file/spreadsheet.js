import ExcelJS from 'exceljs';

/**
 * Reads an uploaded voucher file into rows of plain cell values.
 *
 * Replaces the `xlsx` package, which has unfixed prototype-pollution and ReDoS advisories.
 * ExcelJS reads .xlsx; .csv is parsed here. The legacy .xls format is not supported —
 * those files have to be saved as .xlsx or .csv first.
 *
 * @param {{ buffer: Buffer, originalname: string }} file - Multer file
 * @returns {Promise<string[][]>} Rows of cell values, in file order
 */
export const readSpreadsheetRows = async (file) => {
  const name = String(file.originalname || '').toLowerCase();

  if (name.endsWith('.csv')) {
    return parseCsv(file.buffer.toString('utf8'));
  }

  if (name.endsWith('.xls')) {
    const error = new Error('The old .xls format is not supported. Please save the file as .xlsx or .csv and upload it again.');
    error.isUploadValidationError = true;
    throw error;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-based; index 0 is always empty
    const values = row.values.slice(1).map(cellToString);
    rows.push(values);
  });

  return rows;
};

/** Cell values can be numbers, dates, formula results or rich text. */
const cellToString = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text);
    if ('result' in value) return String(value.result ?? '');
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
};

/**
 * Minimal CSV parser: handles quoted fields, escaped quotes, commas and newlines inside
 * quotes, and both line ending styles.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export const parseCsv = (text) => {
  const content = text.replace(/^\uFEFF/, ''); // strip byte order mark
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);

  return rows;
};
