const { google } = require('googleapis');

async function calculateSheetPoints(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:BQ48`, // Fetch a wide range to ensure all data is included
    });

    const rows = response.data.values || [];
    if (rows.length < 4) {
        return {}; // Not enough data to process
    }

    const eventHeaderRow = rows[0]; // Events are in Row 1
    const studentPoints = {};

    // Find all columns that are 'Daily Points'
    const pointColumnIndices = [];
    for (let i = 3; i < eventHeaderRow.length; i++) { // Start from column D (index 3)
        if ((eventHeaderRow[i] || '').trim().toLowerCase() === 'daily points') {
            pointColumnIndices.push(i);
        }
    }

    // Iterate through student rows (starting from row 4, which is index 3)
    for (let i = 3; i < rows.length; i++) {
        const studentRow = rows[i];
        if (!studentRow || !studentRow[1]) continue; // Skip if no student name

        const studentName = studentRow[1].trim();
        let totalPoints = 0;

        // Sum points only from the 'Daily Points' columns
        for (const colIndex of pointColumnIndices) {
            const points = parseInt(studentRow[colIndex] || '0');
            if (!isNaN(points)) {
                totalPoints += points;
            }
        }
        
        // Use hasOwnProperty check for safety
        if (Object.prototype.hasOwnProperty.call(studentPoints, studentName)) {
            studentPoints[studentName] += totalPoints;
        } else {
            studentPoints[studentName] = totalPoints;
        }
    }
    
    return studentPoints;
}


exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { week } = JSON.parse(event.body);
        if (!week) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Week not specified.' }) };
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        let finalPoints = {};

        if (week.toLowerCase() === 'total') {
            const weekSheets = ['Week1', 'Week2', 'Week3', 'Week4', 'Week5', 'Week6'];
            const allStudentNames = new Set();
            const weeklyPointsData = [];
            
            // First pass to get all weekly data and all unique student names
            for(const sheetName of weekSheets) {
                const points = await calculateSheetPoints(sheets, spreadsheetId, sheetName);
                Object.keys(points).forEach(name => allStudentNames.add(name));
                weeklyPointsData.push(points);
            }

            // Initialize final points for all students
            allStudentNames.forEach(name => finalPoints[name] = 0);
            
            // Sum up the points
            for(const weeklyResult of weeklyPointsData) {
                 for(const studentName in weeklyResult) {
                     if (Object.prototype.hasOwnProperty.call(finalPoints, studentName)) {
                         finalPoints[studentName] += weeklyResult[studentName];
                     }
                 }
            }
        } else {
            finalPoints = await calculateSheetPoints(sheets, spreadsheetId, week);
        }

        // Convert to array and sort
        const rankedList = Object.entries(finalPoints)
            .map(([name, points]) => ({ name, points }))
            .sort((a, b) => b.points - a.points);

        return {
            statusCode: 200,
            body: JSON.stringify(rankedList),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `An error occurred: ${error.message}` }),
        };
    }
};
