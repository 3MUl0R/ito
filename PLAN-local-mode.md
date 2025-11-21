# ITO Local Mode Implementation Plan

## Overview

This document outlines the plan to add a **Local Mode** to ITO, enabling users to run the application as a fully standalone desktop app without requiring the server infrastructure (Docker, PostgreSQL, MinIO).

### Goals

1. **Zero server dependency** - App works out of the box with just the executable
2. **User-provided API key** - Users bring their own Groq API key for transcription
3. **All data stays local** - SQLite only, no cloud sync
4. **Simplified setup** - No Docker, no database migrations, no environment files
5. **Feature parity for core functionality** - Voice transcription works identically

### Non-Goals (for initial release)

- Multi-device sync in local mode
- Cloud backup
- Subscription/billing features
- Usage analytics

---

## User Experience

### First Launch Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Welcome to ITO                           │
│                                                             │
│  How would you like to use ITO?                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🏠 Local Mode                                       │   │
│  │  Everything stays on your computer.                 │   │
│  │  You provide your own Groq API key.                 │   │
│  │  No account required.                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ☁️  Cloud Mode                                      │   │
│  │  Sync across devices. Cloud backup.                 │   │
│  │  Requires ITO account.                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Local Mode Setup (Step 2)

```
┌─────────────────────────────────────────────────────────────┐
│                    Local Mode Setup                         │
│                                                             │
│  To transcribe speech, ITO needs a Groq API key.           │
│                                                             │
│  1. Visit console.groq.com                                 │
│  2. Create a free account                                  │
│  3. Generate an API key                                    │
│  4. Paste it below                                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Get API Key →]                    [Continue]             │
│                                                             │
│  ℹ️  Your API key is stored locally and never sent to us.  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Post-Setup

- User lands on main ITO interface
- Hotkeys work immediately
- Transcription uses their Groq API key directly
- All history saved to local SQLite

---

## Architecture Changes

### Current Architecture (Cloud Mode)

```
┌──────────────────┐         ┌──────────────────┐         ┌─────────────┐
│  Electron App    │  gRPC   │  ITO Server      │   API   │   Groq      │
│  ────────────    │ ──────► │  ───────────     │ ──────► │   Whisper   │
│  - UI            │         │  - Auth (Auth0)  │         └─────────────┘
│  - Native audio  │         │  - Transcribe    │
│  - SQLite cache  │         │  - PostgreSQL    │
│  - Hotkeys       │         │  - S3/MinIO      │
└──────────────────┘         └──────────────────┘
```

### New Architecture (Local Mode)

```
┌──────────────────────────────────────┐         ┌─────────────┐
│           Electron App               │   API   │   Groq      │
│  ─────────────────────────────────   │ ──────► │   Whisper   │
│  - UI                                │         └─────────────┘
│  - Native audio                      │
│  - SQLite (primary storage)          │
│  - Hotkeys                           │
│  - Direct Groq client (new)          │
│  - Local API key storage             │
└──────────────────────────────────────┘
```

### Mode Detection

```typescript
// Stored in Electron store on first launch
type AppMode = 'local' | 'cloud';

// Check on app startup
const appMode = store.get('appMode');

if (!appMode) {
  // First launch - show mode selection
  showModeSelectionScreen();
} else if (appMode === 'local') {
  // Skip auth, use local Groq client
  initializeLocalMode();
} else {
  // Existing cloud flow
  initializeCloudMode();
}
```

---

## Implementation Phases

### Phase 1: Local Groq Client

**Goal**: Create a client-side Groq transcription service that mirrors the server's functionality.

#### Tasks

- [ ] Create `lib/clients/localGroqClient.ts`
  - Implement direct Groq Whisper API calls
  - Handle audio format conversion (match server's WAV formatting)
  - Support all transcription options (model, prompt, temperature)

- [ ] Create `lib/clients/localTranscriptionService.ts`
  - Abstract over local vs cloud transcription
  - Same interface as gRPC client for transcription
  - Route based on app mode

- [ ] Add API key storage
  - Store encrypted in Electron store
  - Add getter/setter in `lib/main/store.ts`
  - Never log or expose the key

#### Files to Create/Modify

```
lib/
├── clients/
│   ├── localGroqClient.ts       # NEW - Direct Groq API calls
│   ├── localTranscriptionService.ts  # NEW - Local transcription orchestration
│   └── grpcClient.ts            # MODIFY - Add mode check
├── main/
│   └── store.ts                 # MODIFY - Add API key storage
```

#### API Key Security

```typescript
// lib/main/store.ts
import { safeStorage } from 'electron';

export function setGroqApiKey(key: string): void {
  const encrypted = safeStorage.encryptString(key);
  store.set('groqApiKey', encrypted.toString('base64'));
}

export function getGroqApiKey(): string | null {
  const encrypted = store.get('groqApiKey');
  if (!encrypted) return null;
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}
```

---

### Phase 2: Mode Selection UI

**Goal**: Add first-launch mode selection and local setup screens.

#### Tasks

- [ ] Create mode selection screen component
  - `app/components/setup/ModeSelection.tsx`
  - Two clear options: Local vs Cloud
  - Persist choice to Electron store

- [ ] Create API key setup screen
  - `app/components/setup/ApiKeySetup.tsx`
  - Input field with validation (check key format)
  - Link to Groq console
  - Test connection button

- [ ] Create setup flow container
  - `app/components/setup/SetupWizard.tsx`
  - Step 1: Mode selection
  - Step 2a (local): API key setup
  - Step 2b (cloud): Existing auth flow

- [ ] Modify app entry point
  - Check for `appMode` in store
  - Route to setup wizard if not set
  - Route to main app if configured

#### Files to Create/Modify

```
app/
├── components/
│   └── setup/
│       ├── ModeSelection.tsx    # NEW
│       ├── ApiKeySetup.tsx      # NEW
│       └── SetupWizard.tsx      # NEW
├── App.tsx                      # MODIFY - Add setup routing
```

---

### Phase 3: Conditional Feature Display

**Goal**: Hide cloud-only features when in local mode.

#### Features to Hide in Local Mode

| Feature | Location | Action |
|---------|----------|--------|
| Sign In / Sign Out | Settings | Hide entirely |
| Account section | Settings | Hide entirely |
| Subscription/billing | Settings | Hide entirely |
| Sync status indicator | UI chrome | Hide entirely |
| "Sync now" button | Various | Hide entirely |
| Cloud backup settings | Settings | Hide entirely |

#### Features to Show Differently

| Feature | Cloud Mode | Local Mode |
|---------|------------|------------|
| API Key settings | Hidden | Show in Settings |
| Data location | "Synced to cloud" | "Stored locally at: [path]" |
| Export data | Optional | Prominent (only backup option) |

#### Implementation

```typescript
// lib/hooks/useAppMode.ts
export function useAppMode() {
  const [mode, setMode] = useState<'local' | 'cloud' | null>(null);

  useEffect(() => {
    window.api.getAppMode().then(setMode);
  }, []);

  return {
    mode,
    isLocal: mode === 'local',
    isCloud: mode === 'cloud',
  };
}

// Usage in components
function SettingsPage() {
  const { isLocal } = useAppMode();

  return (
    <div>
      {isLocal && <ApiKeySection />}
      {!isLocal && <AccountSection />}
      {!isLocal && <SubscriptionSection />}
      <GeneralSettings />
    </div>
  );
}
```

#### Files to Modify

```
app/
├── components/
│   └── settings/
│       ├── Settings.tsx         # MODIFY - Conditional sections
│       ├── ApiKeySection.tsx    # NEW - Local mode only
├── hooks/
│   └── useAppMode.ts            # NEW
lib/
├── preload/
│   └── index.ts                 # MODIFY - Expose getAppMode
├── main/
│   └── ipcEvents.ts             # MODIFY - Add getAppMode handler
```

---

### Phase 4: Remove Server Dependency for Local Mode

**Goal**: Ensure local mode never attempts to contact the server.

#### Tasks

- [ ] Modify `grpcClient.ts` to check mode before any call
- [ ] Add local implementations for all required operations:
  - Transcription (Phase 1)
  - Notes CRUD (already in SQLite)
  - Dictionary CRUD (already in SQLite)
  - Settings (already in Electron store)

- [ ] Disable sync service in local mode
  - `lib/main/syncService.ts` - Early return if local mode

- [ ] Remove auth checks in local mode
  - Skip Auth0 initialization
  - Use a local pseudo-user ID for SQLite

#### Sync Service Modification

```typescript
// lib/main/syncService.ts
export async function startSyncService() {
  const appMode = store.get('appMode');

  if (appMode === 'local') {
    console.log('[SyncService] Local mode - sync disabled');
    return;
  }

  // Existing sync logic...
}
```

#### Local User ID

```typescript
// lib/main/store.ts
export function getLocalUserId(): string {
  let userId = store.get('localUserId');
  if (!userId) {
    userId = `local-${crypto.randomUUID()}`;
    store.set('localUserId', userId);
  }
  return userId;
}
```

---

### Phase 5: Data Export/Import

**Goal**: Since local mode has no cloud backup, provide robust export/import.

#### Tasks

- [ ] Create export function
  - Export all SQLite data to JSON
  - Include: notes, interactions, dictionary, settings
  - Optionally include audio files

- [ ] Create import function
  - Import from JSON export
  - Merge or replace options
  - Validate data integrity

- [ ] Add UI for export/import
  - Settings > Data > Export All Data
  - Settings > Data > Import Data
  - Show last export date as reminder

#### Export Format

```json
{
  "version": "1.0",
  "exportedAt": "2024-01-15T10:30:00Z",
  "appVersion": "1.2.3",
  "mode": "local",
  "data": {
    "notes": [...],
    "interactions": [...],
    "dictionary": [...],
    "settings": {...}
  }
}
```

---

### Phase 6: Testing & Polish

#### Tasks

- [ ] Test fresh install flow (local mode)
- [ ] Test fresh install flow (cloud mode)
- [ ] Test mode switching (if supported)
- [ ] Test transcription in local mode
- [ ] Test all CRUD operations in local mode
- [ ] Test export/import round-trip
- [ ] Test API key validation
- [ ] Test API key update
- [ ] Performance comparison (local vs cloud)
- [ ] Error handling for invalid API key
- [ ] Error handling for Groq rate limits
- [ ] Offline behavior in local mode

---

## UI/UX Considerations

### Naming Options

| Option | Pros | Cons |
|--------|------|------|
| **Local Mode** | Clear, simple | Might imply "inferior" |
| **Standalone Mode** | Emphasizes independence | Less common term |
| **Offline Mode** | Familiar concept | Misleading (still needs internet for Groq) |
| **Self-Hosted** | Accurate for technical users | Intimidating for others |
| **Personal Mode** | Friendly | Vague |
| **Private Mode** | Privacy-focused | Confused with browser private mode |

**Recommendation**: "Local Mode" with subtitle "Your data stays on your computer"

### Settings Organization (Local Mode)

```
Settings
├── General
│   ├── Hotkey configuration
│   ├── Audio input device
│   └── Language preferences
├── Transcription
│   ├── Groq API Key [Edit]
│   ├── Model selection
│   ├── Custom vocabulary
│   └── Advanced options
├── Data
│   ├── Storage location: C:\Users\...\ito
│   ├── Export all data
│   ├── Import data
│   └── Clear all data
└── About
    ├── Version
    ├── Mode: Local
    └── Switch to Cloud Mode [?]
```

### Mode Switching

**Question**: Should users be able to switch modes after initial setup?

| Option | Complexity | User Value |
|--------|------------|------------|
| No switching | Low | Low - stuck with choice |
| Local → Cloud | Medium | High - can "upgrade" |
| Cloud → Local | High | Medium - need data migration |
| Bidirectional | High | High - full flexibility |

**Recommendation**: Start with Local → Cloud only (Phase 7+)

---

## Technical Decisions

### Q1: Where to store the API key?

**Options**:
1. Electron Store (JSON file) - Simple but plaintext
2. Electron safeStorage - Encrypted with OS keychain
3. Environment variable - User manages

**Decision**: Use `safeStorage` for encryption, fall back to Electron Store on systems without keychain.

### Q2: How to handle Groq API errors?

**Scenarios**:
- Invalid API key → Show setup screen with error
- Rate limited → Show user-friendly message with retry
- Network error → Show offline indicator, queue for retry
- Insufficient credits → Link to Groq billing

### Q3: Local user ID strategy?

**Options**:
1. No user ID - Everything is "default user"
2. Random UUID on first launch - Consistent local identity
3. Derived from machine ID - Tied to hardware

**Decision**: Random UUID stored in Electron store. Simple, no PII, works for SQLite foreign keys.

### Q4: Audio storage in local mode?

**Current**: Server stores large audio in S3, reference in PostgreSQL

**Local Mode Options**:
1. Store all audio inline in SQLite (simple, can get large)
2. Store in app data folder, reference in SQLite (scalable)
3. Don't persist audio at all (privacy-focused)

**Decision**: Option 2 - Store in `%APPDATA%/ito/audio/` with SQLite references. Add setting to auto-delete after X days.

---

## Migration Path

### Existing Cloud Users → Local Mode

If we later support Cloud → Local switching:

1. Export all cloud data
2. Import into local SQLite
3. Clear cloud data (optional)
4. Switch mode flag

### Local Users → Cloud Mode

1. Create ITO account
2. Set up Auth0
3. Upload local data to server
4. Switch mode flag
5. Enable sync

---

## Open Questions

1. **Should local mode be the default?**
   - Pro: Simpler onboarding, privacy-first
   - Con: Less engagement with cloud features

2. **Should we support multiple Groq-like providers in local mode?**
   - OpenAI Whisper API
   - Local Whisper (fully offline)
   - Deepgram, AssemblyAI, etc.

3. **Should local mode be free forever or have limitations?**
   - Free: Better adoption, community goodwill
   - Limited: Incentive to upgrade to cloud

4. **How to handle local mode in analytics?**
   - No analytics at all?
   - Opt-in anonymous usage stats?
   - Local-only analytics dashboard?

---

## Success Metrics

1. **Setup completion rate** - % of users who complete local mode setup
2. **Time to first transcription** - Should be <2 minutes from download
3. **Retention in local mode** - 7-day, 30-day active users
4. **Conversion to cloud** - % who upgrade (if we want this)
5. **Support tickets** - Should be lower than cloud mode (simpler)

---

## Timeline Estimate

| Phase | Description | Complexity |
|-------|-------------|------------|
| Phase 1 | Local Groq Client | Medium |
| Phase 2 | Mode Selection UI | Medium |
| Phase 3 | Conditional Features | Low |
| Phase 4 | Remove Server Dependency | Medium |
| Phase 5 | Data Export/Import | Low |
| Phase 6 | Testing & Polish | Medium |

**Total**: Roughly a focused development effort

---

## Appendix: Groq API Reference

### Transcription Endpoint

```bash
POST https://api.groq.com/openai/v1/audio/transcriptions

Headers:
  Authorization: Bearer $GROQ_API_KEY
  Content-Type: multipart/form-data

Body:
  file: (audio file)
  model: "whisper-large-v3"
  response_format: "json"
  language: "en" (optional)
  prompt: "custom vocabulary" (optional)
```

### Response

```json
{
  "text": "The transcribed text appears here.",
  "x_groq": {
    "id": "req_xxx"
  }
}
```

### Rate Limits (Free Tier)

- 7,200 audio-seconds per day
- 20 requests per minute

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2024-XX-XX | - | Initial draft |
