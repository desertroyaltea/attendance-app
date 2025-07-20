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
            const points = parseFloat(studentRow[colIndex] || '0');
            if (!isNaN(points)) {
                totalPoints += points;
            }
        }

        studentData.push({ name: studentName, group: excorGroup, points: totalPoints });
    }

    return studentData;
}

// --- NEW HELPER FUNCTION TO CALCULATE A SINGLE WEEK'S ADJUSTED GROUP SCORES ---
async function getAdjustedGroupScores(sheets, spreadsheetId, sheetName) {
    const weeklyRawData = await calculateSheetData(sheets, spreadsheetId, sheetName);
    const weeklyGroupData = {};
    const weeklyFinalScores = {};

    // Gather points and unique student names for the week
    for (const student of weeklyRawData) {
        if (student.group) {
            if (!weeklyGroupData[student.group]) {
                weeklyGroupData[student.group] = { points: 0, studentNames: new Set() };
            }
            weeklyGroupData[student.group].points += student.points;
            weeklyGroupData[student.group].studentNames.add(student.name);
        }
    }

    // Calculate the final adjusted score for the week
    for (const groupName in weeklyGroupData) {
        const group = weeklyGroupData[groupName];
        const studentCount = group.studentNames.size;

        if (studentCount > 0) {
            const adjustedScore = (6 / studentCount) * group.points;
            weeklyFinalScores[groupName] = Math.round(adjustedScore);
        } else {
            weeklyFinalScores[groupName] = 0;
        }
    }
    return weeklyFinalScores;
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

        let finalScores = {};

        if (type === 'group') {
            // --- REBUILT LOGIC FOR GROUP CALCULATIONS ---
            if (week.toLowerCase() === 'total') {
                const weekSheets = ['Week1', 'Week2', 'Week3', 'Week4', 'Week5', 'Week6'];
                for (const sheetName of weekSheets) {
                    // Get the adjusted scores for each week individually
                    const weeklyAdjustedScores = await getAdjustedGroupScores(sheets, spreadsheetId, sheetName);
                    // Add them to the running total
                    for (const groupName in weeklyAdjustedScores) {
                        finalScores[groupName] = (finalScores[groupName] || 0) + weeklyAdjustedScores[groupName];
                    }
                }
            } else {
                // For a single week, just get its adjusted scores
                finalScores = await getAdjustedGroupScores(sheets, spreadsheetId, week);
            }
        } else { 
            // Student logic remains the same (gathers all data then sums)
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
            // Sum points by student name
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