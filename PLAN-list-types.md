# Plan: List Types (Grocery vs Task) with Accountability System

## Summary

Split lists into two types:
- **Grocery lists**: Shared within household, items have quantity/description, pantry/recipe integration
- **Task lists**: Personal/private, items have due date/reminder/recurrence, aggressive multi-channel notification system with LLM accountability partner

## Requirements Gathered

### List Behavior
| Aspect | Grocery | Task |
|--------|---------|------|
| Sharing | Household-shared | Personal/private |
| Item fields | quantity, description | due_date, reminder, recurrence |
| Categories | Yes | No |
| Pantry integration | Yes | No |
| Recipe integration | Yes | No |
| Completion behavior | Checked (show/hide) | Archived + history kept |

### Task Reminder System
- **Escalation ladder** (quick timing):
  1. Push notification at reminder time
  2. SMS +5 min if no response
  3. Phone call +15 min (TTS reads task, records voice response)
  4. Repeat call every 30 min until resolved

- **Response channels**: In-app modal, notification reply, SMS reply, voice response (all processed by LLM)

- **LLM accountability partner**: Firm, demands specifics for vague responses ("later" → "when exactly?"), personality tunable later

- **Escape hatch**: Safe word (configurable) → notifies accountability partner via SMS with explanation of what was abandoned

### Other Features
- Recurring tasks: auto-create next occurrence on completion, keep history
- Voice input: works for both types, natural date parsing for tasks
- Due date + reminder both optional, reminder can be absolute or relative to due

---

## Implementation Phases

### Phase 1: Database & Models (Foundation)

**Migration 1**: Add list_type to lists table
```
ALTER TABLE lists ADD COLUMN list_type VARCHAR(10) DEFAULT 'grocery' NOT NULL;
```

**Migration 2**: Add task fields to items table
```
ALTER TABLE items ADD COLUMN due_date TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN reminder_at TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN reminder_offset VARCHAR(20);  -- "1h", "1d"
ALTER TABLE items ADD COLUMN recurrence_pattern VARCHAR(10);  -- daily/weekly/monthly
ALTER TABLE items ADD COLUMN recurrence_parent_id INTEGER REFERENCES items(id);
ALTER TABLE items ADD COLUMN completed_at TIMESTAMPTZ;
CREATE INDEX ix_items_reminder_at ON items(reminder_at);
CREATE INDEX ix_items_due_date ON items(due_date);
```

**Migration 3**: Notification system tables
```
CREATE TABLE reminder_state (
  id SERIAL PRIMARY KEY,
  item_id INTEGER REFERENCES items(id) NOT NULL,
  current_escalation_level INTEGER DEFAULT 0,  -- 0=push, 1=sms, 2=call
  last_escalation_at TIMESTAMPTZ,
  next_escalation_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending',  -- pending/acknowledged/completed/escaped
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reminder_responses (
  id SERIAL PRIMARY KEY,
  reminder_state_id INTEGER REFERENCES reminder_state(id),
  channel VARCHAR(20) NOT NULL,  -- push/sms/call/app
  raw_response TEXT NOT NULL,
  llm_interpretation JSONB,  -- {action: "reschedule", new_time: "...", pushback: "..."}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh_key VARCHAR(200) NOT NULL,
  auth_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

CREATE TABLE user_notification_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) UNIQUE NOT NULL,
  phone_number VARCHAR(20),  -- for SMS/call
  accountability_partner_phone VARCHAR(20),  -- partner's phone for escape notifications
  escape_safe_word VARCHAR(50) DEFAULT 'abort',
  escalation_timing JSONB DEFAULT '{"push_to_sms": 5, "sms_to_call": 15, "call_repeat": 30}',
  quiet_hours_start TIME,  -- e.g., 23:00
  quiet_hours_end TIME,  -- e.g., 07:00
  quiet_hours_timezone VARCHAR(50) DEFAULT 'America/Toronto'
);
```

**Files to modify:**
- `src/models/list.py` - add `list_type` field
- `src/models/item.py` - add task-specific fields
- `src/models/reminder_state.py` (new)
- `src/models/push_subscription.py` (new)
- `src/models/user_notification_settings.py` (new)
- `src/schemas/list.py` - add `list_type` to create/response
- `src/schemas/item.py` - add task item schemas

---

### Phase 2: Core API Changes

**List endpoints** (`src/api/lists.py`):
- Accept `list_type` in create (immutable after)
- Return `list_type` in response

**Item endpoints** (`src/api/items.py`):
- Validate item fields match list type
- Add `/items/{id}/complete` endpoint for task completion
- Handle recurrence (create next occurrence)
- Schedule reminder in `reminder_state` when creating task with reminder

**Category endpoints** (`src/api/categories.py`):
- Block category creation for task lists

**Recipe endpoints** (`src/api/recipes.py`):
- Filter "add to list" to only show grocery lists

**New notification endpoints** (`src/api/notifications.py`):
- `POST /notifications/subscribe` - register push subscription
- `DELETE /notifications/subscribe` - unsubscribe
- `GET /notifications/vapid-public-key`
- `POST /notifications/respond` - submit response from app
- `POST /notifications/settings` - update phone, accountability partner, etc.

**New webhook endpoints** (`src/api/webhooks.py`):
- `POST /webhooks/twilio/sms` - incoming SMS response
- `POST /webhooks/twilio/voice` - voice call status/recording

---

### Phase 3: Notification Engine (Celery)

**New service** (`src/services/notification_service.py`):
```python
class NotificationService:
    def send_push(subscription, title, body, item_id)
    def send_sms(phone, message, item_id)  # via Twilio
    def initiate_call(phone, item_id)  # via Twilio
    def send_accountability_sms(partner_phone, task_name, original_due, user_name)  # via Twilio
```

**Celery beat schedule** - check every minute:
```python
'process-reminder-escalations': {
    'task': 'src.tasks.reminders.process_escalations',
    'schedule': 60.0,
}
```

**Reminder task** (`src/tasks/reminders.py`):
```python
@celery_app.task
def process_escalations():
    """Find reminder_states needing escalation and process them."""
    now = datetime.now(UTC)

    # Skip users in quiet hours
    def is_in_quiet_hours(user_settings):
        if not user_settings.quiet_hours_start:
            return False
        user_tz = ZoneInfo(user_settings.quiet_hours_timezone)
        local_time = now.astimezone(user_tz).time()
        # Handle overnight quiet hours (e.g., 23:00-07:00)
        if user_settings.quiet_hours_start > user_settings.quiet_hours_end:
            return local_time >= user_settings.quiet_hours_start or local_time < user_settings.quiet_hours_end
        return user_settings.quiet_hours_start <= local_time < user_settings.quiet_hours_end

    # Find pending reminders whose next_escalation_at has passed
    pending = db.query(ReminderState).filter(
        ReminderState.status == 'pending',
        ReminderState.next_escalation_at <= now
    ).all()

    for reminder in pending:
        if reminder.current_escalation_level == 0:
            send_push(...)
            reminder.current_escalation_level = 1
            reminder.next_escalation_at = now + timedelta(minutes=5)
        elif reminder.current_escalation_level == 1:
            send_sms(...)
            reminder.current_escalation_level = 2
            reminder.next_escalation_at = now + timedelta(minutes=15)
        elif reminder.current_escalation_level == 2:
            initiate_call(...)
            reminder.next_escalation_at = now + timedelta(minutes=30)
            # stays at level 2, keeps calling
```

**Response processing task** (`src/tasks/reminders.py`):
```python
@celery_app.task
def process_reminder_response(reminder_state_id, channel, raw_response):
    """Use LLM to interpret response and decide next action."""
    # Get context
    reminder = db.query(ReminderState).get(reminder_state_id)
    item = reminder.item

    # Call LLM
    llm_result = llm_service.evaluate_reminder_response(
        task_name=item.name,
        due_date=item.due_date,
        raw_response=raw_response,
    )

    # llm_result structure:
    # {
    #   "action": "complete" | "reschedule" | "pushback" | "escape",
    #   "new_reminder_at": "2025-01-02T15:00:00Z",  # if reschedule
    #   "pushback_message": "When exactly will you do this?",  # if pushback
    # }

    if llm_result["action"] == "complete":
        reminder.status = "completed"
        item.checked = True
        item.completed_at = now
        # handle recurrence...
    elif llm_result["action"] == "reschedule":
        reminder.next_escalation_at = llm_result["new_reminder_at"]
        reminder.current_escalation_level = 0  # reset escalation
    elif llm_result["action"] == "pushback":
        # Send pushback message via same channel
        send_pushback(channel, llm_result["pushback_message"])
    elif llm_result["action"] == "escape":
        reminder.status = "escaped"
        send_accountability_sms(...)
```

---

### Phase 4: Twilio Integration

**Environment variables**:
```
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=...
```

**Voice call flow** (TwiML):
```xml
<Response>
  <Say>Reminder: {task_name}. Please say your response after the beep.</Say>
  <Record maxLength="60" transcribe="true"
          transcribeCallback="/api/v1/webhooks/twilio/transcription"/>
</Response>
```

**SMS webhook** (`src/api/webhooks.py`):
```python
@router.post("/webhooks/twilio/sms")
def handle_sms_response(From: str, Body: str):
    # Look up user by phone number
    # Find active reminder for that user
    # Queue response processing task
    process_reminder_response.delay(reminder_id, "sms", Body)
```

**Dependencies**: `pyproject.toml`
```
twilio = "^8.0.0"
pywebpush = "^1.14.0"
```

---

### Phase 5: Frontend Changes

**List creation** (`web/src/app/lists/page.tsx`):
- Add type selector toggle (Grocery / Task)
- Pass `list_type` to API

**List detail** (`web/src/app/list/[id]/page.tsx`):
- Conditional rendering based on `list.list_type`
- Task mode: hide categories, show due date/reminder fields
- Task mode: different item component (TaskItem)
- Hide pantry prompt for task lists

**New TaskItem component** (`web/src/components/TaskItem.tsx`):
- Shows due date, overdue indicator
- Shows reminder status
- Complete button (not just check)
- Recurrence indicator

**Response modal** (`web/src/components/ReminderResponseModal.tsx`):
- Opens when clicking push notification (via URL param)
- Text input for natural language response
- Shows LLM pushback if any
- Submit → API → Celery task

**Push subscription** (`web/src/lib/pushNotifications.ts`):
- Request notification permission
- Subscribe to push
- Send subscription to API

**Service worker** (`web/public/sw.js`):
- Handle push events
- Show notification with reply action
- Handle notification click → open app to response modal

**Voice confirm page** (`web/src/app/confirm/page.tsx`):
- Show due date/reminder fields for task items
- Different field layout based on pending item's target list type

**Notification settings** (`web/src/app/settings/page.tsx` - may need to create):
- Phone number input
- Accountability partner phone number
- Escape safe word
- Quiet hours start/end
- Test notification button

**Completion history** (`web/src/components/TaskCompletionHistory.tsx`):
- Shows for recurring tasks
- List of past completion dates
- Expandable/collapsible in task detail view

---

### Phase 6: Voice Processing Updates

**Voice prompts** (`src/services/llm_prompts.py`):
- Add task-aware parsing prompt
- Extract due dates naturally ("tomorrow at 3pm" → datetime)
- Extract reminder preferences ("remind me 1 hour before")

**Voice processing task** (`src/tasks/voice_processing.py`):
- Detect target list type
- Use appropriate prompt
- Include parsed due_date/reminder in proposed changes

---

### Phase 7: Docker & Infrastructure

**docker-compose.yml**:
- Add `celery-beat` service for scheduled tasks
- Add environment variables for Twilio/VAPID

**Cloudflare/nginx**:
- Ensure `/api/v1/webhooks/*` routes work for Twilio callbacks

---

## File Change Summary

### New Files
- `src/models/reminder_state.py`
- `src/models/push_subscription.py`
- `src/models/user_notification_settings.py`
- `src/schemas/reminder.py`
- `src/schemas/notification.py`
- `src/services/notification_service.py`
- `src/tasks/reminders.py`
- `src/api/notifications.py`
- `src/api/webhooks.py`
- `web/src/components/TaskItem.tsx`
- `web/src/components/ReminderResponseModal.tsx`
- `web/src/components/TaskCompletionHistory.tsx`
- `web/src/app/settings/page.tsx`
- `web/src/lib/pushNotifications.ts`
- `web/public/sw.js`
- `tests/test_list_types.py`
- `tests/test_reminders.py`
- `tests/test_notifications.py`

### Modified Files
- `src/models/list.py` - add list_type
- `src/models/item.py` - add due_date, reminder_at, etc.
- `src/models/__init__.py` - export new models
- `src/schemas/list.py` - add list_type to schemas
- `src/schemas/item.py` - add task item schemas
- `src/api/lists.py` - handle list_type in create
- `src/api/items.py` - validate by list type, add complete endpoint
- `src/api/categories.py` - block for task lists
- `src/api/recipes.py` - filter to grocery lists only
- `src/tasks/voice_processing.py` - task-aware parsing
- `src/services/llm_prompts.py` - add task parsing prompt
- `src/celery_app.py` - add beat schedule
- `src/main.py` - include new routers
- `web/src/lib/api.ts` - add types and methods
- `web/src/app/lists/page.tsx` - type selector
- `web/src/app/list/[id]/page.tsx` - conditional task mode
- `web/src/app/confirm/page.tsx` - task fields
- `docker-compose.yml` - add celery-beat

---

## External Services Required

1. **Twilio** - SMS and voice calls
   - Account SID, Auth Token, Phone Number
   - Configure webhook URLs in Twilio console

2. **VAPID keys** - Web push notifications
   - Generate with `npx web-push generate-vapid-keys`

---

## Resolved Design Decisions

1. **Escape safe word**: Configurable per-user (default: "abort")
2. **Quiet hours**: Yes, configurable start/end time with timezone
3. **Completion history**: Yes, visible history view for recurring tasks

---

## Suggested Implementation Order

1. Phase 1 (DB/Models) + Phase 2 (Core API) - get list types working
2. Phase 5 (Frontend) - basic task UI without notifications
3. Phase 6 (Voice) - task parsing
4. Phase 3 (Notification Engine) + Phase 4 (Twilio) - the accountability system
5. Phase 7 (Docker) - celery-beat for production
6. Polish, testing, edge cases
