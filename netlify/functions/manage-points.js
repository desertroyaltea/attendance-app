const { google } = require('googleapis');

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

function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { studentName, points, action, reason, excorName } = JSON.parse(event.body);
    const saudiTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    const todayString = formatDate(saudiTime);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // --- 1. Check and Update EXCOR Balance ---
    const excorSheetName = 'EXCORS';
    const excorData = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${excorSheetName}!A:B`,
    });
    const excorRows = excorData.data.values || [];
    const excorRowIndex = excorRows.findIndex(row => row[0] === excorName);

    if (excorRowIndex === -1) {
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `EXCOR '${excorName}' not found.` }) };
    }
    const currentExcorBalance = parseInt(excorRows[excorRowIndex][1] || '0');

    if (currentExcorBalance < points) {
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Insufficient balance. You have ${currentExcorBalance} points.` }) };
    }
    
    const newExcorBalance = currentExcorBalance - points;
    const excorCellToUpdate = `B${excorRowIndex + 1}`;
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${excorSheetName}!${excorCellToUpdate}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[newExcorBalance]] },
    });

    // --- 2. Update Daily Points in Week1 Sheet ---
    const week1SheetName = 'Week1';
    const week1Data = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${week1SheetName}!A:AZ` });
    const rows = week1Data.data.values || [];
    const eventHeaderRow = rows[0];
    const dateHeaderRow = rows[1];

    let targetColumnIndex = -1;
    for (let i = 0; i < eventHeaderRow.length; i++) {
        if (((eventHeaderRow[i] || '').trim().toLowerCase() === 'daily points') && (dateHeaderRow[i] ? formatDate(new Date(dateHeaderRow[i])) : null) === todayString) {
            targetColumnIndex = i;
            break;
        }
    }

    if (targetColumnIndex === -1) {
        // If we fail here, we must refund the EXCOR's points
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${excorSheetName}!${excorCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[currentExcorBalance]] } });
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
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${excorSheetName}!${excorCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[currentExcorBalance]] } });
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Student '${studentName}' not found in Week1.` }) };
    }

    // Get the student's EXCOR group from Column C (index 2)
    const studentExcorGroup = rows[targetRowIndex][2] ? `EXCOR ${rows[targetRowIndex][2]}'s Group` : "Unknown Group";

    const currentStudentPoints = parseInt(rows[targetRowIndex][targetColumnIndex] || '0');
    let pointsChange = action === 'add' ? points : -points;
    const newStudentPoints = currentStudentPoints + pointsChange;

    const studentCellToUpdate = toA1(targetColumnIndex) + (targetRowIndex + 1);
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${week1SheetName}!${studentCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[newStudentPoints]] } });

    // --- 3. Log the transaction in the Points Sheet ---
    const pointsLogSheetName = 'Points';
    const dateForLog = saudiTime.toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });
    // Add the student's EXCOR group to the log data array
    const pointsLogData = [
        dateForLog, 
        studentName, 
        excorName, 
        pointsChange > 0 ? `+${pointsChange}` : pointsChange.toString(), 
        reason,
        studentExcorGroup // This will be logged to Column F
    ];
    
    await sheets.spreadsheets.values.append({ spreadsheetId, range: pointsLogSheetName, valueInputOption: 'USER_ENTERED', resource: { values: [pointsLogData] } });
    
    // --- Updated Confirmation Message ---
    const actionVerb = action === 'add' ? 'Added' : 'Removed';
    const successMessage = `${actionVerb} ${points} points for ${studentName}!`;

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'success', message: successMessage }),
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: `An error occurred: ${error.message}` }),
    };
  }
};
