# Resilience Fixes Implementation Plan

Comprehensive plan to implement 12 resilience improvements across 4 phases.

---

## Phase 1: Critical Infrastructure (Foundation)

This phase establishes the core reliability mechanisms that all other fixes depend on.

---

### 1.1 Python Process Crash Recovery

**Priority:** 🔴 Critical | **Effort:** Medium

#### [MODIFY] [useTelegramBridge.ts](file:///c:/Users/yaros/Downloads/telethon/src/hooks/useTelegramBridge.ts)

Add auto-restart logic with exponential backoff:

```diff
+ const MAX_RESTART_ATTEMPTS = 5;
+ const INITIAL_BACKOFF_MS = 1000;
+ const restartAttemptsRef = useRef(0);
+ const backoffRef = useRef(INITIAL_BACKOFF_MS);

+ const startPythonProcess = useCallback(() => {
+     const pythonScript = path.resolve(__dirname, '../../python/telegram_service.py');
+     const proc = spawn('python', [pythonScript], {
+         stdio: ['pipe', 'pipe', 'inherit'],
+         env: { ...process.env },
+         cwd: path.resolve(__dirname, '../..'),
+     });
+     // ... setup code ...
+     return proc;
+ }, []);

  proc.on('exit', (code) => {
-     if (code !== 0 && code !== null) {
-         console.error(`Python process exited with code ${code}`);
-     }
+     if (code !== 0 && code !== null) {
+         // Reject all pending requests immediately
+         pendingRef.current.forEach(({ reject }) => {
+             reject(new Error('Python process crashed'));
+         });
+         pendingRef.current.clear();
+         
+         // Notify user via callback
+         notificationCallbackRef.current?.({
+             type: 'error',
+             message: 'Backend disconnected, attempting reconnect...',
+         });
+         
+         // Attempt restart with backoff
+         if (restartAttemptsRef.current < MAX_RESTART_ATTEMPTS) {
+             restartAttemptsRef.current++;
+             setTimeout(() => {
+                 processRef.current = startPythonProcess();
+                 backoffRef.current = Math.min(backoffRef.current * 2, 30000);
+             }, backoffRef.current);
+         } else {
+             notificationCallbackRef.current?.({
+                 type: 'error',
+                 message: 'Failed to restart backend after 5 attempts',
+             });
+         }
+     }
  });
```

**Changes:**
- Extract process spawn into reusable function
- Add restart counter with max 5 attempts
- Implement exponential backoff (1s → 2s → 4s → 8s → 16s)
- Immediately reject all pending RPC calls on crash
- Notify user of disconnection and recovery attempts

---

### 1.2 Reduce RPC Timeout & Pending Cleanup

**Priority:** 🟠 High | **Effort:** Low

#### [MODIFY] [useTelegramBridge.ts](file:///c:/Users/yaros/Downloads/telethon/src/hooks/useTelegramBridge.ts)

```diff
- // Timeout after 60 seconds
- setTimeout(() => {
+ // Timeout after 15 seconds
+ const timeoutId = setTimeout(() => {
      if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          reject(new Error('Request timeout'));
      }
- }, 60000);
+ }, 15000);
+
+ // Store timeout for cleanup
+ pendingRef.current.set(id, { resolve, reject, timeoutId });
```

Also add cleanup function:

```typescript
const rejectAllPending = (error: string) => {
    pendingRef.current.forEach(({ reject, timeoutId }) => {
        clearTimeout(timeoutId);
        reject(new Error(error));
    });
    pendingRef.current.clear();
};
```

**Changes:**
- Reduce timeout from 60s to 15s
- Store timeout ID to allow cleanup
- Add function to reject all pending on process exit

---

### 1.3 Add Health Check/Heartbeat

**Priority:** 🟢 Low | **Effort:** Low

#### [MODIFY] [App.tsx](file:///c:/Users/yaros/Downloads/telethon/src/components/App.tsx)

Add periodic ping in [AccountManager](file:///c:/Users/yaros/Downloads/telethon/src/components/App.tsx#210-514):

```typescript
// Health check ping every 30 seconds
useEffect(() => {
    const pingInterval = setInterval(async () => {
        try {
            await bridge.ping();
            // Reset any "disconnected" state if needed
        } catch (e) {
            addLog('Backend health check failed');
        }
    }, 30000);
    
    return () => clearInterval(pingInterval);
}, [bridge]);
```

**Changes:**
- Add 30-second interval for ping
- Log failures to activity panel
- Cleanup on unmount

---

## Phase 2: Connection Resilience

This phase ensures connections are automatically restored when they fail.

---

### 2.1 Telegram Client Reconnection Logic

**Priority:** 🔴 Critical | **Effort:** Medium

#### [MODIFY] [service.py](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/service.py)

Add reconnection handler:

```python
async def connect_with_session(self, account_id: str, session_string: str) -> dict:
    client = TelegramClient(StringSession(session_string), self.api_id, self.api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        return {"success": False, "error": "Session expired"}

    me = await client.get_me()
    self.clients[account_id] = client
    
    # Store session for reconnection
    self._session_strings[account_id] = session_string

    # Register disconnect handler
    @client.on(events.Disconnected)
    async def on_disconnect():
        self._write_notification({
            "type": "log",
            "message": f"Disconnected {account_id[:8]}, reconnecting...",
        })
        await self._reconnect_client(account_id)

    # ... rest of method
```

Add reconnection method:

```python
async def _reconnect_client(self, account_id: str, max_attempts: int = 5) -> None:
    session_string = self._session_strings.get(account_id)
    if not session_string:
        return
    
    for attempt in range(max_attempts):
        try:
            await asyncio.sleep(2 ** attempt)  # Exponential backoff
            client = self.clients.get(account_id)
            if client and not client.is_connected():
                await client.connect()
                if await client.is_user_authorized():
                    self._write_notification({
                        "type": "log",
                        "message": f"Reconnected {account_id[:8]}",
                    })
                    return
        except Exception as e:
            self._write_notification({
                "type": "error",
                "message": f"Reconnect attempt {attempt + 1} failed: {str(e)[:30]}",
            })
    
    self._write_notification({
        "type": "error",
        "message": f"Failed to reconnect {account_id[:8]} after {max_attempts} attempts",
    })
```

**Changes:**
- Add `_session_strings` dict to store sessions
- Register disconnect event handler
- Implement `_reconnect_client` with exponential backoff
- Notify user of reconnection status

---

### 2.2 HTTP Retry with Backoff

**Priority:** 🟡 Medium | **Effort:** Low

#### [MODIFY] [convex_sync.py](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/convex_sync.py)

Add retry logic:

```python
async def sync_message(*, convex_url: str, http_client, notify, **kwargs) -> None:
    if not convex_url:
        return

    max_retries = 3
    for attempt in range(max_retries):
        try:
            resp = await http_client.post(
                f"{convex_url}/api/mutation",
                json={...},
            )
            
            if resp.status_code == 200:
                # Success handling
                return
            elif resp.status_code >= 500:
                # Server error, retry
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
            
            # Client error or final attempt, notify
            notify({"type": "error", "message": f"Convex error: {resp.status_code}"})
            return
            
        except httpx.TimeoutException:
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)
                continue
            notify({"type": "error", "message": "Convex timeout after retries"})
```

**Changes:**
- Add 3 retry attempts for server errors (5xx)
- Add retry for timeout exceptions
- Use exponential backoff between retries

---

### 2.3 Background Task Lifecycle Fix

**Priority:** 🟡 Medium | **Effort:** Low

#### [MODIFY] [service.py](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/service.py)

In [disconnect](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/service.py#276-285) method, ensure task cleanup:

```diff
  async def disconnect(self, account_id: str) -> dict:
      client = self.clients.pop(account_id, None)
      if client:
          task = self._account_settings_refresh_tasks.pop(account_id, None)
          if task is not None:
              task.cancel()
+             try:
+                 await task
+             except asyncio.CancelledError:
+                 pass
          await client.disconnect()
+         # Clean up session string
+         self._session_strings.pop(account_id, None)
          return {"success": True}
      return {"success": False, "error": "Client not found"}
```

Also add termination flag to refresh loop:

```python
async def _run() -> None:
    while account_id in self.clients:  # Check if still connected
        await self._refresh_account_settings(account_id)
        await asyncio.sleep(30)
```

**Changes:**
- Await cancelled tasks to ensure cleanup
- Add loop termination condition
- Clean up session strings on disconnect

---

## Phase 3: Data Integrity

This phase ensures data is not lost and operations are safe.

---

### 3.1 Convex Null Safety Guards

**Priority:** 🟠 High | **Effort:** Low

#### [MODIFY] [App.tsx](file:///c:/Users/yaros/Downloads/telethon/src/components/App.tsx)

Add guards before Convex operations:

```diff
  const loadAccounts = async () => {
-     if (!convex) return;
+     if (!convex) {
+         setError('Database not connected. Check CONVEX_URL.');
+         setLoading(false);
+         return;
+     }
      setLoading(true);
      try {
```

```diff
  const toggleSaveMessages = async () => {
-     if (!convex || accounts.length === 0) return;
+     if (!convex) {
+         setError('Database not connected');
+         return;
+     }
+     if (accounts.length === 0) return;
```

#### [MODIFY] [LoginScreen.tsx](file:///c:/Users/yaros/Downloads/telethon/src/components/LoginScreen.tsx)

```diff
  const handlePhoneSubmit = useCallback(async () => {
+     if (!convex) {
+         onError('Database not connected. Cannot create account.');
+         return;
+     }
      if (!phone || phone.length < 10) {
```

**Changes:**
- Add explicit null checks with user-facing error messages
- Show specific error when Convex unavailable
- Prevent silent failures

---

### 3.2 Persistent Sync Queue

**Priority:** 🟠 High | **Effort:** High

#### [NEW] [python/tg_service/persistent_queue.py](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/persistent_queue.py)

Create disk-backed fallback queue:

```python
import json
import os
from pathlib import Path
from typing import Optional
import asyncio


class PersistentQueue:
    """Fallback queue that writes to disk when in-memory queue is full."""
    
    def __init__(self, queue_dir: str = ".queue"):
        self.queue_dir = Path(queue_dir)
        self.queue_dir.mkdir(exist_ok=True)
        self._counter = 0
    
    def write(self, item: dict) -> str:
        """Write item to disk, return filename."""
        self._counter += 1
        filename = f"{int(time.time())}_{self._counter}.json"
        filepath = self.queue_dir / filename
        with open(filepath, 'w') as f:
            json.dump(item, f)
        return filename
    
    def read_all(self) -> list[tuple[str, dict]]:
        """Read all queued items, return list of (filename, item) tuples."""
        items = []
        for filepath in sorted(self.queue_dir.glob("*.json")):
            try:
                with open(filepath) as f:
                    items.append((filepath.name, json.load(f)))
            except Exception:
                pass
        return items
    
    def delete(self, filename: str) -> None:
        """Delete processed item."""
        filepath = self.queue_dir / filename
        if filepath.exists():
            filepath.unlink()
```

#### [MODIFY] [service.py](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/service.py)

Integrate persistent queue:

```python
from .persistent_queue import PersistentQueue

class TelegramService:
    def __init__(self, ...):
        ...
        self._persistent_queue = PersistentQueue()
    
    def enqueue_sync_message(self, payload: dict) -> bool:
        self.ensure_sync_workers()
        if self._sync_queue is None:
            return False
        try:
            self._sync_queue.put_nowait(payload)
            return True
        except asyncio.QueueFull:
            # Fallback to persistent queue
            self._persistent_queue.write(payload)
            self._write_notification({
                "type": "log",
                "message": "Queue full, buffering to disk",
            })
            return True
```

**Changes:**
- Create `PersistentQueue` class for disk-based fallback
- Write to disk when in-memory queue full
- Add worker to process disk queue when memory frees up

---

### 3.3 Settings Cache Improvements

**Priority:** 🟡 Medium | **Effort:** Low

#### [MODIFY] [service.py](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/service.py)

Add immediate refresh on connect and pessimistic defaults:

```diff
  async def connect_with_session(self, account_id: str, session_string: str) -> dict:
      client = TelegramClient(...)
      await client.connect()
      ...
      
-     await self._refresh_account_settings(account_id)
+     # Critical: Wait for settings before accepting messages
+     settings_loaded = await self._refresh_account_settings_sync(account_id)
+     if not settings_loaded:
+         self._write_notification({
+             "type": "log",
+             "message": f"Using default settings for {account_id[:8]}",
+         })
```

Add sync version of settings refresh:

```python
async def _refresh_account_settings_sync(self, account_id: str) -> bool:
    """Refresh settings synchronously, return True if successful."""
    try:
        resp = await self.http_client.post(
            f"{self.convex_url}/api/query",
            json={"path": "accounts:get", "args": {"accountId": account_id}},
        )
        if resp.status_code == 200:
            body = resp.json()
            if isinstance(body, dict) and body.get("status") == "success":
                self._account_settings[account_id] = body.get("value", {})
                return True
        return False
    except Exception:
        return False
```

**Changes:**
- Wait for settings before processing messages
- Return success/failure from settings refresh
- Notify user when using defaults

---

## Phase 4: User Experience & Recovery

This phase improves user experience during failures and recovery.

---

### 4.1 Persist Login State

**Priority:** 🟡 Medium | **Effort:** Medium

#### [MODIFY] [LoginScreen.tsx](file:///c:/Users/yaros/Downloads/telethon/src/components/LoginScreen.tsx)

Add state persistence using filesystem:

```typescript
import fs from 'fs';
import path from 'path';

const LOGIN_STATE_FILE = path.join(process.cwd(), '.login_state.json');

interface PersistedLoginState {
    phone: string;
    accountId: string;
    phoneCodeHash: string;
    step: 'code' | '2fa';
    timestamp: number;
}

function saveLoginState(state: PersistedLoginState) {
    fs.writeFileSync(LOGIN_STATE_FILE, JSON.stringify(state));
}

function loadLoginState(): PersistedLoginState | null {
    try {
        if (fs.existsSync(LOGIN_STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(LOGIN_STATE_FILE, 'utf-8'));
            // Expire after 5 minutes
            if (Date.now() - data.timestamp < 5 * 60 * 1000) {
                return data;
            }
            fs.unlinkSync(LOGIN_STATE_FILE);
        }
    } catch {}
    return null;
}

function clearLoginState() {
    try { fs.unlinkSync(LOGIN_STATE_FILE); } catch {}
}
```

Use in component:

```typescript
useEffect(() => {
    const saved = loadLoginState();
    if (saved) {
        setPhone(saved.phone);
        setAccountId(saved.accountId);
        setPhoneCodeHash(saved.phoneCodeHash);
        setStep(saved.step);
    }
}, []);

// After receiving code:
saveLoginState({ phone, accountId, phoneCodeHash, step: 'code', timestamp: Date.now() });

// On success:
clearLoginState();
```

**Changes:**
- Save login state to disk after phone verification
- Restore state on app restart
- Auto-expire state after 5 minutes
- Clean up on successful login

---

### 4.2 Enhanced Error Logging

**Priority:** 🟢 Low | **Effort:** Low

#### [MODIFY] [handlers.py](file:///c:/Users/yaros/Downloads/telethon/python/tg_service/handlers.py)

Add full error logging:

```diff
  async def handle_new_message(service, event, account_id: str) -> None:
      try:
          # ... processing
      except Exception as e:
+         import traceback
+         logger.error(f"Message handler error: {traceback.format_exc()}")
          service._write_notification({
              "type": "error",
-             "message": str(e),
+             "message": f"Handler error: {type(e).__name__}: {str(e)[:40]}",
          })
```

#### [MODIFY] [App.tsx](file:///c:/Users/yaros/Downloads/telethon/src/components/App.tsx)

Add error counter display:

```typescript
const [errorCount, setErrorCount] = useState(0);

// In notification handler:
if (notification.type === 'error') {
    setErrorCount(prev => prev + 1);
    addLog(`Error: ${notification.message}`);
}

// In header:
{errorCount > 0 && (
    <Text color="red"> {errorCount} errors</Text>
)}
```

**Changes:**
- Log full stack traces to stderr
- Include exception type in user message
- Show error counter in UI

---

### 4.3 Global Interval Cleanup

**Priority:** 🟢 Low | **Effort:** Low

#### [MODIFY] [App.tsx](file:///c:/Users/yaros/Downloads/telethon/src/components/App.tsx)

Move interval to React-managed lifecycle:

```diff
- // Shared animation phase for synchronized gradient animation
- let globalPhase = 0;
- setInterval(() => {
-     globalPhase = (globalPhase + 0.05) % (Math.PI * 2);
- }, 50);

+ // Animation context for synchronized gradients
+ const AnimationContext = createContext({ phase: 0 });
+
+ function AnimationProvider({ children }: { children: React.ReactNode }) {
+     const [phase, setPhase] = useState(0);
+     
+     useEffect(() => {
+         const interval = setInterval(() => {
+             setPhase(p => (p + 0.05) % (Math.PI * 2));
+         }, 50);
+         return () => clearInterval(interval);
+     }, []);
+     
+     return (
+         <AnimationContext.Provider value={{ phase }}>
+             {children}
+         </AnimationContext.Provider>
+     );
+ }
+
+ function useAnimationPhase() {
+     return useContext(AnimationContext).phase;
+ }
```

Wrap app in provider:

```typescript
export function App() {
    return (
        <AnimationProvider>
            <ConvexProvider>
                <AccountManager />
            </ConvexProvider>
        </AnimationProvider>
    );
}
```

**Changes:**
- Replace module-level interval with React context
- Proper cleanup on unmount
- Shared phase across all gradient components

---

## Verification Plan

### Manual Testing

Since this is a TUI application with external dependencies (Telegram API, Convex), automated testing is limited. Each phase should be manually verified:

**Phase 1 Tests:**
1. Start app, then kill Python process manually (`taskkill /f /im python.exe`)
   - ✓ Verify error notification appears
   - ✓ Verify automatic restart attempts
   - ✓ Verify pending operations are rejected promptly

2. Test timeout:
   - Add artificial delay in Python RPC handler
   - ✓ Verify timeout occurs after 15 seconds (not 60)

**Phase 2 Tests:**
1. Disconnect network while Telegram connected
   - ✓ Verify reconnection attempts logged
   - ✓ Verify reconnection succeeds when network restored

**Phase 3 Tests:**
1. Start app without `CONVEX_URL` set
   - ✓ Verify error message shown (not crash)
   
2. Test queue overflow:
   - Reduce queue size temporarily to 10
   - Send burst of messages
   - ✓ Verify messages written to disk
   - ✓ Verify disk queue processed

**Phase 4 Tests:**
1. Start login, get to code entry, then kill app
   - Restart app
   - ✓ Verify login state restored
   - ✓ Verify can continue with code entry

---

## User Review Required

> [!IMPORTANT]
> **Phase 3.2 (Persistent Queue)** is the highest-effort item. If this is not a priority, it can be deferred or simplified to just increase the in-memory queue size.

> [!WARNING]
> **Phase 2.1 (Telegram Reconnection)** modifies core connection logic. Recommend testing with a non-primary Telegram account first.
