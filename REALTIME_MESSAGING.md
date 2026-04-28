# Messaging A → Z (REST + Socket.IO + FCM)

## A. Firebase Console (one-time)

1. Create / open the Firebase project.
2. **Project settings → Service accounts → Generate new private key** → download JSON.
3. Store the file **outside git** (or rely on `.gitignore` patterns) and point the server to it with **`FIREBASE_SERVICE_ACCOUNT_PATH`** (see **B**).
4. Mobile: add the app (Android/iOS), enable **Cloud Messaging**, integrate the **Firebase SDK**, obtain an **FCM registration token**.

## B. Server env (pick one)

| Variable | Use |
|----------|-----|
| **`FIREBASE_SERVICE_ACCOUNT_PATH`** (recommended) | Path to the JSON file, **relative to project root** unless absolute, e.g. `./your-adminsdk.json` |
| **`FIREBASE_SERVICE_ACCOUNT_JSON`** | Entire JSON as one string |
| **`GOOGLE_APPLICATION_CREDENTIALS`** | Absolute path to the JSON file |

If **none** are set, **FCM is skipped**; REST chat still works.

## C. Database

```bash
npx prisma db push
```

## D. REST — chat (`Authorization: Bearer <access_jwt>`)

Base: **`/api/chat`**

| Method | Path | Purpose |
|--------|------|--------|
| `POST` | `/conversations/direct` | Body `{ "userId": "<otherUserId>" }` — get or create 1:1 conversation |
| `GET` | `/conversations` | List conversations (`limit` optional) |
| `GET` | `/conversations/:conversationId/messages` | Paginated messages (`cursor`, `limit`) |
| `POST` | `/conversations/:conversationId/messages` | **Send** — persists message, then **FCM** to other members |
| `POST` | `/conversations/:conversationId/read` | Body `{ "lastReadMessageId": "<id>" }` |

## E. REST — FCM device token

Base: **`/api/me/fcm-token`**

| Method | Body | Response |
|--------|------|----------|
| `POST` | `{ "token": "<fcm_token>" }` | `201` `{ "status":"success","data":{"registered":true} }` |
| `DELETE` | `{ "token": "<fcm_token>" }` | `200` removed or `404` if unknown for this user |

Register after login; remove on logout / invalid token.

## F. REST — notification preference (enable/disable FCM)

Base: **`/api/me/notification-preferences`**

### `PATCH /api/me/notification-preferences`

**Body:**

```json
{ "fcmEnabled": true }
```

**Response (200):**

```json
{ "status": "success", "data": { "fcmNotificationsEnabled": true } }
```

When `fcmEnabled` is `false`, the server **will not send FCM** to that user’s tokens for new messages.

## G. Socket.IO (real-time in-app)

### Connect

- **URL:** same host as API (no `/api` prefix), default path `/socket.io`
- **Auth:** pass access JWT in `auth.token` (recommended) or query `token`

### Rooms (server-side)

- `user:<userId>` — joined automatically on connect (inbox / multi-device)
- `conv:<conversationId>` — joined when client emits `conversation:join` (active chat thread)

### Client → server events

- **`conversation:join`**
  - payload: `{ "conversationId": "<id>" }`
  - ack: `{ "ok": true }` or `{ "ok": false, "error": "<string>" }`
- **`conversation:leave`**
  - payload: `{ "conversationId": "<id>" }`
- **`message:send`** (optional alternative to REST send)
  - payload:

```json
{
  "conversationId": "<id>",
  "type": "text",
  "text": "hi"
}
```

  - ack: `{ "ok": true, "data": { "message": { ... } } }` or `{ "ok": false, "error": "<string>" }`

### Server → client events

- **`message:new`**
  - payload: `{ "conversationId": "<id>", "message": { ... } }`
  - emitted to: `conv:<id>` and each member’s `user:<id>`
  - client should **dedupe by `message.id`**

## H. FCM data payload (after each successful send)

- **Recipients:** conversation members **except the sender**.
- **Data keys** (all string values): `type` (`new_message`), `conversationId`, `messageId`, `senderId`, `messageType`, `textPreview`, `createdAt`.

Handle in the app for **foreground**; for system notifications, extend client/server as needed.

## G. Flow (short)

| Piece | Role |
|--------|------|
| **REST** | Create/list/read messages — **source of truth** |
| **Socket.IO** | Real-time in-app updates (`message:new`) |
| **FCM** | Push notifications / background delivery signal (if enabled + token registered) |

Both **Socket.IO** and **FCM** are used: sockets for real-time, FCM for push.
