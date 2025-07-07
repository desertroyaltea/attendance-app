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

// --- NEW: Helper function to determine the correct week sheet ---
function getWeekSheetName(currentDate) {
    // Dates are set in YYYY, MM-1, DD format for reliability
    const week6_start = new Date(2025, 7, 10); // Aug 10
    const week5_start = new Date(2025, 7, 3);  // Aug 3
    const week4_start = new Date(2025, 6, 27); // July 27
    const week3_start = new Date(2025, 6, 20); // July 20
    const week2_start = new Date(2025, 6, 13); // July 13
    const week1_start = new Date(2025, 6, 6);  // July 6

    if (currentDate >= week6_start) return 'Week6';
    if (currentDate >= week5_start) return 'Week5';
    if (currentDate >= week4_start) return 'Week4';
    if (currentDate >= week3_start) return 'Week3';
    if (currentDate >= week2_start) return 'Week2';
    if (currentDate >= week1_start) return 'Week1';
    
    return 'Week1'; // Default or fallback
}


exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { studentName, points, action, reason, excorName } = JSON.parse(event.body);
    const saudiTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    const todayString = formatDate(saudiTime);
    
    // --- NEW: Dynamically get the current week's sheet name ---
    const currentWeekSheet = getWeekSheetName(saudiTime);

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

    // --- 2. Update EXCOR Points in the correct Weekly Sheet ---
    const weekData = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${currentWeekSheet}!A:AZ` });
    const rows = weekData.data.values || [];
    const eventHeaderRow = rows[0];
    const dateHeaderRow = rows[1];

    let targetColumnIndex = -1;
    for (let i = 0; i < eventHeaderRow.length; i++) {
        // --- CHANGE: Looking for "EXCOR Points" ---
        if (((eventHeaderRow[i] || '').trim().toLowerCase() === 'excor points') && (dateHeaderRow[i] ? formatDate(new Date(dateHeaderRow[i])) : null) === todayString) {
            targetColumnIndex = i;
            break;
        }
    }

    if (targetColumnIndex === -1) {
        // If we fail here, we must refund the EXCOR's points
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${excorSheetName}!${excorCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[currentExcorBalance]] } });
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Could not find 'EXCOR Points' column for today in ${currentWeekSheet}.` }) };
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
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Student '${studentName}' not found in ${currentWeekSheet}.` }) };
    }

    const studentExcorGroup = rows[targetRowIndex][2] ? `EXCOR ${rows[targetRowIndex][2]}'s Group` : "Unknown Group";
    const currentStudentPoints = parseInt(rows[targetRowIndex][targetColumnIndex] || '0');
    let pointsChange = action === 'add' ? points : -points;
    const newStudentPoints = currentStudentPoints + pointsChange;

    const studentCellToUpdate = toA1(targetColumnIndex) + (targetRowIndex + 1);
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${currentWeekSheet}!${studentCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[newStudentPoints]] } });

    // --- 3. Log the transaction in the Points Sheet ---
    const pointsLogSheetName = 'Points';
    const dateForLog = saudiTime.toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });
    const pointsLogData = [dateForLog, studentName, excorName, pointsChange > 0 ? `+${pointsChange}` : pointsChange.toString(), reason, studentExcorGroup];
    
    await sheets.spreadsheets.values.append({ spreadsheetId, range: pointsLogSheetName, valueInputOption: 'USER_ENTERED', resource: { values: [pointsLogData] } });
    
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
