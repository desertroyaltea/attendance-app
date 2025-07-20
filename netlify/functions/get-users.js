const { google } = require('googleapis');

exports.handler = async function (event) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // This line correctly reads the ID you set in your environment variables.
        // No changes are needed here.
        const spreadsheetId = process.env.USER_SHEET_ID;
        const sheetName = 'EXCORS';

        // Fetch Username (E), Password (F), and Type (G) starting from row 2
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!E2:G`,
        });

        const rows = response.data.values || [];
        const users = rows.map(row => {
            // Ensure row has all required data before creating an object
            if (row[0] && row[1] && row[2]) {
                return {
                    username: row[0].trim(), // Column E
                    password: row[1].trim(), // Column F
                    type: row[2].trim(),     // Column G
                };
            }
            return null;
        }).filter(user => user !== null); // Filter out any empty rows

        return {
            statusCode: 200,
            body: JSON.stringify(users),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `An error occurred while fetching users: ${error.message}` }),
        };
    }
};