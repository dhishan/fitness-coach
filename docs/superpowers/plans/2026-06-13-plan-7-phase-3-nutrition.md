# Plan 7 (Phase 3): Nutrition — AI Photo/Text Logging + Favorites + Goals

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Log food by photo or natural-language text (AI-estimated calories + macros via LiteLLM/gpt-4o-mini), build a favorites quick-log list, set/track daily calorie + macro goals with optional AI suggestion. Web + mobile.

**Architecture:**
- **Single LLM path** through existing `llm.complete` (LiteLLM) — no new providers. Estimation uses `gpt-4o-mini` for text and `gpt-4o-mini` vision for photos (config-swappable via `nutrition_model`).
- **Data model**: `food_logs/{id}` (one entry per food), `favorites/{id}` (user-saved templates), `goals/{id}` (singleton per user with current daily targets + history).
- **Image storage**: Cloud Storage bucket `fitness-tracker-uploads-prod`, signed-URL upload from client → backend reads URL into LiteLLM vision call. No image content reaches Firestore.
- **No USDA in Phase 3.** AI estimation is the entire logging surface; database search/barcode deferred to Phase 3.5/4 (open question per spec).
- **Goals**: user sets manually OR clicks "Suggest" → AI proposes based on profile + recent volume + bodyweight → user accepts/edits → stored. No silent autopilot.
- **Tab ordering**: web + mobile keep 5 tabs by moving Library behind a "Browse" link in Home (Workout tab's "+ Exercise" picker remains primary discovery path). New tab: **Nutrition**.

**Existing:** backend chat infra + LiteLLM wrapper accepts `model` override; usage metering captures any model; image-capable LiteLLM call is `messages = [{role:user, content:[{type:text}, {type:image_url, image_url:{url}}]}]`.

---

### Task 1: Schemas + Firestore indexes

**Files:** modify `backend/app/schemas.py`; add `terraform/main/indexes_nutrition.tf`.

```python
class Macros(BaseModel):
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)


class FoodLogCreate(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    name: str = Field(min_length=1, max_length=120)
    serving: str = ""   # "1 bowl", "200g", etc.
    macros: Macros
    source: Literal["ai_text", "ai_photo", "favorite", "manual"] = "manual"
    notes: str = ""


class FoodLogUpdate(BaseModel):
    name: str | None = None
    serving: str | None = None
    macros: Macros | None = None
    notes: str | None = None


class FavoriteCreate(BaseModel):
    name: str
    serving: str = ""
    macros: Macros


class GoalsUpdate(BaseModel):
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
```

Indexes (`indexes_nutrition.tf`):
- `food_logs (user_id ASC, date ASC)` and `(user_id ASC, date DESC)` for day + recent queries.
- `favorites (user_id ASC, last_used_at DESC)`.

`terraform validate` passes. Commit: "feat: nutrition schemas and firestore indexes".

### Task 2: Services + AI estimation

**Files:** `backend/app/services/food_service.py`, `backend/app/services/goals_service.py`, `backend/app/services/nutrition_ai.py`.

`nutrition_ai.py`:
- `estimate_from_text(text: str) -> dict`: single LiteLLM call to settings.nutrition_model (default `openai/gpt-4o-mini`), strict JSON-shaped response (use OpenAI's `response_format={"type":"json_object"}`) returning `{name, serving, macros: {calories, protein_g, carbs_g, fat_g}, confidence: 0..1}`. System prompt: "You estimate calories and macros for foods. Return JSON only. Be conservative; if unsure of portion, assume the most common serving size and say so in the name. Never invent precision."
- `estimate_from_image(image_url: str, hint: str = "") -> dict`: same shape via vision message (content array with image_url + optional hint text).
- Errors return `{error: str}`; callers translate to 422 with a clear message; nothing crashes silently.

`food_service.py`: create/list_by_date/update/delete; favorites CRUD with `last_used_at` updated on each use; `log_from_favorite(uid, favorite_id, date)` clones the favorite into a food log.

`goals_service.py`: `get_goals(uid)` (returns current or `None`), `set_goals(uid, payload)`, `suggest_goals(uid)` — calls LLM with `system: "Propose daily calorie + macro targets..."` plus context: recent training volume (4-week dashboard summary), bodyweight if present, stated goal text from user. Returns the proposal as Macros + a one-line rationale (NOT auto-applied — UI shows accept/edit).

TDD on each service. Commit per service file.

### Task 3: Image upload + nutrition API

**Files:** modify `backend/app/main.py` (mount uploads route), add `backend/app/routers/uploads.py`, `backend/app/routers/nutrition.py`; terraform addition for GCS bucket.

Upload endpoint `POST /api/v1/uploads/sign-food-photo` → returns a v4 signed URL (PUT, 5-min TTL) plus the `gs://` + `https://` paths. Client uploads directly to the bucket; backend never proxies bytes.

Nutrition router `/api/v1/nutrition`:
- `POST /estimate/text` `{text}` → estimation dict
- `POST /estimate/photo` `{image_url, hint?}` → estimation dict
- `POST /logs` `FoodLogCreate` → stored log
- `GET /logs?date=YYYY-MM-DD` → day's logs with daily totals
- `PUT/DELETE /logs/{id}`
- `GET /favorites` / `POST /favorites` / `DELETE /favorites/{id}` / `POST /favorites/{id}/log?date=`
- `GET /goals` / `PUT /goals` / `POST /goals/suggest`

Terraform: bucket `fitness-tracker-uploads-${env}`, lifecycle rule delete objects after 30 days (estimation only needs the image transiently), CORS for the UI origin, IAM: Cloud Run SA roles/storage.objectAdmin on the bucket; signing requires `iam.serviceAccountTokenCreator` on the runtime SA (grant via `google_service_account_iam_member`).

Commit per group: services + uploads infra + router.

### Task 4: Web Nutrition tab

- App.tsx nav: replace Library tab with **Nutrition**; Library accessible via Home "Browse exercises" link.
- `src/pages/Nutrition.tsx`:
  - Date strip (Today / yesterday / picker), totals card (calories + 3 macros vs goals, colored rings/bars) — honest empty when goals not set.
  - Composer with three buttons: **Camera** (file input accept="image/*" capture="environment" → upload via signed URL → estimate/photo → preview card with editable name/serving/macros → save), **Type a meal** (text input → estimate/text → same preview card → save), **From favorites** (sheet listing favorites by last_used).
  - Day list grouped by meal-time if `created_at` present (Breakfast/Lunch/Dinner/Snacks heuristic by hour) else flat.
  - Per-row Edit/Delete and "Save as favorite" action.
  - Goals card: shows current goals + "Suggest with AI" → modal showing proposed macros + rationale + Accept/Edit/Cancel.
- Honest empty states; ASCII text.

Commit: "feat: web nutrition tab with AI photo/text logging, favorites, goals".

### Task 5: Mobile Nutrition tab

Same UX, native components:
- `mobile/app/(tabs)/nutrition.tsx` mirroring the web layout.
- Camera: `expo-image-picker` for capture + library; resize via `expo-image-manipulator` to max 1024px before upload to keep estimation cost down; expo-secure-store / RN-fetch upload to signed URL.
- Goals modal, favorites sheet.

Reuse types from @fitness/shared-types (Macros, FoodLog, Favorite, Goals — add them in shared-types).

Commit per logical chunk: shared-types, screen, polish.

### Task 6: Deploy + live verification

- [ ] `terraform apply` provisions bucket + IAM; CI green; controller smoke (Python script):
  - upload a small test image to the signed URL, call `/estimate/photo` → returns macros with confidence > 0.3
  - call `/estimate/text` with "two scrambled eggs and a slice of toast" → reasonable kcal in 200..400 range
  - create a goal, log 2 foods, GET /logs?date= → totals match
- [ ] User smoke in the web app: photo of dinner, save, see day totals, set goal, ask AI to suggest goals.
- [ ] Tag `plan-7-phase-3-complete`.

---

## Open questions (parked)

- **USDA / OpenFoodFacts database lookups** — not in Phase 3. Add as Phase 3.5 if AI estimation accuracy is insufficient in practice.
- **Bodyweight tracking** is referenced for goal suggestions but not stored yet. If we wire `suggest_goals` to actual body metrics, those become Phase 4 scope. For now `suggest_goals` accepts an optional `bodyweight_kg` arg the UI prefills from a TextInput.

## Self-review

- AI cost lands in the existing `usage_events` log (record_usage from the same service); model field reflects `nutrition_model`.
- Image flow keeps bytes out of Firestore and out of our backend (signed upload direct to GCS), short retention, controlled by bucket lifecycle.
- Goals are explicit; AI never silently changes targets.
- No fake portions or placeholder macros anywhere — estimation always returns a confidence and the UI shows it as a chip.
