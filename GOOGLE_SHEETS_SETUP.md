# Google Sheets API Setup Guide

This guide will help you set up Google Sheets API access for logging call data.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it "Vapi Call Logging" and click "Create"

## Step 2: Enable Google Sheets API

1. In the Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Google Sheets API"
3. Click on it and press "Enable"

## Step 3: Create a Service Account

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Enter:
   - **Service account name**: `vapi-sheets-logger`
   - **Service account ID**: will auto-generate
   - **Description**: "Service account for logging Vapi call data"
4. Click "Create and Continue"
5. Skip the optional steps (Grant access, Grant users access)
6. Click "Done"

## Step 4: Create and Download Service Account Key

1. Click on the service account you just created
2. Go to the "Keys" tab
3. Click "Add Key" → "Create new key"
4. Select "JSON" format
5. Click "Create"
6. A JSON file will download - **KEEP THIS SAFE!**

## Step 5: Share Your Google Sheet with the Service Account

1. Open the JSON file you downloaded
2. Find the `client_email` field (looks like: `vapi-sheets-logger@project-id.iam.gserviceaccount.com`)
3. Copy this email address
4. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio/edit
5. Click "Share" button
6. Paste the service account email
7. Give it "Editor" access
8. Click "Send"

## Step 6: Set Up Column Headers in Google Sheet

In your Google Sheet, add these headers in row 1:

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Customer Name | Call Timestamp | Policy Used | Rating | Customer Feedback | Call Summary | Callback | Callback Schedule | Callback Attempt | Duration |

## Step 7: Add Credentials to Environment Variables

1. Open the JSON key file you downloaded
2. Copy the **entire contents** of the file
3. Open your `.env` file
4. Add this line (paste the JSON as a single line):
   ```
   GOOGLE_CREDENTIALS={"type":"service_account","project_id":"..."}
   ```

**Important**: The entire JSON must be on one line, or you can minify it.

### Alternative: Pretty Format (Easier to read)

You can also store it as a multiline string by escaping it:
```bash
GOOGLE_CREDENTIALS='{"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}'
```

## Step 8: Restart Your Server

```bash
npm start
```

## Step 9: Test the Integration

1. Make a test call through your Vapi app
2. Check the Google Sheet - a new row should appear with the call data!

## Troubleshooting

### Error: "The caller does not have permission"
- Make sure you shared the Google Sheet with the service account email
- Check that the service account has "Editor" permissions

### Error: "Invalid credentials"
- Verify the GOOGLE_CREDENTIALS in .env is properly formatted
- Make sure there are no extra spaces or line breaks
- Check that you copied the entire JSON file contents

### Data not appearing in sheet
- Check server logs for errors
- Verify the SPREADSHEET_ID in `server/index.js` matches your sheet
- Make sure the sheet name is "Sheet1" or update the RANGE variable

## Security Notes

- **Never commit the service account JSON file to git**
- **Never commit the .env file with credentials**
- Keep your service account credentials secure
- Only share the Google Sheet with the service account, not publicly

## Sheet Structure

The data is logged in this order:
1. **Customer Name** - Name of the customer
2. **Call Timestamp** - ISO 8601 timestamp of when call started
3. **Policy Used** - Which policy/script was used
4. **Rating** - Customer rating (1-5)
5. **Customer Feedback** - Customer's feedback text
6. **Call Summary** - AI-generated summary of the call
7. **Callback** - TRUE/FALSE if callback was requested
8. **Callback Schedule** - ISO 8601 timestamp of scheduled callback
9. **Callback Attempt** - Number of callback attempts (1-3)
10. **Duration** - Call duration in seconds

---

Need help? Check the console logs in your terminal for detailed error messages.
