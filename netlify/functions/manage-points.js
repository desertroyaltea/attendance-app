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
    const { studentName, points, action, reason, excorName } = JSON.parse(event.body);
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
    
    // --- Update Daily Points in Week1 Sheet ---
    const week1SheetName = 'Week1';
    const week1Data = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${week1SheetName}!A:AZ`,
    });

    const rows = week1Data.data.values || [];
    if (rows.length < 4) {
      return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Week1 sheet has too few rows.' }) };
    }

    const eventHeaderRow = rows[0];
    const dateHeaderRow = rows[1];

    let targetColumnIndex = -1;
    for (let i = 0; i < eventHeaderRow.length; i++) {
        const sheetEvent = (eventHeaderRow[i] || '').trim().toLowerCase();
        const headerDate = dateHeaderRow[i] ? new Date(dateHeaderRow[i]).toLocaleDateString('en-US') : null;
        if (sheetEvent === 'daily points' && headerDate === todayString) {
            targetColumnIndex = i;
            break;
        }
    }

    if (targetColumnIndex === -1) {
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Could not find 'Daily Points' column for today in Week1.` }) };
    }

    let targetRowIndex = -1;
    for (let i = 3; i < rows.length; i++) {
        if (rows[i] && (rows[i][1] || '').trim() === studentName) {
            targetRowIndex = i;
            break;
        }
    }

    if (targetRowIndex === -1) {
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Student '${studentName}' not found in Week1.` }) };
    }

    const currentPoints = parseInt(rows[targetRowIndex][targetColumnIndex] || '0');
    let newPoints = 0;
    let pointsChange = 0;

    if (action === 'add') {
      pointsChange = points;
      newPoints = currentPoints + pointsChange;
    } else if (action === 'remove') {
      pointsChange = -points; // Make the number negative for removal
      newPoints = currentPoints + pointsChange;
    }

    const cellToUpdate = toA1(targetColumnIndex) + (targetRowIndex + 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${week1SheetName}!${cellToUpdate}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[newPoints]] },
    });

    // --- Log the transaction in the Points Sheet ---
    const pointsLogSheetName = 'Points';
    const pointsLogData = [
        saudiTime.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }), // A: Date and Time
        studentName, // B: Student Name
        excorName,   // C: EXCOR Name
        pointsChange > 0 ? `+${pointsChange}` : pointsChange.toString(), // D: Points +/-
        reason,      // E: Reason
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: pointsLogSheetName,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [pointsLogData],
        },
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
