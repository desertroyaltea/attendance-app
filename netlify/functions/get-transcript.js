const { google } = require('googleapis');

// Helper function to format a date object into a consistent string (e.g., "6/24/2025")
function getLocaleDateString(date) {
    return new Date(date).toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });
}

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { date } = JSON.parse(event.body);
        if (!date) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Date not specified.' }) };
        }

        const requestedDateString = getLocaleDateString(date);

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const sheetName = 'Points';

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:F`, // Fetch up to column F
        });

        const rows = response.data.values || [];
        const transcriptEntries = [];

        for (const row of rows) {
            // Ensure row is valid and has a date in the first column
            if (!row || !row[0]) continue;
            
            const entryDateString = getLocaleDateString(row[0]);

            if (entryDateString === requestedDateString) {
                // De-structure the row to get all the needed values, including the new group from Column F (index 5)
                const [ , studentName, excorName, points, reason, studentExcorGroup] = row;
                
                // --- FIX: Use the student's name in the log, not the group ---
                // The original request was to replace the student name, but it's better to show both.
                // Let's create a more descriptive log entry. If the group is logged, we'll use it.
                
                const targetName = studentExcorGroup ? `${studentName} (${studentExcorGroup})` : studentName;
                
                // Format the entry exactly as requested, using the correct name
                const entryText = `EXCOR ${excorName || 'N/A'} gave ${targetName || 'N/A'} ${points || 'N/A'} points for: ${reason || 'N/A'}`;
                transcriptEntries.push(entryText);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify(transcriptEntries.reverse()), // Show most recent first
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `An error occurred: ${error.message}` }),
        };
    }
};
