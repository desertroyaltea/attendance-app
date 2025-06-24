const { google } = require('googleapis');

// This function now calculates points and returns student names, their group, and their points.
async function calculateSheetData(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:BQ48`, 
    });

    const rows = response.data.values || [];
    if (rows.length < 4) {
        return []; // Return empty array if not enough data
    }

    const eventHeaderRow = rows[0]; // Events are in Row 1
    const studentData = [];

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
        // Ensure row has a student name (col C, index 2) and an EXCOR group (col B, index 1)
        if (!studentRow || !studentRow[1] || !studentRow[2]) continue; 

        const studentName = studentRow[1].trim();
        const excorGroup = studentRow[2].trim();
        let totalPoints = 0;

        // Sum points only from the 'Daily Points' columns
        for (const colIndex of pointColumnIndices) {
            const points = parseInt(studentRow[colIndex] || '0');
            if (!isNaN(points)) {
                totalPoints += points;
            }
        }
        
        studentData.push({ name: studentName, group: excorGroup, points: totalPoints });
    }
    
    return studentData;
}


exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { week, type } = JSON.parse(event.body); // Now expects 'type' (student or group)
        if (!week || !type) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Week or type not specified.' }) };
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

        let aggregatedData = [];

        if (week.toLowerCase() === 'total') {
            const weekSheets = ['Week1', 'Week2', 'Week3', 'Week4', 'Week5', 'Week6'];
            for(const sheetName of weekSheets) {
                const weeklyData = await calculateSheetData(sheets, spreadsheetId, sheetName);
                aggregatedData = aggregatedData.concat(weeklyData);
            }
        } else {
            aggregatedData = await calculateSheetData(sheets, spreadsheetId, week);
        }

        let finalPoints = {};

        if (type === 'group') {
            // Aggregate points by EXCOR group
            for (const student of aggregatedData) {
                if(student.group){
                   finalPoints[student.group] = (finalPoints[student.group] || 0) + student.points;
                }
            }
        } else { // Default to student ranking
            // Aggregate points by student name
             for (const student of aggregatedData) {
                if(student.name){
                   finalPoints[student.name] = (finalPoints[student.name] || 0) + student.points;
                }
            }
        }


        // Convert the aggregated points map to an array and sort it
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
