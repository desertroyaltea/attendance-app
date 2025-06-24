const { google } = require('googleapis');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { excorName } = JSON.parse(event.body);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'EXCORS';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:B`,
    });

    const rows = response.data.values || [];
    const excorRow = rows.find(row => row[0] === excorName);

    if (!excorRow) {
      return { statusCode: 404, body: JSON.stringify({ message: 'EXCOR not found.' }) };
    }

    const balance = parseInt(excorRow[1] || '0');

    return {
      statusCode: 200,
      body: JSON.stringify({ balance }),
    };

  } catch (error) {
    console.error('Error fetching EXCOR balance:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to fetch EXCOR balance.' }),
    };
  }
};
