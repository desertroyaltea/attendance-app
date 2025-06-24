const { google } = require('googleapis');

// --- EVENT SCHEDULE ---
// Define the time frames for each event in 24-hour format.
const eventSchedule = [
    { name: 'Breakfast', start: 7, end: 9 },   // 7:00 AM - 9:00 AM
    { name: 'Lunch', start: 12, end: 14 },     // 12:00 PM - 2:00 PM
    { name: 'Dinner', start: 18, end: 20 },    // 6:00 PM - 8:00 PM
];
// --------------------

// Helper function to get the current event based on the time
function getCurrentEvent(date) {
    const currentHour = date.getHours();
    for (const event of eventSchedule) {
        if (currentHour >= event.start && currentHour < event.end) {
            return event.name;
        }
    }
    return null; // No event is currently active
}

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
        const saudiTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
        const { studentId } = JSON.parse(event.body);
        const currentEvent = getCurrentEvent(saudiTime);
        
        if (!studentId) {
            return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Student ID not provided.' }) };
        }
        if (!currentEvent) {
            const currentHour = saudiTime.getHours();
            return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `No event is currently active. Current time: ${currentHour}:00 AST.` }) };
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
        const sheetName = 'Week1';

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:AZ`,
        });

        const rows = response.data.values || [];
        if (rows.length < 2) {
             return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Sheet has fewer than 2 rows. Cannot read headers.' }) };
        }
        
        const eventHeaderRow = rows[0]; // Events are in Row 1
        const dateHeaderRow = rows[1];  // Dates are in Row 2
        
        const todayString = saudiTime.toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });
        
        let targetColumnIndex = -1;
        for (let i = 0; i < eventHeaderRow.length; i++) {
            const sheetEvent = eventHeaderRow[i] ? eventHeaderRow[i].trim().toLowerCase() : null;
            const expectedEvent = currentEvent.toLowerCase();
            const headerDate = dateHeaderRow[i] ? new Date(dateHeaderRow[i]).toLocaleDateString('en-US') : null;
            
            if (sheetEvent === expectedEvent && headerDate === todayString) {
                targetColumnIndex = i;
                break;
            }
        }

        if (targetColumnIndex === -1) {
            return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Could not find column for Event: '${currentEvent}' on Date: '${todayString}'.` }) };
        }

        let targetRowIndex = -1;
        for(let i = 2; i < rows.length; i++){
            if(rows[i] && rows[i][0] === studentId){
                targetRowIndex = i;
                break;
            }
        }
        
        if (targetRowIndex === -1) {
            return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Student ID ${studentId} not found in the sheet.` }) };
        }
        
        const studentName = rows[targetRowIndex][1];

        // --- ROBUST CHECK FOR EXISTING VALUE ---
        // This safely checks if the cell exists and has a non-empty value.
        const existingValue = (rows[targetRowIndex] && rows[targetRowIndex][targetColumnIndex]) ? rows[targetRowIndex][targetColumnIndex] : null;
        if (existingValue && existingValue.trim() !== "") {
            return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `${studentName} has already been checked in for ${currentEvent}!` }) };
        }
        // ------------------------------------------

        const valueToWrite = saudiTime.getMinutes().toString();
        const cellA1Notation = toA1(targetColumnIndex) + (targetRowIndex + 1);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!${cellA1Notation}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[valueToWrite]] },
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'success', message: `Checked in ${studentName} for ${currentEvent}!` }),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ status: 'error', message: `An error occurred: ${error.message}` }),
        };
    }
};