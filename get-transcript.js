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
                // De-structure the row to get all the needed values
                const [ , , RAsName, points, reason, studentRAsGroup] = row;
                
                // --- NEW: Return a structured object instead of a string ---
                const entryData = {
                    RAsName: RAsName || 'N/A',
                    studentRAsGroup: studentRAsGroup || 'N/A',
                    points: points || 'N/A',
                    reason: reason || 'N/A'
                };
                transcriptEntries.push(entryData);
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
