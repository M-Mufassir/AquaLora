# AquaLoRa Mobile Application

The **AquaLoRa Mobile App** is a cross-platform React Native / Expo application that connects to the multi-tenant AquaLoRa cloud backend. It provides aquaculture farm owners and managers with remote telemetry monitoring, threshold alerts, and facility profile management.

---

## 1. Features

- **Multi-Tenant Master Node Authentication**: Select facility Master Node from a dynamically fetched cloud directory or enter custom node code with encrypted password login.
- **Persistent Secure Session**: Uses `expo-secure-store` to keep sessions safely encrypted at rest.
- **Real-Time Live Dashboard**: Displays water quality gauges (Temperature, Turbidity, TDS, pH), Fish Health Index (FHI), and connection metrics scoped to the active facility.
- **Historical Trends & Analytics**: Time-filtered charts and telemetry logs.
- **Threshold Alerts**: Instant viewing of warning and critical pond quality alerts.
- **Facility Profile Manager**: View and edit pond metadata (farm name, contact person, phone, site location, species) and change Master Node password.

---

## 2. Setup & Execution

### Prerequisites
- Node.js ≥ 20
- Expo CLI: `npm install -g expo-cli`
- Physical device with Expo Go **OR** Android Studio / iOS Simulator
- Backend API running (locally or on Railway)

### Installation
```bash
cd mobile_application
npm install
```

### Configuration
Edit `src/config.ts` if needed:
```typescript
export const API_BASE_URL = 'http://localhost:8000'; // Or your Railway production endpoint
```
*(For Android emulator accessing host localhost, use `http://10.0.2.2:8000`)*

### Start App
```bash
npm run start
```
- Press `a` for Android emulator, `i` for iOS simulator, or scan the QR code with Expo Go.

---

## 3. Project Structure

```
src/
├── components/          # Reusable UI components (Button, Modal, Card, etc.)
├── config.ts            # API base URL configuration
├── context/
│   └── AuthContext.tsx  # Multi-tenant auth state & session provider
├── navigation/
│   └── index.tsx        # Bottom tab & stack navigators
├── screens/
│   ├── LoginScreen.tsx               # Master Node picker & login
│   ├── DashboardScreen.tsx           # Real-time pond gauges & FHI
│   ├── HistoryScreen.tsx             # Telemetry charts & history
│   ├── AlertsScreen.tsx              # System alerts & warnings
│   ├── MasterNodeProfileScreen.tsx   # Facility metadata & password change
│   └── SettingsScreen.tsx            # Connection tests & account sign-out
├── services/
│   ├── apiService.ts    # Axios client with bearer token interceptor
│   ├── authService.ts   # Multi-tenant login, directory & profile APIs
│   └── cacheService.ts  # Local caching helper
└── theme/               # Color palette, spacing, typography & shadows
```
