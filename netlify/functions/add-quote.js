const { google } = require('googleapis');

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { quote, author, recorderName } = JSON.parse(event.body);
        if (!quote || !author) {
            return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Quote and author are required.' }) };
        }

        const saudiTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
        const logDate = saudiTime.toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const sheetName = 'Quotes';

        const newRow = [
            logDate,        // Column A: Date
            author,         // Column B: Who said it
            recorderName,   // Column C: Who recorded it
            quote           // Column D: The quote
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: sheetName,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'success', message: 'Quote added successfully!' }),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ status: 'error', message: `An error occurred: ${error.message}` }),
        };
    }
};
