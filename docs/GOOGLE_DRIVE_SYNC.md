# Google Drive Cloud Sync

This project uses a dedicated `cloud-sync-service` to snapshot each service database and upload the snapshot bundle to Google Drive.

## What It Does

1. Connects to each MongoDB database owned by the services.
2. Reads the configured collections.
3. Normalizes Mongo objects into JSON-safe data.
4. Uploads the snapshot JSON to a Google Drive folder.
5. Exposes a manual sync route and a restore preview route.

This is backup/sync storage, not a replacement for MongoDB as the operational database.

## Google APIs You Need

Enable these in your Google Cloud project:

1. Google Drive API
2. Service Account credentials

## Required Credentials

Add these to `.env`:

1. `GOOGLE_DRIVE_PROJECT_ID`
2. `GOOGLE_DRIVE_CLIENT_EMAIL`
3. `GOOGLE_DRIVE_PRIVATE_KEY`
4. `GOOGLE_DRIVE_TOKEN_URI`
5. `GOOGLE_DRIVE_SCOPE`
6. `GOOGLE_DRIVE_FOLDER_ID` or `GOOGLE_DRIVE_FOLDER_NAME`

## Recommended Scope

Use:

```txt
https://www.googleapis.com/auth/drive
```

If you want narrower access, use `drive.file`, but keep in mind folder access and restore workflows are easier with the broader scope.

## Drive Setup Steps

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Create a service account.
4. Generate a JSON key and copy the `client_email` and `private_key` values into `.env`.
5. Create a Drive folder for backups, or let the service create one.
6. Share the folder with the service account if you use a pre-created folder.

## Service Endpoints

`cloud-sync-service` runs on port `3007` and exposes:

1. `GET /health`
2. `GET /ready`
3. `GET /status`
4. `GET /snapshots`
5. `POST /sync`
6. `GET /restore/latest`

## Environment Variables

### Sync Control

1. `CLOUD_SYNC_INTERVAL_MS`
2. `CLOUD_SYNC_BACKUP_PREFIX`
3. `CLOUD_SYNC_RESTORE_ON_START`

### Google Drive

1. `GOOGLE_DRIVE_PROJECT_ID`
2. `GOOGLE_DRIVE_CLIENT_EMAIL`
3. `GOOGLE_DRIVE_PRIVATE_KEY`
4. `GOOGLE_DRIVE_TOKEN_URI`
5. `GOOGLE_DRIVE_SCOPE`
6. `GOOGLE_DRIVE_FOLDER_ID`
7. `GOOGLE_DRIVE_FOLDER_NAME`

### MongoDB Sources

1. `USER_SERVICE_MONGO_URI`
2. `TASK_SERVICE_MONGO_URI`
3. `REMINDER_SERVICE_MONGO_URI`
4. `NOTIFICATION_SERVICE_MONGO_URI`
5. `AI_SERVICE_MONGO_URI`
6. `ANALYTICS_SERVICE_MONGO_URI`

## Tools Used

The implementation uses:

1. Node.js `fetch` for Google REST calls.
2. Node.js `crypto` for Google service account JWT signing.
3. Mongoose connections for reading each service database.
4. Express for sync control endpoints.

No extra Google client library is required in the current implementation.
