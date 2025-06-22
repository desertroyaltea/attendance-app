const { google } = require('googleapis');

// Helper function to convert a 0-based column index to A1 notation (e.g., 0 -> A, 1 -> B, 26 -> AA)
function toA1(colIndex) {
    let column = "";
    let temp = colIndex + 1;
    while (temp > 0) {
        let mod = (temp - 1) % 26;
        column = String.fromCharCode(65 + mod) + column;
        temp = Math.floor((temp - 1) / 26);
    }
    return column;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { studentId } = JSON.parse(event.body);
    if (!studentId) {
      return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Student ID not provided.' }) };
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'Sheet1';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
    });

    const rows = response.data.values || [];
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD format
    const checkInTime = new Date().toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit'});

    const studentRowIndex = rows.findIndex(row => row && row[0] === studentId);
    if (studentRowIndex === -1) {
      return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Student ID ${studentId} not found.` }) };
    }
    const studentName = rows[studentRowIndex][1];

    const headerRow = rows[0] || [];
    let dateColumnIndex = headerRow.findIndex(header => header && new Date(header).toLocaleDateString("en-CA") === today);

    if (dateColumnIndex === -1) {
      dateColumnIndex = headerRow.length;
      const newHeaderCell = toA1(dateColumnIndex) + '1';
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${newHeaderCell}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[today]] },
      });
    }

    const cellToUpdate = toA1(dateColumnIndex) + (studentRowIndex + 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${cellToUpdate}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[checkInTime]] },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'success', message: `Checked in ${studentName} at ${checkInTime}` }),
    };

  } catch (error) {
    console.error('Function Error:', error); // Log the detailed error for debugging
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: `An error occurred: ${error.message}` }),
    };
  }
};