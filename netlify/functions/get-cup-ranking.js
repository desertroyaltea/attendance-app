const { google } = require('googleapis');

// --- HELPER: Fetches and processes student scores from a single sheet ---
async function getStudentScores(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName, // Read the entire sheet
    });

    const rows = response.data.values || [];
    if (rows.length < 4) return []; // Not enough data

    const studentData = [];
    const pointsColumnIndex = rows[0].length - 2; // Second to last column

    for (let i = 3; i < rows.length; i++) { // Student data starts at row 4
        const studentRow = rows[i];
        if (!studentRow || !studentRow[1]) continue; // Skip if no student name

        const studentName = studentRow[1].trim();
        const points = parseFloat(studentRow[pointsColumnIndex] || '0');

        if (studentName) {
            studentData.push({ name: studentName, points: isNaN(points) ? 0 : points });
        }
    }
    return studentData;
}


// --- HELPER: Fetches and processes group scores from a single sheet ---
async function getGroupScores(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
    });

    const rows = response.data.values || [];
    if (rows.length < 4) return [];

    const groupData = {};
    const groupColumnIndex = rows[0].length - 1; // Very last column
    let currentGroupPoints = 0;

    for (let i = 3; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[2]) continue; // Skip if no group name

        const groupName = row[2].trim();
        // The value from a merged cell only appears in the first row.
        // We capture it and carry it down until we see a new value.
        const pointsValue = parseFloat(row[groupColumnIndex] || '0');
        if (!isNaN(pointsValue) && pointsValue !== 0) {
            currentGroupPoints = pointsValue;
        }

        // We add the points to the group. Since the points are the same for
        // all members of a group, this correctly assigns the total group score.
        if (groupName) {
            groupData[groupName] = { name: groupName, points: currentGroupPoints };
        }
    }

    // Return an array of the final group objects
    return Object.values(groupData);
}


// --- MAIN HANDLER ---
exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { week, type } = JSON.parse(event.body);
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

        const weekSheets = ['Week1', 'Week2', 'Week3', 'Week4', 'Week5', 'Week6'];
        const sheetsToProcess = week.toLowerCase() === 'total' ? weekSheets : [week];

        const finalScores = {};

        if (type === 'student') {
            for (const sheetName of sheetsToProcess) {
                const weeklyData = await getStudentScores(sheets, spreadsheetId, sheetName);
                for (const student of weeklyData) {
                    finalScores[student.name] = (finalScores[student.name] || 0) + student.points;
                }
            }
        } else if (type === 'group') {
            for (const sheetName of sheetsToProcess) {
                const weeklyData = await getGroupScores(sheets, spreadsheetId, sheetName);
                for (const group of weeklyData) {
                    finalScores[group.name] = (finalScores[group.name] || 0) + group.points;
                }
            }
        }

        const rankedList = Object.entries(finalScores)
            .map(([name, points]) => ({ name, points: Math.round(points) }))
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