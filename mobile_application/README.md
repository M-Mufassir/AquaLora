# AquaLora Mobile – Quick Start Guide

## Overview
This repository now contains a **minimal mobile client** (React Native using Expo) that authenticates against the existing AquaLora backend.  The authentication logic re‑uses the SQLite database created by the desktop application, so the default admin credentials are:

```
Username: Admin
Password: Admin123
```

The setup consists of three parts:

1. **`mobile_app/`** – React Native (Expo) UI with a login screen.
2. **`mobile_auth_server/`** – a tiny Express server that reads the same SQLite DB and implements `POST /auth/login`.
3. **Desktop application** – unchanged; it already creates the SQLite DB and admin user on first run.

## Prerequisites
- Node.js **≥ 20** (download from https://nodejs.org)
- **Yarn** or **npm** (the commands below use npm)
- **Expo CLI** (global install): `npm install -g expo-cli`
- A recent version of **Android Studio** (for Android emulator) **or** the Expo Go app on a physical device (iOS or Android).
- The **desktop application** must have been started at least once so that the `aqualora.db` file exists in the user‑data directory.

## Folder structure
```
desktop_application/
│   ... (existing desktop code)
│
├─ mobile_app/               # Expo project (mobile UI)
│   ├─ package.json
│   ├─ app.json
│   ├─ src/
│   │   ├─ App.tsx
│   │   ├─ navigation/index.tsx
│   │   └─ screens/LoginScreen.tsx
│   └─ README.md   <-- you are reading this!
│
└─ mobile_auth_server/       # Tiny Express auth service
    ├─ package.json
    └─ src/
        └─ db.ts
        └─ server.js
```

## Setup & Run
### 1. Install dependencies for the auth server
```bash
cd desktop_application/mobile_auth_server
npm install
```
### 2. Start the auth server
```bash
npm start
# The server will listen on http://localhost:3001
```
You should see a log line like:
```
[auth] Server listening on http://localhost:3001
```
### 3. Install dependencies for the mobile app
```bash
cd ../mobile_app
npm install
```
### 4. Run the mobile app with Expo
```bash
npm run start   # opens the Expo dev tools in a browser
```
- On the Expo dev tools page click **Run on Android device/emulator** (or iOS) to launch the app.
- If you are using a physical device, scan the QR code with the **Expo Go** app.

### 5. Test the login flow
1. The app starts on the **Login** screen.
2. Enter the admin credentials (Admin / Admin123) and press **Login**.
3. On success, you are navigated to a placeholder Home screen.
4. Wrong credentials show an alert “Login failed”.

## Adding more users
The desktop application already contains a **Users** screen where you can create new accounts. Those accounts are stored in the same SQLite DB, so the mobile app will automatically recognise them once the auth server is restarted.

## Troubleshooting
- **CORS errors** – the auth server enables CORS for all origins. If you run the server on a different host/IP, update the URL in `LoginScreen.tsx`.
- **Android emulator cannot reach localhost** – use `10.0.2.2` instead of `localhost` in the Axios URL, or run the app on a physical device with the same network.
- **Database not found** – make sure the desktop app has been launched at least once. The DB lives in `%APPDATA%\AquaLora\aqualora.db` on Windows.
- **Port already in use** – change the `PORT` variable in `mobile_auth_server/.env` and update the URL in the mobile code accordingly.

## Next steps (beyond login)
- Persist authentication state (e.g., using SecureStore).
- Fetch node‑list and readings via additional endpoints on the auth server.
- Implement real‑time updates using WebSockets.
- Add proper navigation and UI components for Home, Nodes, Settings, etc.

---
*Happy coding! If you run into any issues, feel free to ask for further assistance.*
