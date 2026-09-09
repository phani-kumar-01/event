# REST API Documentation

Base URL: `http://localhost:3001/api`

## Authentication

All protected endpoints require the `Authorization` header:
```http
Authorization: Bearer <jwt_token>
```

---

### 1. `POST /auth/login`
Authenticate a student or admin user.

**Request Body:**
```json
{
  "rollNo": "CS001",
  "password": "student123"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsIn...",
  "user": {
    "id": "cuid123",
    "rollNo": "CS001",
    "name": "Jane Doe",
    "role": "STUDENT"
  }
}
```

---

## Student APIs

### 2. `GET /current-event`
Retrieves current running or scheduled event status, active round, timers, and student qualification state.

**Response (200 OK):**
```json
{
  "event": {
    "id": "event_id_1",
    "type": "TECHNICAL_QUIZ",
    "name": "Technical Quiz Arena 2026",
    "status": "RUNNING",
    "currentRound": 1,
    "round1Status": "RUNNING",
    "round2Status": "DRAFT",
    "startTime": "2026-09-09T10:00:00.000Z",
    "endTime": "2026-09-09T10:30:00.000Z",
    "durationSeconds": 1800
  },
  "isQualified": true,
  "locked": false
}
```

---

### 3. `GET /events/:id/quiz-challenges`
Returns challenge stages configured for the student's active round.

**Response (200 OK):**
```json
{
  "challenges": [
    {
      "id": "ch_1",
      "round": 1,
      "type": "RAPID_FIRE",
      "title": "Stage 1: Rapid Fire",
      "subtitle": "Quick recall trivia",
      "points": 100,
      "isActive": true
    },
    {
      "id": "ch_2",
      "round": 1,
      "type": "GUESS_THE_TECH",
      "title": "Stage 2: Guess The Tech",
      "subtitle": "Image identification",
      "points": 100,
      "isActive": true
    }
  ]
}
```

---

### 4. `GET /events/:id/quiz-questions`
Retrieves questions for the student's active round (with `correctAnswer` stripped for security).

**Response (200 OK):**
```json
{
  "questions": [
    {
      "id": "q_1",
      "challengeId": "ch_1",
      "round": 1,
      "category": "AI",
      "type": "MCQ",
      "question": "What does Transformer architecture rely on?",
      "imageUrl": "",
      "optionA": "Self-Attention Mechanism",
      "optionB": "Convolutional Kernels",
      "optionC": "Recurrent Cells",
      "optionD": "Markov Chains",
      "points": 10
    }
  ]
}
```

---

### 5. `POST /events/:id/quiz-answers`
Submit student answer for a quiz question.

**Request Body:**
```json
{
  "questionId": "q_1",
  "selectedAnswer": "A",
  "timeTakenSeconds": 12
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "isCorrect": true,
  "pointsAwarded": 10
}
```

---

### 6. `POST /events/:id/run-code`
Run student C code against test cases in preview sandbox without recording an official submission.

**Request Body:**
```json
{
  "problemId": "prob_1",
  "code": "#include <stdio.h>\nint main() { printf(\"Hello World\"); return 0; }"
}
```

**Response (200 OK):**
```json
{
  "compiled": true,
  "output": "Hello World",
  "compileOutput": "",
  "testResults": [
    {
      "testCaseIndex": 0,
      "passed": true,
      "actual": "Hello World",
      "expected": "Hello World"
    }
  ]
}
```

---

### 7. `POST /events/:id/submit-code`
Submit final C code solution for problem scoring.

**Request Body:**
```json
{
  "problemId": "prob_1",
  "code": "..."
}
```

---

## Admin APIs

### 8. `POST /admin/events/:id/qualify-round1`
Locks in Round 1 standings, promotes top 10 finalists to Round 2, and sets `isQualified = true`.

**Response (200 OK):**
```json
{
  "message": "Top 10 qualifiers confirmed for Round 2",
  "qualifiers": [
    {
      "rollNo": "CS014",
      "name": "Alex Smith",
      "round1Score": 380,
      "round1Rank": 1,
      "round1Time": 412
    }
  ]
}
```

---

### 9. `POST /admin/quiz-questions/upload-image`
Upload question image (`multipart/form-data`, file field name: `image`, max 5MB).

**Response (200 OK):**
```json
{
  "imageUrl": "/uploads/questions/1725901234567-891011.png"
}
```

---

### 10. `POST /admin/quiz-questions`
Create a question with category and image validation.

**Request Body:**
```json
{
  "eventId": "event_1",
  "challengeId": "ch_2",
  "round": 1,
  "category": "GADGETS",
  "type": "MCQ",
  "question": "Identify this micro-controller:",
  "imageUrl": "/uploads/questions/1725901234567-891011.png",
  "optionA": "Raspberry Pi Pico",
  "optionB": "Arduino Uno",
  "optionC": "ESP32",
  "optionD": "STM32",
  "correctAnswer": "A",
  "points": 10
}
```

