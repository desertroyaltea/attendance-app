const { google } = require('googleapis');

exports.handler = async function (event) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      // Use read-only scope as we are only fetching data
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Fetch the specific range for student names from the 'Week1' sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Week1!B3:B68',
    });

    // The API returns an array of arrays, e.g., [['Student A'], ['Student B']].
    // .flat() converts it to a simple array: ['Student A', 'Student B']
    const studentNames = response.data.values.flat();

    // Return the list of students in a successful response
    return {
      statusCode: 200,
      body: JSON.stringify(studentNames),
    };

  } catch (error) {
    // If anything goes wrong, log the error and return a server error status
    console.error('Error fetching students:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to fetch student list.' }),
    };
  }
};
