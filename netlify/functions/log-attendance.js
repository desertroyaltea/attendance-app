const { google } = require('googleapis');

// Helper to find the correct event from the Times sheet using a start and end time
async function getCurrentEvent(sheets, spreadsheetId, date) {
    // Get today's date in a comparable format, e.g., "6/24/2025"
    const todayString = date.toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });
    // Get current time as a number, e.g., 9:45 AM -> 945, 4:20 PM -> 1620
    const currentTime = date.getHours() * 100 + date.getMinutes();

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Times!A:D', // Update range to include the new End Time column
    });

    const schedules = response.data.values || [];
    
    // Find an event for today where the current time is within the event's window
    for (const row of schedules) {
        // Ensure row has enough columns (Date, Event, Start, End) to avoid errors
        if (!row || !row[0] || !row[1] || !row[2] || !row[3]) continue;

        const scheduleDate = new Date(row[0]).toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });
        
        if (scheduleDate === todayString) {
            const startTime = parseInt(row[2]);
            const endTime = parseInt(row[3]);
            // Check if the current time is between the start and end times
            if (currentTime >= startTime && currentTime <= endTime) {
                // Return an object with both the name and the start time
                return {
                    name: row[1],
                    startTime: startTime
                };
            }
        }
    }
    
    // If no event is found after checking all rows, return null
    return null;
}


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

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        const currentEvent = await getCurrentEvent(sheets, spreadsheetId, saudiTime);
        
        if (!studentId) {
            return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Student ID not provided.' }) };
        }
        if (!currentEvent) {
            return { statusCode: 200, body: JSON.stringify({ status: 'error', message: 'No active event found in the Times sheet for the current date and time.' }) };
        }

        const week1SheetName = 'Week1';
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${week1SheetName}!A:AZ` });
        const rows = response.data.values || [];
        const eventHeaderRow = rows[0];
        const dateHeaderRow = rows[1];
        const todayDateString = saudiTime.toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });

        let targetColumnIndex = -1;
        for (let i = 0; i < eventHeaderRow.length; i++) {
            const sheetEvent = (eventHeaderRow[i] || '').trim().toLowerCase();
            const expectedEvent = currentEvent.name.toLowerCase();
            const headerDate = dateHeaderRow[i] ? new Date(dateHeaderRow[i]).toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' }) : null;
            
            if (sheetEvent === expectedEvent && headerDate === todayDateString) {
                targetColumnIndex = i;
                break;
            }
        }

        if (targetColumnIndex === -1) {
            return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Could not find column for Event: '${currentEvent.name}' on today's date.` }) };
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
        const existingValue = (rows[targetRowIndex] && rows[targetRowIndex][targetColumnIndex]) ? rows[targetRowIndex][targetColumnIndex] : null;

        if (existingValue && existingValue.trim() !== "") {
            return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `${studentName} has already been checked in for ${currentEvent.name}!` }) };
        }

        // --- NEW: Calculate minutes since event start ---
        const eventStartHour = Math.floor(currentEvent.startTime / 100);
        const eventStartMinute = currentEvent.startTime % 100;
        
        const eventStartDate = new Date(saudiTime);
        eventStartDate.setHours(eventStartHour, eventStartMinute, 0, 0);

        const diffMs = saudiTime - eventStartDate;
        const minutesSinceStart = Math.floor(diffMs / 60000);
        // ------------------------------------------

        const valueToWrite = minutesSinceStart.toString();
        const cellA1Notation = toA1(targetColumnIndex) + (targetRowIndex + 1);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${week1SheetName}!${cellA1Notation}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[valueToWrite]] },
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'success', message: `Checked in ${studentName} for ${currentEvent.name}!` }),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ status: 'error', message: `An error occurred: ${error.message}` }),
        };
    }
};
