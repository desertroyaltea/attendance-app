const { google } = require('googleapis');

// Helper function to convert a 0-based column index to A1 notation (e.g., 0 -> A, 1 -> B)
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
    const { studentName, points, action } = JSON.parse(event.body);
    const saudiTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    const todayString = saudiTime.toLocaleDateString('en-US');

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'Week1';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:AZ`, // Fetch all relevant columns
    });

    const rows = response.data.values || [];
    if (rows.length < 4) {
      return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Sheet has too few rows.' }) };
    }

    // Headers are now in Row 1 (Events) and Row 2 (Dates)
    const eventHeaderRow = rows[0];
    const dateHeaderRow = rows[1];

    // Find the 'Daily Points' column for today's date
    let targetColumnIndex = -1;
    for (let i = 0; i < eventHeaderRow.length; i++) {
        const sheetEvent = (eventHeaderRow[i] || '').trim().toLowerCase();
        const headerDate = dateHeaderRow[i] ? new Date(dateHeaderRow[i]).toLocaleDateString('en-US') : null;

        if (sheetEvent === 'EXCOR Points' && headerDate === todayString) {
            targetColumnIndex = i;
            break;
        }
    }

    if (targetColumnIndex === -1) {
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Could not find 'EXCOR Points' column for today.` }) };
    }

    // Find the student's row by name (starting from row 4, which is index 3)
    let targetRowIndex = -1;
    for (let i = 3; i < rows.length; i++) {
        // Column B is index 1
        if (rows[i] && (rows[i][1] || '').trim() === studentName) {
            targetRowIndex = i;
            break;
        }
    }

    if (targetRowIndex === -1) {
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Student '${studentName}' not found.` }) };
    }

    // Get current points, defaulting to 0 if the cell is empty
    const currentPoints = parseInt(rows[targetRowIndex][targetColumnIndex] || '0');
    let newPoints = 0;

    if (action === 'add') {
      newPoints = currentPoints + points;
    } else if (action === 'remove') {
      newPoints = currentPoints - points;
    }

    const cellToUpdate = toA1(targetColumnIndex) + (targetRowIndex + 1);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${cellToUpdate}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[newPoints]] },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'success', message: `Updated points for ${studentName} to ${newPoints}.` }),
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: `An error occurred: ${error.message}` }),
    };
  }
};
