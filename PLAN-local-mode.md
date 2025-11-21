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

### Key Requirements (from team review)

1. **Network Isolation** - Zero server calls in local mode
   - Gate Auth0, gRPC, sync, auto-updater, telemetry, feature flags, remote config behind mode check
   - Permitted network targets: `api.groq.com` (transcription), `github.com/releases` (manual update check only)
   - Implementation: Add mode guard at each network call site + CI test that monitors outbound requests
   - *Note: A strict network allowlist is fragile; prefer explicit guards + monitoring over blanket blocking*

2. **Distribution** - First-launch experience must work without config files
   - Packaged installers drop users into setup wizard
   - Optional: `ITO_MODE=local` env/CLI flag for enterprise pre-configuration (Phase 7+, not blocking)

3. **API Key Security** - Defense in depth
   - Primary: Electron `safeStorage` (OS keychain)
   - Fallback: If keychain unavailable, warn user clearly, use AES encryption with machine-derived key
   - Never: Log the key, include in exports/backups, send to any server
   - Validation: Lightweight Groq ping before completing setup

4. **Data Boundaries** - Clean separation between modes
   - Local data root: `%APPDATA%/ito/` (Win) / `~/Library/Application Support/ito/` (Mac)
   - Local user ID: `local-{uuid}` prefix to prevent collision with cloud user IDs
   - Audio retention: Default 30 days, configurable, with manual cleanup option
   - If user switches modes later: Data does NOT auto-migrate (explicit export/import required)

5. **Export/Import** - Robust backup for local users
   - Format: JSON manifest + optional zipped audio folder
   - Excludes: API keys, tokens, any secrets
   - Includes: Version info for forward compatibility
   - UI: Progress indicator, disk space check, default to Documents folder

6. **Testing** - Automated verification
   - Network monitor test: CI job that runs local mode and fails if unexpected hosts are contacted
   - Setup wizard e2e: Both cloud and local paths
   - safeStorage fallback: Test on systems without keychain

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

- [ ] Create provider abstraction layer
  - `lib/clients/providers/types.ts` - Provider interface definitions
  - `lib/clients/providers/TranscriptionProvider.ts` - ASR provider interface
  - `lib/clients/providers/LLMProvider.ts` - Smart generation provider interface

- [ ] Implement Groq transcription provider
  - `lib/clients/providers/groq/GroqTranscriptionProvider.ts`
  - Implement direct Groq Whisper API calls
  - Handle audio format conversion (match server's WAV formatting)
  - Support all transcription options (model, prompt, temperature)
  - Add request timeout/cancellation + retry/backoff for rate limits

- [ ] Create generic OpenAI-compatible provider
  - `lib/clients/providers/openai/OpenAICompatibleProvider.ts`
  - Works with any OpenAI-compatible endpoint (OpenAI, Local Whisper, vLLM, etc.)
  - Configurable base URL, model, auth header

- [ ] Create `lib/clients/localTranscriptionService.ts`
  - Abstract over local vs cloud transcription
  - Same interface as gRPC client for transcription
  - Route based on app mode
  - Load provider config from store and instantiate correct provider
  - Mirror server error shape/codes so the UI behaves identically

- [ ] Add API key storage
  - Store encrypted in Electron store
  - Add getter/setter in `lib/main/store.ts`
  - Never log or expose the key
  - Handle `safeStorage` unavailable case with a warned fallback and re-prompt flow
  - Add a lightweight 'validate key' helper the setup UI can call before proceeding

#### Files to Create/Modify

```
lib/
├── clients/
│   ├── providers/
│   │   ├── types.ts                    # NEW - Provider interfaces
│   │   ├── TranscriptionProvider.ts    # NEW - ASR provider interface
│   │   ├── LLMProvider.ts              # NEW - LLM provider interface
│   │   ├── groq/
│   │   │   └── GroqTranscriptionProvider.ts  # NEW - Groq implementation
│   │   └── openai/
│   │       └── OpenAICompatibleProvider.ts   # NEW - Generic OpenAI-compatible
│   ├── localTranscriptionService.ts    # NEW - Local transcription orchestration
│   └── grpcClient.ts                   # MODIFY - Add mode check
├── main/
│   └── store.ts                        # MODIFY - Add provider config storage
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

**safeStorage Fallback Strategy:**
- Check `safeStorage.isEncryptionAvailable()` before use
- If unavailable: Show one-time warning dialog explaining reduced security
- Fallback encryption: AES-256-GCM with key derived from `node-machine-id` + app-specific salt
- Store a `keyStorageMethod: 'keychain' | 'fallback'` flag to show security indicator in Settings
- Never include the key in exports/backups regardless of storage method

---

### Phase 2: Mode Selection UI

**Goal**: Add first-launch mode selection and local setup screens.

#### Tasks

- [ ] Create mode selection screen component
  - `app/components/setup/ModeSelection.tsx`
  - Two clear options: Local vs Cloud
  - Persist choice to Electron store

- [ ] Create provider setup screen
  - `app/components/setup/ProviderSetup.tsx`
  - Provider dropdown (Groq, OpenAI, Local Whisper, Custom)
  - Auto-fill endpoint when provider selected
  - API key input with validation
  - Custom endpoint field (shown when "Custom" selected)
  - Test connection button (ping the endpoint, surface rate-limit/invalid-key states)
  - Link to provider's console for getting API keys

- [ ] Create setup flow container
  - `app/components/setup/SetupWizard.tsx`
  - Step 1: Mode selection (Local vs Cloud)
  - Step 2a (local): Transcription provider setup (required)
  - Step 2b (local, optional): Smart generation provider setup (can skip)
  - Step 2c (cloud): Existing auth flow

- [ ] Modify app entry point
  - Check for `appMode` in store
  - Route to setup wizard if not set
  - Route to main app if configured
  - Do not start Auth0, sync, gRPC, auto-updater, or feature-flag fetches until mode + (if local) key is confirmed

- [ ] Add a 'Reset to Setup Wizard' option in Settings (behind Advanced toggle)
  - Clears `appMode` flag, returns user to mode selection on next launch
  - Does NOT delete any data (local SQLite, audio files remain intact)
  - Shows warning: "Your existing data will remain on this device. If switching to Cloud Mode, use Export first to preserve your data."
  - Primary use case: QA testing, support troubleshooting, user changing their mind

#### Files to Create/Modify

```
app/
├── components/
│   └── setup/
│       ├── ModeSelection.tsx      # NEW - Local vs Cloud choice
│       ├── ProviderSetup.tsx      # NEW - Provider config (reusable for ASR & LLM)
│       ├── SetupWizard.tsx        # NEW - Multi-step flow container
│       └── SetupComplete.tsx      # NEW - Success screen with quick tips
├── App.tsx                        # MODIFY - Add setup routing
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
| Telemetry / crash reporting / feature flags | Main process + renderer | Disable entirely |
| Auto-update checks | Main process | No background checks; show "Check for updates" button in Settings |

#### Features to Show Differently

| Feature | Cloud Mode | Local Mode |
|---------|------------|------------|
| API Key settings | Hidden | Show in Settings |
| Data location | "Synced to cloud" | "Stored locally at: [path]" |
| Export data | Optional | Prominent (only backup option) |
| App updates | Auto-check & background download | Manual "Check for updates" button; links to GitHub releases |

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
- [ ] Disable in local mode:
  - Auto-updater background checks (keep manual check button)
  - Telemetry/crash reporting (Sentry, PostHog)
  - Remote config/feature flags
  - Any analytics endpoints

- [ ] Audit and guard all network call sites:
  - Add `if (isLocalMode()) return;` guards to each cloud-dependent module
  - Document permitted hosts: `api.groq.com`, `github.com` (manual update check only)
  - Do NOT implement strict network blocking (fragile); rely on explicit guards + CI testing

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
  - Never import/export API keys; keep secrets out by design

- [ ] Add UI for export/import
  - Settings > Data > Export All Data
  - Settings > Data > Import Data
  - Show last export date as reminder
  - Allow including/excluding audio (if included, bundle as .zip)
  - Surface data location and available disk space before exporting

- [ ] Add audio retention settings (Settings > Data)
  - "Keep audio recordings for: [7 days / 30 days / 90 days / Forever]" (default: 30 days)
  - "Delete all audio now" button with confirmation
  - Show current audio storage size
  - Background cleanup job runs on app startup

#### Export Format

```json
{
  "version": "1.0",
  "exportedAt": "2024-01-15T10:30:00Z",
  "appVersion": "1.2.3",
  "mode": "local",
  "includesAudio": true,
  "dataPath": "C:/Users/.../AppData/Roaming/ito",
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
- [ ] Automated 'no unexpected network hosts' test in local mode (allowlist Groq only)
- [ ] SafeStorage unavailable fallback test
- [ ] First-launch/setup wizard e2e (cloud + local)
- [ ] Confirm auto-updater/telemetry do not start in local mode

---

## Packaging & Distribution

### Installer Behavior

- [ ] Packaged installers (Win/Mac) surface setup wizard on first launch
  - No pre-configuration required; wizard handles everything
  - Works identically whether downloaded from website or GitHub releases

### Build Variants (Future - Phase 7+)

- [ ] Consider separate "ITO Local" build that:
  - Excludes Auth0 client ID and cloud endpoints from bundle
  - Pre-selects local mode (skips mode selection screen)
  - Smaller bundle size (no cloud-related dependencies)
  - Published to GitHub releases alongside standard build

### Documentation

- [ ] Update README with:
  - Local Mode quick start (download → get Groq key → run)
  - Data location paths per platform
  - Backup guidance (export feature)
  - Troubleshooting common issues (API key invalid, rate limits)

- [ ] Add in-app help:
  - "Where is my data stored?" link in Settings > Data
  - "How do I back up my data?" tooltip near Export button
  - First-run tooltip explaining the mode choice

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

### Decided

1. **Should local mode be the default?**
   - **Decision: No** - Present both options equally on first launch
   - Rationale: Let users make an informed choice; don't bias toward either mode

2. **How should auto-updates behave in local mode?**
   - **Decision: Manual only** - No background checks; "Check for updates" button in Settings links to GitHub releases
   - Rationale: Respects local mode's "minimal network" promise while still allowing updates

3. **How to handle local mode in analytics?**
   - **Decision: None** - No telemetry, no crash reporting, no analytics in local mode
   - Rationale: Clean privacy story; users choosing local mode expect no data collection

4. **Should we support multiple transcription providers in local mode?**
   - **Decision: Yes** - Support configurable providers for both transcription AND smart generation
   - Design: Separate configuration for each capability:
     - **Transcription (ASR)**: Groq Whisper, OpenAI Whisper, local Whisper, or any OpenAI-compatible endpoint
     - **Smart Generation (LLM)**: Claude, Gemini, GPT-4, Groq, or any OpenAI-compatible endpoint
   - Each provider gets: Base URL + API Key + Model selection
   - See "Multi-Provider Architecture" section below for details

5. **Should local mode be free forever or have limitations?**
   - **Decision: Yes, free forever**
   - Rationale: It's open source - there's no stopping it anyway, and this builds community goodwill
   - Users bring their own API keys; ITO is just the UX wrapper

### Deferred

6. **Build-time flag for enterprise deployments (`ITO_MODE=local`)?**
   - **Decision: Deferred** - Not a priority for initial release
   - Can revisit if enterprise demand emerges

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

## Multi-Provider Architecture

Local mode supports **two independent provider configurations**:

### 1. Transcription Provider (ASR)
Converts speech to text. Any OpenAI Whisper-compatible API.

### 2. Smart Generation Provider (LLM)
Enhances/transforms transcripts. Any OpenAI-compatible chat API.

### Settings UI Design

```
Settings > Transcription
├── Transcription Service (ASR)
│   ├── Provider: [Groq / OpenAI / Local Whisper / Custom]
│   ├── API Endpoint: [https://api.groq.com/openai/v1] (editable for Custom)
│   ├── API Key: [••••••••••••] [Edit]
│   ├── Model: [whisper-large-v3 ▼]
│   └── [Test Connection]
│
├── Smart Generation (LLM) — Optional
│   ├── Enable: [✓]
│   ├── Provider: [Claude / OpenAI / Gemini / Groq / Custom]
│   ├── API Endpoint: [https://api.anthropic.com/v1] (editable for Custom)
│   ├── API Key: [••••••••••••] [Edit]
│   ├── Model: [claude-sonnet-4-20250514 ▼]
│   └── [Test Connection]
```

### Provider Presets

| Provider | Type | Default Endpoint | Auth Header |
|----------|------|------------------|-------------|
| Groq | ASR | `https://api.groq.com/openai/v1` | `Bearer` |
| OpenAI | ASR/LLM | `https://api.openai.com/v1` | `Bearer` |
| Local Whisper | ASR | `http://localhost:8080/v1` | None |
| Claude | LLM | `https://api.anthropic.com/v1` | `x-api-key` |
| Gemini | LLM | `https://generativelanguage.googleapis.com/v1beta` | `Bearer` |
| Custom | Any | User-defined | User-defined |

### Data Model

```typescript
// lib/main/store.ts

interface ProviderConfig {
  provider: 'groq' | 'openai' | 'local' | 'claude' | 'gemini' | 'custom';
  endpoint: string;
  apiKey: string;  // Stored encrypted via safeStorage
  model: string;
  authHeader?: 'bearer' | 'x-api-key';  // For custom providers
}

interface LocalModeSettings {
  transcription: ProviderConfig;
  smartGeneration: {
    enabled: boolean;
    config: ProviderConfig;
  };
}
```

### Implementation Notes

1. **Transcription is required** - User must configure ASR to use local mode
2. **Smart generation is optional** - Can be disabled; transcription-only mode
3. **Separate API keys** - Each provider has its own key (user may use same key for both if using same provider)
4. **Custom endpoints** - Enables self-hosted models (Ollama, vLLM, LocalAI, etc.)
5. **Auth flexibility** - Support both `Authorization: Bearer` and `x-api-key` header styles

### Phase 1 Scope

For initial release, implement:
- [x] Groq ASR (already planned)
- [ ] Provider abstraction interface
- [ ] Settings UI for provider selection
- [ ] "Custom" option with endpoint/key fields

### Phase 2+ Scope

- [ ] Add preset configurations for common providers
- [ ] Local Whisper detection (check if localhost:8080 is running)
- [ ] Smart generation integration
- [ ] Provider-specific model dropdowns (fetch available models from API)

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
| 2025-11-21 | Claude | Initial draft |
| 2025-11-21 | Team | Added: network isolation requirements, safeStorage fallback, distribution considerations, testing expansion, auto-updater behavior |
| 2025-11-21 | Claude | Refined: Key Requirements section, safeStorage fallback strategy (AES-256-GCM), network guarding approach (explicit guards vs allowlist), audio retention settings, open questions (marked decisions), packaging/distribution details |
| 2025-11-21 | User + Claude | Decisions: Multi-provider support (separate ASR + LLM configs), free forever, enterprise flag deferred. Added Multi-Provider Architecture section with provider abstraction, settings UI design, and data model. Updated Phase 1 & 2 tasks for provider system. |
