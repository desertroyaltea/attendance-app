const { google } = require('googleapis');

async function calculateSheetData(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName, 
    });

    const rows = response.data.values || [];
    if (rows.length < 4) {
        return [];
    }

    const eventHeaderRow = rows[0];
    const studentData = [];
    const pointColumnIndices = [];

    for (let i = 3; i < eventHeaderRow.length; i++) {
        if ((eventHeaderRow[i] || '').trim().toLowerCase() === 'daily points') {
            pointColumnIndices.push(i);
        }
    }

    for (let i = 3; i < rows.length; i++) {
        const studentRow = rows[i];
        if (!studentRow || !studentRow[1] || !studentRow[2]) continue; 

        const studentName = studentRow[1].trim();
        const excorGroup = studentRow[2].trim();
        let totalPoints = 0;

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

        let aggregatedData = [];

        if (week.toLowerCase() === 'total') {
            const weekSheets = ['Week1', 'Week2', 'Week3', 'Week4', 'Week5', 'Week6'];
            for (const sheetName of weekSheets) {
                const weeklyData = await calculateSheetData(sheets, spreadsheetId, sheetName);
                aggregatedData = aggregatedData.concat(weeklyData);
            }
        } else {
            aggregatedData = await calculateSheetData(sheets, spreadsheetId, week);
        }

        let finalScores = {};

        if (type === 'group') {
            const groupData = {};
            for (const student of aggregatedData) {
                if (student.group) {
                    if (!groupData[student.group]) {
                        groupData[student.group] = { points: 0, studentCount: 0 };
                    }
                    groupData[student.group].points += student.points;
                    groupData[student.group].studentCount += 1;
                }
            }

            for (const groupName in groupData) {
                const group = groupData[groupName];
                if (group.studentCount > 0) {
                    const adjustedScore = (6 / group.studentCount) * group.points;
                    // --- CHANGE: Round the final score to a whole number ---
                    finalScores[groupName] = Math.round(adjustedScore);
                } else {
                    finalScores[groupName] = 0;
                }
            }
        } else { // Default to student ranking
            for (const student of aggregatedData) {
                if (student.name) {
                    finalScores[student.name] = (finalScores[student.name] || 0) + student.points;
                }
            }
        }

        const rankedList = Object.entries(finalScores)
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