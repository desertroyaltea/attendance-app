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

        // --- MODIFIED SECTION START ---
        
        let finalScores = {};

        if (type === 'group') {
            const groupData = {};
            // First, gather points and student counts for each group
            for (const student of aggregatedData) {
                if (student.group) {
                    if (!groupData[student.group]) {
                        groupData[student.group] = { points: 0, studentCount: 0 };
                    }
                    groupData[student.group].points += student.points;
                    groupData[student.group].studentCount += 1;
                }
            }

            // Next, calculate the final adjusted score for each group
            for (const groupName in groupData) {
                const group = groupData[groupName];
                if (group.studentCount > 0) {
                    // Apply the adjustment formula
                    finalScores[groupName] = (6 / group.studentCount) * group.points;
                } else {
                    finalScores[groupName] = 0;
                }
            }
        } else { // Default to student ranking (no change here)
            for (const student of aggregatedData) {
                if (student.name) {
                    finalScores[student.name] = (finalScores[student.name] || 0) + student.points;
                }
            }
        }

        // --- MODIFIED SECTION END ---

        // Convert the final scores map to an array and sort it
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